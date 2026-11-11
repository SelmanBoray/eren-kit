"""CLI testleri: yedekle / yedekler / geri-yukle komutları ve ice-al --uzerine-yaz bayrağı.

Zaman farkı kararı (yedekleme testleri): `yedek.yedekle`'ye CLI'dan `simdi` verilemez ve 1.1 sn
beklemek testleri yavaşlatır; bu yüzden beklemeyiz. Aynı saniyedeki yedekler `-2`, `-3` ... ekiyle
ayrı ad alır (yedek.py sözleşmesi), yani iki çağrı saniye sınırına denk gelse de gelmese de
ayrı dosya üretir.
"""

import gc
import hashlib
import io
import json
from pathlib import Path

import pytest

from bellek.beyin import db, yaz, yedek
from bellek.beyin.__main__ import main


# ---------------------------------------------------------------- yardımcılar

def _t(anahtar, baslik, ebeveyn="kok", tur="dal", **kw):
    d = {
        "anahtar": anahtar, "baslik": baslik, "ozet": f"ozet {baslik}", "ayrinti": "",
        "tur": tur, "durum": "aktif", "gizlilik": "normal", "tarih": "2026-01-01",
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


def _ozet_sha(yol: Path) -> str:
    return hashlib.sha256(Path(yol).read_bytes()).hexdigest()


def _ozet(db_yol, anahtar):
    """Salt okunur bağlantıyla düğümün özeti (yoksa None); bağlantı kapatılır."""
    con = db.baglan(db_yol, salt_okunur=True)
    try:
        r = con.execute("SELECT ozet FROM dugum WHERE anahtar=?", (anahtar,)).fetchone()
        return None if r is None else r[0]
    finally:
        con.close()


def _ice_al(*argv):
    """`ice-al` çağırır. __main__ içe alımda bağlantıyı kapatmaz (döngüsel başvuru, GC'ye kalır:
    WAL checkpoint'i gecikir, dosya özeti sonradan değişir); testin deterministik olması için
    çağrıdan hemen sonra çöp toplama yapılır."""
    rc = main(["ice-al", *argv])
    gc.collect()
    return rc


@pytest.fixture
def ortam(tmp_path, monkeypatch):
    """İçe alınmış bir veritabanı; (db_yol, yedek_dizini, tohum_yolu) döner."""
    db_yol = tmp_path / "b.db"
    monkeypatch.setenv("BELLEK_BEYIN_DB", str(db_yol))
    tohum = _yaz(tmp_path / "t1.jsonl", [_t("proje-a", "ProjeA", tur="proje")])
    assert _ice_al(str(tohum)) == 0
    return db_yol, tmp_path / "yedek", tohum


def _yedekle(dizin, *ek, capsys):
    capsys.readouterr()
    rc = main(["yedekle", "--dizin", str(dizin), *ek])
    return rc, capsys.readouterr()


def _yol_cikar(stdout: str) -> Path:
    satir = stdout.strip().splitlines()[0]
    assert satir.startswith("Yedek alındı: ")
    govde = satir[len("Yedek alındı: "):]
    return Path(govde[:govde.rindex(" (")])


# ---------------------------------------------------------------- yedekle

def test_yedekle_tek(ortam, capsys):
    _, dizin, _ = ortam
    rc, c = _yedekle(dizin, capsys=capsys)
    assert rc == 0
    assert c.out.startswith("Yedek alındı: ")
    assert "(1 yedek saklanıyor)" in c.out
    yol = _yol_cikar(c.out)
    assert yol.is_file()
    assert dizin.resolve() in yol.resolve().parents


def test_yedekle_iki_kez(ortam, capsys):
    _, dizin, _ = ortam
    _yedekle(dizin, capsys=capsys)
    rc, c = _yedekle(dizin, capsys=capsys)
    assert rc == 0
    assert "(2 yedek saklanıyor)" in c.out


def test_yedekle_sakla_1_uc_kez(ortam, capsys):
    _, dizin, _ = ortam
    for _ in range(3):
        rc, c = _yedekle(dizin, "--sakla", "1", capsys=capsys)
        assert rc == 0
    assert "(1 yedek saklanıyor)" in c.out
    assert len(yedek.yedekleri_listele(dizin)) == 1
    assert _yol_cikar(c.out).is_file()


def test_yedekle_sakla_sifir(ortam, capsys):
    _, dizin, _ = ortam
    rc, c = _yedekle(dizin, "--sakla", "0", capsys=capsys)
    assert rc == 2
    assert "Hata: --sakla en az 1 olmalı" in c.err
    assert yedek.yedekleri_listele(dizin) == []


def test_yedekle_kaynak_yok(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("BELLEK_BEYIN_DB", str(tmp_path / "yok.db"))
    rc = main(["yedekle", "--dizin", str(tmp_path / "yedek")])
    c = capsys.readouterr()
    assert rc == 1
    assert any(s.startswith("Hata: ") for s in c.err.splitlines())
    assert "Traceback" not in c.err
    assert not (tmp_path / "yok.db").exists()


# ---------------------------------------------------------------- yedekler

def test_yedekler_bos_ve_yok_dizin(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("BELLEK_BEYIN_DB", str(tmp_path / "b.db"))
    bos = tmp_path / "bos"
    bos.mkdir()
    for d in (bos, tmp_path / "hic-yok"):
        assert main(["yedekler", "--dizin", str(d)]) == 0
        assert capsys.readouterr().out.splitlines() == ["Yedek yok."]


def test_yedekler_iki_yedek(ortam, capsys):
    _, dizin, _ = ortam
    _yedekle(dizin, capsys=capsys)
    _yedekle(dizin, capsys=capsys)
    assert main(["yedekler", "--dizin", str(dizin)]) == 0
    satirlar = capsys.readouterr().out.splitlines()
    assert len(satirlar) == 2
    assert all(Path(s).is_file() for s in satirlar)
    assert Path(satirlar[0]) == yedek.yedekleri_listele(dizin)[0]


# ---------------------------------------------------------------- geri-yukle

def test_geri_yukle_evet_gidis_donus(ortam, tmp_path, capsys):
    db_yol, dizin, _ = ortam
    _, c = _yedekle(dizin, capsys=capsys)
    yol = _yol_cikar(c.out)
    t2 = _yaz(tmp_path / "t2.jsonl", [_t("yeni-n", "YeniN")])
    assert _ice_al(str(t2)) == 0
    assert _ozet(db_yol, "yeni-n") is not None
    capsys.readouterr()

    rc = main(["geri-yukle", str(yol), "--evet"])
    c = capsys.readouterr()
    assert rc == 0
    onek = "Geri yüklendi. Eski veritabanı kenarda: "
    assert onek in c.out
    eski = Path(c.out.split(onek, 1)[1].strip().splitlines()[0])
    assert eski.is_file()
    assert _ozet(db_yol, "yeni-n") is None
    assert _ozet(db_yol, "proje-a") is not None


def _onaysiz(ortam, capsys, monkeypatch, girdi):
    db_yol, dizin, _ = ortam
    _, c = _yedekle(dizin, capsys=capsys)
    yol = _yol_cikar(c.out)
    once = _ozet_sha(db_yol)
    monkeypatch.setattr("sys.stdin", io.StringIO(girdi))
    rc = main(["geri-yukle", str(yol)])
    return rc, capsys.readouterr(), once, db_yol


@pytest.mark.parametrize("girdi", ["", "h\n"])
def test_geri_yukle_onaysiz_vazgecilir(ortam, capsys, monkeypatch, girdi):
    rc, c, once, db_yol = _onaysiz(ortam, capsys, monkeypatch, girdi)
    assert rc == 1
    assert "Devam edilsin mi?" in c.err
    assert "Vazgeçildi." in c.err
    assert _ozet_sha(db_yol) == once


@pytest.mark.parametrize("girdi", ["e\n", "EVET\n"])
def test_geri_yukle_onayli(ortam, capsys, monkeypatch, girdi):
    rc, c, _, _ = _onaysiz(ortam, capsys, monkeypatch, girdi)
    assert rc == 0
    assert "Geri yüklendi." in c.out


def test_geri_yukle_bozuk_yedek(ortam, tmp_path, capsys):
    db_yol, _, _ = ortam
    bozuk = tmp_path / "bozuk.db"
    bozuk.write_bytes(bytes(range(256)) * 40)
    once = _ozet_sha(db_yol)
    rc = main(["geri-yukle", str(bozuk), "--evet"])
    c = capsys.readouterr()
    assert rc == 1
    assert "Hata: " in c.err
    assert "Traceback" not in c.err
    assert _ozet_sha(db_yol) == once


def test_geri_yukle_yedek_yok(ortam, tmp_path, capsys):
    rc = main(["geri-yukle", str(tmp_path / "yok.db"), "--evet"])
    assert rc == 1
    assert "Hata: " in capsys.readouterr().err


# ---------------------------------------------------------------- ice-al korunan

def _korunan_kur(tmp_path, ilk_ozet="ilk özet"):
    v1 = _yaz(tmp_path / "v1.jsonl", [_t("proje-a", "ProjeA", tur="proje", ozet=ilk_ozet)])
    v2 = _yaz(tmp_path / "v2.jsonl", [_t("proje-a", "ProjeA", tur="proje", ozet="tohum v2 özet")])
    return v1, v2


def _duzelt(db_yol, anahtar, ozet):
    con = db.baglan(db_yol)
    try:
        r = yaz.duzelt(con, db.anahtardan_id(con, anahtar), ozet=ozet)
        assert r["sonuc"] == "guncellendi", r
    finally:
        con.close()


KORUNAN_SATIRI = "Korunan (tohum dışı düzeltilmiş) düğüm: 1; ezmek için --uzerine-yaz"


def test_ice_al_korunan_satiri(tmp_path, monkeypatch, capsys):
    db_yol = tmp_path / "b.db"
    monkeypatch.setenv("BELLEK_BEYIN_DB", str(db_yol))
    v1, v2 = _korunan_kur(tmp_path)
    assert _ice_al(str(v1)) == 0
    _duzelt(db_yol, "proje-a", "kullanıcının düzelttiği özet")
    capsys.readouterr()
    assert _ice_al(str(v2)) == 0
    out = capsys.readouterr().out
    assert out.rstrip("\n").splitlines()[-1] == KORUNAN_SATIRI
    assert _ozet(db_yol, "proje-a") == "kullanıcının düzelttiği özet"


def test_ice_al_uzerine_yaz(tmp_path, monkeypatch, capsys):
    db_yol = tmp_path / "b.db"
    monkeypatch.setenv("BELLEK_BEYIN_DB", str(db_yol))
    v1, v2 = _korunan_kur(tmp_path)
    assert _ice_al(str(v1)) == 0
    _duzelt(db_yol, "proje-a", "kullanıcının düzelttiği özet")
    capsys.readouterr()
    assert _ice_al(str(v2), "--uzerine-yaz") == 0
    out = capsys.readouterr().out
    assert not any(s.startswith("Korunan") for s in out.splitlines())
    assert _ozet(db_yol, "proje-a") == "tohum v2 özet"


def test_ice_al_korunan_yokken_satir_yok(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("BELLEK_BEYIN_DB", str(tmp_path / "b.db"))
    v1, _ = _korunan_kur(tmp_path)
    assert _ice_al(str(v1)) == 0
    out = capsys.readouterr().out
    assert not any(s.startswith("Korunan") for s in out.splitlines())


# ---------------------------------------------------------------- mevcut komut

def test_gez_bozulmadi(ortam, capsys):
    capsys.readouterr()
    assert main(["gez"]) == 0
