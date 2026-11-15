"""Devir notlari: otomatik not yazma, listeleme ve yeni oturum icin dizin metni.

Hook her turda calistigi icin hizli, yalniz stdlib ve istisna firlatmayan olmali.
"""
from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

_PAKET_KOK = Path(__file__).resolve().parents[3]


DEVIR_KOK_UYARI: str | None = None  # son devir_kok cagrisi varsayilana dustuyse nedeni


_KOK_ONBELLEK_ADI = "devir_kok.json"
_KOK_ONBELLEK_SURUM = 1


def _ayar_dosyasi() -> tuple[str, Path]:
    """(BELLEK_CONFIG degeri, okunacak ayar dosyasi): bellek.config'in secimiyle ayni kural.

    Yalniz stat cagrilari; bellek.config'i (tomllib, dataclasses) yuklemez.
    """
    ayar_env = os.environ.get("BELLEK_CONFIG") or ""
    if ayar_env:
        return ayar_env, Path(ayar_env)
    varsayilan = _PAKET_KOK / "bellek.toml"
    if not varsayilan.exists():
        ornek = _PAKET_KOK / "bellek.example.toml"
        if ornek.is_file():
            return "", ornek
    return "", varsayilan


def _damga(yol: Path) -> list[int]:
    st = os.stat(yol)
    return [st.st_mtime_ns, st.st_size]


def _onbellekten_kok(onbellek: Path) -> Path | None:
    """Gecerli onbellek kaydi varsa devir kokunu dondurur; yoksa None (asla firlatmaz)."""
    try:
        import json

        with open(Path(onbellek) / _KOK_ONBELLEK_ADI, "rb") as f:
            k = json.loads(f.read().decode("utf-8"))
        if not isinstance(k, dict) or k.get("surum") != _KOK_ONBELLEK_SURUM:
            return None
        ayar_env, yol = _ayar_dosyasi()
        if (k.get("ayar_env") != ayar_env or k.get("yol") != str(yol)
                or k.get("damga") != _damga(yol) or not isinstance(k.get("kok"), str)):
            return None
        return Path(k["kok"])
    except Exception:  # noqa: BLE001 - onbellek yoksa/bozuksa normal yol
        return None


