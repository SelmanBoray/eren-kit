"""yaz.duzelt sözleşme testleri (düğüm özet/ayrıntı düzeltme)."""
import pytest

from bellek.beyin import db, sorgu, yaz

SIR_ANTHROPIC = "API anahtarım sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456"
SIR_ENV = "DB_PASSWORD=supersecret1"


@pytest.fixture
def g(tmp_path):
    con = db.baglan(tmp_path / "b.db")
    kok = db.kok_id(con)
    with con:
        okul = db.dugum_ekle(con, "Okul", ozet="okul işleri", ebeveyn=kok)
        gokbilim = db.dugum_ekle(con, "Gökbilim", ozet="eski özet", ayrinti="eski ayrıntı",
                                 ebeveyn=okul)
        sirli = db.dugum_ekle(con, "Kasa", ozet="kasa", ebeveyn=kok)
        con.execute("UPDATE dugum SET gizlilik='sir_icerir' WHERE id=?", (sirli,))
        ozel = db.dugum_ekle(con, "Özel", ozet="özel dal", ebeveyn=kok, gizlilik="ozel")
        cocuk = db.dugum_ekle(con, "Günlük", ozet="günlük", ebeveyn=ozel, gizlilik="ozel")
    yield {"con": con, "kok": kok, "okul": okul, "gokbilim": gokbilim,
           "sirli": sirli, "ozel": ozel, "cocuk": cocuk}
    con.close()


def sayi(con, tablo):
    return con.execute(f"SELECT COUNT(*) FROM {tablo}").fetchone()[0]


def alanlar(con, d):
    return con.execute("SELECT ozet, ayrinti FROM dugum WHERE id=?", (d,)).fetchone()


def anlik(con):
    return {t: sayi(con, t) for t in ("dugum", "olgu", "kenar", "gelen")}


def mesaj_ok(r):
    assert {"sonuc", "mesaj", "dugum_id"} <= set(r)
    assert isinstance(r["mesaj"], str)


def test_yalniz_ozet(g):
    con, d = g["con"], g["gokbilim"]
    r = yaz.duzelt(con, d, ozet="yeni özet")
    assert r["sonuc"] == "guncellendi"
    assert r["dugum_id"] == d
    mesaj_ok(r)
    assert tuple(alanlar(con, d)) == ("yeni özet", "eski ayrıntı")


def test_yalniz_ayrinti(g):
    con, d = g["con"], g["gokbilim"]
    r = yaz.duzelt(con, d, ayrinti="yeni ayrıntı")
    assert r["sonuc"] == "guncellendi"
    assert tuple(alanlar(con, d)) == ("eski özet", "yeni ayrıntı")


def test_ikisi_birden(g):
    con, d = g["con"], g["gokbilim"]
    r = yaz.duzelt(con, d, ozet="Ö2", ayrinti="A2", kaynak={"tur": "elle", "ref": "t"})
    assert r["sonuc"] == "guncellendi"
    assert tuple(alanlar(con, d)) == ("Ö2", "A2")


def test_ayrinti_temizleme(g):
    con, d = g["con"], g["gokbilim"]
    r = yaz.duzelt(con, d, ayrinti="")
    assert r["sonuc"] == "guncellendi"
    assert alanlar(con, d)[1] in ("", None)
    assert alanlar(con, d)[0] == "eski özet"


def test_degismedi_ve_gecmis_artmaz(g):
    con, d = g["con"], g["gokbilim"]
    assert yaz.duzelt(con, d, ozet="X")["sonuc"] == "guncellendi"
    once = sayi(con, "gecmis")
    r = yaz.duzelt(con, d, ozet="X")
    assert r["sonuc"] == "degismedi"
    mesaj_ok(r)
    r = yaz.duzelt(con, d, ozet="X", ayrinti="eski ayrıntı")
    assert r["sonuc"] == "degismedi"
    assert sayi(con, "gecmis") == once


