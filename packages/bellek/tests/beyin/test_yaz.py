"""yaz.py sözleşme testleri (bilgi grafına yazma kararları + gelen kutusu)."""
import json

import pytest

from bellek.beyin import db, yaz

SIR_ANTHROPIC = "API anahtarım sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456"
SIR_ENV = "DB_PASSWORD=supersecret1"
KAYNAK = {"tur": "oturum", "ref": "test", "istemci": "pytest"}


@pytest.fixture
def g(tmp_path):
    con = db.baglan(tmp_path / "b.db")
    kok = db.kok_id(con)
    with con:
        okul = db.dugum_ekle(con, "Okul", ozet="okul işleri", ebeveyn=kok)
        dersler = db.dugum_ekle(con, "Dersler", ozet="dersler", ebeveyn=okul)
        gokbilim = db.dugum_ekle(con, "Gökbilim", ozet="gökbilim dersi", ebeveyn=dersler)
        ozel = db.dugum_ekle(con, "Özel", ozet="özel dal", ebeveyn=kok, gizlilik="ozel")
        gunluk = db.dugum_ekle(con, "Günlük", ozet="günlük", ebeveyn=ozel, gizlilik="ozel")
    yield {"con": con, "kok": kok, "okul": okul, "dersler": dersler,
           "gokbilim": gokbilim, "ozel": ozel, "gunluk": gunluk}
    con.close()


def sayi(con, tablo, where="1=1", args=()):
    return con.execute(f"SELECT COUNT(*) FROM {tablo} WHERE {where}", args).fetchone()[0]


def olgular(con, dugum):
    return [r[0] for r in con.execute(
        "SELECT metin FROM olgu WHERE dugum=? AND durum='aktif'", (dugum,))]


def tablo_sayilari(con):
    return {t: sayi(con, t) for t in ("dugum", "olgu", "gelen", "kenar")}


def mesaj_ok(r):
    assert isinstance(r["mesaj"], str) and len(r["mesaj"]) <= 300


def gizlilik(con, dugum):
    return con.execute("SELECT gizlilik FROM dugum WHERE id=?", (dugum,)).fetchone()[0]


# --- 1. doğrulama ---------------------------------------------------------

def test_bos_metin_reddedilir(g):
    for m in ("", "   "):
        r = yaz.yaz(g["con"], m, dugum_id=g["gokbilim"])
        assert r["sonuc"] == "reddedildi"
        mesaj_ok(r)
    assert olgular(g["con"], g["gokbilim"]) == []


def test_uzun_metin_reddedilir(g):
    r = yaz.yaz(g["con"], "a" * 301, dugum_id=g["gokbilim"])
    assert r["sonuc"] == "reddedildi"
    mesaj_ok(r)
    assert sayi(g["con"], "olgu") == 0


def test_300_karakter_kabul_edilir(g):
    r = yaz.yaz(g["con"], "a" * 300, dugum_id=g["gokbilim"])
    assert r["sonuc"] == "olgu_eklendi"


# --- 2. sır ---------------------------------------------------------------

@pytest.mark.parametrize("sir", [SIR_ANTHROPIC, SIR_ENV])
def test_sir_reddedilir_ve_iz_birakmaz(g, sir):
    con = g["con"]
    once = tablo_sayilari(con)
    for kw in ({"dugum_id": g["gokbilim"]},
               {"baslik": "Yeni", "ebeveyn": g["dersler"]},
               {}):
        r = yaz.yaz(con, sir, **kw)
        assert r["sonuc"] == "reddedildi"
        mesaj_ok(r)
    assert tablo_sayilari(con) == once
    assert sayi(con, "gelen") == 0
    for t in ("dugum", "olgu", "gelen"):
        for satir in con.execute(f"SELECT * FROM {t}"):
            assert "supersecret1" not in repr(tuple(satir))
            assert "sk-ant-api03" not in repr(tuple(satir))


