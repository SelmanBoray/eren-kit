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


@pytest.fixture(autouse=True)
def doktor_calismaz(request, monkeypatch):
    """main() kurulum sonunda gerçek doktoru (canlı sorgularla) çalıştırmasın; test_doktor_* hariç."""
    if not request.node.name.startswith("test_doktor"):
        monkeypatch.setattr(im, "post_install_doctor", lambda ctx: None)


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
    assert spec["devir"]["events"]["Stop"][0]["command"] == 'python -I -S "C:/r/packages/bellek/src/bellek/devir/hook.py" || true'


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
    assert p["RunAtLoad"] is True
    plistlib.dumps(p)  # geçerli plist


def test_plist_cokmede_yeniden_baslatir_cakismada_dongu_kurmaz(tmp_path):
    p = im.service_plist(_ctx(tmp_path))
    # Sıfır olmayan çıkış (istisna, sys.exit(1)) ve sinyal yeniden başlatır...
    assert p["KeepAlive"] == {"SuccessfulExit": False, "Crashed": True}
    # ...kilit/port çakışmasında servis 0 ile çıksın diye bayrak verilir (sonsuz deneme yok).
    assert p["EnvironmentVariables"][im.CONFLICT_ENV] == "1"
    assert p["ThrottleInterval"] >= 10


# ---------------------------------------------------------------- venv

def _venv_pkg(tmp_path: Path) -> Path:
    pkg = tmp_path / "pkg"
    (pkg / ".venv" / "bin").mkdir(parents=True)
    (pkg / ".venv" / "bin" / "python").write_text("", encoding="utf-8")
    return pkg


def test_venv_pip_basarisizsa_hazir_sayilmaz(tmp_path):
    calls = []

    def fake_run(args, **kw):
        calls.append(args)
        return im.subprocess.CompletedProcess(args, 1, "", "ERROR: paket bulunamadı")

    pkg = _venv_pkg(tmp_path)
    ctx = _ctx(tmp_path, run=fake_run, venv_python=sys.executable)
    with pytest.raises(im.StepError, match="pip install başarısız"):
        im.install_venv(ctx, pkg, "packages/bellek")
    assert str(pkg) not in ctx.venvs_done
    # Aynı çalıştırmadaki ikinci bileşen (devir) "hazır" demez, görünür biçimde düşer; pip yeniden koşmaz.
    with pytest.raises(im.StepError, match="kurulamadı"):
        im.install_venv(ctx, pkg, "packages/bellek")
    assert len(calls) == 1


def test_venv_basariliysa_ikinci_cagri_tekrar_kurmaz(tmp_path):
    calls = []

    def fake_run(args, **kw):
        calls.append(args)
        return im.subprocess.CompletedProcess(args, 0, "", "")

    pkg = _venv_pkg(tmp_path)
    ctx = _ctx(tmp_path, run=fake_run, venv_python=sys.executable)
    assert im.install_venv(ctx, pkg, "packages/bellek").status == "ok"
    r = im.install_venv(ctx, pkg, "packages/bellek")
    assert r.status == "ok" and "bu çalıştırmada hazırlandı" in r.message
    assert len(calls) == 1


def test_venv_dry_run_ikinci_cagrida_da_dry(tmp_path):
    ctx = _ctx(tmp_path, dry_run=True, run=lambda *a, **k: pytest.fail("dry-run komut çalıştırdı"))
    pkg = tmp_path / "pkg"
    assert im.install_venv(ctx, pkg, "packages/bellek").status == "dry"
    assert im.install_venv(ctx, pkg, "packages/bellek").status == "dry"
    assert not pkg.exists()


# ---------------------------------------------------------------- servis adı (beyin kurulmadan)

def _launchctl_kayit(calls):
    def fake_run(args, **kw):
        calls.append(args)
        rc = 113 if args[:2] == ["launchctl", "print"] else 0
        return im.subprocess.CompletedProcess(args, rc, "", "")
    return fake_run


def _plist_yaz(ctx: im.Ctx, name: str) -> Path:
    ctx.launch_agents.mkdir(parents=True, exist_ok=True)
    path = ctx.launch_agents / f"{im.SERVICE_LABEL}.plist"
    data = {"Label": im.SERVICE_LABEL, "ProgramArguments": ["/x/python", "-m", "bellek.beyin", "servis"],
            "EnvironmentVariables": {im.ENV_NAME: name, "BELLEK_BEYIN_IZINLI_HOST": "mac.tail.ts.net"}}
    path.write_bytes(plistlib.dumps(data))
    return path