def test_olgular_baslik_gizlilik_korunur(g):
    con, d = g["con"], g["gokbilim"]
    yaz.yaz(con, "vize 20 Kasımda", dugum_id=d)
    olgu = [r[0] for r in con.execute("SELECT metin FROM olgu WHERE dugum=?", (d,))]
    giz = con.execute("SELECT gizlilik FROM dugum WHERE id=?", (d,)).fetchone()[0]
    once = anlik(con)
    assert yaz.duzelt(con, d, ozet="değişti", ayrinti="")["sonuc"] == "guncellendi"
    assert anlik(con) == once
    assert [r[0] for r in con.execute("SELECT metin FROM olgu WHERE dugum=?", (d,))] == olgu
    assert con.execute("SELECT baslik FROM dugum WHERE id=?", (d,)).fetchone()[0] == "Gökbilim"
    assert con.execute("SELECT gizlilik FROM dugum WHERE id=?", (d,)).fetchone()[0] == giz


def test_gecmis_kaydi_duser(g):
    con, d = g["con"], g["gokbilim"]
    once = sayi(con, "gecmis")
    yaz.duzelt(con, d, ozet="gecmis testi")
    assert sayi(con, "gecmis") > once
    # yeni kayıt eski ve yeni özeti taşır
    son = " ".join(str(c) for c in con.execute(
        "SELECT * FROM gecmis ORDER BY rowid DESC LIMIT 1").fetchone())
    assert "gecmis testi" in son


# --- reddetmeler ----------------------------------------------------------

def _reddedildi(g, **kw):
    con = g["con"]
    once = anlik(con)
    gec = sayi(con, "gecmis")
    d = kw.pop("dugum_id", g["gokbilim"])
    r = yaz.duzelt(con, d, **kw)
    assert r["sonuc"] == "reddedildi", kw
    mesaj_ok(r)
    assert anlik(con) == once
    assert sayi(con, "gecmis") == gec
    return r


def test_dugum_yok(g):
    _reddedildi(g, dugum_id=999999, ozet="x")
    _reddedildi(g, dugum_id=None, ozet="x")


def test_ikisi_de_none(g):
    _reddedildi(g)
    assert tuple(alanlar(g["con"], g["gokbilim"])) == ("eski özet", "eski ayrıntı")


@pytest.mark.parametrize("o", ["", "   ", "\n\t"])
def test_bos_ozet(g, o):
    _reddedildi(g, ozet=o)
    assert alanlar(g["con"], g["gokbilim"])[0] == "eski özet"


def test_ozet_uzunluk_siniri(g):
    _reddedildi(g, ozet="a" * 201)
    assert yaz.duzelt(g["con"], g["gokbilim"], ozet="a" * 200)["sonuc"] == "guncellendi"


def test_ayrinti_uzunluk_siniri(g):
    _reddedildi(g, ayrinti="a" * 1501)
    assert yaz.duzelt(g["con"], g["gokbilim"], ayrinti="a" * 1500)["sonuc"] == "guncellendi"


@pytest.mark.parametrize("kw", [{"ozet": 5}, {"ayrinti": 5}, {"ozet": ["a"]},
                                {"ayrinti": {"a": 1}}, {"ozet": b"x"}])
def test_str_olmayan(g, kw):
    _reddedildi(g, **kw)


def test_kontrol_karakteri(g):
    _reddedildi(g, ozet="boz\x08uk")
    _reddedildi(g, ayrinti="boz\x07uk")


def test_satir_sonu_ve_tab_kabul(g):
    r = yaz.duzelt(g["con"], g["gokbilim"], ayrinti="bir\nüç\tdört")
    assert r["sonuc"] == "guncellendi"


@pytest.mark.parametrize("sir", [SIR_ANTHROPIC, SIR_ENV])
def test_sir_deseni(g, sir):
    _reddedildi(g, ozet=sir)
    _reddedildi(g, ayrinti=sir)
    for satir in g["con"].execute("SELECT * FROM dugum"):
        assert "supersecret1" not in repr(tuple(satir))
        assert "sk-ant-api03" not in repr(tuple(satir))


