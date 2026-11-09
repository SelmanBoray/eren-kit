"""Görsel arayüz için salt okunur veri projeksiyonları (`/api/ui/*` gövdeleri).

Her fonksiyon bir sqlite3 bağlantısı alır ve servisin olduğu gibi JSON'a çevireceği
bir sözlük döndürür. Hiçbir fonksiyon yazmaz.

Gizlilik (etkin gizlilik = düğüm + birincil ata zincirinin en kısıtlayıcısı,
`sorgu._EtkinGizlilik` ile aynı kural):
- normal: her şey.
- ozel: toplu uçlarda (graf, ara, gelen) yalnız başlık + işaret; gövde yalnız
  `dugum(..., ac=True)` ve `gelen(ac=<id>)` ile o tek öğe için.
- sir_icerir: her yerde yalnız id, başlık, gizlilik; gövde, olgu sayısı, ek hiç.
- Kapalı başarısızlık: tanınmayan gizlilik, bulunamayan ata, döngü ya da derinlik
  sınırını aşan zincir sir_icerir sayılır.
"""

from __future__ import annotations

import json
import sqlite3
from typing import Any, Callable

from . import db, sorgu, yaz

__all__ = ["graf", "dugum", "ara", "gelen", "gelen_bekleyen"]

_NORMAL, _OZEL, _SIR = "normal", "ozel", "sir_icerir"
_DERINLIK = sorgu._YOL_DERINLIK
_ARA_K_EN_COK = 50
_OLGU_DURUMLARI = ("aktif", "eskidi")

_EBEVEYN_SQL = (
    "SELECT ebeveyn FROM kenar WHERE cocuk = ? AND tur = 'alt' "
    "ORDER BY birincil DESC, sira LIMIT 1"
)


# --------------------------------------------------------------------------
# Gizlilik
# --------------------------------------------------------------------------


class _Etkin:
    """`sorgu._EtkinGizlilik` + zincir bütünlüğü denetimi.

    Taban değer sorgu'dan gelir. Ek olarak birincil zincir bulunamayan bir ataya,
    döngüye ya da derinlik sınırına takılıyorsa sonuç sir_icerir olur.
    Ebeveyni olmayan (kök ya da öksüz) düğümde zincir temiz biter.
    """

    def __init__(self, con: sqlite3.Connection) -> None:
        self.con = con
        self.taban = sorgu._EtkinGizlilik(con)
        self.tam: dict[str, bool] = {}

    def _zincir_tam(self, dugum_id: str) -> bool:
        # Önbellek yalnız başlangıç düğümü için: derinlik sınırı sıradan bağımsız kalsın
        # (graf ile aynı sonuç). Zincirler kısa; çağrı başına birkaç sorgu.
        if dugum_id in self.tam:
            return self.tam[dugum_id]
        gorulen: set[str] = set()
        simdiki: str | None = dugum_id
        sonuc = True
        while simdiki is not None:
            if simdiki in gorulen or len(gorulen) >= _DERINLIK:
                sonuc = False
                break
            if self.con.execute("SELECT 1 FROM dugum WHERE id = ?", (simdiki,)).fetchone() is None:
                sonuc = False
                break
            gorulen.add(simdiki)
            r = self.con.execute(_EBEVEYN_SQL, (simdiki,)).fetchone()
            simdiki = r[0] if r is not None else None
        self.tam[dugum_id] = sonuc
        return sonuc

    def __call__(self, dugum_id: str) -> str:
        g = self.taban(dugum_id)
        if g == _SIR:
            return _SIR
        return g if self._zincir_tam(dugum_id) else _SIR


def _graf_etkin(
    giz: dict[str, str], ebeveyn: dict[str, str | None]
) -> tuple[dict[str, str], dict[str, int]]:
    """Bellekte tüm düğümler için (etkin gizlilik, derinlik); `_Etkin` ile aynı kural.

    Derinlik birincil zincirin tepesine (kök ya da öksüz) olan adım sayısıdır.
    Zincir kırıksa (bulunamayan ata, döngü, derinlik sınırı) zincirdeki tüm
    düğümler sir_icerir olur; derinlikleri yürünebilen kısımdaki sıradır.
    """
    etkin: dict[str, str] = {}
    derinlik: dict[str, int] = {}
    for bas in giz:
        if bas in etkin:
            continue
        yol: list[str] = []
        gorulen: set[str] = set()
        simdiki: str | None = bas
        ust_giz, ust_derinlik, kirik = _NORMAL, -1, False
        while simdiki is not None:
            if simdiki in etkin:
                ust_giz, ust_derinlik = etkin[simdiki], derinlik[simdiki]
                break
            if simdiki not in giz or simdiki in gorulen or len(yol) >= _DERINLIK:
                kirik = True
                break
            gorulen.add(simdiki)
            yol.append(simdiki)
            simdiki = ebeveyn.get(simdiki)
        if ust_derinlik + 1 + len(yol) > _DERINLIK:
            kirik = True  # önbellekten gelen kısımla birlikte sınırı aşıyor
        g, dr = ust_giz, ust_derinlik
        for d in reversed(yol):
            g = _SIR if kirik else sorgu._en_kisitli(g, giz[d])
            dr += 1
            etkin[d] = g
            derinlik[d] = dr
    return etkin, derinlik