def _onbellege_yaz(onbellek: Path, ayar_env: str, yol: Path, damga: list[int],
                   kok: Path) -> None:
    """Cozulen yolu onbellege yazar; yalniz ortamdan bagimsiz cozumlerde (asla firlatmaz)."""
    tmp = None
    try:
        import json
        import tomllib

        from bellek.config import _select_config_path

        # Secim bellek.config ile birebir ayni olmali; goreli yol cwd'ye bagli: onbelleklenmez.
        if Path(_select_config_path(None)[0]) != yol or not yol.is_absolute():
            return
        if _damga(yol) != damga:  # okuma sirasinda degisti
            return
        ham = tomllib.loads(yol.read_bytes().decode("utf-8"))["bellek"]["vault"]
        # Ortam degiskeni ya da ~ iceren vault her surecte yeniden cozulur.
        if not isinstance(ham, str) or any(c in ham for c in "%$~"):
            return
        klasor = Path(onbellek)
        from bellek.izin import ozel_klasor
        ozel_klasor(klasor)  # hook durum klasörü: POSIX'te yalnız sahibine açık
        hedef = klasor / _KOK_ONBELLEK_ADI
        tmp = klasor / f".{_KOK_ONBELLEK_ADI}.{os.getpid()}.tmp"
        tmp.write_text(json.dumps({"surum": _KOK_ONBELLEK_SURUM, "ayar_env": ayar_env,
                                   "yol": str(yol), "damga": damga, "kok": str(kok)},
                                  ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, hedef)
        tmp = None
    except Exception:  # noqa: BLE001
        pass
    finally:
        try:
            if tmp is not None and tmp.exists():
                tmp.unlink()
        except Exception:  # noqa: BLE001
            pass


def devir_kok(env=None, onbellek: Path | None = None) -> Path:
    """Devir notlarinin klasoru.

    Sira: BELLEK_DEVIR_DIR > Bellek ayarindaki vault + "/devir" (bellek.toml,
    BELLEK_CONFIG ya da sablon) > paket kokundeki vault/devir. Ayarin vault disindaki
    hatalari (ornegin bozuk bir [[source]]) yolu degistirmez. Vault cozulemezse istisna
    firlatmaz: varsayilan klasoru dondurur, nedeni DEVIR_KOK_UYARI'ya ve stderr'e yazar.

    onbellek: verilirse (hook durum klasoru) cozulen yol orada saklanir; ayar dosyasinin
    mtime/boyutu ve BELLEK_CONFIG degismedikce sonraki surecler bellek.config'i yuklemez.
    """
    global DEVIR_KOK_UYARI
    DEVIR_KOK_UYARI = None
    env = os.environ if env is None else env
    ozel = env.get("BELLEK_DEVIR_DIR")
    if ozel:
        return Path(ozel)
    if onbellek is not None:
        kayitli = _onbellekten_kok(onbellek)
        if kayitli is not None:
            return kayitli
    varsayilan = _PAKET_KOK / "vault" / "devir"
    try:
        damga = None
        if onbellek is not None:
            try:
                ayar_env, ayar_yol = _ayar_dosyasi()
                damga = _damga(ayar_yol)
            except Exception:  # noqa: BLE001
                damga = None
        from bellek.config import load_vault

        kok = Path(load_vault()) / "devir"
        if damga is not None:
            _onbellege_yaz(onbellek, ayar_env, ayar_yol, damga, kok)
        return kok
    except Exception as e:  # noqa: BLE001 - hook fail-open: varsayilan klasor + gorunur uyari
        DEVIR_KOK_UYARI = (f"devir klasoru ayardan cozulemedi ({type(e).__name__}: {e}); "
                           f"varsayilan kullaniliyor: {varsayilan}")
        try:  # konsol kodlamasından bağımsız: açıkça UTF-8 bayt
            ileti = f"bellek devir: {DEVIR_KOK_UYARI}\n"
            tampon = getattr(sys.stderr, "buffer", None)
            if tampon is not None:
                tampon.write(ileti.encode("utf-8", "replace"))
                tampon.flush()
            else:
                sys.stderr.write(ileti)
        except Exception:  # noqa: BLE001
            pass
        return varsayilan


def __getattr__(ad: str):
    """DEVIR_KOK tembel: ice aktarma bellek.config'i yuklemez (hook her turda calisir).

    Ilk erisimde devir_kok() calisir (DEVIR_KOK_UYARI o an ayarlanir) ve sonuc
    modulde saklanir; importlib.reload sonrasi yeniden hesaplanir.
    """
    if ad == "DEVIR_KOK":
        kok = devir_kok()
        globals()["DEVIR_KOK"] = kok
        return kok
    raise AttributeError(f"module {__name__!r} has no attribute {ad!r}")


globals().pop("DEVIR_KOK", None)  # reload ayni sozlugu kullanir: eski degeri birakma


OTO_MAX_GUN = 14
OTO_BUDAMA_GUN = 2 * OTO_MAX_GUN  # otomatik notlar bundan eskiyse diskten silinir
BITTI_MAX_GUN = 30
# SessionStart dizininde notlardan gelen alanların üst sınırı (konu 100). Değerler dış
# kaynaklıdır (paylaşılan/eşlenen vault): her oturumun bağlamına girdikleri için kısa tutulur.
DIZIN_DURUM_SINIR = 24  # devam | bitti | beklemede; uzun serbest metin kısaltılır
DIZIN_AD_SINIR = 80
OTO_MAX_KARAKTER = 1500
ON_BILGI_OKUMA = 2048  # bayt; on bilgi bunun icinde kalir


def _tek_satir(deger, sinir: int = 0) -> str:
    """Tek satır: denetim/biçim karakterleri (satır sonları, ESC, yön işaretleri, sıfır
    genişlikli karakterler) boşluk olur, boşluklar teke iner; ``sinir`` verilirse kısaltılır.
    Notlardaki dış kaynaklı metin hook çıktısına satır ya da gizli karakter sokamaz."""
    s = "".join(c if c.isprintable() else " " for c in str(deger if deger is not None else ""))
    s = " ".join(s.split())
    if sinir and len(s) > sinir:
        s = s[: sinir - 1].rstrip() + "…"
    return s


def _simdi_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def _baglam_metni(n) -> str:
    try:
        n = int(n)
    except (TypeError, ValueError):
        return ""
    if n <= 0:
        return ""
    return f"{round(n / 1000)}K token" if n >= 1000 else f"{n} token"


def _oto_icerik(ozet: dict) -> str:
    baslik = _tek_satir(ozet.get("baslik"), 120) or "adsız oturum"
    proje = _tek_satir(ozet.get("cwd"), 200) or "-"
    tarih = _tek_satir(ozet.get("son_zaman")) or _simdi_iso()
    on = [
        "---",
        "tur: otomatik",
        f"oturum: {_tek_satir(ozet.get('oturum'))}",
        f"konu: {baslik}",
        f"proje: {proje}",
        f"tarih: {tarih}",
        "durum: bilinmiyor",
        "---",
    ]
    govde: list[str] = []
    ilk = _tek_satir(ozet.get("ilk_istem"), 300)
    son = _tek_satir(ozet.get("son_istem"), 300)
    if ilk:
        govde.append(f"İlk istem: {ilk}")
    if son and son != ilk:
        govde.append(f"Son istem: {son}")
    dosyalar = [_tek_satir(d, 150) for d in (ozet.get("duzenlenen") or []) if d]
    if dosyalar:
        govde.append("Düzenlenen dosyalar:")
        govde.extend(f"- {d}" for d in dosyalar[:15])
        if len(dosyalar) > 15:
            govde.append(f"- … (+{len(dosyalar) - 15})")
    b = _baglam_metni(ozet.get("son_baglam"))
    if b:
        govde.append(f"Son bağlam: {b}")
    if ozet.get("istek_sayisi") not in (None, ""):
        govde.append(f"İstek sayısı: {_tek_satir(ozet.get('istek_sayisi'))}")
    m = _tek_satir(ozet.get("son_model"), 80)
    if m:
        govde.append(f"Model: {m}")
    metin = "\n".join(on + govde) + "\n"
    if len(metin) > OTO_MAX_KARAKTER:
        metin = metin[: OTO_MAX_KARAKTER - 2].rstrip() + "…\n"
    return metin


def _guvenli_ad(oturum: str) -> str:
    return "".join(c if (c.isalnum() or c in "-_.") else "_" for c in oturum)[:120]


def oto_not_yaz(kok: Path, ozet: dict) -> Path | None:
    """Otomatik notu atomik yazar; oturum yoksa ya da hata olursa None.

    Icerik diskteki dosyayla ayniysa yeniden yazmaz (mtime degismez): bulutla eslenen
    klasorde gereksiz senkronu ve eszamanli okuyan oturumla os.replace cakismasini onler.
    """
    tmp = None
    try:
        oturum = _tek_satir((ozet or {}).get("oturum"))
        if not oturum:
            return None
        klasor = Path(kok) / "oto"
        hedef = klasor / f"{_guvenli_ad(oturum)}.md"
        veri = _oto_icerik(ozet).encode("utf-8")
        try:
            with open(hedef, "rb") as f:
                if f.read(len(veri) + 1) == veri:
                    return hedef
        except OSError:
            pass  # yok ya da okunamadi: yaz
        klasor.mkdir(parents=True, exist_ok=True)
        tmp = klasor / f".{hedef.name}.{os.getpid()}.tmp"
        tmp.write_bytes(veri)
        os.replace(tmp, hedef)
        return hedef
    except Exception:
        try:
            if tmp is not None and tmp.exists():
                tmp.unlink()
        except Exception:
            pass
        return None


def _tarih_coz(s: str) -> datetime | None:
    s = (s or "").strip()
    if not s:
        return None
    try:
        if s.endswith(("Z", "z")):
            s = s[:-1] + "+00:00"
        return datetime.fromisoformat(s)
    except ValueError:
        return None


def _on_bilgi_oku(yol: Path) -> dict | None:
    try:
        with open(yol, "rb") as f:
            ham = f.read(ON_BILGI_OKUMA)
        metin = ham.decode("utf-8", errors="replace").lstrip("\ufeff")
        satirlar = metin.splitlines()
        if not satirlar or satirlar[0].strip() != "---":
            return None
        alanlar: dict[str, str] = {}
        kapandi = False
        for s in satirlar[1:]:
            if s.strip() == "---":
                kapandi = True
                break
            if ": " in s:
                a, d = s.split(": ", 1)
            elif s.endswith(":"):
                a, d = s[:-1], ""
            else:
                continue
            alanlar[a.strip()] = d.strip()
        if not kapandi:
            return None
        return alanlar
    except Exception:
        return None


def notlari_listele(kok: Path) -> list[dict]:
    kok = Path(kok)
    sonuc: list[dict] = []
    for klasor, varsayilan_tur in ((kok, "devir"), (kok / "oto", "otomatik")):
        try:
            with os.scandir(klasor) as it:
                girdiler = [e for e in it if e.name.endswith(".md")
                            and not e.name.startswith(".") and e.is_file()]
        except Exception:
            continue
        for e in girdiler:
            a = _on_bilgi_oku(Path(e.path))
            if a is None:
                continue
            sonuc.append({
                "yol": Path(e.path),
                "tur": a.get("tur") or varsayilan_tur,
                "oturum": a.get("oturum", ""),
                "konu": a.get("konu", ""),
                "proje": a.get("proje", ""),
                "tarih": _tarih_coz(a.get("tarih", "")),
                "durum": a.get("durum") or "bilinmiyor",
                "private": a.get("private", "").strip().lower() in ("true", "evet", "yes", "1"),
            })
    return sonuc


def _uyumlu(t: datetime, simdi: datetime) -> datetime:
    """Saat dilimli/dilimsiz karisikligini giderir."""
    if t.tzinfo is None and simdi.tzinfo is not None:
        return t.replace(tzinfo=simdi.tzinfo)
    if t.tzinfo is not None and simdi.tzinfo is None:
        return t.astimezone().replace(tzinfo=None)
    return t


def _not_zamani(tarih: datetime | None, yol: Path) -> datetime | None:
    """Notun yas hesabindaki zamani: on bilgideki tarih, yoksa dosyanin mtime'i."""
    if tarih is not None:
        return tarih
    try:
        return datetime.fromtimestamp(Path(yol).stat().st_mtime).astimezone()
    except Exception:
        return None


def _junction_mi(yol: Path) -> bool:
    """Windows junction mi (os.path.isjunction 3.12+; hata olursa suphe: True)."""
    try:
        return bool(getattr(os.path, "isjunction", lambda _p: False)(yol))
    except Exception:  # noqa: BLE001
        return True


def oto_notlari_buda(kok: Path, simdi: datetime | None = None) -> int:
    """kok/oto/ altinda yasi OTO_BUDAMA_GUN'u asan otomatik notlari siler; silinen sayisi.

    Silme geri alinamaz; supheli her dosya kalir. Bir dosya ancak hepsi saglanirsa silinir:
    oto/'nun dogrudan icinde, baglanti olmayan duz .md dosyasi; on bilgisi okuma penceresi
    icinde acilip kapanmis; ``tur: otomatik`` acikca yazili; adi oto_not_yaz'in urettigi
    ``<guvenli oturum adi>.md``; ``tarih`` alani cozulebiliyor ve OTO_BUDAMA_GUN'den eski.
    Yas yalniz on bilgideki tarihten gelir (dizin_metni de onu kullanir); dizin_metni'nin
    mtime yedegi burada bilerek yok: kopyalanmis/eslenmis dosyada mtime yanlis yas verir.
    kok ya da kok/oto bir baglanti/junction ise hicbir sey silinmez. Asla istisna firlatmaz.
    """
    silinen = 0
    try:
        simdi = simdi or datetime.now(timezone.utc)
        esik = timedelta(days=OTO_BUDAMA_GUN)
        klasor = Path(kok) / "oto"
        for p in (Path(kok), klasor):
            if os.path.islink(p) or _junction_mi(p):
                return 0
        with os.scandir(klasor) as it:
            girdiler = [e for e in it if e.name.endswith(".md")
                        and not e.name.startswith(".")]
        for e in girdiler:
            try:
                if e.is_symlink() or not e.is_file(follow_symlinks=False):
                    continue
                a = _on_bilgi_oku(Path(e.path))
                if a is None or a.get("tur") != "otomatik":
                    continue
                oturum = a.get("oturum", "")
                if not oturum or e.name != f"{_guvenli_ad(oturum)}.md":
                    continue
                t = _tarih_coz(a.get("tarih", ""))
                if t is None or simdi - _uyumlu(t, simdi) <= esik:
                    continue
                os.unlink(e.path)
                silinen += 1
            except Exception:  # noqa: BLE001 - silinemeyen dosya atlanir
                continue
    except Exception:  # noqa: BLE001 - oto/ yok ya da okunamadi
        pass
    return silinen


def dizin_metni(kok: Path, simdi: datetime, oturum: str | None = None,
                sinir: int = 1500) -> str:
    try:
        notlar = notlari_listele(kok)
        zengin_oturumlar = {n["oturum"] for n in notlar
                            if n["tur"] != "otomatik" and n["oturum"]}
        aday: list[tuple[datetime, dict]] = []
        for n in notlar:
            if n.get("private"):
                continue
            if oturum and n["oturum"] == oturum:
                continue
            oto = n["tur"] == "otomatik"
            if oto and n["oturum"] in zengin_oturumlar:
                continue
            t = _not_zamani(n["tarih"], n["yol"])
            if t is None:
                continue
            t = _uyumlu(t, simdi)
            yas = simdi - t
            if oto and yas > timedelta(days=OTO_MAX_GUN):
                continue
            if not oto and n["durum"] == "bitti" and yas > timedelta(days=BITTI_MAX_GUN):
                continue
            aday.append((t, n))
        if not aday:
            return ""
        # önce zengin notlar, sonra otomatikler; her grup en yeniden eskiye
        aday.sort(key=lambda x: (x[1]["tur"] == "otomatik", -x[0].timestamp()))

        baslik = (f"Son devir notları (klasör: {Path(kok)}; "
                  "devam edilecek iş varsa ilgili notu oku):")
        satirlar = []
        for t, n in aday:
            oto_mu = n["tur"] == "otomatik"
            etiket = "[oto]" if oto_mu else "[devir]"
            konu = _tek_satir(n["konu"], 100) or "adsız"
            if t.tzinfo is not None:
                try:
                    gosterim = t.astimezone()
                except Exception:
                    gosterim = t
            else:
                gosterim = t
            ad = _tek_satir(f"oto/{n['yol'].name}" if oto_mu else n["yol"].name, DIZIN_AD_SINIR)
            durum = _tek_satir(n["durum"], DIZIN_DURUM_SINIR) or "bilinmiyor"
            satirlar.append(f"- {gosterim.strftime('%Y-%m-%d %H:%M')} {etiket} {konu} · "
                            f"{durum} · {ad}")

        def ek(dis: int) -> str:
            return f"… ve {dis} not daha dışarıda"

        toplam = len(satirlar)
        for k in range(toplam, -1, -1):
            parcalar = [baslik] + satirlar[:k]
            if k < toplam:
                parcalar.append(ek(toplam - k))
            metin = "\n".join(parcalar)
            if len(metin) <= sinir:
                return metin
        return (baslik + "\n" + ek(toplam))[:sinir]
    except Exception:
        return ""
