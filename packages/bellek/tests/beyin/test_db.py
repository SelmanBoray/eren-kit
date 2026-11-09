"""bellek.beyin.db sözleşme testleri (SQLite bilgi grafı çekirdeği)."""

import json
import sqlite3

import pytest

from bellek.beyin import db


@pytest.fixture
def yol(tmp_path, monkeypatch):
    p = tmp_path / "beyin.db"
    monkeypatch.setenv("BELLEK_BEYIN_DB", str(p))
    return p


@pytest.fixture
def con(yol):
    c = db.baglan(yol)
    yield c
    c.close()


def _gecmis(con, tablo=None):
    if tablo:
        return con.execute("SELECT * FROM gecmis WHERE tablo=? ORDER BY id", (tablo,)).fetchall()
    return con.execute("SELECT * FROM gecmis ORDER BY id").fetchall()


def _kaynak(con):
    return db.kaynak_ekle(con, "elle", "test-ref")


def _birincil(con, cocuk):
    return con.execute(
        "SELECT ebeveyn FROM kenar WHERE cocuk=? AND tur='alt' AND birincil=1", (cocuk,)
    ).fetchall()


def _idler(sonuc):
    return [s[0] for s in sonuc]


# --- şema / bağlantı ---------------------------------------------------------

def test_sema_kurulur(con):
    adlar = {r[0] for r in con.execute("SELECT name FROM sqlite_master")}
    for t in ("dugum", "kenar", "olgu", "kaynak", "ek", "gelen", "gecmis", "dugum_fts"):
        assert t in adlar
    assert con.execute("PRAGMA user_version").fetchone()[0] >= 1


def test_wal_ve_foreign_keys_ve_row_factory(con):
    assert con.execute("PRAGMA journal_mode").fetchone()[0].lower() == "wal"
    assert con.execute("PRAGMA foreign_keys").fetchone()[0] == 1
    assert con.row_factory is sqlite3.Row


def test_baglan_env_yolu(yol):
    c = db.baglan()
    try:
        assert yol.exists()
    finally:
        c.close()


def test_sema_idempotent_yeniden_baglan(yol):
    c = db.baglan(yol)
    with c:
        i = db.dugum_ekle(c, "Kalıcı")
    c.close()
    c2 = db.baglan(yol)
    try:
        assert c2.execute("SELECT baslik FROM dugum WHERE id=?", (i,)).fetchone()["baslik"] == "Kalıcı"
    finally:
        c2.close()


def test_salt_okunur_yazma_hatasi(yol):
    c = db.baglan(yol)
    with c:
        db.dugum_ekle(c, "Var")
    c.close()
    ro = db.baglan(yol, salt_okunur=True)
    try:
        assert ro.execute("SELECT COUNT(*) FROM dugum").fetchone()[0] == 1
        with pytest.raises(sqlite3.Error):
            ro.execute("INSERT INTO dugum(id, baslik) VALUES ('x','y')")
        with pytest.raises(sqlite3.Error):
            db.dugum_ekle(ro, "Yazılamaz")
    finally:
        ro.close()


# --- yardımcılar -------------------------------------------------------------

def test_yeni_id_ulid_sirali():
    ids = [db.yeni_id() for _ in range(200)]
    assert all(isinstance(i, str) and len(i) == 26 for i in ids)
    assert len(set(ids)) == 200
    assert ids == sorted(ids)


def test_normalize_turkce():
    assert "istanbul" in db.normalize("İSTANBUL")
    assert db.normalize("IŞIK") in ("ışık", "isik")
    assert db.normalize("sınav") == db.normalize("Sinav")
    assert db.normalize("İş") == db.normalize("is")
    assert db.normalize("ĞÜÖÇ") == db.normalize("guoc")


# --- düğüm -------------------------------------------------------------------

