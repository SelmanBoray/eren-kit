"""Arayüz zaman şeridi ve canlı güncelleme: `gecmis` tablosunun güvenli projeksiyonu.

Sözleşme (SOZLESME §1-§3):
- `gecmis.eski_json` / `yeni_json` ham içerik (sır gövdesi dahil) taşır; ASLA dışarı
  verilmez. Her olay beyaz listeli `Olay` alanlarına indirgenir:
  {"id","zaman","islem","tablo","hedef_id","dugum_id","baslik","gizlilik","ozet"}.
- Gizlilik hedef düğümün BUGÜNKÜ etkin gizliliğidir (`arayuz._Etkin`, yani
  `sorgu._EtkinGizlilik` + zincir bütünlüğü): düğüm + birincil ata zincirinin en
  kısıtlayıcısı; bulunamayan düğüm/ata, döngü ya da derinlik sınırı `sir_icerir`.
  Sonuç sorgu sırasından bağımsızdır; graf/dugum ile aynıdır.
- `baslik` düğümün bugünkü başlığıdır (sır için de serbest); düğüm yoksa null.
- `ozet` (≤160 karakter) yalnız etkin gizlilik `normal` ise doludur. Düğüme bağlı
  olmayan olaylarda (gelen, kaynak) ozet yalnız genel ifadedir; öneri metni,
  kaynak ref'i gibi serbest içerik hiç yer almaz.
- Tanınmayan tablo ya da düğümü çözülemeyen olgu: dugum_id null, gizlilik
  `sir_icerir`, ozet null (kapalı başarısızlık).

Salt okunurdur; hiçbir şey yazmaz, commit etmez.
"""

from __future__ import annotations

import json
import sqlite3
from typing import Any

from . import db
from .arayuz import _Etkin
from .sorgu import _giz, _kisalt

__all__ = ["imlec", "gecmis", "degisim"]

OZET_SINIR = 160
GECMIS_LIMIT_VARSAYILAN = 500
GECMIS_LIMIT_UST = 1000
DEGISIM_SINIR = 200

_NORMAL, _SIR = "normal", "sir_icerir"

# dugum güncellemesinde değişen alanların okunur adları (yalnız ad, değer asla)
_ALAN_ADLARI = {
    "baslik": "başlık",
    "ozet": "özet",
    "ayrinti": "ayrıntı",
    "tur": "tür",
    "durum": "durum",
    "gizlilik": "gizlilik",
    "tarih": "tarih",
    "anahtar": "anahtar",
}

_GELEN_TUR_ADLARI = {
    "yeni_dugum": "yeni düğüm",
    "olgu": "olgu",
    "celiski": "çelişki",
    "tasima": "taşıma",
}

_GELEN_DURUM_OZETLERI = {
    "kabul": "Öneri kabul edildi",
    "red": "Öneri reddedildi",
    "bekliyor": "Öneri beklemeye alındı",
}

_SECIM = "SELECT id, zaman, islem, tablo, hedef_id, eski_json, yeni_json FROM gecmis"


# --------------------------------------------------------------------------
# Yardımcılar
# --------------------------------------------------------------------------


def _tamsayi(deger: Any, varsayilan: int) -> int:
    try:
        return int(deger)
    except (TypeError, ValueError):
        return varsayilan


def _coz(metin: Any) -> dict[str, Any]:
    """JSON metnini sözlüğe çevirir; bozuk/eksikse boş sözlük (yalnız iç kullanım)."""
    if not isinstance(metin, str) or not metin:
        return {}
    try:
        veri = json.loads(metin)
    except (ValueError, TypeError):
        return {}
    return veri if isinstance(veri, dict) else {}


def _str_ya_da_none(deger: Any) -> str | None:
    return deger if isinstance(deger, str) and deger else None


