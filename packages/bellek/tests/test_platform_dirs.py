"""platform_dirs.data_dir: platforma göre yerel veri kökü."""
from pathlib import Path

from bellek.platform_dirs import data_dir


def test_localappdata_her_platformda_once_gelir(tmp_path):
    for plat in ("win32", "darwin", "linux"):
        assert data_dir({"LOCALAPPDATA": str(tmp_path)}, plat) == tmp_path / "Bellek"


def test_windows_varsayilani():
    assert data_dir({}, "win32") == Path.home() / "AppData" / "Local" / "Bellek"


def test_macos_application_support():
    assert data_dir({}, "darwin") == Path.home() / "Library" / "Application Support" / "Bellek"


def test_linux_xdg_ve_varsayilan(tmp_path):
    assert data_dir({"XDG_DATA_HOME": str(tmp_path)}, "linux") == tmp_path / "Bellek"
    # Göreli XDG_DATA_HOME spesifikasyona göre yok sayılır.
    assert data_dir({"XDG_DATA_HOME": "goreli"}, "linux") == Path.home() / ".local" / "share" / "Bellek"
    assert data_dir({}, "linux") == Path.home() / ".local" / "share" / "Bellek"


def test_devir_state_dir_platform_kokunu_izler(tmp_path):
    from bellek.devir.hook import state_dir
    assert state_dir({"LOCALAPPDATA": str(tmp_path)}) == tmp_path / "Bellek" / "devir"
    assert state_dir({"BELLEK_DEVIR_STATE": str(tmp_path / "o")}) == tmp_path / "o"


def test_ornek_ayar_state_dir_vermez_platform_varsayilani_kullanilir(monkeypatch, tmp_path):
    """bellek.example.toml macOS'ta literal '%LOCALAPPDATA%' klasörü yaratmamalı."""
    from bellek import config as config_module
    monkeypatch.delenv("LOCALAPPDATA", raising=False)
    cfg = config_module.load_config(config_module.example_config_path())
    assert "%" not in str(cfg.state_dir)
    assert cfg.state_dir == data_dir()
