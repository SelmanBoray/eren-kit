"""bellek.doctor testleri (yalnız sözleşmeden yazıldı).

VARSAYIM: üretim kodu `sqlite3.connect`'i `sqlite3` modülü üzerinden çağırır;
bu yüzden FTS5 yok senaryosunda `sqlite3.connect` monkeypatch ile değiştirilir.
"""

from __future__ import annotations

import dataclasses
import os
import sqlite3
import sys
from pathlib import Path

import pytest

from bellek.config import Config, Source
from bellek.doctor import Check, DoctorReport, run_checks


# Beyin ve hook denetimleri: kaynak denetimlerinden ve sqlite_fts5'ten sonra, bu sırayla.
# Ad ve sıra JSON çıktısının sözleşmesidir; bu yüzden testler tam listeyi sabitler.
BEYIN_DENETIMLERI = ["beyin_db", "beyin_fts", "beyin_yetim", "beyin_gelen", "beyin_kuyruk", "hook_gunluk"]


def make_config(
    root: Path,
    *,
    vault: bool = True,
    state: bool = True,
    sources: tuple[str, ...] = ("a", "b"),
    existing_sources: tuple[str, ...] = ("a", "b"),
) -> Config:
    vault_dir = root / "vault"
    state_dir = root / "state"
    if vault:
        vault_dir.mkdir()
    if state:
        state_dir.mkdir()
    srcs = []
    for name in sources:
        p = root / f"src_{name}"
        if name in existing_sources:
            p.mkdir()
        srcs.append(Source(name=name, path=p))
    return Config(
        config_path=root / "bellek.toml",
        vault=vault_dir,
        state_dir=state_dir,
        sources=tuple(srcs),
        server_host="127.0.0.1",
        server_port=47321,
        projects={},
    )


def by_name(report: DoctorReport) -> dict[str, Check]:
    return {c.name: c for c in report.checks}


def snapshot(root: Path) -> list[str]:
    return sorted(str(p.relative_to(root)) for p in root.rglob("*"))


def test_check_and_report_are_frozen_dataclasses():
    c = Check("x", "ok", "tamam")
    with pytest.raises(dataclasses.FrozenInstanceError):
        c.status = "error"  # type: ignore[misc]
    r = DoctorReport((c,))
    with pytest.raises(dataclasses.FrozenInstanceError):
        r.checks = ()  # type: ignore[misc]


def test_check_names_and_order_with_sources(tmp_path):
    cfg = make_config(tmp_path, sources=("zeta", "alfa", "mid"), existing_sources=("zeta", "alfa", "mid"))
    names = [c.name for c in run_checks(cfg).checks]
    assert names == [
        "python", "vault", "state_dir", "source:zeta", "source:alfa", "source:mid", "sqlite_fts5",
        *BEYIN_DENETIMLERI,
    ]


def test_check_names_without_sources(tmp_path):
    cfg = make_config(tmp_path, sources=(), existing_sources=())
    names = [c.name for c in run_checks(cfg).checks]
    assert names == ["python", "vault", "state_dir", "sqlite_fts5", *BEYIN_DENETIMLERI]


def test_all_ok(tmp_path):
    report = run_checks(make_config(tmp_path))
    assert [c.status for c in report.checks] == ["ok"] * len(report.checks)
    assert report.status == "ok"


def test_python_ok_on_current_interpreter(tmp_path):
    assert sys.version_info >= (3, 12)
    assert by_name(run_checks(make_config(tmp_path)))["python"].status == "ok"


def test_details_are_non_empty_text(tmp_path):
    for c in run_checks(make_config(tmp_path)).checks:
        assert isinstance(c.detail, str) and c.detail.strip()
        assert c.status in ("ok", "warn", "error")


def test_details_non_empty_when_failing(tmp_path):
    cfg = make_config(tmp_path, vault=False, state=False, existing_sources=())
    for c in run_checks(cfg).checks:
        assert c.detail.strip()


def test_missing_vault_is_error(tmp_path):
    report = run_checks(make_config(tmp_path, vault=False))
    checks = by_name(report)
    assert checks["vault"].status == "error"
    assert checks["state_dir"].status == "ok"
    assert report.status == "error"


def test_vault_path_is_file_not_ok(tmp_path):
    cfg = make_config(tmp_path, vault=False)
    cfg.vault.write_text("dosya")
    assert by_name(run_checks(cfg))["vault"].status == "error"


