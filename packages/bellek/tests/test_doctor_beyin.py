"""bellek doktor: beyin veritabanı ve hook günlüğü denetimleri (sözleşmeden yazıldı).

Tüm yollar `tmp_path` altına yönlendirilir: BELLEK_BEYIN_DB, BELLEK_KAPI_STATE, BELLEK_DEVIR_STATE.
"""

from __future__ import annotations

import hashlib
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from bellek.beyin import db as beyin_db
from bellek.config import Config
from bellek.doctor import Check, DoctorReport, run_checks

_SIRA = {"ok": 0, "warn": 1, "error": 2}
YENI_DENETIMLER = ("beyin_db", "beyin_fts", "beyin_yetim", "hook_gunluk")


def make_config(root: Path) -> Config:
    vault_dir = root / "vault"
    state_dir = root / "state"
    vault_dir.mkdir()
    state_dir.mkdir()
    return Config(
        config_path=root / "bellek.toml",
        vault=vault_dir,
        state_dir=state_dir,
        sources=(),
        server_host="127.0.0.1",
        server_port=47321,
        projects={},
    )


def by_name(report: DoctorReport) -> dict[str, Check]:
    return {c.name: c for c in report.checks}


def denetim(report: DoctorReport, ad: str) -> Check:
    checks = by_name(report)
    assert ad in checks, f"denetim adı raporda yok: {ad}"
    return checks[ad]


@pytest.fixture
def ortam(tmp_path, monkeypatch):
    """Ayar + yönlendirilmiş veritabanı ve günlük klasörleri."""
    root = tmp_path / "kok"
    root.mkdir()
    db_yolu = root / "beyin" / "beyin.db"
    kapi = root / "kapi"
    devir = root / "devir"
    monkeypatch.setenv("BELLEK_BEYIN_DB", str(db_yolu))
    monkeypatch.setenv("BELLEK_KAPI_STATE", str(kapi))
    monkeypatch.setenv("BELLEK_DEVIR_STATE", str(devir))
    cfg = make_config(root)
    return cfg, db_yolu, kapi, devir


def saglikli_db(yol: Path, yetim: bool = False) -> None:
    con = beyin_db.baglan(yol)
    try:
        with con:
            kok = beyin_db.kok_id(con)
            dal = beyin_db.dugum_ekle(con, "Okul", tur="dal", ebeveyn=kok)
            beyin_db.dugum_ekle(con, "Ders", ozet="matematik", ebeveyn=dal)
            beyin_db.dugum_ekle(con, "Proje", tur="proje", ebeveyn=kok)
            if yetim:
                beyin_db.dugum_ekle(con, "Sahipsiz")  # ebeveyn yok, kök değil
    finally:
        con.close()


def user_version_yap(yol: Path, deger: int) -> None:
    con = sqlite3.connect(str(yol))
    try:
        con.execute(f"PRAGMA user_version = {int(deger)}")
        con.commit()
    finally:
        con.close()


def ana_dosya_ozeti(yol: Path) -> str:
    return hashlib.sha256(yol.read_bytes()).hexdigest()


def hata_satiri(zaman: datetime, mesaj: str = "beklenmeyen hata") -> str:
    # Kapı hook'unun biçimi: [<ISO zaman>] <mesaj>
    return f"[{zaman.astimezone().isoformat(timespec='seconds')}] {mesaj}\n"


def gunluk_yaz(klasor: Path, *satirlar: str) -> Path:
    klasor.mkdir(parents=True, exist_ok=True)
    yol = klasor / "hook.log"
    yol.write_text("".join(satirlar), encoding="utf-8", newline="\n")
    return yol


# 1
def test_dort_denetim_var_ve_bos_ortamda_ok(ortam):
    cfg, _db, _kapi, _devir = ortam
    report = run_checks(cfg)
    for ad in YENI_DENETIMLER:
        c = denetim(report, ad)
        assert c.status == "ok", f"{ad}: {c.status} {c.detail}"
    assert "henüz oluşturulmamış" in denetim(report, "beyin_db").detail