def test_sir_icerir_dugume_yazilmaz(g):
    con = g["con"]
    with con:
        sirli = db.dugum_ekle(con, "Anahtarlar", ozet="x", ebeveyn=g["kok"])
        con.execute("UPDATE dugum SET gizlilik='sir_icerir' WHERE id=?", (sirli,))
    r = yaz.yaz(con, "bir not", dugum_id=sirli)
    assert r["sonuc"] == "reddedildi"
    mesaj_ok(r)
    assert olgular(con, sirli) == []


# --- 3. dugum_id ----------------------------------------------------------

def test_dugume_olgu_eklenir(g):
    r = yaz.yaz(g["con"], "Gökbilim vizesi 20 Kasımda", dugum_id=g["gokbilim"])
    assert r["sonuc"] == "olgu_eklendi"
    assert r["dugum_id"] == g["gokbilim"]
    mesaj_ok(r)
    assert olgular(g["con"], g["gokbilim"]) == ["Gökbilim vizesi 20 Kasımda"]


def test_zaten_var_normalize(g):
    con = g["con"]
    yaz.yaz(con, "Gökbilim vizesi 20 Kasımda", dugum_id=g["gokbilim"])
    for varyant in ("gokbilim vizesi 20 kasimda", "GÖKBİLİM VİZESİ 20 KASIMDA",
                    "Gökbilim vizesi 20 Kasımda"):
        r = yaz.yaz(con, varyant, dugum_id=g["gokbilim"])
        assert r["sonuc"] == "zaten_var", varyant
        mesaj_ok(r)
    assert len(olgular(con, g["gokbilim"])) == 1


def test_farkli_dugumde_ayni_metin_eklenir(g):
    yaz.yaz(g["con"], "ortak not", dugum_id=g["gokbilim"])
    r = yaz.yaz(g["con"], "ortak not", dugum_id=g["dersler"])
    assert r["sonuc"] == "olgu_eklendi"


def test_farkli_metin_zaten_var_degil(g):
    yaz.yaz(g["con"], "vize 20 Kasımda", dugum_id=g["gokbilim"])
    r = yaz.yaz(g["con"], "vize 21 Kasımda", dugum_id=g["gokbilim"])
    assert r["sonuc"] == "olgu_eklendi"


# --- 4. başlık + ebeveyn --------------------------------------------------

def test_yeni_dugum_ebeveyn_id(g):
    con = g["con"]
    r = yaz.yaz(con, "Final 5 Ocakta", baslik="Lineer Cebir", ebeveyn=g["dersler"])
    assert r["sonuc"] == "dugum_eklendi"
    yeni = r["dugum_id"]
    assert con.execute("SELECT baslik FROM dugum WHERE id=?", (yeni,)).fetchone()[0] == "Lineer Cebir"
    assert olgular(con, yeni) == ["Final 5 Ocakta"]
    k = con.execute("SELECT birincil FROM kenar WHERE ebeveyn=? AND cocuk=?",
                    (g["dersler"], yeni)).fetchone()
    assert k is not None and k[0] == 1
    mesaj_ok(r)
    assert r["yol"]


def test_yol_ile_ebeveyn_turkce_duyarsiz(g):
    for i, yol in enumerate(("Okul/Dersler", "okul/dersler", "OKUL/DERSLER")):
        r = yaz.yaz(g["con"], f"not {i}", baslik=f"Ders{i}", ebeveyn=yol)
        assert r["sonuc"] == "dugum_eklendi", yol
        ebv = g["con"].execute(
            "SELECT ebeveyn FROM kenar WHERE cocuk=? AND birincil=1", (r["dugum_id"],)).fetchone()[0]
        assert ebv == g["dersler"]


def test_turkce_karakter_yolu(g):
    with g["con"]:
        db.dugum_ekle(g["con"], "Çınar Üniversitesi", ozet="x", ebeveyn=g["kok"])
    r = yaz.yaz(g["con"], "kayıt açık", baslik="Başvuru", ebeveyn="cinar universitesi")
    assert r["sonuc"] == "dugum_eklendi"


def test_mevcut_baslik_olgu_eklenir(g):
    con = g["con"]
    once = sayi(con, "dugum")
    r = yaz.yaz(con, "Ödev teslimi Cuma", baslik="gokbilim", ebeveyn="Okul/Dersler")
    assert r["sonuc"] == "olgu_eklendi"
    assert r["dugum_id"] == g["gokbilim"]
    assert sayi(con, "dugum") == once
    assert olgular(con, g["gokbilim"]) == ["Ödev teslimi Cuma"]