def test_missing_state_dir_is_warn(tmp_path):
    report = run_checks(make_config(tmp_path, state=False))
    assert by_name(report)["state_dir"].status == "warn"
    assert report.status == "warn"


def test_missing_source_is_warn(tmp_path):
    cfg = make_config(tmp_path, existing_sources=("a",))
    report = run_checks(cfg)
    checks = by_name(report)
    assert checks["source:a"].status == "ok"
    assert checks["source:b"].status == "warn"
    assert report.status == "warn"


def test_error_outranks_warn_in_overall(tmp_path):
    cfg = make_config(tmp_path, vault=False, state=False, existing_sources=())
    report = run_checks(cfg)
    assert by_name(report)["state_dir"].status == "warn"
    assert report.status == "error"


def test_run_checks_has_no_side_effects(tmp_path):
    cfg = make_config(tmp_path, state=False, existing_sources=("a",))
    (tmp_path / "vault" / "not.md").write_text("x")
    before = snapshot(tmp_path)
    run_checks(cfg)
    run_checks(cfg)
    assert snapshot(tmp_path) == before
    assert not cfg.state_dir.exists()


def test_run_checks_does_not_leave_files_in_existing_state_dir(tmp_path):
    cfg = make_config(tmp_path)
    before = snapshot(tmp_path)
    run_checks(cfg)
    assert snapshot(tmp_path) == before
    assert list(cfg.state_dir.iterdir()) == []


class _NoFts5Connection:
    def execute(self, sql, *args, **kwargs):
        if "fts5" in str(sql).lower():
            raise sqlite3.OperationalError("no such module: fts5")
        return self

    def executescript(self, sql):
        return self.execute(sql)

    def close(self):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def test_fts5_unavailable_is_error(tmp_path, monkeypatch):
    monkeypatch.setattr(sqlite3, "connect", lambda *a, **k: _NoFts5Connection())
    report = run_checks(make_config(tmp_path))
    checks = by_name(report)
    assert checks["sqlite_fts5"].status == "error"
    assert checks["sqlite_fts5"].detail.strip()
    assert report.status == "error"
    # Diğer kontroller etkilenmez ve rapor kesilmez: FTS5 hatasından sonraki denetimler de çalışır.
    names = [c.name for c in report.checks]
    assert names[names.index("sqlite_fts5") + 1 :] == BEYIN_DENETIMLERI
    assert checks["vault"].status == "ok"


def test_fts5_connect_raising_does_not_break_report(tmp_path, monkeypatch):
    def boom(*a, **k):
        raise sqlite3.OperationalError("bağlanılamadı")

    monkeypatch.setattr(sqlite3, "connect", boom)
    report = run_checks(make_config(tmp_path))
    assert by_name(report)["sqlite_fts5"].status == "error"
    assert [c.name for c in report.checks] == [
        "python", "vault", "state_dir", "source:a", "source:b", "sqlite_fts5", *BEYIN_DENETIMLERI,
    ]


@pytest.mark.parametrize(
    "statuses, expected",
    [
        ((), "ok"),
        (("ok",), "ok"),
        (("ok", "ok"), "ok"),
        (("ok", "warn"), "warn"),
        (("warn", "ok", "warn"), "warn"),
        (("ok", "error"), "error"),
        (("warn", "error", "ok"), "error"),
        (("error", "warn"), "error"),
    ],
)
def test_report_status_priority(statuses, expected):
    checks = tuple(Check(f"c{i}", s, "ayrıntı") for i, s in enumerate(statuses))
    assert DoctorReport(checks).status == expected


@pytest.mark.skipif(
    sys.platform == "win32" or (hasattr(os, "geteuid") and os.geteuid() == 0),
    reason="Yazılamayan klasör Windows'ta (ACL) ve root olarak güvenilir kurulamaz; POSIX'te chmod ile test edilir.",
)
def test_unwritable_state_dir_is_error(tmp_path):
    cfg = make_config(tmp_path)
    cfg.state_dir.chmod(0o500)
    try:
        report = run_checks(cfg)
        assert by_name(report)["state_dir"].status == "error"
        assert report.status == "error"
    finally:
        cfg.state_dir.chmod(0o700)


def test_sablonla_calisirken_config_uyarisi_ilk_sirada(tmp_path):
    """bellek.toml yokken (şablon yüklendi) doktor bunu uyarı olarak söyler."""
    cfg = dataclasses.replace(make_config(tmp_path, sources=(), existing_sources=()), template=True)
    report = run_checks(cfg)
    names = [c.name for c in report.checks]
    assert names == ["config", "python", "vault", "state_dir", "sqlite_fts5", *BEYIN_DENETIMLERI]
    assert report.checks[0].status == "warn"
    assert "bellek.toml" in report.checks[0].detail
    assert report.status == "warn"


