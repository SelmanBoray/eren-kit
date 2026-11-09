"""sorgu.py testleri (sözleşmeden): yol, gez, ara, oku, bütçe, gizlilik."""
import json
import random

import pytest

from bellek.beyin import db, sorgu

SIR = "SIRISARETI_Zq9x7"
OZEL = "OZELISARETI_Kw4m2"


@pytest.fixture
def con(tmp_path):
    c = db.baglan(tmp_path / "b.db")
    yield c
    c.close()


def ekle(con, baslik, **kw):
    with con:
        return db.dugum_ekle(con, baslik, **kw)


def tum(d):
    return json.dumps(d, ensure_ascii=False, default=str)


# ---------- yol ----------

def test_yol_kok_ve_zincir(con):
    kok = db.kok_id(con)
    a = ekle(con, "Okul", ebeveyn=kok)
    b = ekle(con, "Dersler", ebeveyn=a)
    assert sorgu.yol(con, kok) == ["Kullanıcı"]
    assert sorgu.yol(con, b) == ["Kullanıcı", "Okul", "Dersler"]


def test_yol_coklu_ebeveynde_birincil_zincir(con):
    kok = db.kok_id(con)
    a = ekle(con, "A", ebeveyn=kok)
    b = ekle(con, "B", ebeveyn=kok)
    c = ekle(con, "C", ebeveyn=a)
    with con:
        db.kenar_ekle(con, b, c, tur="alt", birincil=False)
    assert sorgu.yol(con, c) == ["Kullanıcı", "A", "C"]


# ---------- gez ----------

def test_gez_kok_varsayilan(con):
    kok = db.kok_id(con)
    a = ekle(con, "Okul", ozet="okul işleri", ebeveyn=kok)
    r = sorgu.gez(con)
    assert r["dugum"]["id"] == kok
    assert r["dugum"]["baslik"] == "Kullanıcı"
    assert [c["id"] for c in r["cocuklar"]] == [a]
    assert str(a) in r["metin"] and "Okul" in r["metin"]


def test_gez_ic_dugum_cocuk_sayisi_ve_yol(con):
    kok = db.kok_id(con)
    a = ekle(con, "Okul", ebeveyn=kok)
    b = ekle(con, "Dersler", ebeveyn=a)
    c1 = ekle(con, "Gökbilim", ebeveyn=b)
    c2 = ekle(con, "Lojik", ebeveyn=b)
    ekle(con, "Vize", ebeveyn=c1)
    ekle(con, "Final", ebeveyn=c1)
    r = sorgu.gez(con, b)
    assert r["dugum"]["yol"] == ["Kullanıcı", "Okul", "Dersler"]
    sayi = {c["id"]: c["cocuk_sayisi"] for c in r["cocuklar"]}
    assert sayi == {c1: 2, c2: 0}
    for cid in (c1, c2):
        assert str(cid) in r["metin"]


def test_gez_cocuk_ozeti_100_karakter(con):
    kok = db.kok_id(con)
    a = ekle(con, "Uzun", ozet="x" * 190, ebeveyn=kok)
    r = sorgu.gez(con, kok, butce=5000)
    ozet = [c for c in r["cocuklar"] if c["id"] == a][0]["ozet"]
    assert len(ozet) <= 100


def test_gez_ek_ebeveyn_isareti(con):
    kok = db.kok_id(con)
    a = ekle(con, "A", ebeveyn=kok)
    b = ekle(con, "B", ebeveyn=kok)
    c = ekle(con, "Ortak", ebeveyn=a)
    with con:
        db.kenar_ekle(con, b, c, tur="alt", birincil=False)
    rb = sorgu.gez(con, b)
    assert c in [x["id"] for x in rb["cocuklar"]]
    assert "(ek)" in rb["metin"]
    ra = sorgu.gez(con, a)
    assert c in [x["id"] for x in ra["cocuklar"]]
    assert "(ek)" not in ra["metin"]


def test_gez_olmayan_id(con):
    r = sorgu.gez(con, 999999)
    assert "hata" in r and r["metin"]


# ---------- ara ----------

def test_ara_turkce_katlama(con):
    kok = db.kok_id(con)
    s = ekle(con, "Sınav takvimi", ozet="vize ve final", ebeveyn=kok)
    ekle(con, "Yemek", ozet="makarna", ebeveyn=kok)
    r = sorgu.ara(con, "sinav")
    ids = [x["id"] for x in r["sonuclar"]]
    assert s in ids
    assert r["sonuclar"][0]["yol"][0] == "Kullanıcı"
    assert "Sınav" in r["metin"]


