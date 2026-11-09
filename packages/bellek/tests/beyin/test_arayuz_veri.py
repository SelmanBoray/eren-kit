"""Arayüz veri projeksiyonları (arayuz.py, arayuz_zaman.py) — sözleşmeden yazılmış testler.

Sözleşme: şekil (§3), gizlilik (§1): ozel gövdesi toplu çıktılarda yok, sir_icerir gövdesi
ve olgu sayısı hiçbir yerde yok, gecmis/gelen ham JSON'u asla gönderilmez, gizlilik hedefin
BUGÜNKÜ etkin gizliliğine göre (düğüm + birincil ata zincirinin en kısıtlayıcısı).
"""
import json
import sqlite3

import pytest

from bellek.beyin import arayuz, arayuz_zaman, db, yaz

# Benzersiz işaretler: yalnız gövdelerde (özet/ayrıntı/olgu) geçer, başlıklarda asla.
SIR_OZ = "SIRGOVDEOZ_x9"
SIR_AY = "SIRGOVDEAY_x9"
SIR_OL = "SIRGOVDEOL_x9"
SIRC_OZ = "SIRCOCUKOZ_k7"
SIRC_AY = "SIRCOCUKAY_k7"
SIRC_OL = "SIRCOCUKOL_k7"
OZEL_OZ = "OZELGOVDEOZ_m3"
OZEL_AY = "OZELGOVDEAY_m3"
OZEL_OL = "OZELGOVDEOL_m3"
OZELC_OZ = "OZELCOCUKOZ_r4"
OZELC_OL = "OZELCOCUKOL_r4"
TASI_OZ = "TASINANOZ_p5"
TASI_OL = "TASINANOL_p5"
SIR_GELEN = "SIRGELENMETIN_z1"
OZEL_GELEN = "OZELGELENMETIN_w2"
NORMAL_GELEN = "NORMALGELENMETIN_v3"
NORMAL_OL = "NORMALOLGU_a1"

SIR_HEPSI = (SIR_OZ, SIR_AY, SIR_OL, SIRC_OZ, SIRC_AY, SIRC_OL)
OZEL_HEPSI = (OZEL_OZ, OZEL_AY, OZEL_OL, OZELC_OZ, OZELC_OL)

GRAF_DUGUM_ANAHTAR = {
    "id", "baslik", "tur", "durum", "gizlilik", "ozet", "tarih", "olusturma", "guncelleme",
    "olgu_aktif", "olgu_eski", "ebeveyn", "derinlik", "kok_dal",
}
GRAF_KENAR_ANAHTAR = {"ebeveyn", "cocuk", "tur", "birincil"}
DUGUM_ANAHTAR = {
    "id", "baslik", "tur", "durum", "gizlilik", "tarih", "olusturma", "guncelleme",
    "yol", "ozet", "ayrinti", "olgular", "cocuklar", "ilgili", "kilitli",
}
OLGU_ANAHTAR = {
    "id", "metin", "durum", "olusturma", "gecerli_bas", "gecerli_bit", "yerine_gecen",
    "guven", "kaynak_tur",
}
OLAY_ANAHTAR = {
    "id", "zaman", "islem", "tablo", "hedef_id", "dugum_id", "baslik", "gizlilik", "ozet",
}
GELEN_ANAHTAR = {
    "id", "zaman", "tur", "baslik", "ebeveyn", "hedef_id", "metin", "gizlilik", "kilitli",
}
ARA_ANAHTAR = {"id", "baslik", "yol", "ozet", "gizlilik"}
YASAK_ANAHTARLAR = {"eski_json", "yeni_json", "oneri_json"}


# ---------------------------------------------------------------- yardımcılar


def metin(veri) -> str:
    return json.dumps(veri, ensure_ascii=False, default=str)


def sizinti_yok(veri, isaretler, nerede=""):
    s = metin(veri)
    for i in isaretler:
        assert i not in s, f"{nerede}: {i!r} sızdı"


def tum_anahtarlar(veri) -> set:
    out: set = set()
    if isinstance(veri, dict):
        for k, v in veri.items():
            out.add(k)
            out |= tum_anahtarlar(v)
    elif isinstance(veri, (list, tuple)):
        for v in veri:
            out |= tum_anahtarlar(v)
    return out


def graf_dugumu(g, id):
    eslesen = [d for d in g["dugumler"] if d["id"] == id]
    assert len(eslesen) == 1, f"graf'ta {id} tek kez olmalı"
    return eslesen[0]


def tum_gecmis(con, limit=500):
    olaylar, sonra = [], 0
    for _ in range(10_000):
        r = arayuz_zaman.gecmis(con, sonra=sonra, limit=limit)
        olaylar.extend(r["olaylar"])
        if r["sonraki"] is None:
            return olaylar
        assert r["sonraki"] > sonra, "sonraki ilerlemeli"
        sonra = r["sonraki"]
    raise AssertionError("gecmis sayfalaması bitmedi")