def test_ozel_dal_gizlilik_kalitimi(g):
    con = g["con"]
    r = yaz.yaz(con, "bugün yorgundum", baslik="Ruh Hali", ebeveyn=g["gunluk"])
    assert r["sonuc"] == "dugum_eklendi"
    assert gizlilik(con, r["dugum_id"]) == "ozel"


def test_ozel_dal_dogrudan_cocuk_da_ozel(g):
    r = yaz.yaz(g["con"], "not", baslik="Rüyalar", ebeveyn="Özel")
    assert r["sonuc"] == "dugum_eklendi"
    assert gizlilik(g["con"], r["dugum_id"]) == "ozel"


def test_acik_dalda_gizlilik_ozel_degil(g):
    r = yaz.yaz(g["con"], "not", baslik="Fizik", ebeveyn=g["dersler"])
    assert gizlilik(g["con"], r["dugum_id"]) != "ozel"


def test_acik_gizlilik_parametresi_verilirse_kullanilir(g):
    r = yaz.yaz(g["con"], "not", baslik="Rüyalar2", ebeveyn=g["dersler"], gizlilik="ozel")
    assert gizlilik(g["con"], r["dugum_id"]) == "ozel"


# --- 5. gelen kutusu ------------------------------------------------------

def test_ebeveyn_cozulemezse_gelen_kutusu(g):
    con = g["con"]
    once = sayi(con, "dugum")
    r = yaz.yaz(con, "bir not", baslik="X", ebeveyn="Yok/Böyle/Yol")
    assert r["sonuc"] == "gelen_kutusuna"
    mesaj_ok(r)
    assert sayi(con, "gelen", "durum='bekliyor'") == 1
    assert sayi(con, "olgu") == 0
    assert sayi(con, "dugum") == once


def test_yalniz_metin_gelen_kutusu_adaylar_alakali(g):
    con = g["con"]
    metin = "gökbilim vizesi 20 kasımda"
    r = yaz.yaz(con, metin)
    assert r["sonuc"] == "gelen_kutusuna"
    mesaj_ok(r)
    liste = yaz.gelen_listele(con)
    assert len(liste) == 1
    kayit = liste[0]
    assert kayit["durum"] == "bekliyor"
    oneri = kayit["oneri_json"]
    if isinstance(oneri, str):
        oneri = json.loads(oneri)
    assert oneri["metin"] == metin
    adaylar = oneri["adaylar"]
    assert 1 <= len(adaylar) <= 3
    # aday biçimi sözleşmede sabit değil: id, {"dugum_id"} ya da {"id"} olabilir
    idler = set()
    for a in adaylar:
        if isinstance(a, dict):
            idler.add(a.get("dugum_id", a.get("id")))
        else:
            idler.add(a)
    assert g["gokbilim"] in idler


def test_gelen_aday_sayisi_en_cok_3(g):
    con = g["con"]
    with con:
        for i in range(6):
            db.dugum_ekle(con, f"Gökbilim {i}", ozet="gökbilim", ebeveyn=g["dersler"])
    yaz.yaz(con, "gökbilim notu")
    oneri = yaz.gelen_listele(con)[0]["oneri_json"]
    if isinstance(oneri, str):
        oneri = json.loads(oneri)
    assert len(oneri["adaylar"]) <= 3


def test_ilgisiz_metin_de_gelen_kutusuna(g):
    r = yaz.yaz(g["con"], "zzzz qqqq")
    assert r["sonuc"] == "gelen_kutusuna"
    assert sayi(g["con"], "gelen") == 1


# --- gelen_karar ----------------------------------------------------------

def _gelen_id(con):
    return yaz.gelen_listele(con)[0]["id"]