def test_ara_alt_agac_suzgeci(con):
    kok = db.kok_id(con)
    a = ekle(con, "Okul", ebeveyn=kok)
    b = ekle(con, "Proje", ebeveyn=kok)
    x = ekle(con, "Rapor okul", ebeveyn=a)
    y = ekle(con, "Rapor proje", ebeveyn=b)
    tum_ids = [r["id"] for r in sorgu.ara(con, "rapor")["sonuclar"]]
    assert x in tum_ids and y in tum_ids
    ids = [r["id"] for r in sorgu.ara(con, "rapor", alt_agac=a)["sonuclar"]]
    assert x in ids and y not in ids


def test_ara_k_siniri(con):
    kok = db.kok_id(con)
    for i in range(12):
        ekle(con, f"Defter {i}", ebeveyn=kok)
    assert len(sorgu.ara(con, "defter", k=3, butce=5000)["sonuclar"]) <= 3
    assert len(sorgu.ara(con, "defter", k=7, butce=5000)["sonuclar"]) <= 7


def test_ara_sonuc_yok(con):
    r = sorgu.ara(con, "yokboyleBirSey")
    assert r["sonuclar"] == [] and isinstance(r["metin"], str)


# ---------- oku ----------

def test_oku_alanlar_ebeveyn_ilgili(con):
    kok = db.kok_id(con)
    a = ekle(con, "A", ebeveyn=kok)
    b = ekle(con, "B", ebeveyn=kok)
    c = ekle(con, "Ortak", ozet="kısa", ayrinti="uzun ayrıntı metni", ebeveyn=a)
    d = ekle(con, "Komşu", ebeveyn=kok)
    with con:
        db.kenar_ekle(con, b, c, tur="alt", birincil=False)
        db.kenar_ekle(con, c, d, tur="ilgili")
    r = sorgu.oku(con, c)
    assert r["dugum"]["id"] == c
    assert r["dugum"]["ayrinti"] == "uzun ayrıntı metni"
    assert r["dugum"]["yol"] == ["Kullanıcı", "A", "Ortak"]
    eb = {e["id"]: e["birincil"] for e in r["ebeveynler"]}
    assert set(eb) == {a, b}
    assert eb[a] and not eb[b]
    assert d in [i["id"] for i in r["ilgililer"]]
    assert "uzun ayrıntı metni" in r["metin"]


def test_oku_olgu_siniri_8_ve_en_yeni(con):
    kok = db.kok_id(con)
    n = ekle(con, "Olgulu", ebeveyn=kok)
    with con:
        for i in range(12):
            db.olgu_ekle(con, n, f"olgu-numara-{i:02d}")
    r = sorgu.oku(con, n, butce=5000)
    assert len(r["olgular"]) == 8
    metinler = {o["metin"] for o in r["olgular"]}
    assert metinler == {f"olgu-numara-{i:02d}" for i in range(4, 12)}
    for o in r["olgular"]:
        assert {"id", "metin", "tarih"} <= set(o)


def test_oku_eskimis_olgu_gorunmez(con):
    eskit = db.olgu_eskit
    kok = db.kok_id(con)
    n = ekle(con, "Olgulu", ebeveyn=kok)
    with con:
        db.olgu_ekle(con, n, "kalan-olgu")
        db.olgu_ekle(con, n, "eskiyen-olgu")
    r0 = sorgu.oku(con, n)
    oid = [o["id"] for o in r0["olgular"] if o["metin"] == "eskiyen-olgu"][0]
    with con:
        eskit(con, oid)
    r = sorgu.oku(con, n)
    assert "eskiyen-olgu" not in tum(r)
    assert "kalan-olgu" in tum(r)


def test_oku_olmayan_id(con):
    r = sorgu.oku(con, 987654)
    assert "hata" in r and r["metin"]


def test_olmayan_id_istisna_yok(con):
    sorgu.gez(con, -5)
    sorgu.oku(con, -5)


# ---------- bütçe değişmezi ----------