def test_yalitim_varsayilan_yollari_gecici_koke_yonlendirir(tmp_path):
    """tests/conftest.py güvencesi: hiçbir şey yönlendirmeyen bir testte doktorun okuduğu
    beyin.db, kuyruk, hook günlükleri ve platform kökü pytest geçici kökündedir; gerçek
    kullanıcı veri kökünde (oturum başındaki ortamdan çözülen) değildir."""
    from conftest import OTURUM_BASI_ORTAM

    from bellek import doctor
    from bellek.beyin import mcp_kopru, servis
    from bellek.devir import hook as devir_hook
    from bellek.kapi import hook as kapi_hook
    from bellek.devir import notlar as devir_notlar
    from bellek.platform_dirs import data_dir

    from bellek import config as config_module

    gecici_kok = Path(tmp_path).resolve().parent  # pytest basetemp
    gercek_ortam = {k: v for k, v in OTURUM_BASI_ORTAM.items() if v is not None}
    gercek_kok = data_dir(gercek_ortam).resolve()

    yollar = {
        "data_dir": data_dir(),
        "beyin_db": doctor._beyin_db_path(),
        "servis_kuyruk": servis._kuyruk_yolu(),
        "servis_durum": servis._durum_klasoru(),
        "servis_token": servis._token_yolu(),
        "servis_log": servis._log_yolu(),
        "kopru_kuyruk": mcp_kopru._kuyruk_yolu(),
        "kopru_log": mcp_kopru._log_yolu(),
        "kapi_state": Path(kapi_hook.state_dir()),
        "devir_state": Path(devir_hook.state_dir()),
        **{f"hook_log:{ad}": yol for ad, yol in doctor._hook_log_paths()},
        "ayar": config_module.default_config_path(),
        "vault": config_module.load_vault(),
        "devir_kok": devir_notlar.devir_kok(),
    }
    for ad, yol in yollar.items():
        cozulmus = Path(yol).resolve()
        assert cozulmus.is_relative_to(gecici_kok), f"{ad} geçici kökte değil: {cozulmus}"
        assert not cozulmus.is_relative_to(gercek_kok), f"{ad} gerçek veri kökünde: {cozulmus}"


def test_yalitim_paket_kokunde_gercek_ayar_olsa_da_vaulta_dusmez(tmp_path, monkeypatch):
    """Canlı kurulum benzetimi: paket kökünde gerçek vault'u gösteren bir bellek.toml var.
    Yönlendirme yapmayan bir testte ayar, vault ve devir klasörü o vault'a çözülmez."""
    from bellek import config as config_module
    from bellek.devir import notlar as devir_notlar

    gercek_vault = tmp_path / "gercek_vault"
    paket = tmp_path / "paket"
    paket.mkdir()
    (paket / "bellek.toml").write_text(f'[bellek]\nvault = "{gercek_vault.as_posix()}"\n', encoding="utf-8")
    monkeypatch.setattr(config_module, "_package_root", lambda: paket)
    monkeypatch.setattr(devir_notlar, "_PAKET_KOK", paket)

    gecici_kok = Path(tmp_path).resolve().parent  # pytest basetemp
    yollar = {
        "ayar": config_module.default_config_path(),
        "vault": config_module.load_vault(),
        "config.vault": config_module.load_config().vault,
        "devir_kok": devir_notlar.devir_kok(),
    }
    for ad, yol in yollar.items():
        cozulmus = Path(yol).resolve()
        assert not cozulmus.is_relative_to(gercek_vault.resolve()), f"{ad} gerçek vault'ta: {cozulmus}"
        assert not cozulmus.is_relative_to(paket.resolve()), f"{ad} paket kökündeki ayara düştü: {cozulmus}"
        assert cozulmus.is_relative_to(gecici_kok), f"{ad} geçici kökte değil: {cozulmus}"

    # Kontrol: yalıtım kaldırılınca benzetim gerçekten "gerçek vault"a çözülür (test boş geçmiyor).
    with monkeypatch.context() as m:
        m.delenv("BELLEK_CONFIG", raising=False)
        m.delenv("BELLEK_DEVIR_DIR", raising=False)
        assert Path(devir_notlar.devir_kok()).resolve() == (gercek_vault / "devir").resolve()