@pytest.fixture()
def sahte_launchd(monkeypatch):
    monkeypatch.setattr(im.os, "getuid", lambda: 501, raising=False)
    monkeypatch.setattr(im, "_health", lambda *a, **k: True)
    monkeypatch.setattr(im.time, "sleep", lambda *_: None)


def test_ad_degisince_plist_guncellenir_servis_yeniden_yuklenir(tmp_path, sahte_launchd):
    calls = []
    ctx = _ctx(tmp_path, assistant_name="Bob", run=_launchctl_kayit(calls))
    path = _plist_yaz(ctx, "Ada")
    r = im.service_name_sync(ctx)
    assert r.status == "ok" and "Bob" in r.message
    d = plistlib.loads(path.read_bytes())
    assert d["EnvironmentVariables"][im.ENV_NAME] == "Bob"
    assert d["EnvironmentVariables"]["BELLEK_BEYIN_IZINLI_HOST"] == "mac.tail.ts.net"  # diğerleri korunur
    assert d["ProgramArguments"] == ["/x/python", "-m", "bellek.beyin", "servis"]
    assert plistlib.loads((ctx.backup_dir / "launchd" / path.name).read_bytes())["EnvironmentVariables"][im.ENV_NAME] == "Ada"
    assert [c[1] for c in calls] == ["bootout", "print", "bootstrap"]
    calls.clear()
    assert im.service_name_sync(ctx).status == "ok" and calls == []  # ad aynı: yeniden yükleme yok


def test_ad_settings_jsondan_okunur(tmp_path, sahte_launchd):
    calls = []
    ctx = _ctx(tmp_path, run=_launchctl_kayit(calls))
    ctx.settings.write_text(json.dumps({"env": {im.ENV_NAME: "Bob"}}), encoding="utf-8")
    path = _plist_yaz(ctx, "Ada")
    assert im.service_name_sync(ctx).status == "ok"
    assert plistlib.loads(path.read_bytes())["EnvironmentVariables"][im.ENV_NAME] == "Bob"


def test_plist_yoksa_ad_icin_plist_olusturulmaz(tmp_path):
    ctx = _ctx(tmp_path, assistant_name="Bob", run=lambda *a, **k: pytest.fail("launchctl çağrıldı"))
    assert im.service_name_sync(ctx).status == "skip"
    assert not ctx.launch_agents.exists()


def test_ad_esitleme_dry_run_yazmaz(tmp_path):
    ctx = _ctx(tmp_path, assistant_name="Bob", dry_run=True, run=lambda *a, **k: pytest.fail("launchctl çağrıldı"))
    path = _plist_yaz(ctx, "Ada")
    before = path.read_bytes()
    assert im.service_name_sync(ctx).status == "dry"
    assert path.read_bytes() == before and not (ctx.claude_home / "backups").exists()


def test_main_beyin_disi_bilesenle_ad_degisince_plist_yenilenir(tmp_path, monkeypatch):
    monkeypatch.setenv("EREN_KIT_FORCE_MACOS", "1")
    home = tmp_path / "claude"
    home.mkdir()
    plist = tmp_path / "LaunchAgents" / f"{im.SERVICE_LABEL}.plist"
    plist.parent.mkdir()
    plist.write_bytes(plistlib.dumps({"Label": im.SERVICE_LABEL, "EnvironmentVariables": {im.ENV_NAME: "Ada"}}))
    reloads = []
    monkeypatch.setattr(im, "_plist_path", lambda ctx: plist)
    monkeypatch.setattr(im, "_reload_service", lambda ctx, path: reloads.append(path) or im.Step("ok", "yüklendi"))
    args = ["--components", "kapi", "--claude-home", str(home), "--skip-mcp", "--skip-repo-setup",
            "--hook-python", sys.executable, "--assistant-name", "Bob"]
    assert im.main(args) == 0
    assert json.loads((home / "settings.json").read_text(encoding="utf-8"))["env"][im.ENV_NAME] == "Bob"
    assert plistlib.loads(plist.read_bytes())["EnvironmentVariables"][im.ENV_NAME] == "Bob"
    assert reloads == [plist]
    assert im.main(args) == 0 and reloads == [plist]  # tekrar çalıştırma: ad aynı, yeniden yükleme yok
    assert im.main(args + ["--uninstall"]) == 0 and plist.exists()  # kaldırma servis plist'ine dokunmaz


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