def rastgele_graf(con, n=300, seed=1234):
    rng = random.Random(seed)
    kok = db.kok_id(con)
    ids = [kok]
    kelimeler = ["sınav", "proje", "okul", "kod", "yemek", "oyun", "font", "ders", "not", "kamera"]
    gizler = [None, None, None, "sir_icerir", "ozel"]
    with con:
        for i in range(n):
            kw = dict(
                ozet=" ".join(rng.choices(kelimeler, k=rng.randint(0, 25))),
                ayrinti=" ".join(rng.choices(kelimeler, k=rng.randint(0, 200))),
                ebeveyn=rng.choice(ids),
            )
            g = rng.choice(gizler)
            if g:
                kw["gizlilik"] = g
            ids.append(db.dugum_ekle(con, f"{rng.choice(kelimeler)} {i}", **kw))
        for _ in range(150):
            a, b = rng.choice(ids), rng.choice(ids)
            if a != b:
                try:
                    db.kenar_ekle(con, a, b, tur=rng.choice(["alt", "ilgili"]), birincil=False)
                except Exception:
                    pass  # döngü/yineleme reddi serbest
        for _ in range(500):
            db.olgu_ekle(con, rng.choice(ids), " ".join(rng.choices(kelimeler, k=rng.randint(1, 40))))
    return ids, kelimeler, rng


@pytest.mark.parametrize("butce", [40, 100, 300, 800, 1500, 2500])
def test_butce_degismezi_rastgele_graf(con, butce):
    ids, kelimeler, rng = rastgele_graf(con)
    for i in rng.sample(ids, 40) + [ids[0]]:
        assert len(sorgu.gez(con, i, butce=butce)["metin"]) <= butce
        assert len(sorgu.oku(con, i, butce=butce)["metin"]) <= butce
    for w in kelimeler:
        assert len(sorgu.ara(con, w, butce=butce, k=20)["metin"]) <= butce
    assert len(sorgu.gez(con, butce=butce)["metin"]) <= butce


def test_butce_kesilince_daha_satiri(con):
    kok = db.kok_id(con)
    for i in range(60):
        ekle(con, f"Çocuk numara {i}", ozet="bir özet metni " * 5, ebeveyn=kok)
    r = sorgu.gez(con, kok, butce=400)
    assert len(r["metin"]) <= 400
    assert "daha" in r["metin"].splitlines()[-1]


# ---------- gizlilik ----------

def gizli_graf(con):
    kok = db.kok_id(con)
    ust = ekle(con, "Ust", ebeveyn=kok)
    sir = ekle(con, "Gizlibaslik", ozet=f"ozet {SIR}", ayrinti=f"ayrinti {SIR}",
               gizlilik="sir_icerir", ebeveyn=ust)
    ozel = ekle(con, "Ozelbaslik", ozet=f"ozet {OZEL}", ayrinti=f"ayrinti {OZEL} detay",
                gizlilik="ozel", ebeveyn=ust)
    with con:
        db.olgu_ekle(con, sir, f"olgu {SIR}")
        db.olgu_ekle(con, ozel, f"olgu {OZEL}")
    return kok, ust, sir, ozel


def test_gizlilik_sir_icerir_hicbir_yerde_yok(con):
    kok, ust, sir, ozel = gizli_graf(con)
    cikti = [
        sorgu.gez(con, ust), sorgu.gez(con, sir), sorgu.gez(con, kok),
        sorgu.ara(con, "Gizlibaslik"), sorgu.ara(con, "ozet ayrinti olgu"),
        sorgu.oku(con, sir), sorgu.oku(con, ust),
    ]
    for c in cikti:
        assert SIR not in tum(c)
        assert SIR not in c["metin"]
    # sorgu metni yankılanabilir; içerik aramasıyla gizli düğüm bulunmamalı
    assert sorgu.ara(con, SIR)["sonuclar"] == []
    assert "Gizlibaslik" in sorgu.gez(con, ust)["metin"]
    assert "[gizli içerik]" in sorgu.oku(con, sir)["metin"]


def test_gizlilik_ozel_gez_ve_ara_gizler(con):
    kok, ust, sir, ozel = gizli_graf(con)
    g = sorgu.gez(con, ust)
    a = sorgu.ara(con, "Ozelbaslik")
    for c in (g, a):
        assert OZEL not in tum(c)
        assert OZEL not in c["metin"]
    assert "[özel]" in g["metin"]
    assert ozel in [x["id"] for x in a["sonuclar"]]


