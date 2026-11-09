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


def devir_kok(env=None) -> Path:
    """Devir notlarinin klasoru.

    Sira: BELLEK_DEVIR_DIR > Bellek ayarindaki vault + "/devir" (bellek.toml,
    BELLEK_CONFIG ya da sablon) > paket kokundeki vault/devir. Ayarin vault disindaki
    hatalari (ornegin bozuk bir [[source]]) yolu degistirmez. Vault cozulemezse istisna
    firlatmaz: varsayilan klasoru dondurur, nedeni DEVIR_KOK_UYARI'ya ve stderr'e yazar.
    """
    global DEVIR_KOK_UYARI
    DEVIR_KOK_UYARI = None
    env = os.environ if env is None else env
    ozel = env.get("BELLEK_DEVIR_DIR")
    if ozel:
        return Path(ozel)
    varsayilan = _PAKET_KOK / "vault" / "devir"
    try:
        from bellek.config import load_vault

        return Path(load_vault()) / "devir"
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


DEVIR_KOK: Path = devir_kok()

OTO_MAX_GUN = 14
BITTI_MAX_GUN = 30
OTO_MAX_KARAKTER = 1500
ON_BILGI_OKUMA = 2048  # bayt; on bilgi bunun icinde kalir


def _tek_satir(deger, sinir: int = 0) -> str:
    s = " ".join(str(deger if deger is not None else "").split())
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
    """Otomatik notu atomik yazar; oturum yoksa ya da hata olursa None."""
    tmp = None
    try:
        oturum = _tek_satir((ozet or {}).get("oturum"))
        if not oturum:
            return None
        klasor = Path(kok) / "oto"
        klasor.mkdir(parents=True, exist_ok=True)
        hedef = klasor / f"{_guvenli_ad(oturum)}.md"
        tmp = klasor / f".{hedef.name}.{os.getpid()}.tmp"
        tmp.write_text(_oto_icerik(ozet), encoding="utf-8", newline="\n")
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
            t = n["tarih"]
            if t is None:
                try:
                    t = datetime.fromtimestamp(n["yol"].stat().st_mtime).astimezone()
                except Exception:
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
            ad = f"oto/{n['yol'].name}" if oto_mu else n["yol"].name
            satirlar.append(f"- {gosterim.strftime('%Y-%m-%d %H:%M')} {etiket} {konu} · "
                            f"{_tek_satir(n['durum'])} · {ad}")

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