# 2
def test_db_yokken_dosya_olusturulmaz(ortam):
    cfg, db_yolu, _kapi, _devir = ortam
    run_checks(cfg)
    run_checks(cfg)
    assert not db_yolu.exists()
    assert not Path(str(db_yolu) + "-wal").exists()


# 3
def test_saglikli_db_ok(ortam):
    cfg, db_yolu, _kapi, _devir = ortam
    saglikli_db(db_yolu)
    report = run_checks(cfg)
    for ad in ("beyin_db", "beyin_fts", "beyin_yetim"):
        c = denetim(report, ad)
        assert c.status == "ok", f"{ad}: {c.status} {c.detail}"


# 4
def test_ana_dosya_degismez(ortam):
    cfg, db_yolu, _kapi, _devir = ortam
    saglikli_db(db_yolu)
    onceki = ana_dosya_ozeti(db_yolu)
    report = run_checks(cfg)
    denetim(report, "beyin_db")  # denetimin çalıştığından emin ol
    assert ana_dosya_ozeti(db_yolu) == onceki


# 5
def test_bozuk_dosya_error_ve_istisna_yok(ortam):
    cfg, db_yolu, _kapi, _devir = ortam
    db_yolu.parent.mkdir(parents=True)
    db_yolu.write_bytes(bytes((i * 37 + 11) % 256 for i in range(8192)))
    report = run_checks(cfg)  # istisna fırlatmamalı
    assert denetim(report, "beyin_db").status == "error"


# 6
def test_yeni_sema_surumu_error(ortam):
    cfg, db_yolu, _kapi, _devir = ortam
    saglikli_db(db_yolu)
    user_version_yap(db_yolu, beyin_db.SEMA_SURUMU + 1)
    report = run_checks(cfg)
    assert denetim(report, "beyin_db").status == "error"


# 7
def test_eski_sema_surumu_warn(ortam):
    cfg, db_yolu, _kapi, _devir = ortam
    saglikli_db(db_yolu)
    user_version_yap(db_yolu, beyin_db.SEMA_SURUMU - 1)
    report = run_checks(cfg)
    assert denetim(report, "beyin_db").status == "warn"


# 8
def test_yetim_dugum_warn(ortam):
    cfg, db_yolu, _kapi, _devir = ortam
    saglikli_db(db_yolu, yetim=True)
    c = denetim(run_checks(cfg), "beyin_yetim")
    assert c.status == "warn"
    assert "1" in c.detail


# 9
def test_hook_gunlugu_yeni_hata_warn(ortam):
    cfg, _db, kapi, _devir = ortam
    gunluk_yaz(kapi, hata_satiri(datetime.now(timezone.utc)))
    assert denetim(run_checks(cfg), "hook_gunluk").status == "warn"


# 10
def test_hook_gunlugu_eski_hata_ok(ortam):
    cfg, _db, kapi, _devir = ortam
    gunluk_yaz(kapi, hata_satiri(datetime.now(timezone.utc) - timedelta(days=30)))
    assert denetim(run_checks(cfg), "hook_gunluk").status == "ok"


# 11
def test_hook_gunlugu_yoksa_ok(ortam):
    cfg, _db, kapi, devir = ortam
    assert not (kapi / "hook.log").exists() and not (devir / "hook.log").exists()
    assert denetim(run_checks(cfg), "hook_gunluk").status == "ok"


# 12
@pytest.mark.parametrize("senaryo", ["yetim", "gunluk"])
def test_genel_durum_en_az_warn(ortam, senaryo):
    cfg, db_yolu, kapi, _devir = ortam
    if senaryo == "yetim":
        saglikli_db(db_yolu, yetim=True)
    else:
        gunluk_yaz(kapi, hata_satiri(datetime.now(timezone.utc)))
    report = run_checks(cfg)
    assert _SIRA[report.status] >= _SIRA["warn"]
