"""Otomatik yedek kararı, durum kaydı ve `yedek-durum` denetimi (yedek.py, CLI).

Zaman kararı: yedeğin "yaşı" dosyanın değişiklik zamanından ölçülür (duvar saati). Testler
beklemez; `os.utime` ile yedeğin zamanını geriye alır ve `simdi` verir.
"""
from __future__ import annotations

import json
import os
import time
from pathlib import Path

import pytest

from bellek.beyin import db, yedek
from bellek.beyin.__main__ import main

SAAT = 3600.0


@pytest.fixture()
def kur(tmp_path):
    db_yol = tmp_path / "beyin.db"
    db.baglan(db_yol).close()
    return db_yol, tmp_path / "yedekler"


def _yaslandir(yol: Path, saniye: float) -> None:
    t = time.time() - saniye
    os.utime(yol, (t, t))


# ---------------------------------------------------------------- karar


def test_hic_yedek_yoksa_gerekli(kur):
    _, dizin = kur
    assert yedek.otomatik_yedek_gerekli(dizin) is True  # dizin yok
    dizin.mkdir()
    assert yedek.otomatik_yedek_gerekli(dizin) is True  # dizin boş


def test_yeni_yedek_varken_gerekli_degil_eskiyince_gerekli(kur):
    db_yol, dizin = kur
    y = yedek.yedekle(db_yol, dizin)
    assert yedek.otomatik_yedek_gerekli(dizin) is False
    _yaslandir(y, yedek.OTOMATIK_ARALIK - 60)
    assert yedek.otomatik_yedek_gerekli(dizin) is False
    _yaslandir(y, yedek.OTOMATIK_ARALIK + 1)
    assert yedek.otomatik_yedek_gerekli(dizin) is True


def test_makine_kapali_kalinca_kacan_yedek_gerekli(kur):
    """Duvar saati: makine günlerce kapalı/uykuda kaldıysa ilk denetimde yedek gerekir."""
    db_yol, dizin = kur
    y = yedek.yedekle(db_yol, dizin)
    _yaslandir(y, 3 * 24 * SAAT)
    assert yedek.otomatik_yedek_gerekli(dizin) is True


def test_en_yeni_yedek_sayilir_bos_yer_tutucu_sayilmaz(kur):
    db_yol, dizin = kur
    eski = yedek.yedekle(db_yol, dizin)
    _yaslandir(eski, 30 * SAAT)
    (dizin / "beyin-29990101-000000.db").write_bytes(b"")  # 0 bayt: yedek değil
    assert yedek.otomatik_yedek_gerekli(dizin) is True
    yedek.yedekle(db_yol, dizin)  # elle alınan yedek de sayılır
    assert yedek.otomatik_yedek_gerekli(dizin) is False


def test_gelecekte_gorunen_yedek_sayilmaz(kur):
    db_yol, dizin = kur
    y = yedek.yedekle(db_yol, dizin)
    t = time.time() + 5 * 24 * SAAT
    os.utime(y, (t, t))
    assert yedek.otomatik_yedek_gerekli(dizin) is True


def test_durum_dosyasi_yedek_sayilmaz(kur, capsys):
    db_yol, dizin = kur
    dizin.mkdir()
    yedek._durum_yaz(dizin, {"surum": 1, "zaman": time.time(), "sonuc": "hata", "hata": "x"})
    assert yedek.yedekleri_listele(dizin) == []
    assert main(["yedekler", "--dizin", str(dizin)]) == 0
    assert "Yedek yok." in capsys.readouterr().out


# ---------------------------------------------------------------- otomatik_yedekle


def test_otomatik_yedekle_basarida_durum_kaydi(kur):
    db_yol, dizin = kur
    yeni = yedek.otomatik_yedekle(db_yol, dizin, simdi=1234.5)
    yedek.dogrula(yeni)
    kayit = yedek.otomatik_durumu_oku(dizin)
    assert kayit == {"surum": 1, "zaman": 1234.5, "sonuc": "basarili", "yedek": yeni.name}


def test_otomatik_yedekle_saklama_kuralini_korur(kur, monkeypatch):
    db_yol, dizin = kur
    for _ in range(16):
        yedek.otomatik_yedekle(db_yol, dizin)
    assert len(yedek.yedekleri_listele(dizin)) == 14


def test_otomatik_yedekle_yedek_hatasini_kaydeder(tmp_path):
    dizin = tmp_path / "yedekler"
    with pytest.raises(yedek.YedekHatasi, match="bulunamadı"):
        yedek.otomatik_yedekle(tmp_path / "yok.db", dizin, simdi=99.0)
    # Dizin hiç oluşmadıysa kayıt yazılamaz; bu da yedeği/hatayı değiştirmez.
    dizin.mkdir()
    with pytest.raises(yedek.YedekHatasi):
        yedek.otomatik_yedekle(tmp_path / "yok.db", dizin, simdi=100.0)
    kayit = yedek.otomatik_durumu_oku(dizin)
    assert kayit["sonuc"] == "hata" and kayit["zaman"] == 100.0
    assert "bulunamadı" in kayit["hata"]


def test_beklenmeyen_hata_yedek_hatasina_doner_icerik_tasimaz(kur, monkeypatch):
    db_yol, dizin = kur
    dizin.mkdir()

    def patla(*a, **kw):
        raise RuntimeError("gizli-icerik-parcasi")

    monkeypatch.setattr(yedek, "yedekle", patla)
    with pytest.raises(yedek.YedekHatasi) as e:
        yedek.otomatik_yedekle(db_yol, dizin)
    assert "RuntimeError" in str(e.value) and "gizli-icerik-parcasi" not in str(e.value)
    ham = (dizin / yedek.DURUM_DOSYASI).read_text(encoding="utf-8")
    assert "gizli-icerik-parcasi" not in ham and "RuntimeError" in ham