class _Cozumleyici:
    """Çağrı başına bir örnek: etkin gizlilik ve başlıklar önbelleklenir."""

    def __init__(self, con: sqlite3.Connection) -> None:
        self.con = con
        self.etkin = _Etkin(con)  # sorgu tabanı + zincir bütünlüğü (arayuz ile aynı kural)
        self._basliklar: dict[str, str | None] = {}
        self._olgular: dict[str, tuple[str | None, str | None]] = {}

    def baslik(self, dugum_id: str | None) -> str | None:
        if dugum_id is None:
            return None
        if dugum_id not in self._basliklar:
            r = self.con.execute("SELECT baslik FROM dugum WHERE id = ?", (dugum_id,)).fetchone()
            self._basliklar[dugum_id] = _str_ya_da_none(r[0]) if r is not None else None
        return self._basliklar[dugum_id]

    def gizlilik(self, dugum_id: str | None) -> str:
        if dugum_id is None:
            return _SIR
        return _giz(self.etkin(dugum_id))

    def olgu(self, olgu_id: str | None) -> tuple[str | None, str | None]:
        """(dugum, metin) — olgu tablosundan; yoksa (None, None)."""
        if olgu_id is None:
            return None, None
        if olgu_id not in self._olgular:
            r = self.con.execute("SELECT dugum, metin FROM olgu WHERE id = ?", (olgu_id,)).fetchone()
            self._olgular[olgu_id] = (
                (_str_ya_da_none(r[0]), _str_ya_da_none(r[1])) if r is not None else (None, None)
            )
        return self._olgular[olgu_id]

    # ------------------------------------------------------------ olay

    def olay(self, satir: Any) -> dict[str, Any]:
        g_id, zaman, islem, tablo, hedef_id, eski_json, yeni_json = (
            satir[0], satir[1], satir[2], satir[3], satir[4], satir[5], satir[6]
        )
        islem_s = islem if isinstance(islem, str) else str(islem)
        tablo_s = tablo if isinstance(tablo, str) else str(tablo)
        hedef = _str_ya_da_none(hedef_id)

        dugum_id: str | None = None
        gizlilik = _SIR
        ozet: str | None = None
        baslik: str | None = None

        if tablo_s in ("dugum", "olgu", "kenar"):
            eski, yeni = _coz(eski_json), _coz(yeni_json)
            if tablo_s == "dugum":
                dugum_id = hedef
            elif tablo_s == "kenar":
                dugum_id = hedef or _str_ya_da_none(yeni.get("cocuk")) or _str_ya_da_none(eski.get("cocuk"))
            else:
                dugum_id = _str_ya_da_none(yeni.get("dugum")) or _str_ya_da_none(eski.get("dugum"))
                if dugum_id is None:
                    dugum_id = self.olgu(hedef)[0]
            if dugum_id is not None:
                gizlilik = self.gizlilik(dugum_id)
                baslik = self.baslik(dugum_id)
                if baslik is None:  # düğüm bulunamadı → kapalı başarısızlık
                    gizlilik = _SIR
                if gizlilik == _NORMAL:
                    ozet = self._dugumlu_ozet(tablo_s, islem_s, hedef, dugum_id, baslik, eski, yeni)
        elif tablo_s == "gelen":
            gizlilik = _NORMAL
            ozet = self._gelen_ozet(islem_s, _coz(eski_json), _coz(yeni_json))
        elif tablo_s == "kaynak":
            gizlilik = _NORMAL
            yeni = _coz(yeni_json)
            tur = yeni.get("tur")
            ozet = f"Yeni kaynak: {tur}" if tur in db.KAYNAK_TURLERI else "Yeni kaynak"
            if islem_s != "ekle":
                ozet = "Kaynak değişti"
        # tanınmayan tablo: dugum_id null, sir, ozet null

        return {
            "id": g_id,
            "zaman": zaman,
            "islem": islem_s,
            "tablo": tablo_s,
            "hedef_id": hedef,
            "dugum_id": dugum_id,
            "baslik": baslik,
            "gizlilik": gizlilik,
            "ozet": (_kisalt(ozet, OZET_SINIR) or None) if ozet is not None else None,
        }

    def _dugumlu_ozet(
        self,
        tablo: str,
        islem: str,
        hedef: str | None,
        dugum_id: str,
        baslik: str | None,
        eski: dict[str, Any],
        yeni: dict[str, Any],
    ) -> str | None:
        """Yalnız etkin gizliliği `normal` olan düğüm için çağrılır."""
        if tablo == "dugum":
            if islem == "ekle":
                return baslik
            if islem == "guncelle":
                alanlar = [
                    ad for anahtar, ad in _ALAN_ADLARI.items()
                    if anahtar in yeni and eski.get(anahtar) != yeni.get(anahtar)
                ]
                if alanlar:
                    return f"Güncellendi ({', '.join(alanlar)}): {baslik}"
                return f"Güncellendi: {baslik}"
            return f"Düğüm değişti: {baslik}"

        if tablo == "olgu":
            metin = _str_ya_da_none(yeni.get("metin")) or _str_ya_da_none(eski.get("metin"))
            if metin is None:
                metin = self.olgu(hedef)[1]
            if islem == "ekle":
                return metin or f"Yeni olgu: {baslik}"
            if islem == "guncelle":
                durum = yeni.get("durum")
                on = "Olgu eskidi" if durum == "eskidi" else "Olgu güncellendi"
                return f"{on}: {metin}" if metin else f"{on}: {baslik}"
            return f"Olgu değişti: {baslik}"

        # kenar
        kayit = yeni or eski
        ebeveyn = _str_ya_da_none(kayit.get("ebeveyn"))
        e_baslik = self.baslik(ebeveyn) or "?"
        ok = f"{e_baslik} → {baslik}"
        if kayit.get("tur") == "ilgili":
            ok += " (ilgili)"
        if islem == "ekle":
            return ok
        if islem == "sil":
            return f"Bağ kaldırıldı: {ok}"
        if islem == "guncelle":
            if yeni.get("birincil") == 1 and eski.get("birincil") != 1:
                return f"Birincil ebeveyn oldu: {ok}"
            if yeni.get("birincil") == 0 and eski.get("birincil") == 1:
                return f"Birincil ebeveynlikten çıktı: {ok}"
            return f"Bağ güncellendi: {ok}"
        return f"Bağ değişti: {ok}"

    @staticmethod
    def _gelen_ozet(islem: str, eski: dict[str, Any], yeni: dict[str, Any]) -> str:
        """Genel ifade; öneri metni (oneri_json) asla kullanılmaz."""
        if islem == "ekle":
            tur = _GELEN_TUR_ADLARI.get(yeni.get("tur"))  # type: ignore[arg-type]
            return f"Yeni öneri ({tur})" if tur else "Yeni öneri"
        if islem == "guncelle":
            return _GELEN_DURUM_OZETLERI.get(yeni.get("durum"), "Öneri güncellendi")  # type: ignore[arg-type]
        return "Öneri değişti"


