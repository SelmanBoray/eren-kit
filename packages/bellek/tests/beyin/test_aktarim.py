"""ice_al + disa_aktar testleri (sözleşmeden)."""

import json
import os
import subprocess
import sys

import pytest

from bellek.beyin import db, disa_aktar, ice_al

SIR = "SIRDIZE_Zq81xk"
OZEL = "OZELDIZE_Qw47mp"


def _t(anahtar, baslik, ebeveyn="kok", tur="dal", gizlilik="normal", **kw):
    d = {
        "anahtar": anahtar, "baslik": baslik, "ozet": f"ozet {baslik}", "ayrinti": "",
        "tur": tur, "durum": "aktif", "gizlilik": gizlilik, "tarih": "2026-01-01",
        "birincil_ebeveyn": ebeveyn, "ek_ebeveynler": [], "ilgili": [],
        "olgular": [], "kaynaklar": [],
    }
    d.update(kw)
    return d


def _yaz(yol, satirlar):
    if not any(x["anahtar"] == "kok" for x in satirlar):
        satirlar = [_t("kok", "Kullanıcı", ebeveyn=None, tur="kok")] + list(satirlar)
    yol.write_text("\n".join(json.dumps(s, ensure_ascii=False) for s in satirlar) + "\n",
                   encoding="utf-8")
    return yol


def _tohum():
    return [
        _t("kok", "Kullanıcı", ebeveyn=None, tur="kok"),
        _t("alt-a", "AltA", ebeveyn="proje-x", olgular=["olgu bir", "olgu iki"]),
        _t("proje-x", "ProjeX", tur="proje", ek_ebeveynler=["proje-y"]),
        _t("proje-y", "ProjeY", tur="proje"),
        _t("kisi-k", "KisiK", tur="kisi", ilgili=["proje-x"]),
        _t("ozel-d", "OzelD", gizlilik="ozel", ozet=f"gizli not {OZEL}"),
        _t("sir-d", "SirD", gizlilik="sir_icerir", ozet=f"parola {SIR}",
           ayrinti=f"detay {SIR}", olgular=[f"olgu {SIR}"]),
    ]


@pytest.fixture
def con(tmp_path):
    return db.baglan(tmp_path / "b.db")


@pytest.fixture
def dolu(con, tmp_path):
    s = ice_al.ice_al(con, _yaz(tmp_path / "t.jsonl", _tohum()))
    return con, s


def _say(con, tablo):
    return con.execute(f"SELECT COUNT(*) FROM {tablo}").fetchone()[0]


# ---------------- ice_al ----------------

def test_temel_aktarim(dolu):
    con, s = dolu
    assert not s["hatalar"]
    assert set(s) >= {"dugum_eklendi", "dugum_guncellendi", "kenar", "olgu", "atlanan", "hatalar"}
    assert s["olgu"] == 3
    for a in ("alt-a", "proje-x", "proje-y", "kisi-k", "ozel-d", "sir-d"):
        assert db.anahtardan_id(con, a) is not None
    b = con.execute("SELECT baslik FROM dugum WHERE anahtar='alt-a'").fetchone()[0]
    assert b == "AltA"
    assert con.execute("SELECT gizlilik FROM dugum WHERE anahtar='sir-d'").fetchone()[0] == "sir_icerir"


def test_kok_ayni_dugum(dolu):
    con, _ = dolu
    assert db.anahtardan_id(con, "kok") == db.kok_id(con)
    assert con.execute("SELECT COUNT(*) FROM dugum WHERE anahtar='kok'").fetchone()[0] == 1


def test_eski_anahtarli_koke_aktarim(con, tmp_path):
    """Kökü farklı anahtarla açılmış veritabanı: tohumdaki kök satırı o köke yazılır."""
    with con:
        eski = db.dugum_ekle(con, "Eski Kök", tur="kok", anahtar="eski-kok")
    sat = [_t("kok", "Yeni Başlık", ebeveyn=None, tur="kok"), _t("dal-a", "DalA")]
    s = ice_al.ice_al(con, _yaz(tmp_path / "t.jsonl", sat))
    assert not s["hatalar"], s["hatalar"]
    assert _say(con, "dugum WHERE tur='kok'") == 1
    assert con.execute("SELECT baslik FROM dugum WHERE id=?", (eski,)).fetchone()[0] == "Yeni Başlık"
    dal = db.anahtardan_id(con, "dal-a")
    assert con.execute("SELECT ebeveyn FROM kenar WHERE cocuk=? AND birincil=1",
                       (dal,)).fetchone()[0] == eski


