"""Servisin otomatik günlük yedeği (servis.OtomatikYedekleyici).

Sözleşme: zamanı gelince yedek alınır, gelmediyse alınmaz; yedek hatası servisi ve yedek iş
parçacığını düşürmez, günlüğe yazılır ve bir süre yeniden denenmez; süren bir yedek okuma ve
yazmaları bekletmez. Saat sahte (gerçek zaman + kaydırma); testler beklemez.
"""
from __future__ import annotations

import json
import os
import threading
import time
import urllib.request
from pathlib import Path

import pytest

from bellek.beyin import db, servis, yedek

SAAT = 3600.0


class Saat:
    def __init__(self) -> None:
        self.kayma = 0.0

    def __call__(self) -> float:
        return time.time() + self.kayma


@pytest.fixture()
def ortam(tmp_path, monkeypatch):
    db_yol = tmp_path / "beyin.db"
    db.baglan(db_yol).close()
    log = tmp_path / "servis.log"
    monkeypatch.setenv("BELLEK_BEYIN_DB", str(db_yol))
    monkeypatch.setenv("BELLEK_BEYIN_KUYRUK", str(tmp_path / "kuyruk.jsonl"))
    monkeypatch.setenv("BELLEK_BEYIN_LOG", str(log))
    monkeypatch.setenv("BELLEK_BEYIN_TOKEN_DOSYA", str(tmp_path / "token"))
    monkeypatch.setenv("BELLEK_BEYIN_ARAYUZ_TOKEN_DOSYA", str(tmp_path / "arayuz_token"))
    monkeypatch.delenv("BELLEK_BEYIN_IZINLI_HOST", raising=False)
    return db_yol, tmp_path / yedek.YEDEK_DIZIN_ADI, log


def _yedekleyici(db_yol, dizin, saat, **kw):
    return servis.OtomatikYedekleyici(db_yol, dizin, threading.Event(), saat=saat, **kw)


def _bekle(kosul, sure: float = 10.0) -> bool:
    son = time.monotonic() + sure
    while time.monotonic() < son:
        if kosul():
            return True
        time.sleep(0.02)
    return kosul()


def _saglik(port: int) -> dict:
    acici = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with acici.open(f"http://127.0.0.1:{port}/api/saglik", timeout=5) as y:
        return json.loads(y.read())


# ---------------------------------------------------------------- denetim kararı


def test_zamani_gelince_alinir_gelmediyse_alinmaz(ortam):
    db_yol, dizin, _ = ortam
    saat = Saat()
    y = _yedekleyici(db_yol, dizin, saat)
    ilk = y.denetle()
    assert ilk is not None and ilk.exists()
    assert y.denetle() is None  # hemen ardından: zamanı gelmedi
    saat.kayma = yedek.OTOMATIK_ARALIK - 60
    assert y.denetle() is None
    assert len(yedek.yedekleri_listele(dizin)) == 1
    saat.kayma = yedek.OTOMATIK_ARALIK + 60
    ikinci = y.denetle()
    assert ikinci is not None and ikinci != ilk
    assert len(yedek.yedekleri_listele(dizin)) == 2
    assert yedek.otomatik_durumu_oku(dizin)["sonuc"] == "basarili"


def test_yeniden_baslayan_servis_taze_yedegi_tekrarlamaz(ortam):
    db_yol, dizin, _ = ortam
    yedek.yedekle(db_yol, dizin)  # önceki servis (ya da elle) alınmış taze yedek
    assert _yedekleyici(db_yol, dizin, Saat()).denetle() is None
    assert len(yedek.yedekleri_listele(dizin)) == 1


def test_kapali_kalan_makinede_kacan_yedek_ilk_denetimde_alinir(ortam):
    db_yol, dizin, _ = ortam
    eski = yedek.yedekle(db_yol, dizin)
    t = time.time() - 3 * 24 * SAAT
    os.utime(eski, (t, t))
    assert _yedekleyici(db_yol, dizin, Saat()).denetle() is not None


