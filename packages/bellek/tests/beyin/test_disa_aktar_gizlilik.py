"""disa_aktar gizlilik kalıtımı regresyon testleri.

Sır/özel işaretli bir düğümün altındaki normal işaretli torunlar da kısıtlanmalı.
"""

import json

import pytest

from bellek.beyin import db, disa_aktar


@pytest.fixture
def con(tmp_path):
    c = db.baglan(tmp_path / "b.db")
    yield c
    c.close()


def _agac(con, ozel=False):
    """kök > Kasa(sır) > Banka > Hesap; kök > Açık; istenirse kök > Günlük(özel) > Not."""
    kok = db.kok_id(con)
    kasa = db.dugum_ekle(con, "Kasa", ozet="kasa özeti", gizlilik="sir_icerir", ebeveyn=kok)
    banka = db.dugum_ekle(con, "Banka", ozet="PIN 4711", ebeveyn=kasa)
    db.olgu_ekle(con, banka, "kart 9988")
    db.dugum_ekle(con, "Hesap", ozet="IBAN-TEST-0001", ebeveyn=banka)
    db.dugum_ekle(con, "Açık", ozet="herkese-acik-456", ebeveyn=kok)
    gunluk = db.dugum_ekle(con, "Günlük", ozet="günlük özeti", gizlilik="ozel", ebeveyn=kok)
    db.dugum_ekle(con, "Not", ozet="gizli-ozet-123", ebeveyn=gunluk)
    con.commit()
    return con


def test_sir_kalitimi_markdown(con):
    _agac(con)
    md = disa_aktar.markdown_agac(con, ozel_dahil=True, sir_dahil=False)
    assert "PIN 4711" not in md
    assert "kart 9988" not in md


def test_sir_kalitimi_iki_seviye_markdown(con):
    _agac(con)
    md = disa_aktar.markdown_agac(con, ozel_dahil=True, sir_dahil=False)
    assert "IBAN-TEST-0001" not in md


def test_ozel_kalitimi_markdown(con):
    _agac(con)
    kisitli = disa_aktar.markdown_agac(con, ozel_dahil=False)
    assert "gizli-ozet-123" not in kisitli
    acik = disa_aktar.markdown_agac(con, ozel_dahil=True)
    assert "gizli-ozet-123" in acik


def test_asiri_kirpma_yok(con):
    _agac(con)
    assert "herkese-acik-456" in disa_aktar.markdown_agac(con, ozel_dahil=True, sir_dahil=False)
    assert "herkese-acik-456" in disa_aktar.markdown_agac(con, ozel_dahil=False)


def test_sir_kalitimi_jsonl(con, tmp_path):
    _agac(con)
    yol = tmp_path / "dok.jsonl"
    disa_aktar.jsonl_dok(con, yol)
    metin = yol.read_text(encoding="utf-8")
    assert "PIN 4711" not in metin
    assert "kart 9988" not in metin
    assert "herkese-acik-456" in metin

    kayitlar = [json.loads(s) for s in metin.splitlines() if s.strip()]
    dugumler = {k["baslik"]: k for k in kayitlar if k["tur"] == "dugum"}
    kasa, banka = dugumler["Kasa"], dugumler["Banka"]
    # Kasa kaydında boşaltılan her alan Banka kaydında da boşaltılmış olmalı.
    for alan, deger in kasa.items():
        if deger is None or deger == "":
            assert banka.get(alan) in (None, ""), f"Banka.{alan} kırpılmamış: {banka.get(alan)!r}"
    # Kasa'da dolu kalan alanlar Banka'da da korunmuş olmalı (aşırı kırpma yok).
    assert set(banka) == set(kasa)


def test_koksuz_veritabani_yazmaz(con):
    assert con.execute("SELECT COUNT(*) FROM dugum").fetchone()[0] == 0
    once = con.execute("SELECT COUNT(*) FROM dugum").fetchone()[0]
    sonuc = disa_aktar.markdown_agac(con)
    assert isinstance(sonuc, str)
    assert con.in_transaction is False
    assert con.execute("SELECT COUNT(*) FROM dugum").fetchone()[0] == once