def test_eski_anahtarli_koke_kok_satirsiz_aktarim(con, tmp_path):
    """Tohumda kök satırı yokken de 'kok' ebeveyni eski köke çözülür."""
    with con:
        eski = db.dugum_ekle(con, "Eski Kök", tur="kok", anahtar="eski-kok")
    yol = tmp_path / "t.jsonl"
    yol.write_text(json.dumps(_t("dal-b", "DalB"), ensure_ascii=False) + "\n", encoding="utf-8")
    s = ice_al.ice_al(con, yol)
    assert not s["hatalar"], s["hatalar"]
    dal = db.anahtardan_id(con, "dal-b")
    assert con.execute("SELECT ebeveyn FROM kenar WHERE cocuk=? AND birincil=1",
                       (dal,)).fetchone()[0] == eski
    assert _say(con, "dugum WHERE tur='kok'") == 1


def test_cocuk_ebeveynden_once(con, tmp_path):
    sat = [_t("alt-a", "AltA", ebeveyn="proje-x"), _t("proje-x", "ProjeX", tur="proje")]
    s = ice_al.ice_al(con, _yaz(tmp_path / "t.jsonl", sat))
    assert not s["hatalar"]
    e, c = db.anahtardan_id(con, "proje-x"), db.anahtardan_id(con, "alt-a")
    r = con.execute("SELECT birincil FROM kenar WHERE ebeveyn=? AND cocuk=? AND tur='alt'",
                    (e, c)).fetchone()
    assert r is not None and r[0]


def test_birincil_ek_ve_ilgili_kenarlar(dolu):
    con, _ = dolu
    px, py, k = (db.anahtardan_id(con, a) for a in ("proje-x", "proje-y", "kisi-k"))
    asil = con.execute("SELECT birincil FROM kenar WHERE ebeveyn=? AND cocuk=? AND tur='alt'",
                       (db.kok_id(con), px)).fetchone()
    assert asil and asil[0]
    ek = con.execute("SELECT birincil FROM kenar WHERE ebeveyn=? AND cocuk=? AND tur='alt'",
                     (py, px)).fetchone()
    assert ek is not None and not ek[0]
    assert con.execute("SELECT COUNT(*) FROM kenar WHERE tur='ilgili' AND "
                       "((ebeveyn=? AND cocuk=?) OR (ebeveyn=? AND cocuk=?))",
                       (k, px, px, k)).fetchone()[0] >= 1
    n = con.execute("SELECT COUNT(*) FROM kenar WHERE cocuk=? AND tur='alt' AND birincil",
                    (px,)).fetchone()[0]
    assert n == 1


def test_idempotent(con, tmp_path):
    yol = _yaz(tmp_path / "t.jsonl", _tohum())
    s1 = ice_al.ice_al(con, yol)
    sayilar = [_say(con, t) for t in ("dugum", "kenar", "olgu")]
    s2 = ice_al.ice_al(con, yol)
    assert [_say(con, t) for t in ("dugum", "kenar", "olgu")] == sayilar
    assert s2["dugum_eklendi"] == 0
    assert not s2["hatalar"]
    assert s1["dugum_eklendi"] >= 6


def test_guncelleme_anahtarla(con, tmp_path):
    ice_al.ice_al(con, _yaz(tmp_path / "t.jsonl", _tohum()))
    n = _say(con, "dugum")
    sat = _tohum()
    sat[1]["baslik"] = "AltA-yeni"
    s = ice_al.ice_al(con, _yaz(tmp_path / "t2.jsonl", sat))
    assert _say(con, "dugum") == n
    assert s["dugum_guncellendi"] >= 1
    assert con.execute("SELECT baslik FROM dugum WHERE anahtar='alt-a'").fetchone()[0] == "AltA-yeni"


def test_bilinmeyen_ebeveyn(con, tmp_path):
    sat = [_t("iyi", "Iyi"), _t("yetim", "Yetim", ebeveyn="yok-boyle-biri")]
    s = ice_al.ice_al(con, _yaz(tmp_path / "t.jsonl", sat))
    assert s["hatalar"]
    assert all(isinstance(h, str) for h in s["hatalar"])
    assert db.anahtardan_id(con, "iyi") is not None


def test_dongu(con, tmp_path):
    sat = [_t("iyi", "Iyi"), _t("d1", "D1", ebeveyn="d2"), _t("d2", "D2", ebeveyn="d1")]
    s = ice_al.ice_al(con, _yaz(tmp_path / "t.jsonl", sat))
    assert s["hatalar"]
    assert db.anahtardan_id(con, "iyi") is not None
    d1, d2 = db.anahtardan_id(con, "d1"), db.anahtardan_id(con, "d2")
    if d1 and d2:
        ikisi = con.execute("SELECT COUNT(*) FROM kenar WHERE tur='alt' AND "
                            "((ebeveyn=? AND cocuk=?) OR (ebeveyn=? AND cocuk=?))",
                            (d1, d2, d2, d1)).fetchone()[0]
        assert ikisi < 2