def test_dugum_ekle_varsayilanlar_ve_gecmis(con):
    with con:
        i = db.dugum_ekle(con, "Başlık", ozet="o", ayrinti="a")
    r = con.execute("SELECT * FROM dugum WHERE id=?", (i,)).fetchone()
    assert r["baslik"] == "Başlık" and r["ozet"] == "o" and r["ayrinti"] == "a"
    assert r["tur"] == "bilgi" and r["durum"] == "aktif" and r["gizlilik"] == "normal"
    assert r["surum"] == 1
    assert r["olusturma"] and r["guncelleme"]
    g = [x for x in _gecmis(con, "dugum") if x["hedef_id"] == i]
    assert len(g) == 1
    assert json.loads(g[0]["yeni_json"])["baslik"] == "Başlık"
    assert g[0]["eski_json"] in (None, "null")


def test_dugum_ekle_kaynak_gecmise_duser(con):
    with con:
        k = _kaynak(con)
        i = db.dugum_ekle(con, "K", kaynak_id=k)
    g = [x for x in _gecmis(con, "dugum") if x["hedef_id"] == i]
    assert g[0]["kaynak_id"] == k


def test_dugum_ekle_ebeveyn_birincil_kenar(con):
    with con:
        p = db.dugum_ekle(con, "P")
        c = db.dugum_ekle(con, "C", ebeveyn=p)
    k = con.execute("SELECT * FROM kenar WHERE ebeveyn=? AND cocuk=?", (p, c)).fetchone()
    assert k["tur"] == "alt" and k["birincil"] == 1
    assert len(_gecmis(con, "kenar")) >= 1


def test_dugum_ekle_anahtar_benzersiz(con):
    with con:
        db.dugum_ekle(con, "A", anahtar="ak")
    with pytest.raises((sqlite3.IntegrityError, ValueError)):
        with con:
            db.dugum_ekle(con, "B", anahtar="ak")
    assert db.anahtardan_id(con, "ak") is not None
    assert db.anahtardan_id(con, "yok") is None


def test_sinir_asimi(con):
    with pytest.raises(ValueError):
        db.dugum_ekle(con, "x", ozet="a" * 201)
    with pytest.raises(ValueError):
        db.dugum_ekle(con, "x", ayrinti="a" * 1501)
    with con:
        db.dugum_ekle(con, "sinir", ozet="a" * 200, ayrinti="b" * 1500)
    with con:
        i = db.dugum_ekle(con, "g")
    with pytest.raises(ValueError):
        db.dugum_guncelle(con, i, ozet="a" * 201)
    with pytest.raises(ValueError):
        db.dugum_guncelle(con, i, ayrinti="a" * 1501)


def test_dugum_guncelle_surum_ve_gecmis(con):
    with con:
        i = db.dugum_ekle(con, "Eski", ozet="eo")
    with con:
        db.dugum_guncelle(con, i, baslik="Yeni", durum="bitti")
    r = con.execute("SELECT * FROM dugum WHERE id=?", (i,)).fetchone()
    assert r["baslik"] == "Yeni" and r["durum"] == "bitti" and r["surum"] == 2
    assert r["ozet"] == "eo"
    g = [x for x in _gecmis(con, "dugum") if x["hedef_id"] == i]
    assert len(g) == 2
    son = g[-1]
    assert json.loads(son["eski_json"])["baslik"] == "Eski"
    assert json.loads(son["yeni_json"])["baslik"] == "Yeni"
    with con:
        db.dugum_guncelle(con, i, ozet="x")
    assert con.execute("SELECT surum FROM dugum WHERE id=?", (i,)).fetchone()[0] == 3


# --- kenar -------------------------------------------------------------------

def test_dongu_reddi(con):
    with con:
        a = db.dugum_ekle(con, "A")
        b = db.dugum_ekle(con, "B")
        c = db.dugum_ekle(con, "C")
        db.kenar_ekle(con, a, b)
        db.kenar_ekle(con, b, c)
    with pytest.raises(ValueError):
        db.kenar_ekle(con, c, a)
    with pytest.raises(ValueError):
        db.kenar_ekle(con, a, a)
    assert con.execute("SELECT COUNT(*) FROM kenar").fetchone()[0] == 2


