"""Beyin okuma işlemleri: yol, gez, ara, oku.

Her genel fonksiyon (yol hariç) bir dict döndürür. `metin` alanı modele giden
düz metindir: her satırda düğüm id'si köşeli parantez içinde görünür ve metin
hiçbir koşulda `butce` karakterini aşmaz. Sığmayan satırlar sondan atılır ve
yerine "… (+N daha, beyin_ara ile daralt)" satırı konur (o da bütçe içinde).

Gizlilik (dict ve metin için aynı):
- sir_icerir: yalnız başlık ve "[gizli içerik]"; özet, ayrıntı, olgu, ek yok.
  Aramada da gövde eşleşmesiyle bulunmaz (bkz. `_sir_eslesir`).
- ozel: gez ve ara'da yalnız başlık ve "[özel]"; oku() tam döner.
- Tanınmayan gizlilik değeri sir_icerir sayılır (kapalı başarısızlık).
- Gizlilik okuma anında kalıtılır: etkin değer = düğüm ve birincil ata
  zincirinin en kısıtlayıcısı (normal < ozel < sir_icerir). Tüm kurallar
  etkin değere göre uygulanır.

Genel fonksiyonlar istisna fırlatmaz; hata durumunda {hata, metin} döner
(yol() boş liste döner).
"""

from __future__ import annotations

import functools
import inspect
import re
from typing import Any

from . import db

__all__ = ["yol", "gez", "ara", "oku"]

OZEL_ISARET = "[özel]"
GIZLI_ISARET = "[gizli içerik]"

COCUK_OZET_SINIR = 100
ARA_OZET_SINIR = 100
BASLIK_SINIR = 120
YOL_PARCA_SINIR = 40
DUGUM_OZET_SINIR = 400
OLGU_METIN_SINIR = 300
EK_OZET_SINIR = 100
OLGU_SAYISI = 8
KAYNAK_REF_SINIR = 40
KAYNAKSIZ = "kaynaksız"
_YOL_DERINLIK = 64

_KUYRUK = "… (+{n} daha, beyin_ara ile daralt)"

_NORMAL, _OZEL, _SIR = "normal", "ozel", "sir_icerir"

# Satır türleri (_derle için)
_BASLIK = "baslik"  # bölüm başlığı: sonda tek kalırsa atılır, sayılmaz
_OGE = "oge"  # sayılan içerik satırı
_NOT = "not"  # sayılmayan ama atılmayan not satırı


# --------------------------------------------------------------------------
# Küçük yardımcılar
# --------------------------------------------------------------------------

_BOSLUK = re.compile(r"\s+")
_ALFABE = "0123456789abcçdefgğhıijklmnoöprsştuüvwxyz"
_SIRA = {c: i for i, c in enumerate(_ALFABE)}
_FTS_ISLEC = {"and", "or", "not", "near"}


def _tek_satir(s: Any) -> str:
    if s is None:
        return ""
    return _BOSLUK.sub(" ", str(s)).strip()


def _kisalt(s: Any, sinir: int) -> str:
    s = _tek_satir(s)
    if len(s) <= sinir:
        return s
    return s[: max(sinir - 1, 0)].rstrip() + "…"


def _tr_kucuk(s: str) -> str:
    return s.replace("I", "ı").replace("İ", "i").lower()


def _tr_anahtar(s: Any) -> tuple:
    return tuple(_SIRA.get(c, 1000 + ord(c)) for c in _tr_kucuk(_tek_satir(s)))


def _butce(butce: Any) -> int:
    try:
        return max(int(butce), 0)
    except (TypeError, ValueError):
        return 0


def _sinirla(metin: str, butce: int) -> str:
    if len(metin) <= butce:
        return metin
    if butce <= 0:
        return ""
    if butce == 1:
        return "…"
    return metin[: butce - 1].rstrip() + "…"


def _giz(deger: Any) -> str:
    """Gizlilik değerini normalleştirir; tanınmayan değer sır sayılır."""
    if deger is None or deger == "" or deger == _NORMAL:
        return _NORMAL
    if deger == _OZEL:
        return _OZEL
    return _SIR


_GIZ_SIRA = {_NORMAL: 0, _OZEL: 1, _SIR: 2}


def _en_kisitli(a: str, b: str) -> str:
    return a if _GIZ_SIRA[a] >= _GIZ_SIRA[b] else b


