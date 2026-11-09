"""macOS kurulum betiği ve settings_hooks --python testleri (gerçek ~/.claude'a dokunmaz)."""

from __future__ import annotations

import argparse
import json
import plistlib
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

import install_macos as im  # noqa: E402
import settings_hooks  # noqa: E402


def _ctx(tmp_path: Path, **kw) -> im.Ctx:
    home = tmp_path / "claude"
    home.mkdir(exist_ok=True)
    kw.setdefault("hook_python", sys.executable)
    return im.Ctx(claude_home=home, launch_agents=tmp_path / "LaunchAgents", log_dir=tmp_path / "logs", **kw)


def _hooks(settings: Path) -> list[str]:
    d = json.loads(settings.read_text(encoding="utf-8"))
    return [h["command"] for gs in d.get("hooks", {}).values() for g in gs for h in g["hooks"]]


# ---------------------------------------------------------------- settings_hooks --python

def test_varsayilan_yorumlayici_windows_ile_ayni():
    spec = settings_hooks.hook_specs("C:/r")
    assert spec["devir"]["events"]["Stop"][0]["command"] == 'python -I "C:/r/packages/bellek/src/bellek/devir/hook.py" || true'


def test_bosluklu_yorumlayici_tirnaklanir():
    spec = settings_hooks.hook_specs("/r", "/Applications/My Python/bin/python3")
    cmd = spec["orkestra"]["events"]["SessionStart"][0]["command"]
    assert cmd.startswith('"/Applications/My Python/bin/python3" -I "/r/')


def test_yorumlayici_degisince_kayit_yerinde_guncellenir(tmp_path):
    s = tmp_path / "settings.json"
    base = dict(settings=str(s), repo="/r", components="devir", uninstall=False, dry_run=False,
                replace_legacy=False, backup_dir=None)
    settings_hooks.run(argparse.Namespace(**base, python="python"))
    settings_hooks.run(argparse.Namespace(**base, python="/opt/homebrew/bin/python3"))
    cmds = _hooks(s)
    assert len(cmds) == 3 and all(c.startswith("/opt/homebrew/bin/python3 -I") for c in cmds)


# ---------------------------------------------------------------- settings.json env

def test_asistan_adi_env_alanina_yazilir_digerleri_korunur(tmp_path):
    ctx = _ctx(tmp_path)
    ctx.settings.write_text(json.dumps({"theme": "dark", "env": {"X": "1"}}), encoding="utf-8")
    assert im.settings_env_step(ctx, "Ada").status == "ok"
    d = json.loads(ctx.settings.read_text(encoding="utf-8"))
    assert d == {"theme": "dark", "env": {"X": "1", "EREN_KIT_ASSISTANT_NAME": "Ada"}}
    assert (ctx.backup_dir / "settings.json").exists()
    # Ad verilmezse mevcut korunur.
    r = im.settings_env_step(ctx, None)
    assert r.status == "ok" and "zaten" in r.message


def test_asistan_adi_dry_run_yazmaz(tmp_path):
    ctx = _ctx(tmp_path, dry_run=True)
    assert im.settings_env_step(ctx, "Ada").status == "dry"
    assert not ctx.settings.exists()


# ---------------------------------------------------------------- skill

def test_skill_kur_guncel_kaldir(tmp_path):
    src = tmp_path / "src"
    src.mkdir()
    (src / "SKILL.md").write_text("a", encoding="utf-8")
    ctx = _ctx(tmp_path)
    assert "kopyalandı" in im.install_skill(ctx, "devir", "devir", src).message
    dest = ctx.claude_home / "skills" / "devir"
    assert json.loads((dest / im.MARKER).read_text())["installedBy"] == "eren-kit"
    assert "güncel" in im.install_skill(ctx, "devir", "devir", src).message
    (src / "SKILL.md").write_text("b", encoding="utf-8")
    assert "eskisi yedeklendi" in im.install_skill(ctx, "devir", "devir", src).message
    assert (dest / "SKILL.md").read_text() == "b"
    assert im.uninstall_skill(ctx, "devir", src).status == "ok"
    assert not dest.exists()
    assert (ctx.backup_dir / "skills" / "devir" / "SKILL.md").exists()


def test_yabanci_skill_kaldirilmaz(tmp_path):
    src = tmp_path / "src"
    src.mkdir()
    (src / "SKILL.md").write_text("a", encoding="utf-8")
    ctx = _ctx(tmp_path)
    dest = ctx.claude_home / "skills" / "devir"
    dest.mkdir(parents=True)
    (dest / "SKILL.md").write_text("kullanıcının kendi skill'i", encoding="utf-8")
    assert im.uninstall_skill(ctx, "devir", src).status == "warn"
    assert dest.exists()


# ---------------------------------------------------------------- launchd

def test_plist_icerigi(tmp_path):
    ctx = _ctx(tmp_path, assistant_name="Ada", tailscale_host="mac.tail.ts.net")
    p = im.service_plist(ctx)
    assert p["Label"] == im.SERVICE_LABEL
    assert p["ProgramArguments"][1:] == ["-m", "bellek.beyin", "servis"]
    assert p["ProgramArguments"][0].endswith("/packages/bellek/.venv/bin/python")
    assert p["EnvironmentVariables"]["EREN_KIT_ASSISTANT_NAME"] == "Ada"
    assert p["EnvironmentVariables"]["BELLEK_BEYIN_IZINLI_HOST"] == "mac.tail.ts.net"
    assert p["RunAtLoad"] is True and p["KeepAlive"] == {"Crashed": True}
    plistlib.dumps(p)  # geçerli plist