@pytest.mark.parametrize("alan,uzun", [("ozet", "x" * 201), ("ayrinti", "x" * 1501)])
def test_alan_siniri(con, tmp_path, alan, uzun):
    sat = [_t("iyi", "Iyi"), _t("uzun", "Uzun", **{alan: uzun})]
    s = ice_al.ice_al(con, _yaz(tmp_path / "t.jsonl", sat))
    assert s["hatalar"]
    assert db.anahtardan_id(con, "iyi") is not None


def test_olgu_siniri(con, tmp_path):
    sat = [_t("iyi", "Iyi", olgular=["kisa"]), _t("o", "O", olgular=["y" * 301])]
    s = ice_al.ice_al(con, _yaz(tmp_path / "t.jsonl", sat))
    assert s["hatalar"]
    assert db.anahtardan_id(con, "iyi") is not None
    assert con.execute("SELECT COUNT(*) FROM olgu WHERE length(metin)>300").fetchone()[0] == 0


def test_sorunlu_satirlar_atlanir(con, tmp_path):
    sat = [
        _t("iyi-1", "Iyi1"),
        _t("iyi-2", "Iyi2", tur="proje"),
        _t("uzun-b", "B" * 121),
        _t("kotu-durum", "KotuDurum", durum="yok_boyle"),
        _t("kotu-tur", "KotuTur", tur="yok_boyle"),
    ]
    s = ice_al.ice_al(con, _yaz(tmp_path / "t.jsonl", sat))
    h = s["hatalar"]
    assert len(h) >= 3
    assert not any(x.startswith("KRITIK") for x in h)
    for a in ("uzun-b", "kotu-durum", "kotu-tur"):
        assert any(a in x for x in h), a
        assert db.anahtardan_id(con, a) is None
    for a in ("iyi-1", "iyi-2"):
        assert db.anahtardan_id(con, a) is not None
    assert s["atlanan"] >= 3


# ---------------- ice_al ekleri ----------------

def test_gizlilik_gevsemez(con, tmp_path):
    yol = _yaz(tmp_path / "t.jsonl", _tohum())
    ice_al.ice_al(con, yol)
    d = db.anahtardan_id(con, "alt-a")
    db.dugum_guncelle(con, d, gizlilik="sir_icerir")
    con.commit()
    ice_al.ice_al(con, yol)  # tohumda normal
    assert con.execute("SELECT gizlilik FROM dugum WHERE anahtar='alt-a'").fetchone()[0] == "sir_icerir"


def test_gizlilik_yukselir(con, tmp_path):
    ice_al.ice_al(con, _yaz(tmp_path / "t.jsonl", _tohum()))
    sat = _tohum()
    sat[1]["gizlilik"] = "ozel"
    ice_al.ice_al(con, _yaz(tmp_path / "t2.jsonl", sat))
    assert con.execute("SELECT gizlilik FROM dugum WHERE anahtar='alt-a'").fetchone()[0] == "ozel"


def test_tasima_birincil_degisir(con, tmp_path):
    def tohum(bp, ek):
        return [_t("a", "A", tur="proje"), _t("b", "B", tur="proje"),
                _t("x", "X", ebeveyn=bp, ek_ebeveynler=[ek])]

    ice_al.ice_al(con, _yaz(tmp_path / "t1.jsonl", tohum("a", "b")))
    s = ice_al.ice_al(con, _yaz(tmp_path / "t2.jsonl", tohum("b", "a")))
    assert not s["hatalar"]
    a, b, x = (db.anahtardan_id(con, k) for k in ("a", "b", "x"))
    sor = "SELECT birincil FROM kenar WHERE ebeveyn=? AND cocuk=? AND tur='alt'"
    assert con.execute(sor, (b, x)).fetchone()[0]
    assert not con.execute(sor, (a, x)).fetchone()[0]
    assert con.execute("SELECT COUNT(*) FROM kenar WHERE cocuk=? AND tur='alt' AND birincil",
                       (x,)).fetchone()[0] == 1


def test_iz_birikmez(con, tmp_path):
    yol = _yaz(tmp_path / "t.jsonl", _tohum())
    ice_al.ice_al(con, yol)
    k, o = _say(con, "kaynak"), _say(con, "olgu")
    ice_al.ice_al(con, yol)
    assert _say(con, "kaynak") == k
    assert _say(con, "olgu") == o


