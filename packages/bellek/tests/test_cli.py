"""bellek.cli testleri (sözleşmeden)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

import bellek
from bellek.cli import main


def _toml_path(p: Path) -> str:
    return p.as_posix()


def _write_config(
    tmp_path: Path,
    *,
    make_vault: bool = True,
    make_state: bool = True,
    sources: tuple[tuple[str, bool], ...] = (("notlar", True),),
    projects: dict[str, str] | None = None,
    extra: str = "",
) -> Path:
    vault = tmp_path / "vault"
    state = tmp_path / "state"
    if make_vault:
        vault.mkdir()
    if make_state:
        state.mkdir()
    lines = [
        "[bellek]",
        f'vault = "{_toml_path(vault)}"',
        f'state_dir = "{_toml_path(state)}"',
        extra,
        "[server]",
        'host = "127.0.0.1"',
        "port = 47999",
    ]
    for i, (name, exists) in enumerate(sources):
        sdir = tmp_path / f"src{i}"
        if exists:
            sdir.mkdir()
        lines += ["[[source]]", f'name = "{name}"', f'path = "{_toml_path(sdir)}"']
    lines.append("[projects]")
    for k, v in (projects or {}).items():
        lines.append(f'"{k}" = "{v}"')
    cfg = tmp_path / "bellek.toml"
    cfg.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return cfg


def test_version_constant():
    assert bellek.__version__ == "0.0.1"


def test_version_flag(capsys):
    assert main(["--version"]) == 0
    assert capsys.readouterr().out.strip() == "bellek 0.0.1"


def test_no_subcommand_prints_help(capsys):
    assert main([]) == 0
    assert capsys.readouterr().out.strip() != ""


def test_unknown_subcommand_returns_2(capsys):
    assert main(["yok-boyle-komut"]) == 2


def test_paths_json_shape(tmp_path, capsys):
    cfg = _write_config(
        tmp_path,
        sources=(("var", True), ("yok", False)),
        projects={"C:/Proje": "proje"},
    )
    assert main(["--config", str(cfg), "yollar", "--json"]) == 0
    data = json.loads(capsys.readouterr().out)
    assert set(data) == {"config_path", "vault", "state_dir", "server", "sources", "projects"}
    assert Path(data["config_path"]) == cfg
    assert Path(data["vault"]) == tmp_path / "vault"
    assert Path(data["state_dir"]) == tmp_path / "state"
    assert data["server"] == {"host": "127.0.0.1", "port": 47999}
    assert [s["name"] for s in data["sources"]] == ["var", "yok"]
    assert all(set(s) == {"name", "path", "exists"} for s in data["sources"])
    assert [s["exists"] for s in data["sources"]] == [True, False]
    assert data["projects"] == {"C:/Proje": "proje"} or list(data["projects"].values()) == ["proje"]


def test_paths_json_file_source_is_not_exists(tmp_path, capsys):
    # Regresyon: `exists` "yol klasör olarak var mı" demektir; dosya olan kaynak false.
    cfg = _write_config(tmp_path, sources=(("klasor", True), ("dosya", False)))
    (tmp_path / "src1").write_text("bu bir dosya", encoding="utf-8")
    assert main(["--config", str(cfg), "yollar", "--json"]) == 0
    data = json.loads(capsys.readouterr().out)
    assert {s["name"]: s["exists"] for s in data["sources"]} == {"klasor": True, "dosya": False}


def test_paths_human_output(tmp_path, capsys):
    cfg = _write_config(tmp_path)
    assert main(["--config", str(cfg), "yollar"]) == 0
    out = capsys.readouterr().out
    assert out.strip() != ""
    with pytest.raises(json.JSONDecodeError):
        json.loads(out)


def test_doctor_json_all_ok(tmp_path, capsys):
    cfg = _write_config(tmp_path, sources=(("a", True), ("b", True)))
    assert main(["--config", str(cfg), "doktor", "--json"]) == 0
    data = json.loads(capsys.readouterr().out)
    assert data["status"] == "ok"
    names = [c["name"] for c in data["checks"]]
    assert names == ["python", "vault", "state_dir", "source:a", "source:b", "sqlite_fts5"]
    assert all(set(c) == {"name", "status", "detail"} for c in data["checks"])
    assert all(c["status"] == "ok" for c in data["checks"])


def test_doctor_vault_missing_is_error(tmp_path, capsys):
    cfg = _write_config(tmp_path, make_vault=False)
    assert main(["--config", str(cfg), "doktor", "--json"]) == 1
    data = json.loads(capsys.readouterr().out)
    assert data["status"] == "error"
    checks = {c["name"]: c for c in data["checks"]}
    assert checks["vault"]["status"] == "error"


def test_doctor_state_dir_missing_is_warn(tmp_path, capsys):
    cfg = _write_config(tmp_path, make_state=False)
    assert main(["--config", str(cfg), "doktor", "--json"]) == 0
    data = json.loads(capsys.readouterr().out)
    assert data["status"] == "warn"
    checks = {c["name"]: c for c in data["checks"]}
    assert checks["state_dir"]["status"] == "warn"


def test_doctor_source_missing_is_warn(tmp_path, capsys):
    cfg = _write_config(tmp_path, sources=(("var", True), ("yok", False)))
    assert main(["--config", str(cfg), "doktor", "--json"]) == 0
    data = json.loads(capsys.readouterr().out)
    assert data["status"] == "warn"
    checks = {c["name"]: c for c in data["checks"]}
    assert checks["source:var"]["status"] == "ok"
    assert checks["source:yok"]["status"] == "warn"


def test_doctor_human_output_exit_code(tmp_path, capsys):
    cfg = _write_config(tmp_path)
    assert main(["--config", str(cfg), "doktor"]) == 0
    assert capsys.readouterr().out.strip() != ""


def test_config_file_missing(tmp_path, capsys):
    assert main(["--config", str(tmp_path / "yok.toml"), "yollar"]) == 2
    assert capsys.readouterr().err.startswith("Ayar hatası:")


def test_config_missing_vault(tmp_path, capsys):
    cfg = tmp_path / "bellek.toml"
    cfg.write_text("[bellek]\n", encoding="utf-8")
    assert main(["--config", str(cfg), "doktor"]) == 2
    assert capsys.readouterr().err.startswith("Ayar hatası:")


def test_config_unknown_key(tmp_path, capsys):
    cfg = _write_config(tmp_path, extra='bilinmeyen_anahtar = "x"')
    assert main(["--config", str(cfg), "yollar", "--json"]) == 2
    captured = capsys.readouterr()
    assert captured.err.startswith("Ayar hatası:")
    assert captured.out == ""


def test_json_not_ascii_escaped(tmp_path, capsys):
    cfg = _write_config(tmp_path, sources=(("günlük-notlar", True),))
    assert main(["--config", str(cfg), "yollar", "--json"]) == 0
    out = capsys.readouterr().out
    assert "günlük-notlar" in out
    assert "\\u" not in out
    assert json.loads(out)["sources"][0]["name"] == "günlük-notlar"


def test_json_not_ascii_escaped_doctor(tmp_path, capsys):
    cfg = _write_config(tmp_path, sources=(("günlük-notlar", True),))
    assert main(["--config", str(cfg), "doktor", "--json"]) == 0
    out = capsys.readouterr().out
    assert "source:günlük-notlar" in out


def test_paths_sablon_insan_ciktisinda_belirtilir(tmp_path, monkeypatch, capsys):
    """bellek.toml yokken `yollar` şablonun kullanıldığını söyler."""
    from bellek import config as config_module

    monkeypatch.delenv("BELLEK_CONFIG", raising=False)
    monkeypatch.setattr(config_module, "_package_root", lambda: tmp_path)
    (tmp_path / "bellek.example.toml").write_text("[bellek]\nvault = 'kasa'\n", encoding="utf-8")
    assert main(["yollar"]) == 0
    out = capsys.readouterr().out
    assert "bellek.example.toml" in out and "şablon" in out


def test_ayar_ve_sablon_yoksa_acik_hata(tmp_path, monkeypatch, capsys):
    from bellek import config as config_module

    monkeypatch.delenv("BELLEK_CONFIG", raising=False)
    monkeypatch.setattr(config_module, "_package_root", lambda: tmp_path)
    assert main(["doktor"]) == 2
    err = capsys.readouterr().err
    assert "bellek.example.toml" in err and "BELLEK_CONFIG" in err