# --------------------------------------------------------------------------
# Genel fonksiyonlar
# --------------------------------------------------------------------------


def imlec(con: sqlite3.Connection) -> int:
    """Geçmişteki en büyük olay id'si (boşsa 0)."""
    return int(con.execute("SELECT coalesce(max(id), 0) FROM gecmis").fetchone()[0])


_en_buyuk_id = imlec  # degisim'in `imlec` parametresi adı gölgelediği için


def gecmis(
    con: sqlite3.Connection, sonra: int = 0, limit: int = GECMIS_LIMIT_VARSAYILAN
) -> dict[str, Any]:
    """`sonra`dan büyük id'li olaylar, id artan. → {"olaylar": [Olay], "sonraki": int|None}

    `limit` 1..1000'e kırpılır. `sonraki` devam için verilecek `sonra` değeridir;
    daha fazla olay yoksa None.
    """
    sonra = max(_tamsayi(sonra, 0), 0)
    limit = min(max(_tamsayi(limit, GECMIS_LIMIT_VARSAYILAN), 1), GECMIS_LIMIT_UST)
    satirlar = con.execute(
        f"{_SECIM} WHERE id > ? ORDER BY id LIMIT ?", (sonra, limit + 1)
    ).fetchall()
    fazla = len(satirlar) > limit
    satirlar = satirlar[:limit]
    if not satirlar:
        return {"olaylar": [], "sonraki": None}
    cozumleyici = _Cozumleyici(con)
    olaylar = [cozumleyici.olay(s) for s in satirlar]
    return {"olaylar": olaylar, "sonraki": int(satirlar[-1][0]) if fazla else None}


def gelen_bekleyen(con: sqlite3.Connection) -> int:
    return int(con.execute("SELECT count(*) FROM gelen WHERE durum = 'bekliyor'").fetchone()[0])


def degisim(con: sqlite3.Connection, imlec: int) -> dict[str, Any]:  # noqa: A002 — sözleşme adı
    """İmleçten sonraki olaylar (en çok 200).

    → {"imlec": int, "olaylar": [Olay], "yeniden_yukle": bool, "gelen_bekleyen": int}
    200'den fazla olay varsa `yeniden_yukle` true, olaylar yine ilk 200, imlec gerçek
    en büyük id. Boş yoklama yalnız iki ucuz sorgu çalıştırır.
    """
    baslangic = max(_tamsayi(imlec, 0), 0)
    satirlar = con.execute(
        f"{_SECIM} WHERE id > ? ORDER BY id LIMIT ?", (baslangic, DEGISIM_SINIR + 1)
    ).fetchall()
    bekleyen = gelen_bekleyen(con)
    if not satirlar:
        return {"imlec": baslangic, "olaylar": [], "yeniden_yukle": False, "gelen_bekleyen": bekleyen}
    yeniden_yukle = len(satirlar) > DEGISIM_SINIR
    satirlar = satirlar[:DEGISIM_SINIR]
    cozumleyici = _Cozumleyici(con)
    olaylar = [cozumleyici.olay(s) for s in satirlar]
    son = _en_buyuk_id(con) if yeniden_yukle else int(satirlar[-1][0])
    return {
        "imlec": son,
        "olaylar": olaylar,
        "yeniden_yukle": yeniden_yukle,
        "gelen_bekleyen": bekleyen,
    }