def gecmis_idleri(con) -> list[int]:
    return [r[0] for r in con.execute("SELECT id FROM gecmis ORDER BY id")]


# ---------------------------------------------------------------- dünya


@pytest.fixture
def w(tmp_path):
    con = db.baglan(tmp_path / "b.db")
    kok = db.kok_id(con)
    with con:
        okul = db.dugum_ekle(con, "Okul", ozet="okul işleri", ebeveyn=kok, tur="dal")
        dersler = db.dugum_ekle(con, "Dersler", ozet="ders özeti", ayrinti="ders ayrıntısı",
                                ebeveyn=okul)
        o_aktif = db.olgu_ekle(con, dersler, NORMAL_OL)
        o_eski = db.olgu_ekle(con, dersler, "eskiyecek olgu")
        projeler = db.dugum_ekle(con, "Projeler", ozet="projeler", ebeveyn=kok, tur="dal")
        proje = db.dugum_ekle(con, "ProjeA", ozet="proje a", ebeveyn=projeler, tur="proje")
        # ikincil (birincil olmayan) alt kenar ve ilgili kenar
        db.kenar_ekle(con, projeler, dersler, "alt", birincil=False)
        db.kenar_ekle(con, dersler, proje, "ilgili")

        gizli = db.dugum_ekle(con, "Gizli", ozet="gizli dal", ebeveyn=kok, tur="dal")
        sir = db.dugum_ekle(con, "SirD", ozet=SIR_OZ, ayrinti=SIR_AY, ebeveyn=gizli,
                            gizlilik="sir_icerir")
        db.olgu_ekle(con, sir, SIR_OL)
        sir_cocuk = db.dugum_ekle(con, "SirCocuk", ozet=SIRC_OZ, ayrinti=SIRC_AY,
                                  ebeveyn=sir, gizlilik="normal")
        db.olgu_ekle(con, sir_cocuk, SIRC_OL)

        ozel = db.dugum_ekle(con, "OzelD", ozet=OZEL_OZ, ayrinti=OZEL_AY, ebeveyn=okul,
                             gizlilik="ozel")
        db.olgu_ekle(con, ozel, OZEL_OL)
        ozel_cocuk = db.dugum_ekle(con, "OzelCocuk", ozet=OZELC_OZ, ebeveyn=ozel,
                                   gizlilik="normal")
        db.olgu_ekle(con, ozel_cocuk, OZELC_OL)

        g_normal = db.gelen_ekle(con, "yeni_dugum", {
            "metin": NORMAL_GELEN, "baslik": "NormalOneri", "ebeveyn": projeler,
            "adaylar": []})
        g_ozel = db.gelen_ekle(con, "yeni_dugum", {
            "metin": OZEL_GELEN, "baslik": "OzelOneri", "ebeveyn": ozel,
            "gizlilik": "ozel", "adaylar": []})
        g_sir = db.gelen_ekle(con, "yeni_dugum", {
            "metin": SIR_GELEN, "baslik": "SirOneri", "ebeveyn": sir,
            "gizlilik": "sir_icerir", "adaylar": []})
        g_red = db.gelen_ekle(con, "olgu", {
            "metin": "reddedilecek öneri", "baslik": None, "ebeveyn": None, "adaylar": []})
    with con:
        db.olgu_eskit(con, o_eski)
    r = yaz.gelen_karar(con, g_red, "red")
    assert r["sonuc"] == "reddedildi"
    yield {
        "con": con, "kok": kok, "okul": okul, "dersler": dersler, "projeler": projeler,
        "proje": proje, "gizli": gizli, "sir": sir, "sir_cocuk": sir_cocuk,
        "ozel": ozel, "ozel_cocuk": ozel_cocuk, "o_aktif": o_aktif, "o_eski": o_eski,
        "g_normal": g_normal, "g_ozel": g_ozel, "g_sir": g_sir, "g_red": g_red,
    }
    con.close()


# ================================================================ imlec


def test_imlec_max_gecmis_id(w):
    con = w["con"]
    beklenen = con.execute("SELECT coalesce(max(id),0) FROM gecmis").fetchone()[0]
    assert beklenen > 0
    assert arayuz_zaman.imlec(con) == beklenen


def test_imlec_bos_veritabaninda_sifir(tmp_path):
    con = db.baglan(tmp_path / "bos.db")
    try:
        assert arayuz_zaman.imlec(con) == 0
    finally:
        con.close()


# ================================================================ graf