def test_sir_icerir_dugum(g):
    _reddedildi(g, dugum_id=g["sirli"], ozet="yeni")
    assert alanlar(g["con"], g["sirli"])[0] == "kasa"


def test_etkin_gizlilik_sir_icerir_kalitimi(g):
    con = g["con"]
    with con:
        alt = db.dugum_ekle(con, "Alt", ozet="alt", ebeveyn=g["sirli"])
    _reddedildi(g, dugum_id=alt, ozet="yeni")


@pytest.mark.parametrize("kaynak", [{"tur": "tohum", "ref": "x"},
                                    {"tur": "sistem", "ref": "x"}, "metin", 5])
def test_kaynak_turu_taklit_edilemez(g, kaynak):
    con, d = g["con"], g["gokbilim"]
    once = {r[0] for r in con.execute("SELECT id FROM kaynak")}
    r = yaz.duzelt(con, d, ozet="yeni", kaynak=kaynak)
    assert r["sonuc"] == "guncellendi"
    yeniler = [row for row in con.execute("SELECT id, tur FROM kaynak") if row[0] not in once]
    assert yeniler and all(t == "oturum" for _, t in yeniler)


@pytest.mark.parametrize("tur", ["oturum", "elle"])
def test_kaynak_turu_gecerli(g, tur):
    r = yaz.duzelt(g["con"], g["gokbilim"], ozet=f"yeni {tur}",
                   kaynak={"tur": tur, "ref": "t", "istemci": "pytest"})
    assert r["sonuc"] == "guncellendi"


def test_fazladan_anahtar_yok_sayilir(g):
    r = yaz.duzelt(g["con"], g["gokbilim"], ozet="fazla", bilinmeyen=1)
    assert r["sonuc"] == "guncellendi"


def test_ozel_dugum_duzeltilebilir(g):
    r = yaz.duzelt(g["con"], g["cocuk"], ozet="özel düzeltme")
    assert r["sonuc"] == "guncellendi"


# --- arama ----------------------------------------------------------------

def test_duzeltme_sonrasi_aramada_bulunur(g):
    con, d = g["con"], g["gokbilim"]
    assert d not in [x["id"] for x in sorgu.ara(con, "zebrakelime")["sonuclar"]]
    assert yaz.duzelt(con, d, ozet="zebrakelime hakkında özet")["sonuc"] == "guncellendi"
    assert d in [x["id"] for x in sorgu.ara(con, "zebrakelime")["sonuclar"]]


# --- olgu eskitme (eskit) -------------------------------------------------

def _olgular(con, d):
    return [tuple(r) for r in con.execute(
        "SELECT id, metin, durum FROM olgu WHERE dugum=? ORDER BY id", (d,))]


def _aktif_metinler(con, d):
    return [o["metin"] for o in sorgu.oku(con, d)["olgular"]]


def _olgu_ekle(g, metin, dugum=None):
    con = g["con"]
    with con:
        return db.olgu_ekle(con, dugum or g["gokbilim"], metin)


def test_eskit_basarili(g):
    con, d = g["con"], g["gokbilim"]
    oid = _olgu_ekle(g, "vize 20 Kasımda")
    _olgu_ekle(g, "final 5 Ocakta")
    sat_once = sayi(con, "olgu")
    gec = sayi(con, "gecmis")
    r = yaz.duzelt(con, d, eskit="vize 20 Kasımda")
    assert r["sonuc"] == "guncellendi"
    mesaj_ok(r)
    assert "olgu" in r["degisen"]
    # satır silinmez, durum eskidi, geçmişe düşer
    assert sayi(con, "olgu") == sat_once
    assert con.execute("SELECT durum FROM olgu WHERE id=?", (oid,)).fetchone()[0] == "eskidi"
    assert sayi(con, "gecmis") > gec
    # aktif görünümden çıkar, diğer olgu kalır
    assert _aktif_metinler(con, d) == ["final 5 Ocakta"]


