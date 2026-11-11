#!/usr/bin/env python3
"""Gizlilik kapısı: git'te izlenen dosyalarda kişisel veri ve sır arar.

Kullanım::

    python scripts/gizlilik_tara.py [--kok DIR] [--izinli DOSYA] [--json]

Çıkış kodu: 0 = bulgu yok, 1 = bulgu var, 2 = kullanım/ortam hatası.

Kurallar:
  kisisel_yol   Mutlak kullanıcı yolu (Windows ``X:\\Users\\<ad>``, macOS
                ``/Users/<ad>``, Linux ``/home/<ad>``); <ad> genel bir yer
                tutucuysa bulgu değildir.
  eposta        E-posta adresi (noreply, örnek alan adları ve Anthropic hariç).
  belirtec      Bilinen token biçimleri, özel anahtar başlığı ve
                ``parola = "..."`` türü atamalar.
  buyuk_ikili   512 KB üstü ikili dosya.
  yasak_sozcuk  ``GIZLILIK_YASAK`` ortam değişkenindeki (virgülle ayrılmış)
                sözcükler; değişken boşsa çalışmaz.

İzin listesi (varsayılan ``<kok>/.github/gizlilik-izinli.txt``) satırları:
``GLOB``, ``GLOB | KURAL`` ya da ``GLOB | KURAL | DÜZENLİ_İFADE``. Düzenli
ifade, bulgunun maskelenmemiş eşleşme metninde ``re.search`` ile aranır.
Alan ayracı iki yanı boşluklu ``|``'dir; düzenli ifade içinde seçenek için
boşluksuz ``|`` kullanılır (``(a|b)``).

Yalnız standart kütüphane; bağımsız çalışır. Çıktıdaki alıntılar her zaman
maskelidir: bulunan değer hiçbir zaman tam yazdırılmaz.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Iterator, Sequence

KURALLAR = ("kisisel_yol", "eposta", "belirtec", "buyuk_ikili", "yasak_sozcuk")
BUYUK_SINIR = 512 * 1024
_IKILI_KOKLAMA = 8192
_MASKE = "***"
VARSAYILAN_IZINLI = Path(".github") / "gizlilik-izinli.txt"


@dataclass(frozen=True)
class Bulgu:
    dosya: str
    satir: int
    kural: str
    alinti: str


@dataclass(frozen=True)
class Izin:
    glob: str
    kural: str | None = None
    desen: re.Pattern[str] | None = None
    satir: int = 0

    def uyar(self, dosya: str, kural: str, metin: str) -> bool:
        if not _glob_derle(self.glob).fullmatch(dosya):
            return False
        if self.kural is not None and self.kural != kural:
            return False
        if self.desen is not None and not self.desen.search(metin):
            return False
        return True


class IzinHatasi(ValueError):
    """İzin listesinde geçersiz satır."""


# --------------------------------------------------------------------------
# Glob

_GLOB_ONBELLEK: dict[str, re.Pattern[str]] = {}


def _glob_derle(glob: str) -> re.Pattern[str]:
    d = _GLOB_ONBELLEK.get(glob)
    if d is not None:
        return d
    parca: list[str] = []
    i, n = 0, len(glob)
    while i < n:
        c = glob[i]
        if glob.startswith("**/", i):
            parca.append("(?:.*/)?")
            i += 3
        elif glob.startswith("**", i):
            parca.append(".*")
            i += 2
        elif c == "*":
            parca.append("[^/]*")
            i += 1
        elif c == "?":
            parca.append("[^/]")
            i += 1
        else:
            parca.append(re.escape(c))
            i += 1
    d = re.compile("".join(parca))
    _GLOB_ONBELLEK[glob] = d
    return d


# --------------------------------------------------------------------------
# Desenler

# Kullanıcı adı yerine geçen genel yer tutucular ve sistem/CI hesapları.
_YER_TUTUCU_ADLAR = frozenset({
    "kullanici", "kullanıcı", "kullaniciadi", "kullanıcıadı", "kullanici_adi",
    "kullanıcı_adı", "ad", "adin", "adın", "adiniz", "adınız", "isim", "sen",
    "user", "users", "username", "user_name", "user-name", "you", "your",
    "yourname", "your_name", "your-name", "yourusername", "your_username",
    "me", "name", "someone", "somebody", "alice", "bob", "jdoe", "johndoe",
    "john", "jane", "example", "foo", "bar", "test", "tester", "demo",
    "runner", "runneradmin", "public", "default", "defaultuser0", "all",
    "shared", "guest", "admin", "administrator", "root", "vscode", "node",
    "ubuntu", "ec2-user", "app", "linuxbrew", "codespace", "codespaces",
    "gitpod", "circleci", "travis", "jenkins", "jovyan", "build", "builder",
    "x", "xx", "xxx", "...", "…", "*",
})

_WIN_YOL = re.compile(
    r"(?i)(?<![A-Za-z0-9])[a-z]:(?:\\+|/)users(?:\\+|/)"
    r"(?P<gizli>[^\\/\s\"'`<>|:*?,;()\[\]]+)")
_UNIX_YOL = re.compile(
    # "file:///Users/..." yakalanır; "https://site/home/..." (önde harf) yakalanmaz.
    r"(?:(?<=file://)|(?<![A-Za-z0-9_.~\-:/\\]))/(?:Users|home)/"
    r"(?P<gizli>[^\\/\s\"'`<>|:*?,;()\[\]]+)")

_EPOSTA = re.compile(
    r"(?<![A-Za-z0-9._%+\-])(?P<yerel>[A-Za-z0-9][A-Za-z0-9._%+\-]*)@"
    r"(?P<alan>[A-Za-z0-9](?:[A-Za-z0-9\-]*[A-Za-z0-9])?"
    r"(?:\.[A-Za-z0-9](?:[A-Za-z0-9\-]*[A-Za-z0-9])?)*\.(?P<tld>[A-Za-z]{2,24}))"
    r"(?![A-Za-z0-9\-]|\.[A-Za-z0-9])")
_EPOSTA_ALAN_HARIC = ("example.com", "example.org", "example.net", "anthropic.com",
                      "users.noreply.github.com")
# RFC 2606/6761 ayrılmış üst alanlar: gerçek adres olamaz.
_AYRILMIS_TLD = frozenset({"invalid", "test", "example", "localhost", "local"})
# "ikon@2x.png" gibi dosya adları e-posta değildir.
_DOSYA_UZANTILARI = frozenset({
    "png", "jpg", "jpeg", "gif", "svg", "webp", "ico", "bmp", "avif", "pdf",
    "js", "mjs", "ts", "css", "map", "json", "py", "md", "txt", "kt", "java",
})

_BELIRTEC_BICIMLERI: tuple[re.Pattern[str], ...] = (
    re.compile(r"(?<![A-Za-z0-9_\-])sk-ant-[A-Za-z0-9_\-]{16,}"),
    re.compile(r"(?<![A-Za-z0-9_\-])sk-(?!ant-)[A-Za-z0-9_\-]{20,}"),
    re.compile(r"(?<![A-Za-z0-9_])github_pat_[A-Za-z0-9_]{20,}"),
    re.compile(r"(?<![A-Za-z0-9_])gh[pousr]_[A-Za-z0-9]{20,}"),
    re.compile(r"(?<![A-Za-z0-9])(?:AKIA|ASIA)[0-9A-Z]{16}(?![A-Za-z0-9])"),
    re.compile(r"(?<![A-Za-z0-9])xox[baprs]-[A-Za-z0-9\-]{10,}"),
    re.compile(r"(?<![A-Za-z0-9_\-])AIza[0-9A-Za-z_\-]{30,}"),
    re.compile(r"-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----"),
)
# anahtar = "değer" / "anahtar": "değer" / anahtar: 'değer' (8+ karakter).
_BELIRTEC_ATAMA = re.compile(
    # Önek ("GITHUB_TOKEN") desene katılmaz: "_" harf/rakam olmadığı için anahtar
    # sözcük zaten eşleşir; "(?:\w+_)*" öneki uzun satırda karesel geri izleme yapıyordu.
    r"(?i)(?<![A-Za-z0-9])"
    r"(?:password|passwd|parola|şifre|sifre|secret|token|api[_\-]?key)"
    r"[\"']?\s*(?::=|=|:)\s*[rbu]?(?P<tirnak>[\"'])"
    r"(?P<gizli>[^\"'\s]{8,})(?P=tirnak)")
# Değer bir yer tutucu/başvuru ise sır değildir.
_ATAMA_YER_TUTUCU = re.compile(
    r"(?i)^(?:\$|%|<|\{\{|\$\{)|\$\{|\{\{|os\.environ|getenv|"
    r"^(?:x+|\*+|\.+|changeme|placeholder|your[_\-].*|<.*>)$|"
    # Açıkça sahte: ardışık alfabe/rakam, 8+ aynı karakter, "örnek/sahte" sözcükleri.
    r"abcdefgh|12345678|(.)\1{7}|"
    r"sahte|fake|dummy|ornek|örnek|example|placeholder|deger|değer")


def _ad_yer_tutucu_mu(ad: str) -> bool:
    if not ad or ad[0] in "$%{<~." or ad.endswith("%"):
        return True
    a = ad.casefold()
    if a in _YER_TUTUCU_ADLAR:
        return True
    # "<kullanici>" gibi açılı biçim yakalanmaz; "kullanici_adi" türevleri:
    return a.startswith(("kullanici", "kullanıcı", "your", "user_", "username"))


def _maskele(metin: str, gizli_bas: int, gizli_son: int, gorunur: int = 2) -> str:
    gizli = metin[gizli_bas:gizli_son]
    return metin[:gizli_bas] + gizli[:gorunur] + _MASKE


def _satir_tara(satir: str, yasak_desen: re.Pattern[str] | None
                ) -> Iterator[tuple[str, str, str]]:
    """(kural, eşleşen metin, maskeli alıntı) üretir."""
    if "sers" in satir or "SERS" in satir or "/home/" in satir:
        for desen in (_WIN_YOL, _UNIX_YOL):
            for m in desen.finditer(satir):
                if _ad_yer_tutucu_mu(m.group("gizli")):
                    continue
                t = m.group(0)
                b, s = m.span("gizli")
                yield "kisisel_yol", t, _maskele(t, b - m.start(), s - m.start())
    if "@" in satir:
        for m in _EPOSTA.finditer(satir):
            yerel, alan, tld = m.group("yerel"), m.group("alan").lower(), m.group("tld").lower()
            ylow = yerel.lower()
            if "noreply" in ylow or "no-reply" in ylow or "noreply" in alan or "no-reply" in alan:
                continue
            if any(alan == h or alan.endswith("." + h) for h in _EPOSTA_ALAN_HARIC):
                continue
            if tld in _DOSYA_UZANTILARI or tld in _AYRILMIS_TLD:
                continue
            if ylow in ("git", "this", "super"):  # ssh adresi, Kotlin etiketi
                continue
            yield "eposta", m.group(0), yerel[:2] + _MASKE + "@" + alan[:2] + _MASKE
    for desen in _BELIRTEC_BICIMLERI:
        for m in desen.finditer(satir):
            t = m.group(0)
            if t.startswith("-----BEGIN"):
                yield "belirtec", t, t
            else:
                on = 7 if t.startswith("sk-ant-") else (11 if t.startswith("github_pat_") else 4)
                yield "belirtec", t, t[:on] + _MASKE
    for m in _BELIRTEC_ATAMA.finditer(satir):
        if _ATAMA_YER_TUTUCU.search(m.group("gizli")):
            continue
        t = m.group(0)
        b, s = m.span("gizli")
        yield "belirtec", t, _maskele(t, b - m.start(), s - m.start())
    if yasak_desen is not None:
        for m in yasak_desen.finditer(satir):
            t = m.group(0)
            yield "yasak_sozcuk", t, t[:2] + _MASKE


def _yasak_derle(yasak: Sequence[str]) -> re.Pattern[str] | None:
    sozcukler = sorted({y.strip() for y in yasak if y and y.strip()}, key=len, reverse=True)
    if not sozcukler:
        return None
    return re.compile(r"(?<!\w)(?:" + "|".join(map(re.escape, sozcukler)) + r")(?!\w)",
                      re.IGNORECASE)


def _izinli_mi(izinli: Sequence[Izin], dosya: str, kural: str, metin: str) -> bool:
    return any(i.uyar(dosya, kural, metin) for i in izinli)


def _ikili_mi(bas: bytes) -> bool:
    return b"\x00" in bas[:_IKILI_KOKLAMA]


def tara(kok: Path, dosyalar: Iterable[str], izinli: Sequence[Izin] = (),
         yasak: Sequence[str] = ()) -> list[Bulgu]:
    """Verilen (köke göre) dosyaları tarar; izinli bulguları eler."""
    kok = Path(kok)
    yasak_desen = _yasak_derle(yasak)
    bulgular: list[Bulgu] = []
    for ham in dosyalar:
        dosya = ham.replace("\\", "/")
        yol = kok / dosya
        try:
            if not yol.is_file():
                continue
            boyut = yol.stat().st_size
            with open(yol, "rb") as f:
                bas = f.read(_IKILI_KOKLAMA)
                if _ikili_mi(bas):
                    if boyut > BUYUK_SINIR:
                        metin = f"{boyut / 1024:.0f} KB ikili dosya"
                        if not _izinli_mi(izinli, dosya, "buyuk_ikili", dosya):
                            bulgular.append(Bulgu(dosya, 0, "buyuk_ikili", metin))
                    continue
                veri = bas + f.read()
        except OSError:
            continue
        icerik = veri.decode("utf-8", errors="ignore")
        for no, satir in enumerate(icerik.splitlines(), 1):
            for kural, eslesen, alinti in _satir_tara(satir, yasak_desen):
                if _izinli_mi(izinli, dosya, kural, eslesen):
                    continue
                bulgular.append(Bulgu(dosya, no, kural, alinti))
    bulgular.sort(key=lambda b: (b.dosya, b.satir, b.kural))
    return bulgular


# --------------------------------------------------------------------------
# İzin listesi

_IZIN_AYRAC = re.compile(r"\s\|(?:\s|$)")


def izinli_ayristir(metin: str) -> list[Izin]:
    izinler: list[Izin] = []
    for no, ham in enumerate(metin.splitlines(), 1):
        satir = ham.strip()
        if not satir or satir.startswith("#"):
            continue
        # Ayraç iki yanı boşluklu "|"; boşluksuz "|" düzenli ifadede seçenektir.
        parcalar = [p.strip() for p in _IZIN_AYRAC.split(satir)]
        if len(parcalar) > 3:
            raise IzinHatasi(f"izin listesi satır {no}: en çok 3 alan olabilir "
                             f"(GLOB | KURAL | DÜZENLİ_İFADE), {len(parcalar)} alan var")
        glob = parcalar[0]
        if not glob:
            raise IzinHatasi(f"izin listesi satır {no}: GLOB boş")
        if "|" in glob:
            raise IzinHatasi(f"izin listesi satır {no}: alanlar ' | ' (iki yanı boşluklu) "
                             f"ile ayrılmalı")
        kural: str | None = None
        desen: re.Pattern[str] | None = None
        if len(parcalar) >= 2:
            k = parcalar[1]
            if k in ("", "*"):
                kural = None
            elif k in KURALLAR:
                kural = k
            else:
                raise IzinHatasi(f"izin listesi satır {no}: bilinmeyen kural {k!r} "
                                 f"(geçerli: {', '.join(KURALLAR)})")
        if len(parcalar) == 3:
            if not parcalar[2]:
                raise IzinHatasi(f"izin listesi satır {no}: DÜZENLİ_İFADE boş")
            try:
                desen = re.compile(parcalar[2])
            except re.error as e:
                raise IzinHatasi(f"izin listesi satır {no}: geçersiz düzenli ifade: {e}") from None
        izinler.append(Izin(glob, kural, desen, no))
    return izinler


def izinli_oku(yol: Path) -> list[Izin]:
    return izinli_ayristir(Path(yol).read_text(encoding="utf-8-sig"))


# --------------------------------------------------------------------------
# Komut satırı

class OrtamHatasi(RuntimeError):
    pass


def git_dosyalari(kok: Path) -> list[str]:
    try:
        sonuc = subprocess.run(["git", "-C", str(kok), "ls-files", "-z"],
                               capture_output=True, timeout=60)
    except FileNotFoundError:
        raise OrtamHatasi("git bulunamadı (PATH'te yok)") from None
    except (OSError, subprocess.SubprocessError) as e:
        raise OrtamHatasi(f"git çalıştırılamadı: {e}") from None
    if sonuc.returncode != 0:
        hata = sonuc.stderr.decode("utf-8", errors="replace").strip()
        raise OrtamHatasi(f"{kok} bir git deposu değil ya da git ls-files başarısız: {hata}")
    return [p for p in sonuc.stdout.decode("utf-8", errors="replace").split("\0") if p]


def _yasak_ortamdan() -> list[str]:
    return [s for s in os.environ.get("GIZLILIK_YASAK", "").split(",") if s.strip()]


def _utf8_cikti() -> None:
    for akim in (sys.stdout, sys.stderr):
        try:
            akim.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
        except (AttributeError, ValueError, OSError):
            pass


def main(argv: list[str] | None = None) -> int:
    _utf8_cikti()
    ayr = argparse.ArgumentParser(
        prog="gizlilik_tara",
        description="git'te izlenen dosyalarda kişisel veri ve sır arar.")
    ayr.add_argument("--kok", type=Path, default=None,
                     help="depo kökü (varsayılan: bu betiğin deposu)")
    ayr.add_argument("--izinli", type=Path, default=None,
                     help="izin listesi (varsayılan: <kok>/.github/gizlilik-izinli.txt)")
    ayr.add_argument("--json", action="store_true", help="JSON çıktı")
    try:
        args = ayr.parse_args(argv)
    except SystemExit as e:
        return 0 if e.code == 0 else 2

    kok = (args.kok if args.kok is not None else Path(__file__).resolve().parent.parent)
    if not kok.is_dir():
        print(f"hata: kök dizin yok: {kok}", file=sys.stderr)
        return 2
    try:
        if args.izinli is not None:
            if not args.izinli.is_file():
                print(f"hata: izin listesi bulunamadı: {args.izinli}", file=sys.stderr)
                return 2
            izinli = izinli_oku(args.izinli)
        else:
            varsayilan = kok / VARSAYILAN_IZINLI
            izinli = izinli_oku(varsayilan) if varsayilan.is_file() else []
    except IzinHatasi as e:
        print(f"hata: {e}", file=sys.stderr)
        return 2
    except OSError as e:
        print(f"hata: izin listesi okunamadı: {e}", file=sys.stderr)
        return 2

    try:
        dosyalar = git_dosyalari(kok)
    except OrtamHatasi as e:
        print(f"hata: {e}", file=sys.stderr)
        return 2

    bulgular = tara(kok, dosyalar, izinli, _yasak_ortamdan())
    if args.json:
        print(json.dumps({
            "bulgular": [{"dosya": b.dosya, "satir": b.satir, "kural": b.kural,
                          "alinti": b.alinti} for b in bulgular],
            "taranan": len(dosyalar),
        }, ensure_ascii=False, indent=2))
    else:
        for b in bulgular:
            print(f"{b.dosya}:{b.satir}: {b.kural}: {b.alinti}")
        print(f"gizlilik_tara: {len(dosyalar)} dosya tarandı, {len(bulgular)} bulgu.",
              file=sys.stderr)
    return 1 if bulgular else 0


if __name__ == "__main__":
    sys.exit(main())