def test_eskiyen_olgu_yeniden_acilmaz(con, tmp_path):
    yol = _yaz(tmp_path / "t.jsonl", _tohum())
    ice_al.ice_al(con, yol)
    d = db.anahtardan_id(con, "alt-a")
    oid = con.execute("SELECT id FROM olgu WHERE dugum=? AND metin='olgu bir'", (d,)).fetchone()[0]
    db.olgu_eskit(con, oid)
    con.commit()
    toplam = _say(con, "olgu")
    ice_al.ice_al(con, yol)
    assert _say(con, "olgu") == toplam
    assert con.execute("SELECT COUNT(*) FROM olgu WHERE dugum=? AND metin='olgu bir' AND durum='aktif'",
                       (d,)).fetchone()[0] == 0


# ---------------- disa_aktar ----------------

def test_md_basliklar_ve_cok_ebeveyn(dolu):
    con, _ = dolu
    md = disa_aktar.markdown_agac(con)
    for b in ("Kullanıcı", "AltA", "ProjeX", "ProjeY", "KisiK", "OzelD", "SirD"):
        assert b in md
    ek = [l for l in md.splitlines() if "↪" in l]
    assert ek and any("ProjeX" in l for l in ek)
    satirlar = md.splitlines()

    def gir(b):
        return next(len(l) - len(l.lstrip()) for l in satirlar if b in l and "↪" not in l)

    assert gir("AltA") > gir("ProjeX") > gir("Kullanıcı")


def test_md_ozet_gorunur(dolu):
    con, _ = dolu
    assert "ozet AltA" in disa_aktar.markdown_agac(con)


def test_md_ozel_dahil(dolu):
    con, _ = dolu
    assert OZEL in disa_aktar.markdown_agac(con, ozel_dahil=True)
    md = disa_aktar.markdown_agac(con, ozel_dahil=False)
    assert OZEL not in md
    assert "[özel]" in md and "OzelD" in md


@pytest.mark.parametrize("ozel", [True, False])
def test_md_sir_hic_yok(dolu, ozel):
    con, _ = dolu
    md = disa_aktar.markdown_agac(con, ozel_dahil=ozel)
    assert SIR not in md
    assert "[gizli]" in md and "SirD" in md


def test_jsonl_dok(dolu, tmp_path):
    con, _ = dolu
    yol = tmp_path / "dok.jsonl"
    n = disa_aktar.jsonl_dok(con, yol)
    metin = yol.read_text(encoding="utf-8")
    satirlar = [l for l in metin.splitlines() if l.strip()]
    assert n == len(satirlar) and n >= 7
    for l in satirlar:
        assert "tur" in json.loads(l)
    assert SIR not in metin
    assert "SirD" in metin or "sir-d" in metin


def test_jsonl_deterministik(dolu, tmp_path):
    con, _ = dolu
    a, b = tmp_path / "a.jsonl", tmp_path / "b.jsonl"
    disa_aktar.jsonl_dok(con, a)
    disa_aktar.jsonl_dok(con, b)
    assert a.read_bytes() == b.read_bytes()


# ---------------- CLI ----------------

def test_cli_disa_aktar_md(tmp_path):
    yol = tmp_path / "cli.db"
    c = db.baglan(yol)
    ice_al.ice_al(c, _yaz(tmp_path / "t.jsonl", _tohum()))
    c.close()
    env = {**os.environ, "BELLEK_BEYIN_DB": str(yol), "PYTHONIOENCODING": "utf-8"}
    r = subprocess.run([sys.executable, "-m", "bellek.beyin", "disa-aktar", "--bicim", "md"],
                       env=env, capture_output=True, text=True, encoding="utf-8", timeout=60)
    assert r.returncode == 0, r.stderr
    assert "Kullanıcı" in r.stdout
    assert SIR not in r.stdout


# ---------------- kök anahtarı farklı (eski biçimli) tohum ----------------

def _eski_bicim_tohum(yol, ek=()):
    satirlar = [
        _t("eskikok", "Eski Kök", ebeveyn=None, tur="kok", ozet="kök özeti",
           olgular=["kök olgusu"]),
        _t("dal-a", "DalA", ebeveyn="eskikok"),
        _t("alt-b", "AltB", ebeveyn="dal-a", olgular=["alt olgusu"]),
        *ek,
    ]
    yol.write_text("\n".join(json.dumps(s, ensure_ascii=False) for s in satirlar) + "\n",
                   encoding="utf-8")
    return yol