class _EtkinGizlilik:
    """Etkin gizlilik = düğüm ve birincil ata zincirinin en kısıtlayıcısı (O6).

    Çağrı başına bir örnek; ortak atalar önbellekten gelir, böylece ara'da
    her sonuç için zincir yalnız ilk görülen kısma kadar yürünür.
    """

    def __init__(self, con) -> None:
        self.con = con
        self.onbellek: dict[Any, str] = {}

    def __call__(self, id) -> str:
        if id in self.onbellek:
            return self.onbellek[id]
        zincir: list[tuple[Any, str]] = []
        gorulen: set = set()
        simdiki = id
        while (
            simdiki is not None
            and simdiki not in self.onbellek
            and simdiki not in gorulen
            and len(zincir) < _YOL_DERINLIK
        ):
            gorulen.add(simdiki)
            r = self.con.execute(
                "SELECT d.gizlilik, (SELECT k.ebeveyn FROM kenar k WHERE k.cocuk = d.id "
                "AND k.tur = 'alt' ORDER BY k.birincil DESC, k.sira LIMIT 1) "
                "FROM dugum d WHERE d.id = ?",
                (simdiki,),
            ).fetchone()
            if r is None:
                break
            zincir.append((simdiki, _giz(r[0])))
            simdiki = r[1]
        taban = self.onbellek.get(simdiki, _NORMAL)
        for d_id, g in reversed(zincir):
            taban = _en_kisitli(taban, g)
            self.onbellek[d_id] = taban
        return self.onbellek.get(id, _SIR)  # bulunamazsa kapalı başarısızlık


def _isaret(giz: str) -> str:
    return OZEL_ISARET if giz == _OZEL else GIZLI_ISARET


def _liste_ozeti(ozet: Any, giz: str, sinir: int) -> str | None:
    """gez/ara için özet: normal → kısaltılmış, ozel/sir → yalnız işaret."""
    if giz != _NORMAL:
        return _isaret(giz)
    s = _kisalt(ozet, sinir)
    return s or None


def _hata(mesaj: str, butce: int) -> dict:
    return {"hata": mesaj, "metin": _sinirla(f"Hata: {mesaj}", butce)}


def _guvenli(f):
    """Sözleşme: istisna fırlatma. Beklenmeyen hata → {hata, metin}."""
    imza = inspect.signature(f)

    @functools.wraps(f)
    def sar(*args, **kwargs):
        try:
            return f(*args, **kwargs)
        except Exception as e:  # noqa: BLE001 — bilinçli: sözleşme gereği
            try:
                butce = imza.bind_partial(*args, **kwargs).arguments.get(
                    "butce", imza.parameters["butce"].default
                )
            except Exception:  # noqa: BLE001
                butce = imza.parameters["butce"].default
            return _hata(f"{type(e).__name__}: {e}", _butce(butce))

    return sar


def _derle(bas: list[str], ogeler: list[tuple[str, str]], butce: int) -> str:
    """Zorunlu `bas` satırları + sondan kesilebilir `ogeler` → bütçeli metin."""
    tum = "\n".join(bas + [s for s, _ in ogeler])
    if len(tum) <= butce:
        return tum
    toplam = sum(1 for _, t in ogeler if t == _OGE)

    en_iyi: list[str] | None = None
    onek_uzunluk = len("\n".join(bas))
    sayilan = 0
    for k in range(len(ogeler) + 1):
        if k > 0:
            s, t = ogeler[k - 1]
            onek_uzunluk += len(s) + (1 if (bas or k > 1) else 0)
            if t == _OGE:
                sayilan += 1
            if onek_uzunluk > butce:
                break
        govde = ogeler[:k]
        while govde and govde[-1][1] == _BASLIK:
            govde = govde[:-1]
        kalan = toplam - sayilan
        aday = bas + [s for s, _ in govde]
        if kalan:
            aday = aday + [_KUYRUK.format(n=kalan)]
        if len("\n".join(aday)) <= butce:
            en_iyi = aday
    if en_iyi is not None:
        return "\n".join(en_iyi)

    # Zorunlu kısım bile sığmıyor: başı kes, mümkünse kuyruğu koru.
    bas_metin = "\n".join(bas)
    if toplam:
        kuyruk = _KUYRUK.format(n=toplam)
        yer = butce - len(kuyruk) - 1
        if yer >= 20:
            return _sinirla(_sinirla(bas_metin, yer) + "\n" + kuyruk, butce)
    return _sinirla(bas_metin, butce)