def test_gelen_karar_kabul_duzeltme(g):
    con = g["con"]
    yaz.yaz(con, "gökbilim vizesi 20 kasımda")
    gid = _gelen_id(con)
    r = yaz.gelen_karar(con, gid, "kabul", duzeltme={"dugum_id": g["gokbilim"]})
    assert isinstance(r, dict)
    assert olgular(con, g["gokbilim"]) == ["gökbilim vizesi 20 kasımda"]
    assert con.execute("SELECT durum FROM gelen WHERE id=?", (gid,)).fetchone()[0] == "kabul"
    assert yaz.gelen_listele(con) == []


def test_gelen_karar_red(g):
    con = g["con"]
    yaz.yaz(con, "gökbilim vizesi 20 kasımda")
    gid = _gelen_id(con)
    yaz.gelen_karar(con, gid, "red")
    assert con.execute("SELECT durum FROM gelen WHERE id=?", (gid,)).fetchone()[0] == "red"
    assert sayi(con, "olgu") == 0
    assert yaz.gelen_listele(con) == []


def test_gelen_listele_durum_filtresi(g):
    con = g["con"]
    yaz.yaz(con, "bir not")
    gid = _gelen_id(con)
    yaz.gelen_karar(con, gid, "red")
    assert [x["id"] for x in yaz.gelen_listele(con, durum="red")] == [gid]


# --- kaynak, geçmiş, dayanıklılık ----------------------------------------

def test_kaynak_kaydi_ve_baglanti(g):
    con = g["con"]
    r = yaz.yaz(con, "Gökbilim vizesi 20 Kasımda", dugum_id=g["gokbilim"], kaynak=KAYNAK)
    assert r["sonuc"] == "olgu_eklendi"
    assert sayi(con, "kaynak") == 1
    kid = con.execute("SELECT kaynak_id FROM olgu WHERE dugum=?", (g["gokbilim"],)).fetchone()[0]
    assert kid is not None
    assert con.execute("SELECT id FROM kaynak WHERE id=?", (kid,)).fetchone() is not None


def test_kaynaksiz_olgu_yine_kaynaga_bagli(g):
    con = g["con"]
    yaz.yaz(con, "not", dugum_id=g["gokbilim"])
    kid = con.execute("SELECT kaynak_id FROM olgu").fetchone()[0]
    assert kid is not None
    tur, ref = con.execute("SELECT tur, ref FROM kaynak WHERE id=?", (kid,)).fetchone()
    assert tur == "oturum" and ref == "bilinmiyor"


def test_gecmise_kayit_duser(g):
    con = g["con"]
    once = sayi(con, "gecmis")
    yaz.yaz(con, "Gökbilim vizesi 20 Kasımda", dugum_id=g["gokbilim"])
    assert sayi(con, "gecmis") > once
    once = sayi(con, "gecmis")
    yaz.yaz(con, "yeni", baslik="Fizik", ebeveyn=g["dersler"])
    assert sayi(con, "gecmis") > once


def test_beklenmeyen_hata_reddedildi(g):
    class Bozuk:
        def __getattr__(self, ad):
            raise RuntimeError("bozuk")

    r = yaz.yaz(Bozuk(), "bir not", dugum_id=1)
    assert r["sonuc"] == "reddedildi"
    mesaj_ok(r)


def test_olmayan_dugum_id_istisna_sizdirmaz(g):
    r = yaz.yaz(g["con"], "bir not", dugum_id=999999)
    assert r["sonuc"] in ("reddedildi", "gelen_kutusuna")
    mesaj_ok(r)


def test_mesaj_degismezi_tum_sonuclar(g):
    con = g["con"]
    cagrilar = [
        dict(metin=""), dict(metin="a" * 400), dict(metin=SIR_ENV),
        dict(metin="x", dugum_id=g["gokbilim"]), dict(metin="x", dugum_id=g["gokbilim"]),
        dict(metin="y", baslik="Yeni", ebeveyn="Okul"), dict(metin="z"),
    ]
    for c in cagrilar:
        r = yaz.yaz(con, **c)
        assert r["sonuc"] in {"olgu_eklendi", "dugum_eklendi", "gelen_kutusuna",
                              "zaten_var", "reddedildi"}
        mesaj_ok(r)


# --- sözleşme ekleri (gözden geçirme sonrası) ----------------------------

