#!/usr/bin/env python3
"""defter — Opus Orkestra bağlam defteri (yalnız standart kütüphane + git).

Amaç: alt agent'lar kodu her seferinde baştan okumasın. Bir agent işini bitirince dokunduğu
dosyaların özetini yazar; defter dosyanın o anki içeriğini git nesne deposuna (`hash-object -w`)
kaydeder. Sonraki agent `oku` ile özeti ve yalnız o andan beri değişen kısmı (commit edilmemiş
değişiklikler dahil) alır; dosyanın tamamını ancak gerekirse okur.

Depo: `<git-common-dir>/orkestra/defter.jsonl` — depoya girmez, worktree'ler arasında ortaktır.

Komutlar:
  defter yaz --dosya YOL [--dosya YOL ...] --ozet METİN [--kavram "ad: açıklama" ...] [--gorev METİN]
  defter oku [YOL ...] [--sinir SATIR]     özet + kayıttan beri fark (yol verilmezse defter özeti
                                            ve tüm dosyalar)
  defter kavram                             kayıtlı kavramlar (her adın en son tanımı)
  defter durum                              kart sayısı, boyut, en eski/yeni kayıt
  defter ozetle [--eski N] [--yerel MODEL]  DENEYSEL: eski kartları (ve önceki defter özetini)
                                            sıkıştırma girdisi yapar; --yerel ile `ollama run MODEL`
                                            özetler ve özet kartı yazar
  defter temizle --tut N                    son N kartı (özet kartları sayılmaz) ve en son özet kartını
                                            tutar; bir dosyanın ya da kavramın en son kaydını taşıyan
                                            kart da silinmez, yani `oku`/`kavram` çıktısı bilgi kaybetmez

Eşzamanlılık: defteri değiştiren her adım (`yaz`, `temizle`, `ozetle --yerel` kaydı) aynı klasördeki
`defter.kilit` üzerinde işletim sistemi kilidi alır (Windows `msvcrt.locking`, diğerleri `flock`).
Kilidi tutan süreç ölürse kilidi işletim sistemi bırakır. Kilit `DEFTER_KILIT_SURE` saniye (varsayılan
30) içinde alınamazsa komut açık bir hatayla çıkar, asılı kalmaz. Okuyan komutlar kilit beklemez.

Budanma koruması: defterin başvurduğu kayıt içerikleri `refs/orkestra/defter` adlı tek bir ref'in
gösterdiği ağaçta tutulur, böylece `git gc` onları budamaz. Ağaç her `yaz`/`temizle` sonrası
defterden yeniden kurulur; defterden düşen içerik serbest kalır. Ref bir ağacı gösterir (commit
değil): dal, etiket, `git status`, `git log --all` ve varsayılan `git push` onu görmez; ama
`git push --mirror`, `refs/*` refspec'i ve `git clone --mirror` onu ve içindeki commit edilmemiş
içeriği taşır.

Git dışı içerik: defter yalnız git'in görebileceği dosyaları kaydeder. Depo dışı yollar, git'in kendi
klasörü ve git'in yok saydığı izlenmeyen dosyalar (.gitignore/exclude; ör. `.env`) nesne deposuna hiç
yazılmaz: `yaz` onları atlar, uyarır, kalan dosyaları kaydeder. Eski sürümün yazdığı böyle kayıtların
içeriği koruma ağacına girmez (her `yaz`/`temizle` ağacı yeniden kurar), `temizle` kayıtları defterden
çıkarır; nesneyi hemen silmek için ardından `git gc --prune=now`.

Git güvenliği: git (ve `ollama`) PATH'in mutlak klasörlerinden tam yoluyla çağrılır, çalışma
klasöründeki `git.exe` çalışmaz. Deponun yapılandırmasındaki dış komutlar çalışmaz: `core.fsmonitor`,
kancalar (`update-ref` → `reference-transaction`), `diff.external`/diff sürücüsü/textconv ve
`filter.<ad>.clean`/`process` sürücüleri kapalıdır.
"""

from __future__ import annotations

import argparse
import contextlib
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone

OZET_SINIR = 1500
KAVRAM_SINIR = 240
VARSAYILAN_FARK_SINIRI = 160
KILIT_SURE = 30.0
KILIT_BAYT = 1 << 20  # Windows'ta kilitlenen bayt; sahip bilgisi dosyanın başında okunabilir kalır
KORUMA_REF = "refs/orkestra/defter"
_NESNE_ADI = re.compile(r"^[0-9a-f]{40}(?:[0-9a-f]{24})?$")


class DefterHatasi(Exception):
    pass


_CALISTIRILABILIR: dict[str, str | None] = {}


def calistirilabilir(ad: str) -> str | None:
    """`ad` programının PATH'teki mutlak yolu; yoksa None. Yalnız mutlak PATH klasörlerine bakılır:
    çalışma klasörü ve göreli PATH girdileri aranmaz. Windows'ta `subprocess.run(["git", ...])`
    (CreateProcess) `NoDefaultCurrentDirectoryInExePath` tanımlı değilse çalışma klasöründeki `git.exe`yi
    PATH'tekinin önüne koyar; incelenen bir depo kökünde `git.exe` taşıyabilir."""
    if ad not in _CALISTIRILABILIR:
        bulunan = None
        uzantilar = (".exe",) if os.name == "nt" else ("",)
        for dizin in os.environ.get("PATH", "").split(os.pathsep):
            dizin = dizin.strip().strip('"')
            if not dizin or not os.path.isabs(dizin):
                continue
            for u in uzantilar:
                aday = os.path.join(dizin, ad + u)
                if os.path.isfile(aday) and os.access(aday, os.X_OK):
                    bulunan = aday
                    break
            if bulunan:
                break
        _CALISTIRILABILIR[ad] = bulunan
    return _CALISTIRILABILIR[ad]