def test_kenar_ekle_gecmis(con):
    with con:
        a = db.dugum_ekle(con, "A")
        b = db.dugum_ekle(con, "B")
    onceki = len(_gecmis(con, "kenar"))
    with con:
        db.kenar_ekle(con, a, b, tur="ilgili")
    assert len(_gecmis(con, "kenar")) == onceki + 1
    k = con.execute("SELECT * FROM kenar WHERE ebeveyn=? AND cocuk=?", (a, b)).fetchone()
    assert k["tur"] == "ilgili" and k["birincil"] == 0


def test_birincil_devri_ve_tekligi(con):
    with con:
        p1 = db.dugum_ekle(con, "P1")
        p2 = db.dugum_ekle(con, "P2")
        c = db.dugum_ekle(con, "C", ebeveyn=p1)
    assert [r[0] for r in _birincil(con, c)] == [p1]
    with con:
        db.kenar_ekle(con, p2, c, birincil=True)
    assert [r[0] for r in _birincil(con, c)] == [p2]
    eski = con.execute("SELECT birincil FROM kenar WHERE ebeveyn=? AND cocuk=?", (p1, c)).fetchone()
    assert eski["birincil"] == 0
    with con:
        db.kenar_ekle(con, p1, c, birincil=True)
    assert [r[0] for r in _birincil(con, c)] == [p1]


def test_birincil_kenar_silme_reddi(con):
    with con:
        p = db.dugum_ekle(con, "P")
        c = db.dugum_ekle(con, "C", ebeveyn=p)
    with pytest.raises(ValueError):
        db.kenar_sil(con, p, c)
    assert con.execute("SELECT COUNT(*) FROM kenar").fetchone()[0] == 1


def test_birincil_devrinden_sonra_eski_kenar_silinebilir(con):
    with con:
        p1 = db.dugum_ekle(con, "P1")
        p2 = db.dugum_ekle(con, "P2")
        c = db.dugum_ekle(con, "C", ebeveyn=p1)
        db.kenar_ekle(con, p2, c, birincil=True)
    onceki = len(_gecmis(con, "kenar"))
    with con:
        db.kenar_sil(con, p1, c)
    assert con.execute(
        "SELECT COUNT(*) FROM kenar WHERE ebeveyn=? AND cocuk=?", (p1, c)
    ).fetchone()[0] == 0
    assert [r[0] for r in _birincil(con, c)] == [p2]
    assert len(_gecmis(con, "kenar")) == onceki + 1


def test_ilgili_kenar_silinebilir(con):
    with con:
        a = db.dugum_ekle(con, "A")
        b = db.dugum_ekle(con, "B")
        db.kenar_ekle(con, a, b, tur="ilgili")
        db.kenar_sil(con, a, b, tur="ilgili")
    assert con.execute("SELECT COUNT(*) FROM kenar").fetchone()[0] == 0


# --- olgu --------------------------------------------------------------------

def test_olgu_ekle_ve_gecmis(con):
    with con:
        k = _kaynak(con)
        d = db.dugum_ekle(con, "D")
        o = db.olgu_ekle(con, d, "Bir olgu.", kaynak_id=k)
    r = con.execute("SELECT * FROM olgu WHERE id=?", (o,)).fetchone()
    assert r["dugum"] == d and r["metin"] == "Bir olgu."
    assert r["durum"] == "aktif" and r["guven"] == "orta"
    assert r["gecerli_bit"] is None and r["kaynak_id"] == k
    g = [x for x in _gecmis(con, "olgu") if x["hedef_id"] == o]
    assert len(g) == 1 and json.loads(g[0]["yeni_json"])["metin"] == "Bir olgu."