# --------------------------------------------------------------------------
# Yardımcılar
# --------------------------------------------------------------------------


def _kok(con: sqlite3.Connection) -> str | None:
    """Kök id'si; okuma yolunda kök oluşturmaz."""
    return db.kok_bul(con)


def _bos_degil(s: Any) -> str | None:
    if s is None:
        return None
    s = str(s)
    return s if s.strip() else None


def _okuma(con: sqlite3.Connection, f: Callable[[], dict]) -> dict:
    """Tek okuma işleminde (aynı anlık görüntü) çalıştırır."""
    if con.in_transaction:
        return f()
    con.execute("BEGIN")
    try:
        return f()
    finally:
        if con.in_transaction:
            con.execute("COMMIT")


# --------------------------------------------------------------------------
# graf
# --------------------------------------------------------------------------


def graf(con: sqlite3.Connection) -> dict:
    """Tüm ağ: düğümler (gizliliğe göre süzülmüş), kenarlar, imleç."""
    return _okuma(con, lambda: _graf(con))


def _graf(con: sqlite3.Connection) -> dict:
    imlec = int(con.execute("SELECT coalesce(max(id), 0) FROM gecmis").fetchone()[0])
    bekleyen = gelen_bekleyen(con)
    kok = _kok(con)

    satirlar = con.execute(
        "SELECT id, baslik, tur, durum, gizlilik, ozet, tarih, olusturma, guncelleme "
        "FROM dugum ORDER BY id"
    ).fetchall()
    giz = {r[0]: sorgu._giz(r[4]) for r in satirlar}

    kenarlar: list[dict] = []
    ebeveyn: dict[str, str | None] = {}
    for e, c, tur, birincil, _sira in con.execute(
        "SELECT ebeveyn, cocuk, tur, birincil, sira FROM kenar "
        "ORDER BY cocuk, tur, birincil DESC, sira, ebeveyn"
    ):
        if tur == "alt" and c not in ebeveyn:
            ebeveyn[c] = e  # sorgu ile aynı seçim: birincil önce, sonra sira
        if e in giz and c in giz:
            kenarlar.append(
                {"ebeveyn": e, "cocuk": c, "tur": tur, "birincil": bool(birincil)}
            )

    sayilar: dict[str, list[int]] = {}
    for d, durum, n in con.execute(
        "SELECT dugum, durum, count(*) FROM olgu "
        "WHERE durum IN ('aktif', 'eskidi') GROUP BY dugum, durum"
    ):
        s = sayilar.setdefault(d, [0, 0])
        s[0 if durum == "aktif" else 1] = int(n)

    etkin, derinlik = _graf_etkin(giz, ebeveyn)

    # kök dalı: zincirde kökün doğrudan çocuğu olan ata
    kok_dal: dict[str, str | None] = {}

    def dal_bul(d: str) -> str | None:
        if d in kok_dal:
            return kok_dal[d]
        yol: list[str] = []
        gorulen: set[str] = set()
        simdiki: str | None = d
        sonuc: str | None = None
        while simdiki is not None and len(yol) < _DERINLIK:
            if simdiki in kok_dal:
                sonuc = kok_dal[simdiki]
                break
            if simdiki in gorulen or simdiki == kok:
                break
            gorulen.add(simdiki)
            yol.append(simdiki)
            ust = ebeveyn.get(simdiki)
            if ust is not None and ust == kok:
                sonuc = simdiki
                break
            simdiki = ust
        for x in yol:
            kok_dal[x] = sonuc
        return sonuc

    dugumler = []
    for r in satirlar:
        d_id = r[0]
        g = etkin.get(d_id, _SIR)
        sir = g == _SIR
        s = sayilar.get(d_id, [0, 0])
        dugumler.append(
            {
                "id": d_id,
                "baslik": r[1],
                "tur": r[2],
                "durum": r[3],
                "gizlilik": g,
                "ozet": _bos_degil(r[5]) if g == _NORMAL else None,
                "tarih": None if sir else r[6],
                "olusturma": r[7],
                "guncelleme": r[8],
                "olgu_aktif": None if sir else s[0],
                "olgu_eski": None if sir else s[1],
                "ebeveyn": ebeveyn.get(d_id),
                "derinlik": derinlik.get(d_id, 0),
                "kok_dal": None if d_id == kok else dal_bul(d_id),
            }
        )
    return {
        "imlec": imlec,
        "gelen_bekleyen": bekleyen,
        "kok": kok,
        "dugumler": dugumler,
        "kenarlar": kenarlar,
    }