def test_graf_ust_anahtarlar(w):
    con = w["con"]
    g = arayuz.graf(con)
    assert {"imlec", "gelen_bekleyen", "kok", "dugumler", "kenarlar"} <= set(g)
    assert g["kok"] == w["kok"]
    assert g["imlec"] == arayuz_zaman.imlec(con)
    assert g["gelen_bekleyen"] == 3  # normal, ozel, sir; reddedilen sayılmaz


def test_graf_tum_dugumler_ve_anahtarlar(w):
    con = w["con"]
    g = arayuz.graf(con)
    db_idleri = {r[0] for r in con.execute("SELECT id FROM dugum")}
    assert {d["id"] for d in g["dugumler"]} == db_idleri
    assert len(g["dugumler"]) == len(db_idleri)
    for d in g["dugumler"]:
        assert GRAF_DUGUM_ANAHTAR <= set(d), d["id"]
        assert d["gizlilik"] in ("normal", "ozel", "sir_icerir")
        assert isinstance(d["derinlik"], int)


def test_graf_derinlik_kok_dal_ebeveyn(w):
    g = arayuz.graf(w["con"])
    kok = graf_dugumu(g, w["kok"])
    assert kok["derinlik"] == 0 and kok["kok_dal"] is None and kok["ebeveyn"] is None
    okul = graf_dugumu(g, w["okul"])
    assert (okul["derinlik"], okul["kok_dal"], okul["ebeveyn"]) == (1, w["okul"], w["kok"])
    # Dersler'in iki alt ebeveyni var; birincil olan Okul
    ders = graf_dugumu(g, w["dersler"])
    assert (ders["derinlik"], ders["kok_dal"], ders["ebeveyn"]) == (2, w["okul"], w["okul"])
    proje = graf_dugumu(g, w["proje"])
    assert (proje["derinlik"], proje["kok_dal"], proje["ebeveyn"]) == (2, w["projeler"], w["projeler"])
    sc = graf_dugumu(g, w["sir_cocuk"])
    assert (sc["derinlik"], sc["kok_dal"], sc["ebeveyn"]) == (3, w["gizli"], w["sir"])
    oc = graf_dugumu(g, w["ozel_cocuk"])
    assert (oc["derinlik"], oc["kok_dal"], oc["ebeveyn"]) == (3, w["okul"], w["ozel"])


def test_graf_kenarlar(w):
    con = w["con"]
    g = arayuz.graf(con)
    for k in g["kenarlar"]:
        assert GRAF_KENAR_ANAHTAR <= set(k)
        assert k["tur"] in ("alt", "ilgili")
        assert isinstance(k["birincil"], bool)
    beklenen = {
        (r["ebeveyn"], r["cocuk"], r["tur"], bool(r["birincil"]))
        for r in con.execute("SELECT ebeveyn, cocuk, tur, birincil FROM kenar")
    }
    gelen = {(k["ebeveyn"], k["cocuk"], k["tur"], k["birincil"]) for k in g["kenarlar"]}
    assert gelen == beklenen
    assert (w["okul"], w["dersler"], "alt", True) in gelen
    assert (w["projeler"], w["dersler"], "alt", False) in gelen
    assert (w["dersler"], w["proje"], "ilgili", False) in gelen


def test_graf_normal_ozet_ve_olgu_sayilari(w):
    g = arayuz.graf(w["con"])
    d = graf_dugumu(g, w["dersler"])
    assert d["gizlilik"] == "normal"
    assert d["ozet"] == "ders özeti"
    assert d["olgu_aktif"] == 1 and d["olgu_eski"] == 1


def test_graf_sir_ve_kalitim(w):
    g = arayuz.graf(w["con"])
    sizinti_yok(g, SIR_HEPSI, "graf")
    for id in (w["sir"], w["sir_cocuk"]):
        d = graf_dugumu(g, id)
        # sir_cocuk kendi işaretiyle normal; etkin gizlilik atadan sir_icerir
        assert d["gizlilik"] == "sir_icerir", id
        assert d["ozet"] is None
        assert d["olgu_aktif"] is None and d["olgu_eski"] is None
    assert graf_dugumu(g, w["sir"])["baslik"] == "SirD"


def test_graf_ozel_govde_yok(w):
    g = arayuz.graf(w["con"])
    sizinti_yok(g, OZEL_HEPSI, "graf")
    for id in (w["ozel"], w["ozel_cocuk"]):
        d = graf_dugumu(g, id)
        assert d["gizlilik"] == "ozel", id
        assert d["ozet"] is None
    assert graf_dugumu(g, w["ozel"])["baslik"] == "OzelD"


def test_graf_gelen_metni_yok(w):
    sizinti_yok(arayuz.graf(w["con"]), (SIR_GELEN, OZEL_GELEN), "graf")


# ================================================================ dugum