def test_main_kapi_hook_yorumlayiciyla_ve_filtreyle_kaydolur(tmp_path, monkeypatch):
    monkeypatch.setenv("EREN_KIT_FORCE_MACOS", "1")
    home = tmp_path / "claude"
    home.mkdir()
    args = ["--components", "kapi", "--claude-home", str(home), "--skip-mcp", "--no-service",
            "--skip-repo-setup", "--hook-python", "/opt/homebrew/bin/python3"]
    assert im.main(args) == 0
    d = json.loads((home / "settings.json").read_text(encoding="utf-8"))
    hs = [h for g in d["hooks"]["PreToolUse"] for h in g["hooks"]]
    assert hs and all(h["command"].startswith("/opt/homebrew/bin/python3 -I -S ") for h in hs)
    assert all(h.get("if", "").startswith("Read(") for h in hs)
    assert im.main(args + ["--uninstall"]) == 0
    assert "PreToolUse" not in json.loads((home / "settings.json").read_text(encoding="utf-8")).get("hooks", {})


# ---------------------------------------------------------------- eski kopya hook kayıtları

_ESKI_KAPI = 'python -I "C:/Bellek/src/bellek/kapi/hook.py"'


def _eski_kopyali_settings(home: Path) -> None:
    (home / "settings.json").write_text(json.dumps({"hooks": {"PreToolUse": [{"matcher": "Read", "hooks": [
        {"type": "command", "command": _ESKI_KAPI}]}]}}), encoding="utf-8")


def test_eski_kopya_varsayilanda_degistirilir(tmp_path):
    ctx = _ctx(tmp_path)
    _eski_kopyali_settings(ctx.claude_home)
    r = im.settings_hooks_step(ctx, "kapi")
    assert r.status == "ok" and "eski kopyanın 1 hook kaydı kaldırıldı" in r.message
    assert _ESKI_KAPI not in _hooks(ctx.settings)
    assert (ctx.backup_dir / "settings.json").exists()


def test_eski_kopya_keep_existing_ile_korunur(tmp_path):
    ctx = _ctx(tmp_path, keep_existing=True)
    _eski_kopyali_settings(ctx.claude_home)
    r = im.settings_hooks_step(ctx, "kapi")
    assert r.status == "warn" and "--keep-existing olmadan" in r.message
    assert "--replace-existing" not in r.message
    assert _ESKI_KAPI in _hooks(ctx.settings)


def test_keep_ve_replace_birlikte_verilemez(tmp_path):
    with pytest.raises(SystemExit):
        im.parse(["--keep-existing", "--replace-existing"])


# ---------------------------------------------------------------- other_events (başka olaydaki kayıtlar)

def _sahte_rapor(monkeypatch, comp: dict) -> None:
    base = {"added": 3, "removed": 0, "legacy_removed": 0, "legacy": []}
    monkeypatch.setattr(im.settings_hooks, "run", lambda ns: {
        "changed": True, "existed": True, "backup": None, "components": {"devir": {**base, **comp}}})


@pytest.mark.parametrize("dry", [False, True])
def test_other_events_doluysa_uyari_yazilir(tmp_path, monkeypatch, capsys, dry):
    _sahte_rapor(monkeypatch, {"other_events": [
        {"event": "PreToolUse", "command": 'python -I "C:/Bellek/src/bellek/devir/hook.py"'}]})
    r = im.settings_hooks_step(_ctx(tmp_path, dry_run=dry), "devir")
    out = capsys.readouterr().out
    assert r.status == "warn"
    assert "kurulum bu kayda dokunmadı" in r.message and "elle kaldırın" in r.message
    assert "PreToolUse olayında" in out and "C:/Bellek/src/bellek/devir/hook.py" in out


@pytest.mark.parametrize("comp", [{"other_events": []}, {}], ids=["bos", "eksik"])
def test_other_events_bos_ya_da_eksikse_sessiz(tmp_path, monkeypatch, capsys, comp):
    _sahte_rapor(monkeypatch, comp)
    r = im.settings_hooks_step(_ctx(tmp_path), "devir")
    assert r.status == "ok" and "dokunmadı" not in r.message
    assert "olayında" not in capsys.readouterr().out


def test_other_events_gercek_raporla_uyarir_ve_dokunmaz(tmp_path, capsys):
    ctx = _ctx(tmp_path)
    eski = 'python -I "C:/Bellek/src/bellek/devir/hook.py"'
    ctx.settings.write_text(json.dumps({"hooks": {"PreToolUse": [{"hooks": [
        {"type": "command", "command": eski}]}]}}), encoding="utf-8")
    r = im.settings_hooks_step(ctx, "devir")
    assert r.status == "warn" and "dokunmadı" in r.message
    assert "PreToolUse olayında" in capsys.readouterr().out
    assert eski in _hooks(ctx.settings)