# --------------------------------------------------------------------------
# Veri erişimi
# --------------------------------------------------------------------------

# Sütun sırası: 0 id, 1 anahtar, 2 baslik, 3 ozet, 4 ayrinti, 5 tur,
# 6 durum, 7 gizlilik, 8 tarih
_DUGUM_SQL = (
    "SELECT id, anahtar, baslik, ozet, ayrinti, tur, durum, gizlilik, tarih "
    "FROM dugum WHERE id = ?"
)


def _dugum(con, id) -> tuple | None:
    if id is None:
        return None
    r = con.execute(_DUGUM_SQL, (id,)).fetchone()
    return tuple(r) if r is not None else None


def _yol_idleri(con, id) -> list:
    zincir = [id]
    gorulen = {id}
    simdiki = id
    for _ in range(_YOL_DERINLIK):
        r = con.execute(
            "SELECT ebeveyn FROM kenar WHERE cocuk = ? AND tur = 'alt' "
            "ORDER BY birincil DESC, sira LIMIT 1",
            (simdiki,),
        ).fetchone()
        if r is None or r[0] in gorulen:
            break
        simdiki = r[0]
        gorulen.add(simdiki)
        zincir.append(simdiki)
    zincir.reverse()
    return zincir


def _yol_metni(basliklar: list[str]) -> str:
    return " › ".join(_kisalt(b, YOL_PARCA_SINIR) for b in basliklar)


def _durum_eki(durum: Any) -> str | None:
    d = _tek_satir(durum)
    return d if d and d != "aktif" else None


# --------------------------------------------------------------------------
# Sözleşme fonksiyonları
# --------------------------------------------------------------------------


def yol(con, id) -> list[str]:
    """Kökten birincil ebeveyn zinciriyle başlıklar (kök dahil).

    Olmayan id ya da hata → [] (dönüş tipi liste olduğu için).
    """
    try:
        if _dugum(con, id) is None:
            return []
        sonuc = []
        for d_id in _yol_idleri(con, id):
            r = con.execute("SELECT baslik FROM dugum WHERE id = ?", (d_id,)).fetchone()
            if r is not None:
                sonuc.append(_tek_satir(r[0]))
        return sonuc
    except Exception:  # noqa: BLE001 — sözleşme: istisna fırlatma
        return []


@_guvenli
def gez(con, id=None, butce=1500) -> dict:
    """Bir düğümü ve doğrudan alt dallarını başlık + kısa özetle listeler."""
    butce = _butce(butce)
    if id is None:
        id = db.kok_id(con)
        if id is None:
            return _hata("kök düğüm bulunamadı", butce)
    r = _dugum(con, id)
    if r is None:
        return _hata(f"düğüm yok: {id}", butce)

    etkin = _EtkinGizlilik(con)
    giz = etkin(r[0])
    yol_l = yol(con, r[0])
    dugum = {
        "id": r[0],
        "baslik": r[2],
        "ozet": (r[3] if giz == _NORMAL else _isaret(giz)),
        "yol": yol_l,
    }

    satirlar = con.execute(
        "SELECT d.id, d.baslik, d.ozet, d.gizlilik, d.durum, k.birincil, k.sira, "
        "(SELECT COUNT(*) FROM kenar k2 WHERE k2.ebeveyn = d.id AND k2.tur = 'alt') "
        "FROM kenar k JOIN dugum d ON d.id = k.cocuk "
        "WHERE k.ebeveyn = ? AND k.tur = 'alt' AND k.cocuk != k.ebeveyn",
        (r[0],),
    ).fetchall()
    tekil: dict[Any, tuple] = {}
    for s in satirlar:
        s = tuple(s)
        onceki = tekil.get(s[0])
        if onceki is None or (s[5] and not onceki[5]):
            tekil[s[0]] = s
    sirali = sorted(
        tekil.values(),
        key=lambda s: (s[6] is None, s[6] if s[6] is not None else 0, _tr_anahtar(s[1])),
    )

    cocuklar = []
    ogeler: list[tuple[str, str]] = []
    for s in sirali:
        ek = not s[5]
        if ek:
            c_giz = etkin(s[0])  # kendi birincil zinciri bu düğüm değil
        else:
            c_giz = _en_kisitli(_giz(s[3]), giz)
            etkin.onbellek[s[0]] = c_giz
        c = {
            "id": s[0],
            "baslik": s[1],
            "ozet": _liste_ozeti(s[2], c_giz, COCUK_OZET_SINIR),
            "cocuk_sayisi": int(s[7] or 0),
            "gizlilik": c_giz,
            "ek": ek,
        }
        cocuklar.append(c)
        satir = f"- [{s[0]}] {_kisalt(s[1], BASLIK_SINIR)}"
        if c_giz != _NORMAL:
            satir += " " + _isaret(c_giz)
        elif c["ozet"]:
            satir += " — " + c["ozet"]
        ekler = []
        if c["cocuk_sayisi"]:
            ekler.append(f"{c['cocuk_sayisi']} alt")
        d_ek = _durum_eki(s[4])
        if d_ek:
            ekler.append(d_ek)
        if ekler:
            satir += " (" + ", ".join(ekler) + ")"
        if ek:
            satir += " (ek)"
        ogeler.append((satir, _OGE))

    bas = [f"# [{r[0]}] {_yol_metni(yol_l) or _kisalt(r[2], BASLIK_SINIR)}"]
    if giz == _NORMAL:
        oz = _kisalt(r[3], DUGUM_OZET_SINIR)
        if oz:
            bas.append(oz)
    elif giz == _OZEL:
        bas.append(f"{OZEL_ISARET} özet için beyin_oku")
    else:
        bas.append(GIZLI_ISARET)
    bas.append(f"Alt dallar ({len(cocuklar)}):" if cocuklar else "Alt dal yok.")

    return {"dugum": dugum, "cocuklar": cocuklar, "metin": _derle(bas, ogeler, butce)}