def test_eskit_bosluk_normalizasyonu(g):
    con, d = g["con"], g["gokbilim"]
    oid = _olgu_ekle(g, "vize 20 Kasımda")
    r = yaz.duzelt(con, d, eskit="  vize   20\tKasımda \n")
    assert r["sonuc"] == "guncellendi"
    assert con.execute("SELECT durum FROM olgu WHERE id=?", (oid,)).fetchone()[0] == "eskidi"


def test_eskit_buyuk_kucuk_harf_duyarli(g):
    con, d = g["con"], g["gokbilim"]
    _olgu_ekle(g, "vize 20 Kasımda")
    once = _olgular(con, d)
    gec = sayi(con, "gecmis")
    r = yaz.duzelt(con, d, eskit="VİZE 20 KASIMDA")
    assert r["sonuc"] == "reddedildi"
    r = yaz.duzelt(con, d, eskit="Vize 20 Kasımda")
    assert r["sonuc"] == "reddedildi"
    assert _olgular(con, d) == once
    assert sayi(con, "gecmis") == gec


def test_eskit_eslesmeyen_reddedilir(g):
    con, d = g["con"], g["gokbilim"]
    _olgu_ekle(g, "vize 20 Kasımda")
    once = anlik(con)
    gec = sayi(con, "gecmis")
    r = yaz.duzelt(con, d, eskit="olmayan olgu")
    assert r["sonuc"] == "reddedildi"
    mesaj_ok(r)
    assert anlik(con) == once and sayi(con, "gecmis") == gec


def test_eskit_baska_dugumun_olgusu_reddedilir(g):
    con = g["con"]
    oid = _olgu_ekle(g, "okula özgü olgu", dugum=g["okul"])
    once = anlik(con)
    gec = sayi(con, "gecmis")
    r = yaz.duzelt(con, g["gokbilim"], eskit="okula özgü olgu")
    assert r["sonuc"] == "reddedildi"
    assert anlik(con) == once and sayi(con, "gecmis") == gec
    assert con.execute("SELECT durum FROM olgu WHERE id=?", (oid,)).fetchone()[0] == "aktif"


def test_eskit_zaten_eskimis_degismedi(g):
    con, d = g["con"], g["gokbilim"]
    _olgu_ekle(g, "vize 20 Kasımda")
    assert yaz.duzelt(con, d, eskit="vize 20 Kasımda")["sonuc"] == "guncellendi"
    once = anlik(con)
    gec = sayi(con, "gecmis")
    r = yaz.duzelt(con, d, eskit="vize 20 Kasımda")
    assert r["sonuc"] == "degismedi"
    mesaj_ok(r)
    assert anlik(con) == once and sayi(con, "gecmis") == gec


def test_eskit_eski_ve_aktif_ayni_metin(g):
    # eski kopya eskimiş, aynı metinli aktif olgu varsa aktif olan eskitilir
    con, d = g["con"], g["gokbilim"]
    _olgu_ekle(g, "tekrar eden")
    assert yaz.duzelt(con, d, eskit="tekrar eden")["sonuc"] == "guncellendi"
    yeni = _olgu_ekle(g, "tekrar eden")
    r = yaz.duzelt(con, d, eskit="tekrar eden")
    assert r["sonuc"] == "guncellendi"
    assert con.execute("SELECT durum FROM olgu WHERE id=?", (yeni,)).fetchone()[0] == "eskidi"


@pytest.mark.parametrize("e", ["", "   ", "\n\t", 5, ["a"], b"x", {"a": 1},
                               "boz\x08uk", SIR_ANTHROPIC, SIR_ENV])
def test_eskit_gecersiz_deger(g, e):
    _olgu_ekle(g, "vize 20 Kasımda")
    _reddedildi(g, eskit=e)
    assert _aktif_metinler(g["con"], g["gokbilim"]) == ["vize 20 Kasımda"]