def test_tailscale_host_yeniden_kurulumda_korunur_bos_verilince_kalkar(tmp_path):
    ctx = _ctx(tmp_path, tailscale_host="mac.tail.ts.net")
    ctx.launch_agents.mkdir(parents=True)
    (ctx.launch_agents / f"{im.SERVICE_LABEL}.plist").write_bytes(plistlib.dumps(im.service_plist(ctx)))
    ctx.tailscale_host = None  # bayraksız yeniden kurulum
    assert im.service_plist(ctx)["EnvironmentVariables"]["BELLEK_BEYIN_IZINLI_HOST"] == "mac.tail.ts.net"
    ctx.tailscale_host = ""  # açıkça kaldır
    assert "BELLEK_BEYIN_IZINLI_HOST" not in im.service_plist(ctx)["EnvironmentVariables"]


def test_servis_dry_run_dosya_yazmaz(tmp_path):
    ctx = _ctx(tmp_path, dry_run=True)
    assert im.service_install(ctx).status == "dry"
    assert not ctx.launch_agents.exists()


def test_servis_kurulum_launchctl_cagrilari(tmp_path, monkeypatch):
    calls = []

    def fake_run(args, **kw):
        calls.append(args)
        rc = 113 if args[:2] == ["launchctl", "print"] else 0  # servis yüklü değil
        return im.subprocess.CompletedProcess(args, rc, "", "")

    monkeypatch.setattr(im, "_health", lambda *a, **k: True)
    ctx = _ctx(tmp_path, run=fake_run)
    assert im.service_install(ctx).status == "ok"
    plist = ctx.launch_agents / f"{im.SERVICE_LABEL}.plist"
    assert plistlib.loads(plist.read_bytes())["Label"] == im.SERVICE_LABEL
    assert [c[1] for c in calls] == ["bootout", "print", "bootstrap"]
    calls.clear()
    assert im.service_uninstall(ctx).status == "ok"
    assert not plist.exists() and calls[0][:2] == ["launchctl", "bootout"]
    assert im.service_uninstall(ctx).status == "skip"


# ---------------------------------------------------------------- MCP sahiplik

def test_mcp_sahiplik_ve_esitlik():
    cmd = [str(im.P["bellek_py"]), "-m", "bellek.beyin", "mcp"]
    assert im._entry_owned({"command": cmd[0], "args": cmd[1:]})
    assert not im._entry_owned({"command": "/baska/python", "args": ["x"]})
    assert im._entry_same({"type": "stdio", "command": cmd[0], "args": cmd[1:], "env": {}}, cmd)
    assert not im._entry_same({"command": cmd[0], "args": cmd[1:], "env": {"A": "1"}}, cmd)


def test_mcp_cli_yoksa_elle_komut_gosterilir(tmp_path):
    ctx = _ctx(tmp_path)
    r = im.mcp_register(ctx, "beyin", ["/x/python", "-m", "bellek.beyin", "mcp"])
    assert r.status == "warn" and "claude mcp add beyin -s user --" in r.message


# ---------------------------------------------------------------- uçtan uca (repo kurulumu atlanır)

def test_main_orkestra_kur_ve_kaldir(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("EREN_KIT_FORCE_MACOS", "1")
    home = tmp_path / "claude"
    home.mkdir()
    (home / "settings.json").write_text(json.dumps({"hooks": {"Stop": [{"hooks": [
        {"type": "command", "command": "echo baska"}]}]}}), encoding="utf-8")
    args = ["--components", "orkestra", "--claude-home", str(home), "--skip-mcp", "--no-service",
            "--skip-repo-setup", "--hook-python", sys.executable]
    assert im.main(args) == 0
    cmds = _hooks(home / "settings.json")
    assert "echo baska" in cmds and sum("opus-orkestra-sessionstart.py" in c for c in cmds) == 4
    assert (home / "skills" / "opus-orkestra" / "SKILL.md").exists()
    assert im.main(args) == 0  # idempotent
    assert len(_hooks(home / "settings.json")) == 5
    assert im.main(args + ["--uninstall"]) == 0
    assert _hooks(home / "settings.json") == ["echo baska"]
    assert not (home / "skills" / "opus-orkestra").exists()


def test_main_gecersiz_bilesen(monkeypatch, tmp_path):
    monkeypatch.setenv("EREN_KIT_FORCE_MACOS", "1")
    assert im.main(["--components", "yok", "--claude-home", str(tmp_path)]) == 2


def test_main_macos_disinda_reddeder(monkeypatch, tmp_path):
    monkeypatch.delenv("EREN_KIT_FORCE_MACOS", raising=False)
    monkeypatch.setattr(im.sys, "platform", "win32")
    assert im.main(["--claude-home", str(tmp_path)]) == 2


@pytest.mark.parametrize("bilesen", ["computer-use"])
def test_computer_use_macosta_yerlesik_yonlendirir(tmp_path, bilesen):
    r = im.computer_use_info(_ctx(tmp_path))
    assert r.status == "warn" and "/mcp" in r.message