def test_bozuk_durum_dosyasi_yok_sayilir(kur):
    _, dizin = kur
    dizin.mkdir()
    (dizin / yedek.DURUM_DOSYASI).write_text("{bozuk", encoding="utf-8")
    assert yedek.otomatik_durumu_oku(dizin) is None
    (dizin / yedek.DURUM_DOSYASI).write_text('["liste"]', encoding="utf-8")
    assert yedek.otomatik_durumu_oku(dizin) is None


# ---------------------------------------------------------------- yedek_durumu


def test_durum_veritabani_yoksa_ok(tmp_path):
    d = yedek.yedek_durumu(tmp_path / "yok.db", tmp_path / "yedekler")
    assert d["durum"] == "ok" and "henüz yok" in d["mesaj"]


def test_durum_hic_yedek_yoksa_uyari(kur):
    db_yol, dizin = kur
    d = yedek.yedek_durumu(db_yol, dizin)
    assert d["durum"] == "uyari" and d["sayi"] == 0
    assert "Hiç beyin yedeği yok" in d["mesaj"] and "yedekle" in d["mesaj"]


def test_durum_taze_yedek_ok(kur):
    db_yol, dizin = kur
    y = yedek.yedekle(db_yol, dizin)
    _yaslandir(y, 5 * SAAT + 60)
    d = yedek.yedek_durumu(db_yol, dizin)
    assert d["durum"] == "ok", d
    assert d["son_yedek"] == str(y) and d["sayi"] == 1
    assert "5 saat önce" in d["mesaj"] and y.name in d["mesaj"]


def test_durum_eski_yedek_uyari(kur):
    db_yol, dizin = kur
    y = yedek.yedekle(db_yol, dizin)
    _yaslandir(y, 4 * 24 * SAAT)
    d = yedek.yedek_durumu(db_yol, dizin)
    assert d["durum"] == "uyari"
    assert "4 gün önce" in d["mesaj"] and "servis" in d["mesaj"]


def test_durum_son_deneme_basarisizsa_uyari(kur):
    db_yol, dizin = kur
    y = yedek.yedekle(db_yol, dizin)
    _yaslandir(y, 2 * SAAT)
    yedek._durum_yaz(dizin, {"surum": 1, "zaman": time.time() - 60, "sonuc": "hata",
                             "hata": "Yedek alınamadı (diskte yer kalmadı); yarım kopya silindi."})
    d = yedek.yedek_durumu(db_yol, dizin)
    assert d["durum"] == "uyari"
    assert "başarısız" in d["mesaj"] and "diskte yer kalmadı" in d["mesaj"]
    assert "Son başarılı yedek 2 saat önce" in d["mesaj"]
    assert ".." not in d["mesaj"]


def test_durum_eski_hata_sonraki_yedekle_kapanir(kur):
    db_yol, dizin = kur
    dizin.mkdir()
    yedek._durum_yaz(dizin, {"surum": 1, "zaman": time.time() - 3 * SAAT, "sonuc": "hata", "hata": "x"})
    yedek.yedekle(db_yol, dizin)  # sonra elle alınan yedek
    assert yedek.yedek_durumu(db_yol, dizin)["durum"] == "ok"


def test_durum_hic_yedek_yok_ve_hata_birlikte(kur):
    db_yol, dizin = kur
    dizin.mkdir()
    yedek._durum_yaz(dizin, {"surum": 1, "zaman": time.time(), "sonuc": "hata", "hata": "erişim reddedildi"})
    d = yedek.yedek_durumu(db_yol, dizin)
    assert d["durum"] == "uyari" and "Hiç" in d["mesaj"] and "erişim reddedildi" in d["mesaj"]


def test_durum_gelecekteki_yedek_uyari(kur):
    db_yol, dizin = kur
    y = yedek.yedekle(db_yol, dizin)
    t = time.time() + 3 * 24 * SAAT
    os.utime(y, (t, t))
    d = yedek.yedek_durumu(db_yol, dizin)
    assert d["durum"] == "uyari" and "saati" in d["mesaj"]


# ---------------------------------------------------------------- CLI yedek-durum


def test_cli_yedek_durum_json_ve_cikis_kodu(kur, monkeypatch, capsys):
    db_yol, dizin = kur
    monkeypatch.setenv("BELLEK_BEYIN_DB", str(db_yol))
    assert main(["yedek-durum", "--dizin", str(dizin), "--json"]) == 1
    d = json.loads(capsys.readouterr().out)
    assert d["durum"] == "uyari" and d["sayi"] == 0
    assert not dizin.exists()  # salt okunur: dizin oluşturulmaz

    yedek.yedekle(db_yol, dizin)
    assert main(["yedek-durum", "--dizin", str(dizin)]) == 0
    assert "Son beyin yedeği" in capsys.readouterr().out


def test_cli_yedek_durum_varsayilan_dizin(kur, monkeypatch, capsys):
    db_yol, _ = kur
    monkeypatch.setenv("BELLEK_BEYIN_DB", str(db_yol))
    yedek.yedekle(db_yol, yedek.varsayilan_yedek_dizini())
    assert main(["yedek-durum", "--json"]) == 0
    d = json.loads(capsys.readouterr().out)
    assert Path(d["dizin"]) == db_yol.resolve().parent / yedek.YEDEK_DIZIN_ADI