def test_dugum_yok_none(w):
    assert arayuz.dugum(w["con"], "YOKBOYLEBIRID0000000000000") is None
    assert arayuz.dugum(w["con"], "YOKBOYLEBIRID0000000000000", ac=True) is None


def test_dugum_normal_sekil(w):
    d = arayuz.dugum(w["con"], w["dersler"])
    assert DUGUM_ANAHTAR <= set(d)
    assert d["id"] == w["dersler"] and d["baslik"] == "Dersler"
    assert d["gizlilik"] == "normal" and d["kilitli"] is False
    assert d["ozet"] == "ders özeti" and d["ayrinti"] == "ders ayrıntısı"
    assert d["yol"] == [
        {"id": w["kok"], "baslik": "Kullanıcı"},
        {"id": w["okul"], "baslik": "Okul"},
        {"id": w["dersler"], "baslik": "Dersler"},
    ]
    for o in d["olgular"]:
        assert OLGU_ANAHTAR <= set(o)
        assert o["durum"] in ("aktif", "eskidi")
    for c in d["cocuklar"] + d["ilgili"]:
        assert {"id", "baslik", "gizlilik"} <= set(c)
    assert w["proje"] in {c["id"] for c in d["ilgili"]}


def test_dugum_eskimis_olgu_listelenir(w):
    d = arayuz.dugum(w["con"], w["dersler"])
    durum = {o["id"]: o for o in d["olgular"]}
    assert durum[w["o_aktif"]]["durum"] == "aktif"
    assert durum[w["o_aktif"]]["metin"] == NORMAL_OL
    assert durum[w["o_eski"]]["durum"] == "eskidi"
    assert durum[w["o_eski"]]["gecerli_bit"] is not None


def test_dugum_cocuklar(w):
    d = arayuz.dugum(w["con"], w["gizli"], ac=True)
    assert [c["id"] for c in d["cocuklar"]] == [w["sir"]]
    sizinti_yok(d, SIR_HEPSI, "dugum(gizli)")


@pytest.mark.parametrize("ac", [False, True])
@pytest.mark.parametrize("anahtar", ["sir", "sir_cocuk"])
def test_dugum_sir_hep_kilitli(w, anahtar, ac):
    d = arayuz.dugum(w["con"], w[anahtar], ac=ac)
    assert d is not None
    sizinti_yok(d, SIR_HEPSI, f"dugum({anahtar}, ac={ac})")
    assert d["kilitli"] is True
    assert d["ozet"] is None and d["ayrinti"] is None
    assert d["olgular"] == []
    assert d["gizlilik"] == "sir_icerir"


@pytest.mark.parametrize("anahtar,isaretler", [
    ("ozel", (OZEL_OZ, OZEL_AY, OZEL_OL)),
    ("ozel_cocuk", (OZELC_OZ, OZELC_OL)),
])
def test_dugum_ozel_kilitli_sonra_acik(w, anahtar, isaretler):
    con = w["con"]
    kapali = arayuz.dugum(con, w[anahtar])
    assert kapali["kilitli"] is True
    assert kapali["ozet"] is None and kapali["ayrinti"] is None and kapali["olgular"] == []
    sizinti_yok(kapali, OZEL_HEPSI, f"dugum({anahtar})")
    assert kapali["gizlilik"] == "ozel"

    acik = arayuz.dugum(con, w[anahtar], ac=True)
    assert acik["kilitli"] is False
    s = metin(acik)
    for i in isaretler:
        assert i in s
    assert isaretler[-1] in {o["metin"] for o in acik["olgular"]}
    sizinti_yok(acik, SIR_HEPSI, f"dugum({anahtar}, ac)")


# ================================================================ ara


def test_ara_normal_bulunur(w):
    r = arayuz.ara(w["con"], "Dersler")
    assert set(r) >= {"sonuclar"}
    bulunan = {s["id"]: s for s in r["sonuclar"]}
    assert w["dersler"] in bulunan
    s = bulunan[w["dersler"]]
    assert ARA_ANAHTAR <= set(s)
    assert s["yol"] == ["Kullanıcı", "Okul", "Dersler"]
    assert s["ozet"] == "ders özeti" and s["gizlilik"] == "normal"


def test_ara_olgu_metniyle_bulunur(w):
    r = arayuz.ara(w["con"], "normalolgu")
    assert w["dersler"] in {s["id"] for s in r["sonuclar"]}


@pytest.mark.parametrize("sorgu,anahtar", [
    ("SIRGOVDEOZ", "sir"), ("SIRGOVDEOL", "sir"),
    ("SIRCOCUKOZ", "sir_cocuk"), ("SIRCOCUKOL", "sir_cocuk"), ("SIRCOCUKAY", "sir_cocuk"),
])
def test_ara_sir_govde_kelimesi_bulmaz(w, sorgu, anahtar):
    r = arayuz.ara(w["con"], sorgu)
    assert w[anahtar] not in {s["id"] for s in r["sonuclar"]}
    sizinti_yok(r, SIR_HEPSI, f"ara({sorgu})")