def _luhn_ok(s):
    t = 0
    for i, c in enumerate(reversed(s)):
        d = int(c)
        if i % 2:
            d = d * 2 - 9 if d * 2 > 9 else d * 2
        t += d
    return t % 10 == 0


def _tckn_ok(s):
    d = [int(c) for c in s]
    return (len(d) == 11 and d[0] != 0
            and (7 * sum(d[0:9:2]) - sum(d[1:8:2])) % 10 == d[9]
            and sum(d[:10]) % 10 == d[10])


TCKN = "10000000146"
KART = "4539578763621486"
HASSAS = [
    "IBAN TR33 0006 1005 1978 6457 8413 26",
    f"TC kimlik no {TCKN}",
    f"kart numaram {KART}",
    "kart PIN 4821",
]


def test_hassas_ornekler_gecerli():
    assert _tckn_ok(TCKN)
    assert _luhn_ok(KART)


@pytest.mark.parametrize("hassas", HASSAS)
def test_hassas_veri_reddedilir_iz_birakmaz(g, hassas):
    con = g["con"]
    once = tablo_sayilari(con)
    for kw in ({"dugum_id": g["gokbilim"]},
               {"baslik": "Yeni", "ebeveyn": g["dersler"]},
               {}):
        r = yaz.yaz(con, hassas, **kw)
        assert r["sonuc"] == "reddedildi", (hassas, kw)
        mesaj_ok(r)
    assert tablo_sayilari(con) == once
    for t in ("dugum", "olgu", "gelen"):
        for satir in con.execute(f"SELECT * FROM {t}"):
            s = repr(tuple(satir))
            assert "TR33" not in s and TCKN not in s and KART not in s


def test_sir_dugumu_gelen_kutusunda_sizmaz(g):
    con = g["con"]
    with con:
        sirli = db.dugum_ekle(con, "Gizli Kasa Notları", ozet="kasa", ayrinti="kasa kodu 4821",
                              ebeveyn=g["kok"], gizlilik="sir_icerir")
    r = yaz.yaz(con, "4821 numarali sey")
    assert r["sonuc"] == "gelen_kutusuna"
    for parca in (sirli, "Gizli Kasa"):
        assert parca not in json.dumps(r, ensure_ascii=False, default=str)
        for satir in con.execute("SELECT oneri_json FROM gelen"):
            assert parca not in satir[0]


def test_kok_ebeveyn_gelen_kutusuna(g):
    con = g["con"]
    once = sayi(con, "dugum")
    for ebv in (g["kok"], "Kullanıcı"):
        r = yaz.yaz(con, f"kök altına not {ebv}"[:50], baslik="Yeni Dal", ebeveyn=ebv)
        assert r["sonuc"] == "gelen_kutusuna", ebv
        mesaj_ok(r)
    assert sayi(con, "dugum") == once
    assert sayi(con, "olgu") == 0


@pytest.mark.parametrize("kaynak", [
    {"tur": "tohum", "ref": "x", "istemci": "pytest"}, "metin"])
def test_kaynak_turu_taklit_edilemez(g, kaynak):
    con = g["con"]
    r = yaz.yaz(con, "bir olgu", dugum_id=g["gokbilim"], kaynak=kaynak)
    assert r["sonuc"] == "olgu_eklendi"
    kid = con.execute("SELECT kaynak_id FROM olgu WHERE dugum=?", (g["gokbilim"],)).fetchone()[0]
    assert kid is not None
    assert con.execute("SELECT tur FROM kaynak WHERE id=?", (kid,)).fetchone()[0] == "oturum"


def test_baslik_uzunluk_siniri(g):
    con = g["con"]
    r = yaz.yaz(con, "not", baslik="b" * 121, ebeveyn=g["dersler"])
    assert r["sonuc"] == "reddedildi"
    mesaj_ok(r)
    assert sayi(con, "dugum", "baslik=?", ("b" * 121,)) == 0
    r = yaz.yaz(con, "not", baslik="c" * 120, ebeveyn=g["dersler"])
    assert r["sonuc"] == "dugum_eklendi"