def _git_yolu() -> str:
    git = calistirilabilir("git")
    if git is None:
        raise DefterHatasi("git bulunamadı: PATH'teki mutlak bir klasörde git olmalı "
                           "(çalışma klasöründeki git kullanılmaz)")
    return git


# Deponun yapılandırmasıyla (`.git/config`, `.git/hooks`) dış komut çalıştırabilecek ayarlar kapalı:
# `core.fsmonitor` (index okuyan komutlar), kancalar (`update-ref` `reference-transaction` kancasını
# çalıştırır). `core.hooksPath` bu dosyanın kendisini gösterir: bir dosyanın altında kanca olamaz.
# Dış diff/textconv `git diff`'te bayrakla, filtre sürücüleri `blob`ta kapatılır.
_GUVENLI_AYARLAR = ("-c", "core.fsmonitor=false",
                    "-c", "core.hooksPath=" + os.path.abspath(__file__).replace(os.sep, "/"))


def _git_calistir(args: tuple[str, ...], cwd: str | None, env: dict | None,
                  girdi: str | None) -> subprocess.CompletedProcess:
    return subprocess.run([_git_yolu(), *_GUVENLI_AYARLAR, *args], cwd=cwd, capture_output=True, text=True,
                          encoding="utf-8", errors="replace", env=env, input=girdi)


def _git(*args: str, cwd: str | None = None, check: bool = True, env: dict | None = None,
         girdi: str | None = None) -> str:
    p = _git_calistir(args, cwd, env, girdi)
    if check and p.returncode != 0:
        raise DefterHatasi(f"git {' '.join(args[:2])} başarısız: {p.stderr.strip()[:200]}")
    return p.stdout


def _git_rc(*args: str, cwd: str | None = None, env: dict | None = None,
            girdi: str | None = None) -> tuple[int, str]:
    p = _git_calistir(args, cwd, env, girdi)
    return p.returncode, p.stdout


def kok() -> str:
    _git_yolu()  # git yoksa bunu söyle, "depo içinde çalıştır" deme
    try:
        return _git("rev-parse", "--show-toplevel").strip()
    except (DefterHatasi, FileNotFoundError) as e:
        raise DefterHatasi("bir git deposunun içinde çalıştır (defter depo başına tutulur)") from e


def defter_yolu(k: str) -> str:
    ortak = _git("rev-parse", "--git-common-dir", cwd=k).strip()
    if not os.path.isabs(ortak):
        ortak = os.path.join(k, ortak)
    return os.path.join(os.path.normpath(ortak), "orkestra", "defter.jsonl")


def goreli(k: str, yol: str) -> str:
    mutlak = os.path.abspath(yol)
    return os.path.relpath(mutlak, k).replace(os.sep, "/")


def _icinde(yol: str, ust: str) -> bool:
    yol, ust = os.path.normcase(yol), os.path.normcase(ust)
    try:
        return os.path.commonpath([yol, ust]) == ust
    except ValueError:  # Windows'ta farklı sürücü
        return False


def git_disi(k: str, rels: list[str]) -> dict[str, str]:
    """Defterin içeriğini git'e yazmayacağı yollar -> neden. Kullanıcının bilerek git dışında tuttuğu
    içerik nesne deposuna sabitlenmez (`refs/orkestra/defter` `git push --mirror` ile gider): depo dışı
    yollar, git'in kendi klasörü ve git'in yok saydığı izlenmeyen dosyalar (.gitignore, info/exclude,
    core.excludesFile). İzlenen dosya, deseni eşleşse de kabul edilir (içeriği zaten git'te). Yol
    gerçek yoluna (sembolik bağlar çözülerek) göre değerlendirilir: `hash-object` bağı izler."""
    gercek_kok = os.path.realpath(k)
    git_dizinleri = [os.path.realpath(d if os.path.isabs(d) else os.path.join(k, d)) for d in
                     _git("rev-parse", "--git-dir", "--git-common-dir", cwd=k).splitlines() if d.strip()]
    nedenler: dict[str, str] = {}
    sorulacak: dict[str, list[str]] = {}  # gerçek göreli yol -> bu yola çıkan kayıt yolları
    for rel in dict.fromkeys(rels):
        gercek = os.path.realpath(os.path.join(k, rel))
        if not _icinde(gercek, gercek_kok):
            nedenler[rel] = "depo dışında"
            continue
        g = os.path.relpath(gercek, gercek_kok).replace(os.sep, "/")
        if (g == "." or any(p.casefold() == ".git" for p in g.split("/"))
                or any(_icinde(gercek, d) for d in git_dizinleri)):
            nedenler[rel] = "git'in kendi klasöründe"
            continue
        # check-ignore yolu pathspec olarak ayrıştırır (`--literal-pathspecs` desteklemez); ":" ile
        # başlayan ad "./" ile büyü sayılmaktan korunur.
        sorulacak.setdefault("./" + g if g.startswith(":") else g, []).append(rel)
    if not sorulacak:
        return nedenler

    def yok_sayilan(yollar: list[str]) -> set[str] | None:
        rc, cikti = _git_rc("check-ignore", "--stdin", "-z", cwd=k, girdi="".join(y + "\0" for y in yollar))
        return {y for y in cikti.split("\0") if y} if rc in (0, 1) else None

    yollar = sorted(sorulacak)
    toplu = yok_sayilan(yollar)
    for g in yollar:
        if toplu is not None:
            sonuc = toplu
        else:  # biri (ör. alt modül içindeki yol) tüm sorguyu düşürdü: tek tek sor
            sonuc = yok_sayilan([g])
        if sonuc is None:
            neden = "git bu yolu değerlendiremedi (alt modül ya da iç içe depo olabilir)"
        elif g in sonuc:
            neden = "git yok sayıyor (.gitignore/exclude); izlenmeyen bu içerik git'e yazılmaz"
        else:
            continue
        for rel in sorulacak[g]:
            nedenler[rel] = neden
    return nedenler