def test_eski_bicim_tohum_bos_veritabanina_tam_aktarilir(con, tmp_path):
    """tur='kok' olan satır, anahtarı ne olursa olsun köktür; çocukları ona bağlanır."""
    s = ice_al.ice_al(con, _eski_bicim_tohum(tmp_path / "t.jsonl"))
    assert not s["hatalar"], s["hatalar"]
    assert s["dugum_eklendi"] == 2 and s["dugum_guncellendi"] == 1 and s["atlanan"] == 0
    assert s["olgu"] == 2
    assert _say(con, "dugum WHERE tur='kok'") == 1
    kok = db.kok_id(con)
    r = con.execute("SELECT baslik, ozet FROM dugum WHERE id=?", (kok,)).fetchone()
    assert tuple(r) == ("Eski Kök", "kök özeti")
    assert con.execute("SELECT metin FROM olgu WHERE dugum=?", (kok,)).fetchone()[0] == "kök olgusu"
    dal = db.anahtardan_id(con, "dal-a")
    assert con.execute("SELECT ebeveyn FROM kenar WHERE cocuk=? AND birincil=1",
                       (dal,)).fetchone()[0] == kok
    alt = db.anahtardan_id(con, "alt-b")
    assert con.execute("SELECT ebeveyn FROM kenar WHERE cocuk=? AND birincil=1",
                       (alt,)).fetchone()[0] == dal


def test_eski_bicim_tohum_mevcut_koke_yazilir(con, tmp_path):
    with con:
        kok = db.kok_id(con)
    s = ice_al.ice_al(con, _eski_bicim_tohum(tmp_path / "t.jsonl"))
    assert not s["hatalar"], s["hatalar"]
    assert _say(con, "dugum WHERE tur='kok'") == 1
    assert con.execute("SELECT baslik FROM dugum WHERE id=?", (kok,)).fetchone()[0] == "Eski Kök"
    assert con.execute("SELECT metin FROM olgu WHERE dugum=?", (kok,)).fetchone()[0] == "kök olgusu"


def test_eski_bicim_tohumda_kok_takma_adi_da_cozulur(con, tmp_path):
    """Kök anahtarı farklıyken çocuk KOK_ANAHTAR ('kok') ile de köke bağlanabilir."""
    s = ice_al.ice_al(con, _eski_bicim_tohum(tmp_path / "t.jsonl",
                                             ek=[_t("dal-c", "DalC", ebeveyn="kok")]))
    assert not s["hatalar"], s["hatalar"]
    dal = db.anahtardan_id(con, "dal-c")
    assert con.execute("SELECT ebeveyn FROM kenar WHERE cocuk=? AND birincil=1",
                       (dal,)).fetchone()[0] == db.kok_id(con)


def test_ikinci_kok_satiri_atlanir(con, tmp_path):
    s = ice_al.ice_al(con, _eski_bicim_tohum(
        tmp_path / "t.jsonl", ek=[_t("baska-kok", "Başka Kök", ebeveyn=None, tur="kok")]))
    assert any("[baska-kok]" in h and "ikinci kok" in h for h in s["hatalar"]), s["hatalar"]
    assert db.anahtardan_id(con, "baska-kok") is None
    assert _say(con, "dugum WHERE tur='kok'") == 1
    assert db.anahtardan_id(con, "alt-b") is not None


def test_gecersiz_eski_bicim_kok_satiri_kritik_ve_hicbir_sey_yazilmaz(con, tmp_path):
    yol = tmp_path / "t.jsonl"
    satirlar = [_t("eskikok", "", ebeveyn=None, tur="kok"), _t("dal-a", "DalA", ebeveyn="eskikok")]
    yol.write_text("\n".join(json.dumps(s, ensure_ascii=False) for s in satirlar) + "\n",
                   encoding="utf-8")
    s = ice_al.ice_al(con, yol)
    assert any(h.startswith("KRITIK") for h in s["hatalar"]), s["hatalar"]
    assert s["dugum_eklendi"] == 0 and s["dugum_guncellendi"] == 0
    assert _say(con, "dugum") == 0


def test_eski_bicim_kok_ebeveyn_tasirsa_kritik(con, tmp_path):
    yol = tmp_path / "t.jsonl"
    satirlar = [_t("dal-a", "DalA", ebeveyn="eskikok"),
                _t("eskikok", "Eski Kök", ebeveyn="dal-a", tur="kok")]
    yol.write_text("\n".join(json.dumps(s, ensure_ascii=False) for s in satirlar) + "\n",
                   encoding="utf-8")
    s = ice_al.ice_al(con, yol)
    assert any(h.startswith("KRITIK") and "[eskikok]" in h for h in s["hatalar"]), s["hatalar"]
    assert _say(con, "dugum") == 0