# --------------------------------------------------------------------------
# dugum
# --------------------------------------------------------------------------


def dugum(con: sqlite3.Connection, dugum_id: str, ac: bool = False) -> dict | None:
    """Tek düğüm. None = düğüm yok. ozel gövde yalnız ac=True ile; sir hiç."""
    r = con.execute(
        "SELECT id, baslik, tur, durum, gizlilik, ozet, ayrinti, tarih, olusturma, guncelleme "
        "FROM dugum WHERE id = ?",
        (dugum_id,),
    ).fetchone()
    if r is None:
        return None
    etkin = _Etkin(con)
    g = etkin(r[0])
    acik = g == _NORMAL or (g == _OZEL and ac is True)

    yol = []
    for y_id in sorgu._yol_idleri(con, r[0]):
        b = con.execute("SELECT baslik FROM dugum WHERE id = ?", (y_id,)).fetchone()
        if b is not None:
            yol.append({"id": y_id, "baslik": b[0]})

    olgular: list[dict] = []
    if acik:
        for o in con.execute(
            "SELECT o.id, o.metin, o.durum, o.olusturma, o.gecerli_bas, o.gecerli_bit, "
            "o.yerine_gecen, o.guven, ka.tur FROM olgu o "
            "LEFT JOIN kaynak ka ON ka.id = o.kaynak_id "
            "WHERE o.dugum = ? AND o.durum IN ('aktif', 'eskidi') "
            "ORDER BY CASE o.durum WHEN 'aktif' THEN 0 ELSE 1 END, "
            "COALESCE(o.gecerli_bas, o.olusturma) DESC, o.olusturma DESC, o.id DESC",
            (r[0],),
        ):
            olgular.append(
                {
                    "id": o[0],
                    "metin": o[1],
                    "durum": o[2],
                    "olusturma": o[3],
                    "gecerli_bas": o[4],
                    "gecerli_bit": o[5],
                    "yerine_gecen": o[6],
                    "guven": o[7],
                    "kaynak_tur": o[8],
                }
            )

    cocuklar: list[dict] = []
    gorulen: set[str] = set()
    for c_id, c_baslik in con.execute(
        "SELECT d.id, d.baslik FROM kenar k JOIN dugum d ON d.id = k.cocuk "
        "WHERE k.ebeveyn = ? AND k.tur = 'alt' AND k.cocuk <> k.ebeveyn "
        "ORDER BY k.sira, d.baslik, d.id",
        (r[0],),
    ):
        if c_id in gorulen:
            continue
        gorulen.add(c_id)
        cocuklar.append({"id": c_id, "baslik": c_baslik, "gizlilik": etkin(c_id)})

    ilgili: list[dict] = []
    gorulen = {r[0]}
    for i_id, i_baslik, _sira in con.execute(
        "SELECT d.id, d.baslik, k.sira FROM kenar k JOIN dugum d ON d.id = k.cocuk "
        "WHERE k.ebeveyn = ? AND k.tur = 'ilgili' "
        "UNION ALL "
        "SELECT d.id, d.baslik, k.sira FROM kenar k JOIN dugum d ON d.id = k.ebeveyn "
        "WHERE k.cocuk = ? AND k.tur = 'ilgili' ORDER BY 3, 1",
        (r[0], r[0]),
    ):
        if i_id in gorulen:
            continue
        gorulen.add(i_id)
        ilgili.append({"id": i_id, "baslik": i_baslik, "gizlilik": etkin(i_id)})

    return {
        "id": r[0],
        "baslik": r[1],
        "tur": r[2],
        "durum": r[3],
        "gizlilik": g,
        "tarih": None if g == _SIR else r[7],
        "olusturma": r[8],
        "guncelleme": r[9],
        "yol": yol,
        "ozet": _bos_degil(r[5]) if acik else None,
        "ayrinti": _bos_degil(r[6]) if acik else None,
        "olgular": olgular,
        "cocuklar": cocuklar,
        "ilgili": ilgili,
        "kilitli": not acik,
    }


# --------------------------------------------------------------------------
# ara
# --------------------------------------------------------------------------