def test_olgu_sinir(con):
    with con:
        d = db.dugum_ekle(con, "D")
        db.olgu_ekle(con, d, "x" * 300)
    with pytest.raises(ValueError):
        db.olgu_ekle(con, d, "x" * 301)


def test_olgu_eskit(con):
    with con:
        d = db.dugum_ekle(con, "D")
        eski = db.olgu_ekle(con, d, "Eski bilgi")
        yeni = db.olgu_ekle(con, d, "Yeni bilgi")
    with con:
        db.olgu_eskit(con, eski, yerine_gecen=yeni)
    r = con.execute("SELECT * FROM olgu WHERE id=?", (eski,)).fetchone()
    assert r["durum"] == "eskidi" and r["gecerli_bit"] and r["yerine_gecen"] == yeni
    assert con.execute("SELECT durum FROM olgu WHERE id=?", (yeni,)).fetchone()[0] == "aktif"
    g = [x for x in _gecmis(con, "olgu") if x["hedef_id"] == eski]
    assert len(g) == 2
    assert json.loads(g[-1]["eski_json"])["durum"] == "aktif"
    assert json.loads(g[-1]["yeni_json"])["durum"] == "eskidi"


def test_olgu_eskit_yerine_gecensiz(con):
    with con:
        d = db.dugum_ekle(con, "D")
        o = db.olgu_ekle(con, d, "Geçersiz oldu")
        db.olgu_eskit(con, o)
    r = con.execute("SELECT * FROM olgu WHERE id=?", (o,)).fetchone()
    assert r["durum"] == "eskidi" and r["gecerli_bit"] and r["yerine_gecen"] is None


# --- gelen / kaynak ----------------------------------------------------------

def test_gelen_ekle(con):
    with con:
        k = _kaynak(con)
        g = db.gelen_ekle(con, "olgu", {"metin": "öneri", "n": 1}, kaynak_id=k)
    r = con.execute("SELECT * FROM gelen WHERE id=?", (g,)).fetchone()
    assert r["tur"] == "olgu" and r["durum"] == "bekliyor" and r["kaynak_id"] == k
    assert json.loads(r["oneri_json"]) == {"metin": "öneri", "n": 1}
    assert any(x["hedef_id"] == g for x in _gecmis(con, "gelen"))


def test_kaynak_ekle(con):
    with con:
        k = _kaynak(con)
    r = con.execute("SELECT * FROM kaynak WHERE id=?", (k,)).fetchone()
    assert r["tur"] == "elle" and r["ref"] == "test-ref"
    assert any(x["hedef_id"] == k for x in _gecmis(con, "kaynak"))


# --- kök / torunlar ----------------------------------------------------------

def test_kok_id_idempotent(con):
    with con:
        a = db.kok_id(con)
    with con:
        b = db.kok_id(con)
    assert a == b and len(a) == 26
    assert db.anahtardan_id(con, "kok") == a
    assert con.execute("SELECT COUNT(*) FROM dugum WHERE anahtar='kok'").fetchone()[0] == 1
    assert con.execute("SELECT tur FROM dugum WHERE id=?", (a,)).fetchone()[0] == "kok"
    assert con.execute("SELECT baslik FROM dugum WHERE id=?", (a,)).fetchone()[0] == db.KOK_BASLIK


def test_kok_bul_bos_veritabaninda_none_ve_yazmaz(con):
    assert db.kok_bul(con) is None
    assert con.execute("SELECT COUNT(*) FROM dugum").fetchone()[0] == 0


def test_kok_id_anahtari_farkli_eski_koku_bulur(con):
    """Kök anahtarı farklı (eski sürüm) veritabanında ikinci kök açılmaz."""
    with con:
        eski = db.dugum_ekle(con, "Eski Kök", tur="kok", anahtar="eski-kok")
        db.dugum_ekle(con, "Dal", tur="dal", ebeveyn=eski)
    assert db.kok_bul(con) == eski
    with con:
        assert db.kok_id(con) == eski
    assert con.execute("SELECT COUNT(*) FROM dugum WHERE tur='kok'").fetchone()[0] == 1
    assert db.anahtardan_id(con, db.KOK_ANAHTAR) is None