def _sir_eslesir(sorgu: str, baslik: Any) -> bool:
    """Sır düğümü yalnız sorgunun tüm terimleri başlıkta geçiyorsa listelenir.

    Aksi halde arama, gizli gövdenin içeriğini doğrulayan bir kâhine dönüşür
    (ör. "şifre 1234" araması sır düğümünü bulursa gövdede 1234 olduğu sızar).
    """
    terimler = [
        t for t in re.findall(r"\w+", _tr_kucuk(sorgu)) if t not in _FTS_ISLEC
    ]
    if not terimler:
        return False
    b = _tr_kucuk(_tek_satir(baslik))
    return all(t in b for t in terimler)


@_guvenli
def ara(con, sorgu, alt_agac=None, k=5, butce=1200) -> dict:
    """Tam metin arama; sonuçları başlık + kısa özet + yol ile listeler."""
    butce = _butce(butce)
    sorgu = _tek_satir(sorgu)
    if not sorgu:
        return _hata("boş sorgu", butce)
    try:
        k = max(int(k), 1)
    except (TypeError, ValueError):
        k = 5
    alt_r = None
    if alt_agac is not None:
        alt_r = _dugum(con, alt_agac)
        if alt_r is None:
            return _hata(f"alt ağaç düğümü yok: {alt_agac}", butce)

    ham = db.fts_ara(con, sorgu, k=k * 3, alt_agac=alt_agac) or []
    ham = sorted(ham, key=lambda x: -(x[1] if x[1] is not None else float("-inf")))

    etkin = _EtkinGizlilik(con)
    sonuclar = []
    gorulen = set()
    for d_id, _skor in ham:
        if len(sonuclar) >= k:
            break
        if d_id in gorulen:
            continue
        gorulen.add(d_id)
        r = _dugum(con, d_id)
        if r is None:
            continue
        giz = etkin(r[0])
        if giz == _SIR and not _sir_eslesir(sorgu, r[2]):
            continue
        sonuclar.append(
            {
                "id": r[0],
                "baslik": r[2],
                "yol": yol(con, r[0]),
                "ozet": _liste_ozeti(r[3], giz, ARA_OZET_SINIR),
                "_giz": giz,
            }
        )

    ogeler: list[tuple[str, str]] = []
    for s in sonuclar:
        giz = s.pop("_giz")
        satir = f"- [{s['id']}] {_kisalt(s['baslik'], BASLIK_SINIR)}"
        if giz != _NORMAL:
            satir += " " + _isaret(giz)
        elif s["ozet"]:
            satir += " — " + s["ozet"]
        ust = s["yol"][1:-1]
        if ust:
            satir += f" ({_yol_metni(ust)})"
        ogeler.append((satir, _OGE))

    q = _kisalt(sorgu, 80)
    kapsam = ""
    if alt_r is not None:
        kapsam = f" · alt ağaç [{alt_r[0]}] {_kisalt(alt_r[2], YOL_PARCA_SINIR)}"
    if sonuclar:
        bas = [f'Arama "{q}"{kapsam}: {len(sonuclar)} sonuç']
    else:
        bas = [f'Arama "{q}"{kapsam}: sonuç yok.']
    return {"sonuclar": sonuclar, "metin": _derle(bas, ogeler, butce)}