def test_gelen_adaylarinda_kok_yok(g):
    con = g["con"]
    for metin in ("gökbilim vizesi 20 kasımda", "zzzz qqqq", "kullanıcı bir şey yaptı"):
        yaz.yaz(con, metin)
    for kayit in yaz.gelen_listele(con):
        oneri = kayit["oneri_json"]
        if isinstance(oneri, str):
            oneri = json.loads(oneri)
        for a in oneri["adaylar"]:
            assert (a.get("dugum_id", a.get("id")) if isinstance(a, dict) else a) != g["kok"]


def test_kilitli_db_gecici_hata(g, tmp_path):
    import sqlite3
    con = g["con"]
    con.execute("PRAGMA busy_timeout=100")
    baska = sqlite3.connect(str(tmp_path / "b.db"), timeout=0.1, isolation_level=None)
    try:
        baska.execute("BEGIN IMMEDIATE")
        r = yaz.yaz(con, "kilitliyken yazma", dugum_id=g["gokbilim"])
        assert r["sonuc"] == "reddedildi"
        assert r.get("gecici_hata") is True
        mesaj_ok(r)
    finally:
        baska.execute("ROLLBACK")
        baska.close()
    # kilit kalkınca aynı yazma geçer
    assert yaz.yaz(con, "kilitliyken yazma", dugum_id=g["gokbilim"])["sonuc"] == "olgu_eklendi"


def test_normal_ret_gecici_hata_degil(g):
    r = yaz.yaz(g["con"], "", dugum_id=g["gokbilim"])
    assert r["sonuc"] == "reddedildi"
    assert not r.get("gecici_hata")


def test_kontrol_karakterli_metin_reddedilir(g):
    con = g["con"]
    r = yaz.yaz(con, "kod C:\\Proje\\src\x08ilgi", dugum_id=g["gokbilim"])
    assert r["sonuc"] == "reddedildi"
    mesaj_ok(r)
    assert olgular(con, g["gokbilim"]) == []
    assert sayi(con, "olgu") == 0


def test_kontrol_karakterli_baslik_reddedilir(g):
    con = g["con"]
    once = sayi(con, "dugum")
    r = yaz.yaz(con, "not", baslik="Bas\x07lik", ebeveyn=g["dersler"])
    assert r["sonuc"] == "reddedildi"
    mesaj_ok(r)
    assert sayi(con, "dugum") == once


def test_satir_sonu_ve_tab_kabul_edilir(g):
    r = yaz.yaz(g["con"], "satır bir\nsatır\tiki", dugum_id=g["gokbilim"])
    assert r["sonuc"] == "olgu_eklendi"


def test_anahtari_farkli_eski_kokte_kok_korumasi_ve_yol_cozumu(tmp_path):
    """Kökü farklı anahtarla açılmış (eski) veritabanında da kök altı dal açma gelen kutusuna
    düşer, kök başlığıyla başlayan yol çözülür ve özel dal tanınır."""
    con = db.baglan(tmp_path / "eski.db")
    with con:
        kok = db.dugum_ekle(con, "Eski Kök", tur="kok", anahtar="eski-kok")
        okul = db.dugum_ekle(con, "Okul", ozet="okul", ebeveyn=kok)
        db.dugum_ekle(con, "Özel", ozet="özel", ebeveyn=kok, gizlilik="ozel")
    try:
        r = yaz.yaz(con, "kök altına not", baslik="Yeni Dal", ebeveyn=kok)
        assert r["sonuc"] == "gelen_kutusuna"
        r = yaz.yaz(con, "bir olgu", baslik="Dersler", ebeveyn="Eski Kök/Okul")
        assert r["sonuc"] == "dugum_eklendi"
        assert con.execute("SELECT ebeveyn FROM kenar WHERE cocuk=? AND birincil=1",
                           (r["dugum_id"],)).fetchone()[0] == okul
        r = yaz.yaz(con, "gizli günce", baslik="Günce", ebeveyn="Özel")
        assert r["sonuc"] == "dugum_eklendi"
        assert gizlilik(con, r["dugum_id"]) == "ozel"
        assert sayi(con, "dugum", "tur='kok'") == 1
    finally:
        con.close()