def test_bellek_ici_sinir_dosyalar_silinse_de_sik_yedegi_engeller(ortam):
    db_yol, dizin, _ = ortam
    saat = Saat()
    y = _yedekleyici(db_yol, dizin, saat)
    assert y.denetle() is not None
    for p in yedek.yedekleri_listele(dizin):
        p.unlink()
    saat.kayma = SAAT
    assert y.denetle() is None  # OTOMATIK_ARALIK dolmadan ikinci otomatik yedek yok
    saat.kayma = -10 * SAAT  # saat geri alındı: bekleme sayılmaz
    assert y.denetle() is not None


def test_durdurulmussa_yedek_alinmaz(ortam):
    db_yol, dizin, _ = ortam
    y = _yedekleyici(db_yol, dizin, Saat())
    y.durdur.set()
    assert y.denetle() is None
    assert yedek.yedekleri_listele(dizin) == []


# ---------------------------------------------------------------- hata


def test_hata_firlamaz_gunluge_yazilir_bir_sure_denenmez(ortam, monkeypatch):
    db_yol, dizin, log = ortam
    gercek = yedek.yedekle
    cagri = []

    def patla(*a, **kw):
        cagri.append(1)
        raise yedek.YedekHatasi("Yedek alınamadı (diskte yer kalmadı); yarım kopya silindi.")

    monkeypatch.setattr(yedek, "yedekle", patla)
    saat = Saat()
    y = _yedekleyici(db_yol, dizin, saat, hata_bekleme=SAAT)
    assert y.denetle() is None
    assert len(cagri) == 1
    assert "UYARI: otomatik yedek alınamadı" in log.read_text(encoding="utf-8")
    assert "diskte yer kalmadı" in log.read_text(encoding="utf-8")
    saat.kayma = SAAT / 2
    assert y.denetle() is None and len(cagri) == 1  # bekleme süresi dolmadı
    monkeypatch.setattr(yedek, "yedekle", gercek)
    saat.kayma = SAAT + 1
    assert y.denetle() is not None


def test_beklenmeyen_hata_icerik_tasimadan_gunluge_yazilir(ortam, monkeypatch):
    db_yol, dizin, log = ortam

    def patla(*a, **kw):
        raise ValueError("gizli-icerik-parcasi")

    monkeypatch.setattr(yedek, "yedekle", patla)
    assert _yedekleyici(db_yol, dizin, Saat()).denetle() is None
    metin = log.read_text(encoding="utf-8")
    assert "ValueError" in metin and "gizli-icerik-parcasi" not in metin


def test_dongu_hatadan_sonra_ayakta_kalir(ortam, monkeypatch):
    db_yol, dizin, log = ortam
    gercek = yedek.otomatik_yedek_gerekli
    sayac = {"n": 0}

    def bazen_patla(*a, **kw):
        sayac["n"] += 1
        if sayac["n"] <= 2:
            raise PermissionError("taranamadı")
        return gercek(*a, **kw)

    monkeypatch.setattr(yedek, "otomatik_yedek_gerekli", bazen_patla)
    y = _yedekleyici(db_yol, dizin, Saat(), ilk_gecikme=0, aralik=0.02)
    y.baslat()
    try:
        assert _bekle(lambda: len(yedek.yedekleri_listele(dizin)) == 1)
        assert y.is_parcacigi.is_alive()
    finally:
        y.durdur.set()
        y.bekle(5)
    assert not y.is_parcacigi.is_alive()
    assert "otomatik yedek denetimi hatası: PermissionError" in log.read_text(encoding="utf-8")


def test_ilk_gecikme_dolmadan_durdurulursa_hic_denetlemez(ortam):
    db_yol, dizin, _ = ortam
    y = _yedekleyici(db_yol, dizin, Saat(), ilk_gecikme=30)
    y.baslat()
    y.durdur.set()
    y.bekle(5)
    assert not y.is_parcacigi.is_alive()
    assert not dizin.exists()


# ---------------------------------------------------------------- servis içinde