def test_ara_sir_baslikla_govdesiz(w):
    r = arayuz.ara(w["con"], "SirD")
    for s in r["sonuclar"]:
        if s["id"] == w["sir"]:
            assert s["ozet"] is None and s["gizlilik"] == "sir_icerir"
    sizinti_yok(r, SIR_HEPSI, "ara(SirD)")


@pytest.mark.parametrize("sorgu", ["OzelD", "OZELGOVDEOZ", "OzelCocuk", "OZELCOCUKOL"])
def test_ara_ozel_ozet_null(w, sorgu):
    r = arayuz.ara(w["con"], sorgu)
    sizinti_yok(r, OZEL_HEPSI, f"ara({sorgu})")
    for s in r["sonuclar"]:
        if s["id"] in (w["ozel"], w["ozel_cocuk"]):
            assert s["ozet"] is None and s["gizlilik"] == "ozel"


@pytest.mark.parametrize("q", ["", "   "])
def test_ara_bos_sorgu(w, q):
    assert arayuz.ara(w["con"], q)["sonuclar"] == []


def test_ara_k_sinirlar(w):
    r = arayuz.ara(w["con"], "Dersler Projeler ProjeA Okul Gizli", k=1)
    assert len(r["sonuclar"]) <= 1


# ================================================================ gelen


def test_gelen_sekil_ve_yalniz_bekleyen(w):
    con = w["con"]
    r = arayuz.gelen(con)
    ogeler = {g["id"]: g for g in r["gelen"]}
    assert set(ogeler) == {w["g_normal"], w["g_ozel"], w["g_sir"]}
    for g in r["gelen"]:
        assert GELEN_ANAHTAR <= set(g)
        assert g["tur"] in ("yeni_dugum", "olgu", "celiski", "tasima")
        assert isinstance(g["kilitli"], bool)
    assert not (YASAK_ANAHTARLAR & tum_anahtarlar(r))
    n = ogeler[w["g_normal"]]
    assert n["metin"] == NORMAL_GELEN and n["kilitli"] is False
    assert n["baslik"] == "NormalOneri"


def test_gelen_bekleyen_sayisi(w):
    con = w["con"]
    assert arayuz.gelen_bekleyen(con) == 3
    yaz.gelen_karar(con, w["g_normal"], "red")
    assert arayuz.gelen_bekleyen(con) == 2
    assert arayuz.graf(con)["gelen_bekleyen"] == 2


def test_gelen_ozel_kilitli_ac_ile_acilir(w):
    con = w["con"]
    r = arayuz.gelen(con)
    oz = {g["id"]: g for g in r["gelen"]}[w["g_ozel"]]
    assert oz["metin"] is None and oz["kilitli"] is True and oz["gizlilik"] == "ozel"
    sizinti_yok(r, (OZEL_GELEN,) + OZEL_HEPSI + SIR_HEPSI + (SIR_GELEN,), "gelen()")

    r2 = arayuz.gelen(con, ac=w["g_ozel"])
    oz2 = {g["id"]: g for g in r2["gelen"]}[w["g_ozel"]]
    assert oz2["metin"] == OZEL_GELEN and oz2["kilitli"] is False
    sizinti_yok(r2, (SIR_GELEN,) + SIR_HEPSI, "gelen(ac=ozel)")
    assert not (YASAK_ANAHTARLAR & tum_anahtarlar(r2))


@pytest.mark.parametrize("ac_anahtar", [None, "g_sir"])
def test_gelen_sir_hep_kilitli(w, ac_anahtar):
    con = w["con"]
    r = arayuz.gelen(con, ac=w[ac_anahtar] if ac_anahtar else None)
    s = {g["id"]: g for g in r["gelen"]}[w["g_sir"]]
    assert s["kilitli"] is True and s["metin"] is None
    assert s["gizlilik"] == "sir_icerir"
    sizinti_yok(r, (SIR_GELEN,) + SIR_HEPSI, f"gelen(ac={ac_anahtar})")


# ================================================================ gecmis


def test_gecmis_sekil_ve_tum_olaylar(w):
    con = w["con"]
    r = arayuz_zaman.gecmis(con)
    assert set(r) >= {"olaylar", "sonraki"}
    idler = [o["id"] for o in r["olaylar"]]
    assert idler == gecmis_idleri(con)  # 500'den az olay: tek sayfa
    assert r["sonraki"] is None
    for o in r["olaylar"]:
        assert OLAY_ANAHTAR <= set(o)
        assert o["ozet"] is None or (isinstance(o["ozet"], str) and len(o["ozet"]) <= 160)
    assert not (YASAK_ANAHTARLAR & tum_anahtarlar(r))


