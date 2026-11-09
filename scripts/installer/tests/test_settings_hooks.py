"""settings_hooks.py testleri: kapi bileşeni + devir/orkestra gerilemesi.

Yalnız tmp_path kullanır; gerçek ~/.claude/settings.json'a dokunmaz.
"""

from __future__ import annotations

import copy
import json
import subprocess
import sys
from pathlib import Path

import pytest

HELPER = Path(__file__).resolve().parents[1] / "settings_hooks.py"

KAPI_TAIL = "packages/bellek/src/bellek/kapi/hook.py"
LEGACY_CMD = 'python -I -S "C:/Bellek/src/bellek/kapi/hook.py" || true'


@pytest.fixture
def repo(tmp_path):
    r = tmp_path / "eren-kit"
    for rel in (
        KAPI_TAIL,
        "packages/bellek/src/bellek/devir/hook.py",
        "packages/opus-orkestra/hooks/opus-orkestra-sessionstart.py",
    ):
        p = r / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text("", encoding="utf-8")
    return r


@pytest.fixture
def settings(tmp_path):
    return tmp_path / "claude" / "settings.json"


def write_settings(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def read_settings(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def run(settings, repo, components, *flags):
    proc = subprocess.run(
        [sys.executable, "-I", str(HELPER), "--settings", str(settings),
         "--repo", str(repo), "--components", components, *flags],
        capture_output=True, text=True, encoding="utf-8",
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr
    return json.loads(proc.stdout.strip().splitlines()[-1])


def kapi_handlers(repo):
    base = f'python -I -S "{Path(repo).as_posix()}/{KAPI_TAIL}" || true'
    return [
        {"type": "command", "command": base, "if": "Read(//**/*.md)", "timeout": 10},
        {"type": "command", "command": base, "if": "Read(//**/*.markdown)", "timeout": 10},
    ]


def all_handlers(data, event):
    return [h for g in data.get("hooks", {}).get(event, []) for h in g.get("hooks", [])]


def test_kapi_install_empty(settings, repo):
    rep = run(settings, repo, "kapi")
    c = rep["components"]["kapi"]
    assert c["added"] == 2 and c["removed"] == 0
    assert c["legacy_removed"] == 0 and c["legacy"] == []
    data = read_settings(settings)
    groups = data["hooks"]["PreToolUse"]
    assert groups == [{"matcher": "Read", "hooks": kapi_handlers(repo)}]
    assert list(data["hooks"]) == ["PreToolUse"]


def test_kapi_idempotent(settings, repo):
    run(settings, repo, "kapi")
    first = settings.read_text(encoding="utf-8")
    rep = run(settings, repo, "kapi")
    assert rep["changed"] is False
    assert settings.read_text(encoding="utf-8") == first
    assert all_handlers(read_settings(settings), "PreToolUse") == kapi_handlers(repo)


def test_kapi_preserves_user_groups_and_same_matcher_handler(settings, repo):
    other_group = {"matcher": "Bash", "hooks": [{"type": "command", "command": "echo b"}]}
    user_read = {"matcher": "Read", "hooks": [{"type": "command", "command": "echo kullanici"}]}
    original = {"hooks": {"PreToolUse": [other_group, user_read],
                          "Stop": [{"hooks": [{"type": "command", "command": "echo s"}]}]}}
    write_settings(settings, copy.deepcopy(original))
    run(settings, repo, "kapi")
    data = read_settings(settings)
    pre = data["hooks"]["PreToolUse"]
    assert other_group in pre
    handlers = [h for g in pre for h in g["hooks"]]
    assert handlers.count({"type": "command", "command": "echo kullanici"}) == 1
    for h in kapi_handlers(repo):
        assert handlers.count(h) == 1
    assert data["hooks"]["Stop"] == original["hooks"]["Stop"]
    run(settings, repo, "kapi")  # tekrar: çoğalma yok
    assert len(all_handlers(read_settings(settings), "PreToolUse")) == len(handlers)
    # kaldırınca özgün hale dönülür
    run(settings, repo, "kapi", "--uninstall")
    assert read_settings(settings) == original


def test_replace_legacy_removes_with_and_without_if(settings, repo):
    legacy_if = {"type": "command", "command": LEGACY_CMD, "if": "Read(//**/*.md)", "timeout": 10}
    legacy_plain = {"type": "command", "command": LEGACY_CMD, "timeout": 10}
    user = {"type": "command", "command": "echo kalsin"}
    write_settings(settings, {"hooks": {
        "PreToolUse": [{"matcher": "Read", "hooks": [legacy_if, legacy_plain]},
                       {"matcher": "Bash", "hooks": [user]}],
        "SessionStart": [{"hooks": [legacy_plain]}],
    }})
    rep = run(settings, repo, "kapi", "--replace-legacy")
    c = rep["components"]["kapi"]
    assert c["legacy_removed"] == 3 and c["legacy"] == []
    data = read_settings(settings)
    assert "SessionStart" not in data["hooks"]  # boşalan olay temizlendi
    pre = data["hooks"]["PreToolUse"]
    cmds = [h["command"] for g in pre for h in g["hooks"]]
    assert LEGACY_CMD not in cmds
    assert all(g["hooks"] for g in pre)  # boş grup kalmadı
    assert {"matcher": "Bash", "hooks": [user]} in pre
    assert all_handlers(data, "PreToolUse").count(user) == 1
    for h in kapi_handlers(repo):
        assert all_handlers(data, "PreToolUse").count(h) == 1


def test_legacy_kept_and_reported_without_flag(settings, repo):
    legacy = {"type": "command", "command": LEGACY_CMD, "timeout": 10}
    write_settings(settings, {"hooks": {"PreToolUse": [{"matcher": "Read", "hooks": [legacy]}]}})
    rep = run(settings, repo, "kapi")
    c = rep["components"]["kapi"]
    assert c["legacy_removed"] == 0
    assert c["legacy"] == [LEGACY_CMD]
    handlers = all_handlers(read_settings(settings), "PreToolUse")
    assert legacy in handlers
    for h in kapi_handlers(repo):
        assert h in handlers


def test_uninstall_only_ours_and_cleans_up(settings, repo):
    legacy = {"type": "command", "command": LEGACY_CMD}
    user = {"type": "command", "command": "echo u"}
    write_settings(settings, {"model": "opus", "hooks": {
        "PreToolUse": [{"matcher": "Read", "hooks": [user, legacy]}]}})
    run(settings, repo, "kapi")
    rep = run(settings, repo, "kapi", "--uninstall")
    assert rep["components"]["kapi"]["removed"] == 2
    data = read_settings(settings)
    assert data["hooks"]["PreToolUse"] == [{"matcher": "Read", "hooks": [user, legacy]}]

    # yalnız bizimkiler varsa olay ve hooks alanı da kalkar
    solo = settings.parent / "solo.json"
    write_settings(solo, {"env": {"A": "1"}})
    run(solo, repo, "kapi")
    run(solo, repo, "kapi", "--uninstall")
    assert read_settings(solo) == {"env": {"A": "1"}}


def test_dry_run_does_not_write(settings, repo, tmp_path):
    write_settings(settings, {"env": {"X": "1"}})
    before = settings.read_text(encoding="utf-8")
    bk = tmp_path / "bk"
    rep = run(settings, repo, "kapi", "--dry-run", "--backup-dir", str(bk))
    assert rep["dry_run"] is True and rep["changed"] is True
    assert settings.read_text(encoding="utf-8") == before
    assert not bk.exists()
    missing = settings.parent / "yok.json"
    run(missing, repo, "kapi", "--dry-run")
    assert not missing.exists()


def test_backup_only_when_changed(settings, repo, tmp_path):
    write_settings(settings, {"env": {"X": "1"}})
    original = settings.read_text(encoding="utf-8")
    bk = tmp_path / "bk"
    rep = run(settings, repo, "kapi", "--backup-dir", str(bk))
    assert rep["backup"] and (bk / "settings.json").read_text(encoding="utf-8") == original
    bk2 = tmp_path / "bk2"
    rep2 = run(settings, repo, "kapi", "--backup-dir", str(bk2))
    assert rep2["changed"] is False and rep2["backup"] is None
    assert not (bk2 / "settings.json").exists()


def test_devir_orkestra_no_matcher_and_shape(settings, repo):
    rep = run(settings, repo, "devir,orkestra")
    assert rep["components"]["devir"]["added"] == 3
    assert rep["components"]["orkestra"]["added"] == 4
    data = read_settings(settings)
    r = Path(repo).as_posix()
    devir_cmd = f'python -I "{r}/packages/bellek/src/bellek/devir/hook.py" || true'
    assert data["hooks"]["Stop"] == [{"hooks": [{"type": "command", "command": devir_cmd, "timeout": 10}]}]
    assert data["hooks"]["UserPromptSubmit"][0]["hooks"][0]["timeout"] == 5
    ork = data["hooks"]["SessionStart"]
    ork_hooks = [h for g in ork for h in g["hooks"] if "--parca" in h["command"]]
    assert len(ork_hooks) == 4
    assert ork_hooks[0]["statusMessage"] == "Opus Orkestra kuralı yükleniyor..."
    for groups in data["hooks"].values():
        for g in groups:
            assert "matcher" not in g
    assert run(settings, repo, "devir,orkestra")["changed"] is False


def test_all_components_together_no_matcher_on_old(settings, repo):
    run(settings, repo, "devir,orkestra,kapi")
    data = read_settings(settings)
    for event, groups in data["hooks"].items():
        for g in groups:
            if event == "PreToolUse":
                assert g["matcher"] == "Read"
            else:
                assert "matcher" not in g


def test_other_top_level_keys_preserved(settings, repo):
    original = {"permissions": {"allow": ["Bash(ls)"]}, "env": {"A": "b"}, "model": "opus",
                "hooks": {"Notification": [{"hooks": [{"type": "command", "command": "echo n"}]}]}}
    write_settings(settings, copy.deepcopy(original))
    run(settings, repo, "devir,orkestra,kapi")
    data = read_settings(settings)
    for k in ("permissions", "env", "model"):
        assert data[k] == original[k]
    assert data["hooks"]["Notification"] == original["hooks"]["Notification"]
    run(settings, repo, "devir,orkestra,kapi", "--uninstall")
    assert read_settings(settings) == original


def test_turkish_content_preserved(settings, repo):
    original = {"not": "Çalışma öğrenci şğıöüç İ", "env": {"ŞEHİR": "İstanbul"},
                "hooks": {"Stop": [{"hooks": [{"type": "command", "command": "echo Güle güle"}]}]}}
    write_settings(settings, copy.deepcopy(original))
    run(settings, repo, "devir,kapi")
    text = settings.read_text(encoding="utf-8")
    assert "Çalışma öğrenci şğıöüç İ" in text and "İstanbul" in text and "Güle güle" in text
    assert not text.startswith("\ufeff")
    run(settings, repo, "devir,kapi", "--uninstall")
    assert read_settings(settings) == original


def test_replace_legacy_kapi_keeps_legacy_devir(settings, repo):
    legacy_devir = {"type": "command",
                    "command": 'python -I "C:/Bellek/src/bellek/devir/hook.py" || true',
                    "timeout": 10}
    legacy_kapi = {"type": "command", "command": LEGACY_CMD, "timeout": 10}
    write_settings(settings, {"hooks": {
        "SessionStart": [{"hooks": [legacy_devir]}],
        "PreToolUse": [{"matcher": "Read", "hooks": [legacy_kapi]}],
    }})
    rep = run(settings, repo, "kapi", "--replace-legacy")
    assert rep["components"]["kapi"]["legacy_removed"] == 1
    data = read_settings(settings)
    assert data["hooks"]["SessionStart"] == [{"hooks": [legacy_devir]}]
    assert legacy_kapi not in all_handlers(data, "PreToolUse")
    assert all_handlers(data, "PreToolUse") == kapi_handlers(repo)


def test_replace_legacy_second_run_is_noop(settings, repo):
    legacy_kapi = {"type": "command", "command": LEGACY_CMD, "timeout": 10}
    write_settings(settings, {"hooks": {"PreToolUse": [{"matcher": "Read", "hooks": [legacy_kapi]}]}})
    run(settings, repo, "kapi", "--replace-legacy")
    first = settings.read_bytes()
    rep = run(settings, repo, "kapi", "--replace-legacy")
    assert rep["changed"] is False
    assert rep["components"]["kapi"]["legacy_removed"] == 0
    assert settings.read_bytes() == first