def _windows_tekrar(islem, sure: float = 10.0):
    """Windows'ta açık bir dosyanın yerine yazmak ya da değiştirilmekte olan dosyayı açmak kısa süre
    PermissionError verebilir (okuyan bir süreç, virüs tarayıcısı); kısa aralıklarla yeniden dene."""
    bitis = time.monotonic() + sure
    while True:
        try:
            return islem()
        except PermissionError:
            if os.name != "nt" or time.monotonic() >= bitis:
                raise
            time.sleep(0.02)


def kartlar_ve_bozuk(dosya: str) -> tuple[list[dict], int]:
    """Kartlar ve okunamayan (bozuk) satır sayısı. Sonu yeni satırla bitmeyen son satır o an yazılmakta
    olabilir; bozuk sayılmaz ama okunmaz. Yazıcı ölüp yarım bıraktıysa sonraki `ekle` satırı kapatır."""
    if not os.path.exists(dosya):
        return [], 0

    def oku() -> str:
        with open(dosya, encoding="utf-8", errors="replace") as f:
            return f.read()

    satirlar = _windows_tekrar(oku).split("\n")
    son_yarim = satirlar.pop()  # dosya "\n" ile bitiyorsa boş
    out, bozuk = [], 0
    for satir in satirlar:
        satir = satir.strip()
        if not satir:
            continue
        try:
            kart = json.loads(satir)
        except json.JSONDecodeError:
            kart = None
        if isinstance(kart, dict):
            out.append(kart)
        else:
            bozuk += 1
    if son_yarim.strip():
        try:
            kart = json.loads(son_yarim)
        except json.JSONDecodeError:
            kart = None
        if isinstance(kart, dict):
            out.append(kart)
    return out, bozuk


def kartlar(dosya: str) -> list[dict]:
    return kartlar_ve_bozuk(dosya)[0]


def _bozuk_uyarisi(bozuk: int) -> None:
    if bozuk:
        print(f"defter: uyarı: {bozuk} bozuk satır okunamadı ve yok sayıldı (ayrıntı: `defter durum`)",
              file=sys.stderr)


# ---------------------------------------------------------------- kilit

if os.name == "nt":
    import msvcrt

    def _kilitle(fd: int) -> OSError | None:
        os.lseek(fd, KILIT_BAYT, os.SEEK_SET)
        try:
            msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
            return None
        except OSError as e:
            return e

    def _birak(fd: int) -> None:
        os.lseek(fd, KILIT_BAYT, os.SEEK_SET)
        try:
            msvcrt.locking(fd, msvcrt.LK_UNLCK, 1)
        except OSError:
            pass
else:
    import fcntl

    def _kilitle(fd: int) -> OSError | None:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return None
        except OSError as e:
            return e

    def _birak(fd: int) -> None:
        fcntl.flock(fd, fcntl.LOCK_UN)


def _kilit_suresi() -> float:
    try:
        return max(0.0, float(os.environ.get("DEFTER_KILIT_SURE") or KILIT_SURE))
    except ValueError:
        return KILIT_SURE


@contextlib.contextmanager
def kilit(defter: str):
    """Defteri değiştiren adımlar için süreçler arası özel kilit (bkz. modül belgesi)."""
    klasor = os.path.dirname(defter)
    yol = os.path.join(klasor, "defter.kilit")
    try:
        os.makedirs(klasor, exist_ok=True)
        fd = os.open(yol, os.O_RDWR | os.O_CREAT, 0o666)
    except OSError as e:
        raise DefterHatasi(f"defter kilidi açılamadı ({yol}): {e}") from e
    try:
        sure = _kilit_suresi()
        bitis = time.monotonic() + sure
        bekle = 0.01
        while (hata := _kilitle(fd)) is not None:
            if time.monotonic() >= bitis:
                try:
                    os.lseek(fd, 0, os.SEEK_SET)
                    sahip = os.read(fd, 200).decode("utf-8", "replace").strip()
                except OSError:
                    sahip = ""
                raise DefterHatasi(
                    f"defter kilidi {sure:g} sn içinde alınamadı ({yol}; tutan: {sahip or 'bilinmiyor'}; "
                    f"son hata: {hata}). Başka bir defter komutu hâlâ çalışıyor ya da asılı kaldı: o bitince "
                    "yeniden dene. Kilidi tutan süreç öldüyse kilit kendiliğinden kalkar, dosyayı silme.")
            time.sleep(bekle)
            bekle = min(bekle * 2, 0.2)
        try:
            os.lseek(fd, 0, os.SEEK_SET)
            os.ftruncate(fd, 0)
            os.write(fd, f"pid {os.getpid()}, {simdi()}\n".encode())
        except OSError:
            pass  # sahip bilgisi yalnız tanı içindir
        try:
            yield
        finally:
            _birak(fd)
    finally:
        os.close(fd)