def test_gecmis_dugum_id_eslemesi(w):
    con = w["con"]
    olgu_dugum = {r[0]: r[1] for r in con.execute("SELECT id, dugum FROM olgu")}
    gorulen = set()
    for o in arayuz_zaman.gecmis(con)["olaylar"]:
        t = o["tablo"]
        gorulen.add(t)
        if t == "dugum":
            assert o["dugum_id"] == o["hedef_id"]
        elif t == "olgu":
            assert o["dugum_id"] == olgu_dugum[o["hedef_id"]]
        elif t == "kenar":
            assert o["dugum_id"] == o["hedef_id"]  # db kenar olayında hedef_id = cocuk
        elif t in ("gelen", "kaynak"):
            assert o["dugum_id"] is None
    assert {"dugum", "olgu", "kenar", "gelen"} <= gorulen


def test_gecmis_gizlilik_ve_ozet(w):
    con = w["con"]
    olaylar = arayuz_zaman.gecmis(con)["olaylar"]
    sizinti_yok(olaylar, SIR_HEPSI + OZEL_HEPSI + (SIR_GELEN, OZEL_GELEN), "gecmis")
    for o in olaylar:
        if o["dugum_id"] in (w["sir"], w["sir_cocuk"]):
            assert o["gizlilik"] == "sir_icerir" and o["ozet"] is None
        if o["dugum_id"] in (w["ozel"], w["ozel_cocuk"]):
            assert o["gizlilik"] == "ozel" and o["ozet"] is None
    normal_olgu = [o for o in olaylar if o["tablo"] == "olgu" and o["hedef_id"] == w["o_aktif"]
                   and o["islem"] == "ekle"]
    assert len(normal_olgu) == 1
    assert normal_olgu[0]["gizlilik"] == "normal"


def test_gecmis_ozet_160_sinir(w):
    con = w["con"]
    with con:
        uzun = db.olgu_ekle(con, w["dersler"], "u" * 300)
    for o in arayuz_zaman.gecmis(con)["olaylar"]:
        if o["hedef_id"] == uzun:
            assert o["ozet"] is None or len(o["ozet"]) <= 160


def test_gecmis_tasinan_dugum_bugunku_gizlilik(w):
    con = w["con"]
    with con:
        n = db.dugum_ekle(con, "Tasinan", ozet=TASI_OZ, ebeveyn=w["okul"])
        db.olgu_ekle(con, n, TASI_OL)
    with con:  # birincil ebeveyni sir dala taşı
        db.kenar_ekle(con, w["sir"], n, "alt", birincil=True)
    olaylar = tum_gecmis(con)
    sizinti_yok(olaylar, (TASI_OZ, TASI_OL), "gecmis(taşınan)")
    for o in olaylar:
        if o["dugum_id"] == n:
            assert o["gizlilik"] == "sir_icerir" and o["ozet"] is None
    g = arayuz.graf(con)
    sizinti_yok(g, (TASI_OZ, TASI_OL), "graf(taşınan)")
    d = graf_dugumu(g, n)
    assert d["ebeveyn"] == w["sir"] and d["kok_dal"] == w["gizli"]
    assert d["olgu_aktif"] is None


@pytest.mark.parametrize("limit", [1, 3, 7])
def test_gecmis_sayfalama_zinciri(w, limit):
    con = w["con"]
    olaylar, sonra, sayfalar = [], 0, 0
    while True:
        r = arayuz_zaman.gecmis(con, sonra=sonra, limit=limit)
        assert len(r["olaylar"]) <= limit
        olaylar.extend(r["olaylar"])
        sayfalar += 1
        assert sayfalar < 10_000
        if r["sonraki"] is None:
            break
        assert r["olaylar"], "sonraki doluyken sayfa boş olmamalı"
        assert r["sonraki"] == r["olaylar"][-1]["id"]
        sonra = r["sonraki"]
    idler = [o["id"] for o in olaylar]
    assert idler == gecmis_idleri(con)
    assert len(idler) == len(set(idler))
    assert all(a < b for a, b in zip(idler, idler[1:]))