def test_torunlar_coklu_ebeveyn(con):
    with con:
        r = db.dugum_ekle(con, "R")
        a = db.dugum_ekle(con, "A", ebeveyn=r)
        b = db.dugum_ekle(con, "B", ebeveyn=r)
        c = db.dugum_ekle(con, "C", ebeveyn=a)
        db.kenar_ekle(con, b, c)
        d = db.dugum_ekle(con, "D", ebeveyn=c)
        x = db.dugum_ekle(con, "X")  # bağımsız
    assert db.torunlar(con, r) - {r} == {a, b, c, d}
    assert db.torunlar(con, a) - {a} == {c, d}
    assert db.torunlar(con, b) - {b} == {c, d}
    assert db.torunlar(con, d) - {d} == set()
    assert x not in db.torunlar(con, r)


# --- FTS ---------------------------------------------------------------------

def test_fts_turkce_katlama(con):
    with con:
        s1 = db.dugum_ekle(con, "Sinav takvimi")
        s2 = db.dugum_ekle(con, "sınav notları")
        i1 = db.dugum_ekle(con, "İş görüşmesi")
        i2 = db.dugum_ekle(con, "is planı")
    assert s1 in _idler(db.fts_ara(con, "sınav"))
    assert s2 in _idler(db.fts_ara(con, "Sinav"))
    assert i1 in _idler(db.fts_ara(con, "is"))
    assert i2 in _idler(db.fts_ara(con, "İş"))
    assert i1 in _idler(db.fts_ara(con, "IS"))


def test_fts_sonuc_bicimi_ve_skor_sirasi(con):
    with con:
        for n in range(3):
            db.dugum_ekle(con, f"kedi {n}", ozet="kedi kedi kedi" if n == 0 else "")
    s = db.fts_ara(con, "kedi")
    assert len(s) == 3
    skorlar = [x[1] for x in s]
    assert all(isinstance(v, (int, float)) for v in skorlar)
    assert skorlar == sorted(skorlar, reverse=True)  # yüksek skor önde
    assert len(db.fts_ara(con, "kedi", k=2)) == 2


def test_fts_bos_sorgu(con):
    with con:
        db.dugum_ekle(con, "Bir şey")
    assert db.fts_ara(con, "") == []
    assert db.fts_ara(con, "   ") == []


def test_fts_olgu_metninden_bulur(con):
    with con:
        d = db.dugum_ekle(con, "Genel düğüm")
        db.olgu_ekle(con, d, "Kullanıcı zürafa besliyor")
    assert d in _idler(db.fts_ara(con, "zürafa"))
    assert d in _idler(db.fts_ara(con, "zurafa"))


def test_fts_olgu_sonradan_eklenince_guncel(con):
    with con:
        d = db.dugum_ekle(con, "Düğüm")
    assert db.fts_ara(con, "kelebek") == []
    with con:
        db.olgu_ekle(con, d, "kelebek koleksiyonu")
    assert d in _idler(db.fts_ara(con, "kelebek"))


def test_fts_alt_agac_suzgeci(con):
    with con:
        r1 = db.dugum_ekle(con, "Kök bir")
        r2 = db.dugum_ekle(con, "Kök iki")
        a = db.dugum_ekle(con, "proje elma", ebeveyn=r1)
        b = db.dugum_ekle(con, "proje elma", ebeveyn=r2)
    hepsi = _idler(db.fts_ara(con, "elma"))
    assert a in hepsi and b in hepsi
    assert _idler(db.fts_ara(con, "elma", alt_agac=r1)) == [a]
    assert _idler(db.fts_ara(con, "elma", alt_agac=r2)) == [b]