def ekle(dosya: str, kart: dict) -> None:
    """Tek satır ekler; çağıran `kilit` tutmalıdır. Önceki yazıcı satırı yarım bıraktıysa önce kapatır,
    böylece yarım satır yeni kartı bozmaz."""
    os.makedirs(os.path.dirname(dosya), exist_ok=True)
    satir = (json.dumps(kart, ensure_ascii=False) + "\n").encode("utf-8")
    with open(dosya, "a+b") as f:
        f.seek(0, os.SEEK_END)
        if f.tell() > 0:
            f.seek(-1, os.SEEK_END)
            if f.read(1) != b"\n":
                satir = b"\n" + satir
        f.write(satir)
        f.flush()
        os.fsync(f.fileno())


def filtresiz_ortam(k: str, rels: list[str], env: dict | None = None) -> tuple[dict, set[str]]:
    """`rels` için öznitelikle seçilen filtre sürücülerini (`filter.<ad>.clean`/`process`: deponun
    yapılandırmasındaki dış komut) kapatan ortam ve özniteliği okunamayan yollar (ör. depo dışı eski
    kayıt; bunlar `hash-object`e verilmez). Satır sonu dönüşümü (`core.autocrlf`, `eol`) sürer, böylece
    blob adı commit'tekiyle aynı kalır. check-attr belirsiz değerleri ("set", "unspecified") de ad
    olarak yazdığından basılan değer ne olursa kapatılır; sürücü değilse etkisizdir.
    GIT_CONFIG_COUNT anahtar/değeri ayrı taşır (`-c` gibi `=` içeren adda bölünmez)."""
    yeni = dict(os.environ if env is None else env)
    okunamayan: set[str] = set()
    if not rels:
        return yeni, okunamayan

    def sor(yollar: list[str]) -> list[str] | None:
        rc, cikti = _git_rc("check-attr", "-z", "--stdin", "filter", cwd=k, env=env,
                            girdi="".join(r + "\0" for r in yollar))
        return cikti.split("\0") if rc == 0 else None

    cikti = sor(rels)
    if cikti is None:  # biri tüm sorguyu düşürdü: tek tek sor
        cikti = []
        for r in rels:
            tek = sor([r])
            if tek is None:
                okunamayan.add(r)
            else:
                cikti += tek[:3]
    adlar = sorted({cikti[i] for i in range(2, len(cikti), 3) if cikti[i]})
    try:
        n = max(0, int(yeni.get("GIT_CONFIG_COUNT") or 0))
    except ValueError:
        n = 0
    for ad in adlar:
        for anahtar, deger in ((f"filter.{ad}.clean", ""), (f"filter.{ad}.process", ""),
                               (f"filter.{ad}.required", "false")):
            yeni[f"GIT_CONFIG_KEY_{n}"] = anahtar
            yeni[f"GIT_CONFIG_VALUE_{n}"] = deger
            n += 1
    if adlar:
        yeni["GIT_CONFIG_COUNT"] = str(n)
    return yeni, okunamayan


def blob(k: str, rel: str, yaz: bool, env: dict | None = None, filtresiz: bool = False) -> str | None:
    """`rel`in blob adı. `filtresiz`: `env` `rel`i kapsayan bir `filtresiz_ortam` çağrısından geliyor;
    değilse filtre sürücüleri burada kapatılır."""
    yol = os.path.join(k, rel)
    if not os.path.isfile(yol):
        return None
    if not filtresiz:
        env, okunamayan = filtresiz_ortam(k, [rel], env)
        if okunamayan:
            raise DefterHatasi(f"{rel}: git öznitelikleri okunamadı, içerik güvenle karşılaştırılamıyor")
    args = ["hash-object"] + (["-w"] if yaz else []) + ["--", rel]
    return _git(*args, cwd=k, env=env).strip()


# ---------------------------------------------------------------- budanma koruması