def ara(con: sqlite3.Connection, q: str, k: int = 20) -> dict:
    """`sorgu.ara` ile aynı FTS ve gizlilik semantiği; ozel/sir özeti null."""
    q = sorgu._tek_satir(q)
    if not q:
        return {"sonuclar": []}
    try:
        k = min(max(int(k), 1), _ARA_K_EN_COK)
    except (TypeError, ValueError):
        k = 20
    ham = db.fts_ara(con, q, k=k * 3) or []
    ham = sorted(ham, key=lambda x: -(x[1] if x[1] is not None else float("-inf")))

    etkin = _Etkin(con)
    sonuclar: list[dict] = []
    gorulen: set[str] = set()
    for d_id, _skor in ham:
        if len(sonuclar) >= k:
            break
        if d_id in gorulen:
            continue
        gorulen.add(d_id)
        r = con.execute("SELECT id, baslik, ozet FROM dugum WHERE id = ?", (d_id,)).fetchone()
        if r is None:
            continue
        g = etkin(r[0])
        if g == _SIR and not sorgu._sir_eslesir(q, r[1]):
            continue
        sonuclar.append(
            {
                "id": r[0],
                "baslik": r[1],
                "yol": sorgu.yol(con, r[0]),
                "ozet": _bos_degil(r[2]) if g == _NORMAL else None,
                "gizlilik": g,
            }
        )
    return {"sonuclar": sonuclar}


# --------------------------------------------------------------------------
# gelen
# --------------------------------------------------------------------------


def gelen_bekleyen(con: sqlite3.Connection) -> int:
    return int(
        con.execute("SELECT count(*) FROM gelen WHERE durum = 'bekliyor'").fetchone()[0]
    )


def _id_metni(deger: Any) -> str | None:
    if isinstance(deger, bool) or deger is None:
        return None
    if isinstance(deger, (str, int)):
        s = str(deger).strip()
        return s or None
    return None


def _ebeveyn_giz(con: sqlite3.Connection, etkin: _Etkin, ebeveyn: Any) -> str:
    """Önerilen ebeveynin gizliliği; çözülemezse çözülebilen en uzun yol öneki."""
    if ebeveyn is None:
        return _NORMAL
    adaylar: list[Any] = [ebeveyn]
    if isinstance(ebeveyn, str):
        parcalar = yaz._split_path(ebeveyn)
        adaylar += ["/".join(parcalar[:i]) for i in range(len(parcalar) - 1, 0, -1)]
    for aday in adaylar:
        try:
            p_id = yaz._resolve_parent(con, aday)
        except Exception:  # noqa: BLE001 — kapalı başarısızlık
            return _SIR
        if p_id is None:
            continue
        g = etkin(p_id)
        try:
            if yaz._under_private(con, p_id):
                g = sorgu._en_kisitli(g, _OZEL)
        except Exception:  # noqa: BLE001
            return _SIR
        return g
    return _NORMAL


def gelen(con: sqlite3.Connection, ac: str | None = None) -> dict:
    """Bekleyen öneriler. Ham `oneri_json` dönmez; ozel metni yalnız `ac` ile."""
    etkin = _Etkin(con)
    ogeler: list[dict] = []
    for gid, zaman, tur, oneri_json in con.execute(
        "SELECT id, zaman, tur, oneri_json FROM gelen WHERE durum = 'bekliyor' "
        "ORDER BY zaman, id"
    ):
        try:
            oneri = json.loads(oneri_json) if oneri_json else {}
        except (TypeError, ValueError):
            oneri = None
        if not isinstance(oneri, dict):
            oneri = None  # çözülemeyen öneri: kapalı başarısızlık

        if oneri is None:
            g = _SIR
            baslik = ebeveyn = hedef = metin = None
        else:
            g = sorgu._giz(oneri.get("gizlilik")) if "gizlilik" in oneri else _NORMAL
            baslik = _bos_degil(oneri.get("baslik")) if isinstance(oneri.get("baslik"), str) else None
            ebeveyn_ham = oneri.get("ebeveyn")
            ebeveyn = _id_metni(ebeveyn_ham)
            g = sorgu._en_kisitli(g, _ebeveyn_giz(con, etkin, ebeveyn))
            hedef = _id_metni(oneri.get("dugum_id")) or _id_metni(oneri.get("hedef_id"))
            if hedef is None:
                adaylar = oneri.get("adaylar")
                if isinstance(adaylar, list) and adaylar and isinstance(adaylar[0], dict):
                    hedef = _id_metni(adaylar[0].get("id"))
            if hedef is not None:
                if con.execute("SELECT 1 FROM dugum WHERE id = ?", (hedef,)).fetchone() is None:
                    hedef = None
                else:
                    g = sorgu._en_kisitli(g, etkin(hedef))
            m = oneri.get("metin")
            metin = _bos_degil(m) if isinstance(m, str) else None

        acik = g == _NORMAL or (g == _OZEL and ac is not None and ac == gid)
        sir = g == _SIR
        ogeler.append(
            {
                "id": gid,
                "zaman": zaman,
                "tur": tur,
                "baslik": baslik,
                "ebeveyn": None if sir else ebeveyn,
                "hedef_id": None if sir else hedef,
                "metin": metin if acik else None,
                "gizlilik": g,
                "kilitli": not acik,
            }
        )
    return {"gelen": ogeler}