def test_fts_guncellemeden_sonra_guncel(con):
    with con:
        i = db.dugum_ekle(con, "Armut tarifi")
    assert i in _idler(db.fts_ara(con, "armut"))
    with con:
        db.dugum_guncelle(con, i, baslik="Karpuz tarifi", ozet="yaz meyvesi")
    assert i not in _idler(db.fts_ara(con, "armut"))
    assert i in _idler(db.fts_ara(con, "karpuz"))
    assert i in _idler(db.fts_ara(con, "meyvesi"))


# --- işlem bütünlüğü ---------------------------------------------------------

def test_commit_edilmeyen_islem_geri_alinir(con):
    with con:
        db.dugum_ekle(con, "Kalıcı")
    db.dugum_ekle(con, "Geçici")
    con.rollback()
    adlar = [r[0] for r in con.execute("SELECT baslik FROM dugum")]
    assert adlar == ["Kalıcı"]
    assert db.fts_ara(con, "Geçici") == []
    assert len(_gecmis(con, "dugum")) == 1


def test_with_blogu_hatada_geri_alir(con):
    with pytest.raises(RuntimeError):
        with con:
            db.dugum_ekle(con, "Yarım")
            raise RuntimeError("patla")
    assert con.execute("SELECT COUNT(*) FROM dugum").fetchone()[0] == 0
    assert con.execute("SELECT COUNT(*) FROM gecmis").fetchone()[0] == 0


def test_fonksiyonlar_commit_etmez(yol, con):
    db.dugum_ekle(con, "Commitsiz")
    diger = db.baglan(yol, salt_okunur=True)
    try:
        assert diger.execute("SELECT COUNT(*) FROM dugum").fetchone()[0] == 0
    finally:
        diger.close()
    con.rollback()


# --- sözleşme ekleri: gizlilik, değişmezlik, başlık sınırı, göç --------------

def test_sir_icerir_govde_aranmaz_baslik_aranir(con):
    with con:
        d = db.dugum_ekle(
            con, "Gizli mahzen", ozet="ozetkelimesi", ayrinti="ayrintikelimesi",
            gizlilik="sir_icerir",
        )
        db.olgu_ekle(con, d, "olgukelimesi burada")
    assert d in _idler(db.fts_ara(con, "mahzen"))
    for kelime in ("ozetkelimesi", "ayrintikelimesi", "olgukelimesi"):
        assert d not in _idler(db.fts_ara(con, kelime))


def test_normal_dugum_sir_icerir_olunca_govde_kaybolur(con):
    with con:
        d = db.dugum_ekle(con, "Açık düğüm", ozet="ozelsozcuk", ayrinti="ayrintisozcuk")
        db.olgu_ekle(con, d, "olgusozcuk var")
    for kelime in ("ozelsozcuk", "ayrintisozcuk", "olgusozcuk"):
        assert d in _idler(db.fts_ara(con, kelime))
    with con:
        db.dugum_guncelle(con, d, gizlilik="sir_icerir")
    for kelime in ("ozelsozcuk", "ayrintisozcuk", "olgusozcuk"):
        assert d not in _idler(db.fts_ara(con, kelime))
    assert d in _idler(db.fts_ara(con, "düğüm"))
    with con:
        db.dugum_guncelle(con, d, gizlilik="normal")
    assert d in _idler(db.fts_ara(con, "ozelsozcuk"))


def test_olgu_metni_degistirilemez(con):
    with con:
        d = db.dugum_ekle(con, "D")
        o = db.olgu_ekle(con, d, "ilk metin")
    with pytest.raises(sqlite3.DatabaseError):  # IntegrityError alt sınıfı da yakalanır
        with con:
            con.execute("UPDATE olgu SET metin='yeni' WHERE id=?", (o,))
    assert con.execute("SELECT metin FROM olgu WHERE id=?", (o,)).fetchone()[0] == "ilk metin"