def koruma_guncelle(k: str, ks: list[dict]) -> str | None:
    """`KORUMA_REF`'i defterin başvurduğu ve hâlâ var olan içerikleri tutan ağaca yöneltir; başvuru yoksa
    ref'i siler. Çağıran `kilit` tutmalıdır. Hata olursa uyarı metni döner (kart yine de yazılmıştır).
    Yalnız var olan nesneler ağaca girer: kayıp nesneye işaret eden bir ref `git gc`'yi bozardı.
    Git dışı yolların (bkz. `git_disi`; eski sürümün yazdığı kayıtlar) içeriği ağaca girmez: ref'ten
    düşer, `git push --mirror` onu taşımaz, `git gc` zamanla budar."""
    try:
        girdiler = [d for x in ks for d in x.get("dosyalar") or []
                    if isinstance(d, dict) and _NESNE_ADI.match(str(d.get("blob") or ""))]
        disarida = git_disi(k, [str(d.get("yol") or "") for d in girdiler]) if girdiler else {}
        aranan = sorted({d["blob"] for d in girdiler if str(d.get("yol") or "") not in disarida})
        var = []
        if aranan:
            cikti = _git("cat-file", "--batch-check", cwd=k, girdi="\n".join(aranan) + "\n")
            var = [s.split()[0] for s in cikti.splitlines() if s.split()[1:2] == ["blob"]]
        if not var:
            if _git_rc("rev-parse", "-q", "--verify", KORUMA_REF, cwd=k)[0] == 0:
                _git("update-ref", "-d", KORUMA_REF, cwd=k)
            return None
        agac = _git("mktree", cwd=k, girdi="".join(f"100644 blob {b}\t{b}\n" for b in var)).strip()
        _git("update-ref", KORUMA_REF, agac, cwd=k)
        return None
    except (DefterHatasi, OSError) as e:
        return (f"kayıt içerikleri `git gc` budamasına karşı korunamadı ({e}); defter yine de güncellendi, "
                "commit edilmemiş eski içerik zamanla budanabilir")


@contextlib.contextmanager
def gecici_nesne_deposu(k: str):
    """`oku`nun güncel içerik için yazdığı nesneler geçici bir depoya gider; deponun kendi nesneleri
    alternatif olarak okunur. Komut bitince geçici depo silinir, depoda boşta nesne kalmaz."""
    asil = _git("rev-parse", "--git-path", "objects", cwd=k).strip()
    if not os.path.isabs(asil):
        asil = os.path.join(k, asil)
    with tempfile.TemporaryDirectory(prefix="defter-") as d:
        env = dict(os.environ)
        env["GIT_OBJECT_DIRECTORY"] = d
        env["GIT_ALTERNATE_OBJECT_DIRECTORIES"] = os.pathsep.join(
            x for x in (os.path.normpath(asil), os.environ.get("GIT_ALTERNATE_OBJECT_DIRECTORIES")) if x)
        yield env


def simdi() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


# ---------------------------------------------------------------- komutlar

def k_yaz(a) -> int:
    k = kok()
    if not a.ozet and not a.kavram:
        raise DefterHatasi("--ozet ya da en az bir --kavram gerekli")
    ozet = (a.ozet or "").strip()
    if len(ozet) > OZET_SINIR:
        raise DefterHatasi(f"özet {OZET_SINIR} karakteri aşıyor ({len(ozet)}); kısalt, ayrıntı koda kalsın")
    kavramlar = []
    for kv in a.kavram or []:
        kv = kv.strip()
        if ":" not in kv or len(kv) > KAVRAM_SINIR:
            raise DefterHatasi(f'kavram "ad: açıklama" biçiminde ve ≤{KAVRAM_SINIR} karakter olmalı')
        ad, _, aciklama = kv.partition(":")
        kavramlar.append({"ad": ad.strip(), "aciklama": aciklama.strip()})
    rels = list(dict.fromkeys(goreli(k, y) for y in a.dosya or []))
    for rel in rels:
        if not os.path.isfile(os.path.join(k, rel)):
            raise DefterHatasi(f"dosya yok: {rel}")
    # Uygunluk içerik nesne deposuna yazılmadan önce denetlenir; reddedilen dosya kartı düşürmez.
    reddedilen = git_disi(k, rels) if rels else {}
    kabul = [r for r in rels if r not in reddedilen]
    env, okunamayan = filtresiz_ortam(k, kabul)
    for rel in okunamayan:
        reddedilen[rel] = "git öznitelikleri okunamadı"
    kabul = [r for r in kabul if r not in okunamayan]
    dosyalar = []
    for rel in kabul:
        b = blob(k, rel, yaz=True, env=env, filtresiz=True)
        if b is None:
            raise DefterHatasi(f"dosya yok: {rel}")
        dosyalar.append({"yol": rel, "blob": b})
    head = _git("rev-parse", "--verify", "-q", "HEAD", cwd=k, check=False).strip() or None
    kart = {"zaman": simdi(), "tur": a.tur, "gorev": (a.gorev or "").strip() or None, "ozet": ozet,
            "dosyalar": dosyalar, "kavramlar": kavramlar, "head": head}
    yol = defter_yolu(k)
    uyari = None
    with kilit(yol):
        ekle(yol, kart)
        if dosyalar:
            uyari = koruma_guncelle(k, kartlar(yol))
    ek = f"; {len(reddedilen)} dosya kaydedilmedi" if reddedilen else ""
    print(f"defter: kart yazıldı ({len(dosyalar)} dosya, {len(kavramlar)} kavram{ek})")
    for rel, neden in reddedilen.items():
        print(f"defter: uyarı: {rel} kaydedilmedi: {neden}. Defter yalnız git'in görebileceği dosyaları "
              "tutar; bu dosyayı gerektiğinde doğrudan oku.", file=sys.stderr)
    if uyari:
        print(f"defter: uyarı: {uyari}", file=sys.stderr)
    return 0


def son_kartlar_dosya_icin(ks: list[dict]) -> dict[str, tuple[dict, str]]:
    """yol -> (o yolu içeren en son kart, o andaki blob)."""
    son: dict[str, tuple[dict, str]] = {}
    for kart in ks:
        for d in kart.get("dosyalar") or []:
            son[d["yol"]] = (kart, d["blob"])
    return son