def test_gizlilik_ozel_oku_ayrinti_gosterir(con):
    kok, ust, sir, ozel = gizli_graf(con)
    r = sorgu.oku(con, ozel)
    assert f"ayrinti {OZEL} detay" in r["metin"]
    assert OZEL in r["dugum"]["ayrinti"]


# ---------- gizlilik kalıtımı ----------

KAL = "KALITIMISARETI_Pv3d8"


def test_kalitim_ozel_dal_altindaki_normal_ozeti_gizlenir(con):
    kok = db.kok_id(con)
    dal = ekle(con, "Ozeldal", ozet="dal ozeti", gizlilik="ozel", ebeveyn=kok)
    alt = ekle(con, "Altnormal", ozet=f"ozet {KAL}", gizlilik="normal", ebeveyn=dal)
    cikti = [sorgu.gez(con, dal), sorgu.ara(con, "Altnormal")]
    for c in cikti:
        assert KAL not in tum(c)
        assert KAL not in c["metin"]
    assert "Altnormal" in cikti[0]["metin"]
    assert alt in [x["id"] for x in cikti[1]["sonuclar"]]
    # oku ile ayrıntı/özet görünür (özel için serbest)
    assert KAL in sorgu.oku(con, alt)["metin"]


def test_kalitim_sir_icerir_ata_altindaki_normal_hicbir_yerde_yok(con):
    kok = db.kok_id(con)
    ata = ekle(con, "Sirata", gizlilik="sir_icerir", ebeveyn=kok)
    alt = ekle(con, "Altnormal", ozet=f"ozet {KAL}", ayrinti=f"ayr {KAL}",
               gizlilik="normal", ebeveyn=ata)
    with con:
        db.olgu_ekle(con, alt, f"olgu {KAL}")
    cikti = [sorgu.gez(con, ata), sorgu.gez(con, alt), sorgu.ara(con, "Altnormal"),
             sorgu.oku(con, alt), sorgu.oku(con, ata)]
    for c in cikti:
        assert KAL not in tum(c)
        assert KAL not in c["metin"]
    assert "Altnormal" in cikti[0]["metin"]


def test_kalitim_ek_ebeveyn_gizlilik_tasimaz(con):
    kok = db.kok_id(con)
    gizli = ekle(con, "Sirata", gizlilik="sir_icerir", ebeveyn=kok)
    ozel = ekle(con, "Ozeldal", gizlilik="ozel", ebeveyn=kok)
    normal = ekle(con, "Normaldal", ebeveyn=kok)
    alt = ekle(con, "Altcocuk", ozet=f"ozet {KAL}", ayrinti=f"ayr {KAL}", ebeveyn=normal)
    with con:
        db.kenar_ekle(con, gizli, alt, tur="alt", birincil=False)
        db.kenar_ekle(con, ozel, alt, tur="alt", birincil=False)
        db.olgu_ekle(con, alt, f"olgu {KAL}")
    assert KAL in sorgu.gez(con, normal)["metin"]
    assert KAL in sorgu.oku(con, alt)["metin"]
    assert KAL in sorgu.gez(con, ozel)["metin"]
    assert any(x["id"] == alt and KAL in x["ozet"] for x in sorgu.ara(con, "Altcocuk")["sonuclar"])


# ---------- olgu kaynak_tur ----------

def test_oku_olgu_kaynak_tur_ve_tarih(con):
    kok = db.kok_id(con)
    n = ekle(con, "Olgulu", ebeveyn=kok)
    with con:
        k1 = db.kaynak_ekle(con, "oturum", "ref1")
        k2 = db.kaynak_ekle(con, "tohum", "ref2")
        db.olgu_ekle(con, n, "oturumdan-olgu", kaynak_id=k1)
        db.olgu_ekle(con, n, "tohumdan-olgu", kaynak_id=k2)
    r = sorgu.oku(con, n)
    tur = {o["metin"]: o["kaynak_tur"] for o in r["olgular"]}
    assert tur == {"oturumdan-olgu": "oturum", "tohumdan-olgu": "tohum"}
    assert all(o["tarih"] for o in r["olgular"])
    satirlar = {m: [l for l in r["metin"].splitlines() if m in l] for m in tur}
    assert "oturum" in satirlar["oturumdan-olgu"][0]
    assert "tohum" in satirlar["tohumdan-olgu"][0]