# ---------------------------------------------------------------- kurulum doktoru

def test_doktor_komutu_claude_home_ve_json_gecer(tmp_path):
    cmd = im.doctor_command(tmp_path, as_json=True)
    assert cmd[:3] == [sys.executable, "-I", "-B"] and cmd[3].endswith("doktor.py")
    assert cmd[4:] == ["--claude-home", str(tmp_path), "--json"]
    assert "--claude-home" not in im.doctor_command(None)


def test_doktor_yalniz_doktoru_calistirir_cikis_kodunu_dondurur(tmp_path, monkeypatch):
    calls = []
    monkeypatch.setattr(im.subprocess, "run",
                        lambda cmd, **kw: calls.append(cmd) or im.subprocess.CompletedProcess(cmd, 1))
    monkeypatch.setattr(im, "build_steps", lambda ctx: pytest.fail("kurulum adımı çalıştı"))
    assert im.main(["--doctor", "--claude-home", str(tmp_path), "--json"]) == 1
    assert len(calls) == 1 and calls[0][-3:] == ["--claude-home", str(tmp_path), "--json"]
    assert not any(tmp_path.iterdir())


def test_doktor_dry_run_calistirmaz(tmp_path, monkeypatch):
    monkeypatch.setattr(im.subprocess, "run", lambda *a, **k: pytest.fail("doktor çalıştı"))
    assert im.main(["--doctor", "--dry-run", "--claude-home", str(tmp_path)]) == 0


def test_doktor_json_tek_basina_reddedilir(tmp_path):
    assert im.main(["--json", "--claude-home", str(tmp_path)]) == 2


@pytest.mark.parametrize("kod", [0, 1, 2, 7])
def test_doktor_kurulum_sonu_cikis_kodunu_degistirmez(tmp_path, monkeypatch, capsys, kod):
    monkeypatch.setenv("EREN_KIT_FORCE_MACOS", "1")
    home = tmp_path / "claude"
    home.mkdir()
    seen = []

    def sahte_doktor(cmd, **kw):
        seen.append(cmd)
        return im.subprocess.CompletedProcess(cmd, kod, "[uyarı] örnek: ayrıntı\n", "")

    orig_ctx = im.Ctx
    monkeypatch.setattr(im, "Ctx", lambda *a, **kw: orig_ctx(*a, **{**kw, "run": sahte_doktor}))
    args = ["--components", "kapi", "--claude-home", str(home), "--skip-mcp", "--no-service",
            "--skip-repo-setup", "--hook-python", sys.executable]
    assert im.main(args) == 0
    assert len(seen) == 1 and seen[0][-2:] == ["--claude-home", str(home.resolve())]
    out = capsys.readouterr().out
    assert "Kurulum doktoru" in out and "örnek: ayrıntı" in out


def test_doktor_cokerse_kurulum_basarili_biter(tmp_path, monkeypatch):
    monkeypatch.setenv("EREN_KIT_FORCE_MACOS", "1")
    home = tmp_path / "claude"
    home.mkdir()

    def patlayan(cmd, **kw):
        raise OSError("yok")

    orig_ctx = im.Ctx
    monkeypatch.setattr(im, "Ctx", lambda *a, **kw: orig_ctx(*a, **{**kw, "run": patlayan}))
    args = ["--components", "kapi", "--claude-home", str(home), "--skip-mcp", "--no-service",
            "--skip-repo-setup", "--hook-python", sys.executable]
    assert im.main(args) == 0


def test_doktor_kurulum_dry_run_da_calismaz(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("EREN_KIT_FORCE_MACOS", "1")
    home = tmp_path / "claude"
    home.mkdir()
    orig_ctx = im.Ctx
    monkeypatch.setattr(im, "Ctx", lambda *a, **kw: orig_ctx(
        *a, **{**kw, "run": lambda *x, **y: pytest.fail("dry-run komut çalıştırdı")}))
    args = ["--components", "kapi", "--claude-home", str(home), "--skip-mcp", "--no-service",
            "--skip-repo-setup", "--hook-python", sys.executable, "--dry-run"]
    assert im.main(args) == 0
    assert "doktor çalıştırılır" in capsys.readouterr().out
    assert list(home.iterdir()) == []


@pytest.mark.parametrize("bilesen", ["computer-use"])
def test_computer_use_macosta_yerlesik_yonlendirir(tmp_path, bilesen):
    r = im.computer_use_info(_ctx(tmp_path))
    assert r.status == "warn" and "/mcp" in r.message