def son_ozet_karti(ks: list[dict]) -> dict | None:
    """En son yazılmış, metni boş olmayan özet kartı (önceki özetleri kapsadığı varsayılır)."""
    for kart in reversed(ks):
        if kart.get("tur") == "ozet" and (kart.get("ozet") or "").strip():
            return kart
    return None


def k_oku(a) -> int:
    k = kok()
    ks, bozuk = kartlar_ve_bozuk(defter_yolu(k))
    _bozuk_uyarisi(bozuk)
    son = son_kartlar_dosya_icin(ks)
    ozet_karti = son_ozet_karti(ks)
    istenen = [goreli(k, y) for y in a.yollar] if a.yollar else sorted(son)
    if ozet_karti is not None:
        if a.yollar:
            print(f"(defterde sıkıştırılmış proje özeti var, {ozet_karti['zaman']}: bağlam gerekirse "
                  "yol vermeden `defter oku` çalıştır)\n")
        else:
            print(f"## defter özeti  ({ozet_karti['zaman']})\n{ozet_karti['ozet'].strip()}\n")
    if not istenen:
        if ozet_karti is None:
            print("defter boş: dosyaları gerektiği kadar oku, işin sonunda `defter yaz` ile özetle.")
        return 0
    with gecici_nesne_deposu(k) as env:
        _oku_dosyalar(k, istenen, son, a.sinir, env)
    return 0


def _depo_disi_yazim(rel: str) -> bool:
    """Kayıt yolu yazımıyla depo dışını gösteriyor mu (git'e sormadan)."""
    return rel == ".." or rel.startswith("../") or os.path.isabs(rel)


def _git_disi_guvenli(k: str, rels: list[str]) -> dict[str, str]:
    """`git_disi`; git sorusu başarısızsa boş (yalnız bilgi amaçlı çağrılar için)."""
    try:
        return git_disi(k, rels) if rels else {}
    except DefterHatasi:
        return {}


def _oku_dosyalar(k: str, istenen: list[str], son: dict, kalan: int, env: dict) -> None:
    # Kayıtsız yollar ve depo dışını gösteren eski kayıtlar (eski sürüm kabul ediyordu) sorulur.
    disarida = _git_disi_guvenli(k, [r for r in istenen if r not in son or _depo_disi_yazim(r)])
    for r in istenen:
        if _depo_disi_yazim(r):
            disarida.setdefault(r, "depo dışında")
    env, okunamayan = filtresiz_ortam(k, [r for r in istenen if r in son and r not in disarida
                                          and os.path.isfile(os.path.join(k, r))], env)
    for rel in istenen:
        if rel in okunamayan:
            print(f"## {rel}\ndurum: git bu yolun özniteliklerini okuyamadı; fark üretilmedi — dosyayı "
                  "doğrudan oku.\n")
            continue
        if rel in disarida:
            print(f"## {rel}\ndefter bu dosyayı kaydetmez ({disarida[rel]}) — gerekiyorsa doğrudan oku, "
                  "`defter yaz`a verme.\n")
            continue
        if rel not in son:
            print(f"## {rel}\nkayıt yok — dosyayı oku (gerekirse satır aralığıyla), sonra `defter yaz`.\n")
            continue
        kart, eski = son[rel]
        yeni = blob(k, rel, yaz=True, env=env, filtresiz=True)  # güncel içerik yalnız geçici depoya
        print(f"## {rel}  ({kart['zaman']})")
        print(kart["ozet"] or "(özet yok)")
        if yeni is None:
            print("durum: dosya artık YOK (silinmiş ya da taşınmış).\n")
            continue
        if yeni == eski:
            print("durum: kayıttan beri DEĞİŞMEDİ — özet güncel, dosyayı yeniden okumaya gerek yok.\n")
            continue
        if _git_rc("cat-file", "-e", f"{eski}^{{blob}}", cwd=k, env=env)[0] != 0:
            print("durum: kayıttan beri DEĞİŞTİ, ama kayıttaki eski içerik git'te artık yok (büyük olasılıkla "
                  "`git gc` budadı); fark üretilemiyor ve özet eskimiş olabilir — dosyayı oku (gerekirse "
                  "satır aralığıyla), sonra `defter yaz` ile yeniden kaydet.\n")
            continue
        # --no-ext-diff/--no-textconv: deponun `diff.external`, `diff.<sürücü>.command`/`textconv`
        # ayarlarındaki dış komut çalışmaz.
        rc, ham = _git_rc("diff", "--no-color", "--no-ext-diff", "--no-textconv", "-U2", eski, yeni,
                          cwd=k, env=env)
        fark = [s for s in ham.splitlines() if not s.startswith(("diff --git", "index "))]
        if rc != 0 or not fark:
            print("durum: kayıttan beri DEĞİŞTİ, ama fark alınamadı (git diff başarısız); "
                  "dosyayı oku, sonra `defter yaz` ile yeniden kaydet.\n")
            continue
        print(f"durum: kayıttan beri DEĞİŞTİ ({len(fark)} satır fark):")
        if kalan <= 0:
            print("[fark sınırı doldu; bu dosya için `defter oku " + rel + "` ayrıca çalıştır]\n")
            continue
        print("\n".join(fark[:kalan]))
        if len(fark) > kalan:
            print(f"[... {len(fark) - kalan} satır daha; gerekirse dosyanın ilgili aralığını oku]")
        kalan -= len(fark)
        print()