@_guvenli
def oku(con, id, butce=2500) -> dict:
    """Bir düğümün tamamı: ayrıntı, aktif olgular, ebeveynler, ilgililer, ekler."""
    butce = _butce(butce)
    r = _dugum(con, id)
    if r is None:
        return _hata(f"düğüm yok: {id}", butce)
    giz = _EtkinGizlilik(con)(r[0])
    sir = giz == _SIR
    yol_l = yol(con, r[0])

    dugum = {
        "id": r[0],
        "baslik": r[2],
        "ozet": GIZLI_ISARET if sir else r[3],
        "ayrinti": None if sir else r[4],
        "tur": r[5],
        "durum": r[6],
        "tarih": r[8],
        "yol": yol_l,
    }

    olgular: list[dict] = []
    olgu_toplam = 0
    if not sir:
        olgu_toplam = con.execute(
            "SELECT COUNT(*) FROM olgu WHERE dugum = ? AND durum = 'aktif'", (r[0],)
        ).fetchone()[0]
        # O4: kaynak her olguyla birlikte gösterilir; zehirli bir olgu
        # "kullanıcı hakkında doğru bilgi" gibi değil, nereden geldiğiyle sunulur.
        for o in con.execute(
            "SELECT o.id, o.metin, o.gecerli_bas, o.olusturma, ka.tur, ka.ref "
            "FROM olgu o LEFT JOIN kaynak ka ON ka.id = o.kaynak_id "
            "WHERE o.dugum = ? AND o.durum = 'aktif' "
            "ORDER BY COALESCE(o.gecerli_bas, o.olusturma) DESC, o.olusturma DESC, o.id DESC "
            "LIMIT ?",
            (r[0], OLGU_SAYISI),
        ).fetchall():
            # Ref çoğu zaman yol/oturum kimliği: ayırt edici kısım sonda.
            ref = _tek_satir(o[5])
            if len(ref) > KAYNAK_REF_SINIR:
                ref = "…" + ref[-(KAYNAK_REF_SINIR - 1):]
            ref = ref or None
            olgular.append(
                {
                    "id": o[0],
                    "metin": o[1],
                    "tarih": o[2] or o[3],
                    "kaynak_tur": o[4] or KAYNAKSIZ,
                    "kaynak_ref": ref,
                }
            )

    ebeveynler = [
        {"id": e[0], "baslik": e[1], "birincil": bool(e[2])}
        for e in con.execute(
            "SELECT d.id, d.baslik, k.birincil FROM kenar k "
            "JOIN dugum d ON d.id = k.ebeveyn "
            "WHERE k.cocuk = ? AND k.tur = 'alt' ORDER BY k.birincil DESC, k.sira",
            (r[0],),
        ).fetchall()
    ]

    ilgililer: list[dict] = []
    ilg_gorulen = {r[0]}
    for i in con.execute(
        "SELECT d.id, d.baslik, k.sira FROM kenar k JOIN dugum d ON d.id = k.cocuk "
        "WHERE k.ebeveyn = ? AND k.tur = 'ilgili' "
        "UNION ALL "
        "SELECT d.id, d.baslik, k.sira FROM kenar k JOIN dugum d ON d.id = k.ebeveyn "
        "WHERE k.cocuk = ? AND k.tur = 'ilgili'",
        (r[0], r[0]),
    ).fetchall():
        if i[0] in ilg_gorulen:
            continue
        ilg_gorulen.add(i[0])
        ilgililer.append({"id": i[0], "baslik": i[1]})

    ekler: list[dict] = []
    if not sir:
        ekler = [
            {"ad": e[0], "mime": e[1], "ozet": e[2]}
            for e in con.execute(
                "SELECT ad, mime, ozet FROM ek WHERE dugum = ? ORDER BY id", (r[0],)
            ).fetchall()
        ]

    alt_sayisi = con.execute(
        "SELECT COUNT(*) FROM kenar WHERE ebeveyn = ? AND tur = 'alt'", (r[0],)
    ).fetchone()[0]

    # --- metin ---
    bas = [f"# [{r[0]}] {_kisalt(r[2], BASLIK_SINIR)}"]
    meta = []
    if len(yol_l) > 1:
        meta.append("yol: " + _yol_metni(yol_l[:-1]))
    for ad, deger in (("tür", r[5]), ("durum", r[6]), ("tarih", r[8])):
        if _tek_satir(deger):
            meta.append(f"{ad}: {_kisalt(deger, 40)}")
    if alt_sayisi:
        meta.append(f"{alt_sayisi} alt")
    if giz == _OZEL:
        meta.append(OZEL_ISARET)
    if meta:
        bas.append(" · ".join(meta))
    if sir:
        bas.append(f"{GIZLI_ISARET} ayrıntı, olgu ve ekler gösterilmez.")
    else:
        oz = _kisalt(r[3], DUGUM_OZET_SINIR)
        if oz:
            bas.append("Özet: " + oz)

    geri: list[tuple[str, str]] = []
    if olgular:
        baslik = f"## Olgular ({len(olgular)}/{olgu_toplam} aktif)"
        geri.append((baslik, _BASLIK))
        for o in olgular:
            parca = []
            t = _tek_satir(o["tarih"])[:10]
            if t:
                parca.append(t)
            parca.append(o["kaynak_tur"])
            parca.append(_kisalt(o["metin"], OLGU_METIN_SINIR))
            geri.append(("- " + " · ".join(parca), _OGE))
    if ebeveynler:
        geri.append(("## Ebeveynler", _BASLIK))
        for e in ebeveynler:
            b = " (birincil)" if e["birincil"] else ""
            geri.append((f"- [{e['id']}] {_kisalt(e['baslik'], BASLIK_SINIR)}{b}", _OGE))
    if ilgililer:
        geri.append(("## İlgili", _BASLIK))
        for i in ilgililer:
            geri.append((f"- [{i['id']}] {_kisalt(i['baslik'], BASLIK_SINIR)}", _OGE))
    if ekler:
        geri.append(("## Ekler", _BASLIK))
        for e in ekler:
            s = f"- {_kisalt(e['ad'], 80)}"
            if _tek_satir(e["mime"]):
                s += f" ({_kisalt(e['mime'], 40)})"
            oz = _kisalt(e["ozet"], EK_OZET_SINIR)
            if oz:
                s += " — " + oz
            geri.append((s, _OGE))

    ayr: list[tuple[str, str]] = []
    if not sir and r[4] and str(r[4]).strip():
        satirlar = [s.rstrip() for s in str(r[4]).splitlines() if s.strip()]
        metin_ayr = "\n".join(satirlar)
        bas_uz = len("\n".join(bas))
        geri_uz = sum(len(s) + 1 for s, _ in geri)
        baslik_ayr = "## Ayrıntı"
        toplam_uz = bas_uz + 1 + len(baslik_ayr) + 1 + len(metin_ayr) + geri_uz
        if toplam_uz > butce:
            oda = butce - bas_uz - len(baslik_ayr) - 2
            tavan = max(oda - geri_uz, int(oda * 0.6))
            if len(metin_ayr) > tavan:
                isaret_tahmin = len(f"… (ayrıntının +{len(metin_ayr)} karakteri kesildi)")
                kes = max(tavan - isaret_tahmin - 1, 0)
                parca = metin_ayr[:kes]
                bosluk = max(parca.rfind(" "), parca.rfind("\n"))
                if bosluk >= int(kes * 0.8):
                    parca = parca[:bosluk]
                parca = parca.rstrip()
                kalan = len(metin_ayr) - len(parca)
                satirlar = (parca.split("\n") if parca else []) + [
                    f"… (ayrıntının +{kalan} karakteri kesildi)"
                ]
                ayr = [(baslik_ayr, _BASLIK)] + [(s, _OGE) for s in satirlar[:-1]]
                ayr.append((satirlar[-1], _NOT))
        if not ayr:
            ayr = [(baslik_ayr, _BASLIK)] + [(s, _OGE) for s in satirlar]

    return {
        "dugum": dugum,
        "olgular": olgular,
        "ebeveynler": ebeveynler,
        "ilgililer": ilgililer,
        "ekler": ekler,
        "metin": _derle(bas, ayr + geri, butce),
    }