def test_gecmis_sonra_filtreler(w):
    con = w["con"]
    tum = gecmis_idleri(con)
    orta = tum[len(tum) // 2]
    r = arayuz_zaman.gecmis(con, sonra=orta)
    assert [o["id"] for o in r["olaylar"]] == [i for i in tum if i > orta]


def test_gecmis_limit_kirpilir(tmp_path):
    con = db.baglan(tmp_path / "cok.db")
    try:
        with con:
            for i in range(1100):
                db.kaynak_ekle(con, "elle", f"ref{i}")
        assert len(arayuz_zaman.gecmis(con, limit=0)["olaylar"]) == 1
        assert len(arayuz_zaman.gecmis(con, limit=-5)["olaylar"]) == 1
        r = arayuz_zaman.gecmis(con, limit=5000)
        assert len(r["olaylar"]) == 1000
        assert r["sonraki"] is not None
        assert len(tum_gecmis(con, limit=1000)) == 1100
    finally:
        con.close()


# ================================================================ degisim


def test_degisim_bosta(w):
    con = w["con"]
    i = arayuz_zaman.imlec(con)
    r = arayuz_zaman.degisim(con, i)
    assert {"imlec", "olaylar", "yeniden_yukle", "gelen_bekleyen"} <= set(r)
    assert r["olaylar"] == [] and r["imlec"] == i
    assert r["yeniden_yukle"] is False
    assert r["gelen_bekleyen"] == 3


def test_degisim_yazma_sonrasi(w):
    con = w["con"]
    i = arayuz_zaman.imlec(con)
    s = yaz.yaz(con, "degisim testi yeni olgu", dugum_id=w["dersler"],
                kaynak={"tur": "oturum", "ref": "pytest"})
    assert s["sonuc"] == "olgu_eklendi", s
    r = arayuz_zaman.degisim(con, i)
    assert r["imlec"] > i and r["imlec"] == arayuz_zaman.imlec(con)
    assert r["olaylar"] and all(o["id"] > i for o in r["olaylar"])
    assert r["yeniden_yukle"] is False
    for o in r["olaylar"]:
        assert OLAY_ANAHTAR <= set(o)
    assert any(o["tablo"] == "olgu" and o["dugum_id"] == w["dersler"] for o in r["olaylar"])
    assert not (YASAK_ANAHTARLAR & tum_anahtarlar(r))
    # imleçten devam: yeni olay yok
    r2 = arayuz_zaman.degisim(con, r["imlec"])
    assert r2["olaylar"] == [] and r2["imlec"] == r["imlec"]


def test_degisim_gizlilik(w):
    con = w["con"]
    i = arayuz_zaman.imlec(con)
    yeni_sir, yeni_ozel = "SIRYENI_d8", "OZELYENI_d8"
    with con:
        db.olgu_ekle(con, w["sir_cocuk"], yeni_sir)
        db.olgu_ekle(con, w["ozel_cocuk"], yeni_ozel)
        db.dugum_guncelle(con, w["sir"], ayrinti=SIR_AY + " guncel")
    r = arayuz_zaman.degisim(con, i)
    assert len(r["olaylar"]) >= 3
    sizinti_yok(r, (yeni_sir, yeni_ozel) + SIR_HEPSI + OZEL_HEPSI, "degisim")
    assert not (YASAK_ANAHTARLAR & tum_anahtarlar(r))


def test_degisim_200_ustu_yeniden_yukle(w):
    con = w["con"]
    i = arayuz_zaman.imlec(con)
    with con:
        for n in range(250):
            db.kaynak_ekle(con, "elle", f"r{n}")
    r = arayuz_zaman.degisim(con, i)
    assert r["yeniden_yukle"] is True
    assert len(r["olaylar"]) <= 200


def test_degisim_tam_200_yeniden_yukle_yok(w):
    con = w["con"]
    i = arayuz_zaman.imlec(con)
    with con:
        for n in range(200):
            db.kaynak_ekle(con, "elle", f"r{n}")
    r = arayuz_zaman.degisim(con, i)
    assert r["yeniden_yukle"] is False
    assert len(r["olaylar"]) == 200
    assert r["imlec"] == arayuz_zaman.imlec(con)


# ================================================================ kapalı başarısızlık


def test_bilinmeyen_gizlilik_sir_sayilir(w):
    con = w["con"]
    isaret_oz, isaret_ol = "BILINMEYENOZ_q2", "BILINMEYENOL_q2"
    with con:
        x = db.dugum_ekle(con, "Garip", ozet=isaret_oz, ebeveyn=w["okul"])
        db.olgu_ekle(con, x, isaret_ol)
    # Şemada CHECK var; SQLite'ın ignore_check_constraints pragması ile zorla yazmayı dene.
    # Zorla yazılamazsa (pragma desteklenmiyor / CHECK yine de engelliyor) test atlanır:
    # o durumda veritabanı bilinmeyen değeri zaten taşıyamaz.
    try:
        con.execute("PRAGMA ignore_check_constraints = ON")
        with con:
            con.execute("UPDATE dugum SET gizlilik = 'garip_deger' WHERE id = ?", (x,))
    except sqlite3.IntegrityError:
        pytest.skip("CHECK kısıtı tanınmayan gizlilik değerini zorla yazmaya izin vermiyor")
    finally:
        con.execute("PRAGMA ignore_check_constraints = OFF")
    gercek = con.execute("SELECT gizlilik FROM dugum WHERE id = ?", (x,)).fetchone()[0]
    if gercek != "garip_deger":
        pytest.skip("tanınmayan gizlilik değeri veritabanına yazılamadı")

    isaretler = (isaret_oz, isaret_ol)
    g = arayuz.graf(con)
    sizinti_yok(g, isaretler, "graf(bilinmeyen)")
    d = graf_dugumu(g, x)
    assert d["gizlilik"] == "sir_icerir"
    assert d["ozet"] is None and d["olgu_aktif"] is None and d["olgu_eski"] is None

    acik = arayuz.dugum(con, x, ac=True)
    sizinti_yok(acik, isaretler, "dugum(bilinmeyen, ac)")
    assert acik["kilitli"] is True and acik["olgular"] == []

    # FTS satırı eski (normal) haliyle duruyor; ara etkin gizlilikle süzmeli
    r = arayuz.ara(con, "BILINMEYENOL")
    assert x not in {s["id"] for s in r["sonuclar"]}
    sizinti_yok(r, isaretler, "ara(bilinmeyen)")

    sizinti_yok(tum_gecmis(con), isaretler, "gecmis(bilinmeyen)")


# ================================================================ derin zincir (regresyon)

DERIN_ISARET = "DERIN_OZEL_OLGU_h6"
DERIN_SEVIYE = 70  # sorgu._YOL_DERINLIK (64) aşılır: zincir sonu bulunamaz → sir (kapalı başarısızlık)


def _derin_zincir(con, kok):
    """`ozel` dal altında 70 seviyelik birincil `alt` zinciri; en alttakine işaretli olgu."""
    with con:
        dal = db.dugum_ekle(con, "DerinOzelDal", ebeveyn=kok, gizlilik="ozel", tur="dal")
        ust = dal
        for n in range(DERIN_SEVIYE):
            ust = db.dugum_ekle(con, f"Derin{n}", ebeveyn=ust)
    alt = ust
    i = arayuz_zaman.imlec(con)
    with con:
        olgu = db.olgu_ekle(con, alt, DERIN_ISARET)
    return alt, olgu, i


def _derin_olay_dogrula(cikti, olgu, nerede):
    sizinti_yok(cikti, (DERIN_ISARET,), nerede)
    olaylar = [o for o in cikti["olaylar"] if o["tablo"] == "olgu" and o["hedef_id"] == olgu]
    assert len(olaylar) == 1, f"{nerede}: olgu olayı bulunamadı"
    assert olaylar[0]["gizlilik"] == "sir_icerir", nerede
    assert olaylar[0]["ozet"] is None, nerede


@pytest.mark.parametrize("sira", ["gecmis_once", "degisim_once"])
def test_derin_ozel_zincir_sir_sayilir(tmp_path, sira):
    con = db.baglan(tmp_path / "derin.db")
    try:
        kok = db.kok_id(con)
        try:
            alt, olgu, i = _derin_zincir(con, kok)
        except (sqlite3.IntegrityError, ValueError) as e:
            pytest.skip(f"70 seviyelik zincir kurulamadı (CHECK/derinlik kuralı): {e}")
        derinlik = con.execute(
            "WITH RECURSIVE z(id, n) AS (SELECT ?, 0 UNION ALL "
            "SELECT k.ebeveyn, z.n + 1 FROM kenar k JOIN z ON k.cocuk = z.id "
            "WHERE k.tur = 'alt' AND k.birincil = 1) SELECT max(n) FROM z", (alt,)
        ).fetchone()[0]
        assert derinlik == DERIN_SEVIYE + 1  # kök → dal → 70 seviye

        sorgular = [
            ("gecmis(0)", lambda: arayuz_zaman.gecmis(con, sonra=0, limit=1000)),
            ("degisim", lambda: arayuz_zaman.degisim(con, i)),
        ]
        if sira == "degisim_once":
            sorgular.reverse()
        for _ in range(2):  # tekrar da aynı sonucu vermeli
            for ad, f in sorgular:
                _derin_olay_dogrula(f(), olgu, f"{sira}/{ad}")

        g = arayuz.graf(con)
        sizinti_yok(g, (DERIN_ISARET,), "graf(derin)")
        gd = graf_dugumu(g, alt)
        assert gd["gizlilik"] == "sir_icerir"
        assert gd["ozet"] is None and gd["olgu_aktif"] is None and gd["olgu_eski"] is None
        for ac in (False, True):
            d = arayuz.dugum(con, alt, ac=ac)
            sizinti_yok(d, (DERIN_ISARET,), f"dugum(derin, ac={ac})")
            assert d["gizlilik"] == "sir_icerir" and d["kilitli"] is True
            assert d["olgular"] == []
    finally:
        con.close()