@pytest.fixture()
def sunucu_ac(ortam, monkeypatch):
    acilan = []

    def ac(ilk_gecikme: float = 0.0):
        monkeypatch.setattr(servis, "YEDEK_ILK_GECIKME", ilk_gecikme)
        s, durum = servis.sunucu_olustur("127.0.0.1", 0)
        is_ = threading.Thread(target=s.serve_forever, daemon=True)
        is_.start()
        acilan.append((s, is_))
        return s, durum

    yield ac
    for s, is_ in acilan:
        s.shutdown()
        s.kapat()
        is_.join(timeout=5)


def test_servis_acilinca_otomatik_yedek_alir(ortam, sunucu_ac):
    db_yol, dizin, log = ortam
    s, _ = sunucu_ac()
    assert s.yedekleyici.dizin == dizin and s.yedekleyici.db_yol == db_yol
    assert _bekle(lambda: len(yedek.yedekleri_listele(dizin)) == 1)
    yedek.dogrula(yedek.yedekleri_listele(dizin)[0])
    assert _saglik(s.server_address[1])["durum"] == "ok"
    assert _bekle(lambda: "otomatik yedek alındı" in log.read_text(encoding="utf-8"))


def test_varsayilan_ilk_gecikme_testlerde_yedek_almaz(ortam, sunucu_ac):
    _, dizin, _ = ortam
    s, _ = sunucu_ac(ilk_gecikme=servis.YEDEK_ILK_GECIKME)
    assert servis.YEDEK_ILK_GECIKME >= 30
    assert s.yedekleyici.is_parcacigi.is_alive()
    assert yedek.yedekleri_listele(dizin) == []


def test_suren_yedek_okuma_ve_yazmalari_bekletmez(ortam, sunucu_ac, monkeypatch):
    _, dizin, _ = ortam
    basladi, birak = threading.Event(), threading.Event()
    gercek = yedek.yedekle

    def yavas(*a, **kw):
        basladi.set()
        assert birak.wait(20)
        return gercek(*a, **kw)

    monkeypatch.setattr(yedek, "yedekle", yavas)
    s, durum = sunucu_ac()
    try:
        assert basladi.wait(10)
        t0 = time.monotonic()
        assert _saglik(s.server_address[1])["durum"] == "ok"
        sonuc = durum.yaz_cagir(lambda con: con.execute("SELECT count(*) FROM dugum").fetchone()[0])
        assert sonuc >= 1
        assert time.monotonic() - t0 < 5
    finally:
        birak.set()
    assert _bekle(lambda: len(yedek.yedekleri_listele(dizin)) == 1)


def test_yedek_hatasi_servisi_dusurmez(ortam, sunucu_ac, monkeypatch):
    _, dizin, log = ortam

    def patla(*a, **kw):
        raise OSError(28, "No space left on device")

    monkeypatch.setattr(yedek, "yedekle", patla)
    s, durum = sunucu_ac()
    assert _bekle(lambda: log.exists() and "otomatik yedek alınamadı" in log.read_text(encoding="utf-8"))
    assert _saglik(s.server_address[1])["durum"] == "ok"
    assert durum.yaz_cagir(lambda con: 1) == 1
    assert s.yedekleyici.son_hata is not None
    assert yedek.otomatik_durumu_oku(dizin) is None or yedek.otomatik_durumu_oku(dizin)["sonuc"] == "hata"


def test_kapanis_suren_yedegi_bekler(ortam, monkeypatch):
    _, dizin, _ = ortam
    basladi = threading.Event()
    gercek = yedek.yedekle

    def yavas(*a, **kw):
        basladi.set()
        time.sleep(0.3)
        return gercek(*a, **kw)

    monkeypatch.setattr(yedek, "yedekle", yavas)
    monkeypatch.setattr(servis, "YEDEK_ILK_GECIKME", 0.0)
    s, _ = servis.sunucu_olustur("127.0.0.1", 0)
    assert basladi.wait(10)
    s.kapat()
    assert not s.yedekleyici.is_parcacigi.is_alive()
    assert len(yedek.yedekleri_listele(dizin)) == 1
    # Kilit bırakıldı: aynı klasörde yeni servis açılabilir.
    assert yedek.servis_calisiyor_mu(Path(s.yedekleyici.db_yol)) is False