def test_eskit_tek_basina_yeterli_ve_alan_sarti(g):
    con, d = g["con"], g["gokbilim"]
    _olgu_ekle(g, "vize 20 Kasımda")
    # eskit tek başına geçerli; özet/ayrıntı dokunulmaz
    assert yaz.duzelt(con, d, eskit="vize 20 Kasımda")["sonuc"] == "guncellendi"
    assert tuple(alanlar(con, d)) == ("eski özet", "eski ayrıntı")
    # üçü de None ise reddedilir
    _reddedildi(g, ozet=None, ayrinti=None, eskit=None)


def test_eskit_ve_ozet_birlikte(g):
    con, d = g["con"], g["gokbilim"]
    oid = _olgu_ekle(g, "vize 20 Kasımda")
    r = yaz.duzelt(con, d, ozet="birlikte özet", eskit="vize 20 Kasımda")
    assert r["sonuc"] == "guncellendi"
    assert "olgu" in r["degisen"] and "ozet" in r["degisen"]
    assert alanlar(con, d)[0] == "birlikte özet"
    assert con.execute("SELECT durum FROM olgu WHERE id=?", (oid,)).fetchone()[0] == "eskidi"


def test_eskit_eslesmezse_ozet_de_yazilmaz(g):
    con, d = g["con"], g["gokbilim"]
    _olgu_ekle(g, "vize 20 Kasımda")
    once = anlik(con)
    gec = sayi(con, "gecmis")
    r = yaz.duzelt(con, d, ozet="yazılmamalı", eskit="eşleşmeyen")
    assert r["sonuc"] == "reddedildi"
    assert tuple(alanlar(con, d)) == ("eski özet", "eski ayrıntı")
    assert anlik(con) == once and sayi(con, "gecmis") == gec
    assert _aktif_metinler(con, d) == ["vize 20 Kasımda"]


def test_eskit_sir_icerir_dugumde_reddedilir(g):
    con = g["con"]
    with con:
        oid = db.olgu_ekle(con, g["sirli"], "kasa olgusu")
    _reddedildi(g, dugum_id=g["sirli"], eskit="kasa olgusu")
    assert con.execute("SELECT durum FROM olgu WHERE id=?", (oid,)).fetchone()[0] == "aktif"


def test_eskit_sonrasi_aramada_bulunmaz(g):
    con, d = g["con"], g["gokbilim"]
    _olgu_ekle(g, "zebraolgukelime burada")
    assert d in [x["id"] for x in sorgu.ara(con, "zebraolgukelime")["sonuclar"]]
    assert yaz.duzelt(con, d, eskit="zebraolgukelime burada")["sonuc"] == "guncellendi"
    assert d not in [x["id"] for x in sorgu.ara(con, "zebraolgukelime")["sonuclar"]]


def test_eskit_belirsiz_iki_aktif_olgu_reddedilir(g):
    con, d = g["con"], g["gokbilim"]
    a = _olgu_ekle(g, "vize 20 Kasımda")
    b = _olgu_ekle(g, "vize  20   Kasımda")  # boşluk teklenince aynı metin
    for kw in ({"eskit": "vize 20 Kasımda"},
               {"eskit": "vize 20 Kasımda", "ozet": "yazılmamalı"}):
        once = anlik(con)
        gec = sayi(con, "gecmis")
        r = yaz.duzelt(con, d, **kw)
        assert r["sonuc"] == "reddedildi", kw
        mesaj_ok(r)
        assert anlik(con) == once and sayi(con, "gecmis") == gec
        assert tuple(alanlar(con, d)) == ("eski özet", "eski ayrıntı")
        durumlar = [con.execute("SELECT durum FROM olgu WHERE id=?", (i,)).fetchone()[0]
                    for i in (a, b)]
        assert durumlar == ["aktif", "aktif"]
