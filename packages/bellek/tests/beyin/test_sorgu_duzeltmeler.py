"""sorgu.py regresyon testleri: sır başlığı katlaması, köksüz veritabanında gez, olgu tarihi."""
import json
from datetime import datetime, timezone

import pytest

from bellek.beyin import db, sorgu

GIZLI_OZET = "cok-gizli-icerik-789"


def tum(d):
    return json.dumps(d, ensure_ascii=False, default=str)


@pytest.fixture
def con(tmp_path):
    c = db.baglan(tmp_path / "b.db")
    yield c
    c.close()


@pytest.fixture
def sir_con(con):
    """Kökü ve sır işaretli 'Şifre kasası' düğümü olan veritabanı."""
    with con:
        kok = db.kok_id(con)
        sid = db.dugum_ekle(
            con, "Şifre kasası", ozet=GIZLI_OZET, gizlilik="sir_icerir", ebeveyn=kok
        )
    return con, sid


def _bul(sonuc, sid):
    return [i for i, x in enumerate(sonuc["sonuclar"]) if x["id"] == sid]


# ---------- 1-2: sır başlığı katlaması ----------

def test_sir_basligi_katlamasi_ayni_sonucu_verir(sir_con):
    con, sid = sir_con
    r1 = sorgu.ara(con, "Şifre kasası")
    r2 = sorgu.ara(con, "sifre kasasi")
    assert _bul(r1, sid), f"tam yazımla düğüm bulunmalı: {tum(r1)}"
    assert _bul(r2, sid) == _bul(r1, sid), f"katlanmış sorgu aynı yerde bulmalı: {tum(r2)}"


def test_sir_ozeti_sonuclarda_sizmaz(sir_con):
    con, sid = sir_con
    for sorgu_metni in ("Şifre kasası", "sifre kasasi"):
        assert GIZLI_OZET not in tum(sorgu.ara(con, sorgu_metni))


# ---------- 3-4: köksüz veritabanında gez ----------

def _koksuz(tmp_path):
    yol = tmp_path / "koksuz.db"
    c = db.baglan(yol)  # yalnız şema kurar, kök oluşturmaz
    assert db.kok_bul(c) is None
    return yol, c


def _satir_sayisi(c):
    return c.execute("SELECT COUNT(*) FROM dugum").fetchone()[0]


def test_gez_koksuz_yazilabilir_baglanti_kok_olusturmaz(tmp_path):
    yol, c = _koksuz(tmp_path)
    try:
        once = _satir_sayisi(c)
        sorgu.gez(c)  # istisna fırlatmamalı
        assert not c.in_transaction, "gez açık işlem bırakmamalı"
        assert _satir_sayisi(c) == once, "gez kök düğüm oluşturmamalı"
        assert db.kok_bul(c) is None
    finally:
        c.close()


def test_gez_koksuz_salt_okunur_baglanti_yazma_denemez(tmp_path):
    yol, c = _koksuz(tmp_path)
    c.close()
    ro = db.baglan(yol, salt_okunur=True)
    try:
        r = sorgu.gez(ro)  # istisna fırlatmamalı
        assert isinstance(r, dict)
        hata = str(r.get("hata", ""))
        # gez yazmayı denememeli: salt okunur yazma hatası sızmamalı
        assert "OperationalError" not in hata and "readonly" not in hata.lower(), hata
    finally:
        ro.close()


# ---------- 5: olgu tarihi yerel güne göre ----------

def _yerel_ve_utc_gunu_farkli_an():
    """UTC günü ile yerel günü farklı olan bir UTC an'ı; yoksa None."""
    for saat in range(24):
        an = datetime(2026, 6, 15, saat, 30, tzinfo=timezone.utc)
        if an.astimezone().date() != an.date():
            return an
    return None


def test_olgu_tarihi_yerel_gunu_gosterir(con):
    an = _yerel_ve_utc_gunu_farkli_an()
    if an is None:
        pytest.skip("sistem UTC farkı 0: yerel gün ile UTC günü ayrışmıyor")
    with con:
        kok = db.kok_id(con)
        d = db.dugum_ekle(con, "Takvim", ozet="ozet", ebeveyn=kok)
        db.olgu_ekle(
            con, d, "Toplantı yapıldı",
            gecerli_bas=an.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        )
    yerel = datetime.fromtimestamp(an.timestamp()).date().isoformat()
    utc = an.date().isoformat()
    assert yerel != utc
    r = sorgu.oku(con, d, butce=5000)  # olgu tarihi oku çıktısında gösterilir
    metin = r["metin"]
    assert "Toplantı yapıldı" in metin, metin
    assert yerel in metin, f"yerel gün {yerel} bekleniyordu: {metin}"
    assert utc not in metin, f"UTC günü {utc} görünmemeli: {metin}"