def k_kavram(a) -> int:
    k = kok()
    son: dict[str, str] = {}
    ks, bozuk = kartlar_ve_bozuk(defter_yolu(k))
    _bozuk_uyarisi(bozuk)
    for kart in ks:
        for kv in kart.get("kavramlar") or []:
            son[kv["ad"]] = kv["aciklama"]
    if not son:
        print("kayıtlı kavram yok")
    for ad in sorted(son, key=str.casefold):
        print(f"- {ad}: {son[ad]}")
    return 0


def k_durum(a) -> int:
    k = kok()
    yol = defter_yolu(k)
    ks, bozuk = kartlar_ve_bozuk(yol)
    boyut = os.path.getsize(yol) if os.path.exists(yol) else 0
    dosya_sayisi = len(son_kartlar_dosya_icin(ks))
    print(f"defter: {yol}\nkart: {len(ks)}, izlenen dosya: {dosya_sayisi}, boyut: {boyut} bayt")
    if ks:
        print(f"en eski: {ks[0]['zaman']}  en yeni: {ks[-1]['zaman']}")
    if bozuk:
        print(f"bozuk satır: {bozuk} (okunamadı, yok sayılıyor; `defter temizle` atar)")
    disarida = _git_disi_guvenli(k, sorted(son_kartlar_dosya_icin(ks)))
    if disarida:
        ornek = ", ".join(sorted(disarida)[:5]) + (" ..." if len(disarida) > 5 else "")
        print(f"git dışı kayıt: {len(disarida)} ({ornek}); içerikleri korunmaz, `defter temizle` çıkarır")
    rc, agac = _git_rc("rev-parse", "-q", "--verify", KORUMA_REF, cwd=k)
    if rc == 0:
        n = len(_git("ls-tree", agac.strip(), cwd=k, check=False).splitlines())
        print(f"budanma koruması: {KORUMA_REF} ({n} içerik)")
    else:
        print("budanma koruması: yok")
    return 0


def _sikistirma_girdisi(ks: list[dict]) -> str:
    satirlar = []
    for kart in ks:
        yollar = ", ".join(d["yol"] for d in kart.get("dosyalar") or [])
        satirlar.append(f"- [{kart['zaman']}] {kart.get('gorev') or ''} | {yollar} | {kart.get('ozet') or ''}")
        for kv in kart.get("kavramlar") or []:
            satirlar.append(f"  kavram {kv['ad']}: {kv['aciklama']}")
    return "\n".join(satirlar)


def k_ozetle(a) -> int:
    """DENEYSEL. Eski kartları tek özet kartına sıkıştırma girdisi üretir.

    Varsayılan: sıkıştırılacak metni yazdırır; şef bunu `model: "haiku"`, effort low bir alt
    agent'a verir ve dönen özeti `defter yaz --tur ozet --ozet ...` ile kaydettirir.
    --yerel MODEL: `ollama` kuruluysa özet yerel modelle üretilir (API token harcanmaz)."""
    k = kok()
    tum = kartlar(defter_yolu(k))
    ks = [x for x in tum if x.get("tur") != "ozet"]
    eski = ks[: max(0, len(ks) - a.eski)] if a.eski else ks
    if not eski:
        print("sıkıştırılacak eski kart yok")
        return 0
    girdi = _sikistirma_girdisi(eski)
    onceki = son_ozet_karti(tum)
    if onceki is not None:
        # temizle yalnız en son özet kartını tutar; önceki özet yeni özete girmezse kaybolur.
        girdi = (f"Önceki defter özeti ({onceki['zaman']}), yeni özet bunu da kapsamalı:\n"
                 f"{onceki['ozet'].strip()}\n\nKartlar:\n{girdi}")
    istem = ("Aşağıdaki proje defteri kartlarını, kod okumadan sonraki bir mühendisin işine yarayacak "
             f"şekilde en fazla {OZET_SINIR} karakterlik tek bir özete sıkıştır: modüllerin görevi, kritik "
             "arayüzler, alınan kararlar ve kavramlar. Tekrar ve geçmiş anlatısı yok.\n\n" + girdi)
    if not a.yerel:
        print(istem)
        return 0
    ollama = calistirilabilir("ollama")
    if not ollama:
        raise DefterHatasi("--yerel için `ollama` bulunamadı; yerel model yoksa haiku alt agent'ı kullan")
    t0 = time.time()
    p = subprocess.run([ollama, "run", a.yerel], input=istem, capture_output=True, text=True,
                       encoding="utf-8", errors="replace", timeout=600)
    if p.returncode != 0 or not p.stdout.strip():
        raise DefterHatasi(f"yerel model özet üretemedi: {p.stderr.strip()[:200]}")
    ozet = p.stdout.strip()[:OZET_SINIR]
    yol = defter_yolu(k)
    with kilit(yol):  # model çalışırken kilit tutulmaz; yalnız ekleme anında
        ekle(yol, {"zaman": simdi(), "tur": "ozet", "gorev": f"yerel özet ({a.yerel})",
                   "ozet": ozet, "dosyalar": [], "kavramlar": [], "head": None})
    print(f"defter: {len(eski)} kart yerel modelle özetlendi ({time.time() - t0:.1f} sn)")
    return 0