def test_olgu_durum_alanlari_guncellenebilir(con):
    with con:
        d = db.dugum_ekle(con, "D")
        o = db.olgu_ekle(con, d, "x")
        y = db.olgu_ekle(con, d, "y")
    with con:
        con.execute(
            "UPDATE olgu SET durum='celisik', gecerli_bit='2026-01-01', yerine_gecen=? WHERE id=?",
            (y, o),
        )
    r = con.execute("SELECT * FROM olgu WHERE id=?", (o,)).fetchone()
    assert r["durum"] == "celisik" and r["gecerli_bit"] == "2026-01-01" and r["yerine_gecen"] == y
    with con:
        db.olgu_eskit(con, y)
    assert con.execute("SELECT durum FROM olgu WHERE id=?", (y,)).fetchone()[0] == "eskidi"


def test_gecmis_degismez_ve_silinmez(con):
    with con:
        db.dugum_ekle(con, "D")
    with pytest.raises(sqlite3.DatabaseError):
        with con:
            con.execute("UPDATE gecmis SET islem='x'")
    with pytest.raises(sqlite3.DatabaseError):
        with con:
            con.execute("DELETE FROM gecmis")
    assert len(_gecmis(con)) >= 1


def test_baslik_sinir_120(con):
    with con:
        i = db.dugum_ekle(con, "b" * 120)
    with pytest.raises(ValueError):
        db.dugum_ekle(con, "b" * 121)
    with pytest.raises(ValueError):
        db.dugum_guncelle(con, i, baslik="b" * 121)
    with con:
        db.dugum_guncelle(con, i, baslik="c" * 120)
    assert con.execute("SELECT baslik FROM dugum WHERE id=?", (i,)).fetchone()[0] == "c" * 120


def test_v1_veritabani_baglan_ile_goc_eder(tmp_path, monkeypatch):
    # v1 şeması: v2 tetikleyicileri olmayan db._SEMA (özel ad; yoksa test atlanır)
    sema_v1 = getattr(db, "_SEMA", None)
    if sema_v1 is None:
        pytest.skip("db._SEMA yok: eski şema kurulamıyor")
    yol = tmp_path / "eski.db"
    monkeypatch.setenv("BELLEK_BEYIN_DB", str(yol))
    raw = sqlite3.connect(str(yol))
    raw.executescript(sema_v1 + "PRAGMA user_version = 1;")
    simdi = "2026-01-01T00:00:00Z"
    for n in range(3):
        raw.execute(
            "INSERT INTO dugum (id, baslik, ozet, ayrinti, gizlilik, olusturma, guncelleme) "
            "VALUES (?,?,?,?,?,?,?)",
            (f"D{n}", f"Eski düğüm {n}", "eskiozet", "", "sir_icerir" if n == 2 else "normal",
             simdi, simdi),
        )
    for n in range(2):
        raw.execute(
            "INSERT INTO olgu (id, dugum, metin, olusturma) VALUES (?,?,?,?)",
            (f"O{n}", "D0", f"eski olgu {n}", simdi),
        )
    raw.commit()
    assert raw.execute("PRAGMA user_version").fetchone()[0] == 1
    raw.close()

    c = db.baglan(yol)
    try:
        assert c.execute("PRAGMA user_version").fetchone()[0] >= 2
        assert c.execute("SELECT COUNT(*) FROM dugum").fetchone()[0] == 3
        assert c.execute("SELECT COUNT(*) FROM olgu").fetchone()[0] == 2
        # göçle gelen kurallar işliyor
        with pytest.raises(sqlite3.DatabaseError):
            with c:
                c.execute("UPDATE olgu SET metin='z' WHERE id='O0'")
        with pytest.raises(ValueError):
            db.dugum_ekle(c, "b" * 121)
        # FTS yeniden üretildi: normal düğüm gövdesi bulunur, sir_icerir olanın bulunmaz
        bulunan = _idler(db.fts_ara(c, "eskiozet"))
        assert "D0" in bulunan and "D1" in bulunan and "D2" not in bulunan
        assert "D2" in _idler(db.fts_ara(c, "düğüm"))
    finally:
        c.close()