def korunacak_kartlar(ks: list[dict], tut: int) -> tuple[set[int], int]:
    """temizle'nin tutacağı kart indeksleri ve yalnız güncel kayıt taşıdığı için tutulan eski kart sayısı.

    Tutulan: son `tut` kart (özet kartları sayılmaz; `ozetle --eski N` ile aynı sayım), en son özet
    kartı, ve bir dosyanın ya da bir kavram adının en son kaydını taşıyan her kart. Sıra korunduğu
    için "son kayıt kazanır" kuralı değişmez; `oku` ve `kavram` çıktısı temizlikten etkilenmez.
    Silinen yalnız tamamen eskimiş geçmiştir; onu özet kartı taşır."""
    kart_idx = [i for i, x in enumerate(ks) if x.get("tur") != "ozet"]
    son_n = set(kart_idx[-tut:] if tut else [])
    korunan = set(son_n)
    ozet_idx = [i for i, x in enumerate(ks) if x.get("tur") == "ozet" and (x.get("ozet") or "").strip()]
    if ozet_idx:
        korunan.add(ozet_idx[-1])
    son_dosya: dict[str, int] = {}
    son_kavram: dict[str, int] = {}
    for i, x in enumerate(ks):
        for d in x.get("dosyalar") or []:
            son_dosya[d["yol"]] = i
        for kv in x.get("kavramlar") or []:
            son_kavram[kv["ad"]] = i
    guncel = set(son_dosya.values()) | set(son_kavram.values())
    korunan |= guncel
    return korunan, len(guncel - son_n - set(ozet_idx[-1:]))


def k_temizle(a) -> int:
    k = kok()
    yol = defter_yolu(k)
    if a.tut < 0:
        raise DefterHatasi("--tut negatif olamaz")
    with kilit(yol):  # okuma-yeniden yazma arasında eklenen kart kaybolmasın
        ks, bozuk = kartlar_ve_bozuk(yol)
        # Git dışı yolların kayıtları (eski sürümün kabul ettiği .gitignore'daki ya da depo dışı dosyalar)
        # çıkarılır; aksi halde "her dosyanın en son kaydı tutulur" kuralı onları sonsuza dek taşırdı.
        disarida = _git_disi_guvenli(k, sorted({str(d.get("yol") or "") for x in ks
                                                for d in x.get("dosyalar") or [] if isinstance(d, dict)}))
        cikarilan = 0
        for x in ks if disarida else []:
            ds = x.get("dosyalar") or []
            kalan = [d for d in ds if not (isinstance(d, dict) and str(d.get("yol") or "") in disarida)]
            if len(kalan) != len(ds):
                cikarilan += len(ds) - len(kalan)
                x["dosyalar"] = kalan
        korunan, tasinan = korunacak_kartlar(ks, a.tut)
        tut = [x for i, x in enumerate(ks) if i in korunan]
        tmp = yol + ".tmp"
        with open(tmp, "wb") as f:
            for kart in tut:
                f.write((json.dumps(kart, ensure_ascii=False) + "\n").encode("utf-8"))
            f.flush()
            os.fsync(f.fileno())
        _windows_tekrar(lambda: os.replace(tmp, yol))
        uyari = koruma_guncelle(k, tut)
    ek = f" ({tasinan} eski kart bir dosyanın/kavramın en son kaydını taşıdığı için tutuldu)" if tasinan else ""
    ek += f"; {bozuk} bozuk satır atıldı" if bozuk else ""
    ek += f"; {cikarilan} git dışı dosya kaydı çıkarıldı" if cikarilan else ""
    print(f"defter: {len(ks) - len(tut)} kart silindi, {len(tut)} kaldı{ek}")
    if uyari:
        print(f"defter: uyarı: {uyari}", file=sys.stderr)
    return 0


def main(argv: list[str] | None = None) -> int:
    for akim in (sys.stdout, sys.stderr):
        try:
            akim.reconfigure(encoding="utf-8")
        except (AttributeError, ValueError):
            pass
    p = argparse.ArgumentParser(prog="defter", description="Opus Orkestra bağlam defteri")
    alt = p.add_subparsers(dest="komut", required=True)
    y = alt.add_parser("yaz")
    y.add_argument("--dosya", action="append")
    y.add_argument("--ozet")
    y.add_argument("--kavram", action="append")
    y.add_argument("--gorev")
    y.add_argument("--tur", default="kart", choices=["kart", "ozet"])
    o = alt.add_parser("oku")
    o.add_argument("yollar", nargs="*")
    o.add_argument("--sinir", type=int, default=VARSAYILAN_FARK_SINIRI, help="toplam fark satırı sınırı")
    alt.add_parser("kavram")
    alt.add_parser("durum")
    z = alt.add_parser("ozetle")
    z.add_argument("--eski", type=int, default=0, help="son N kartı dışarıda bırak")
    z.add_argument("--yerel", metavar="MODEL", help="DENEYSEL: ollama modeliyle yerelde özetle")
    t = alt.add_parser("temizle")
    t.add_argument("--tut", type=int, required=True)
    a = p.parse_args(argv)
    try:
        return {"yaz": k_yaz, "oku": k_oku, "kavram": k_kavram, "durum": k_durum,
                "ozetle": k_ozetle, "temizle": k_temizle}[a.komut](a)
    except DefterHatasi as e:
        print(f"defter: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
