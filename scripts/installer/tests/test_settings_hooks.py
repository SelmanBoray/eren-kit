"""settings_hooks.py testleri: kapi bileşeni + devir/orkestra gerilemesi.

Yalnız tmp_path kullanır; gerçek ~/.claude/settings.json'a dokunmaz.
"""

from __future__ import annotations

import copy
import importlib.util
import json
import re
import subprocess
import sys
import time
from pathlib import Path

import pytest

HELPER = Path(__file__).resolve().parents[1] / "settings_hooks.py"

KAPI_TAIL = "packages/bellek/src/bellek/kapi/hook.py"
DEVIR_TAIL = "packages/bellek/src/bellek/devir/hook.py"
ORK_TAIL = "packages/opus-orkestra/hooks/opus-orkestra-sessionstart.py"
LEGACY_CMD = 'python -I -S "C:/Bellek/src/bellek/kapi/hook.py" || true'
LEGACY_DEVIR_CMD = 'python -I "C:/Bellek/src/bellek/devir/hook.py" || true'
DEVIR_EVENTS = {"SessionStart": 10, "UserPromptSubmit": 5, "Stop": 10}
WINDOWS = sys.platform == "win32"


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


def kapi_cmd(repo):
    return f'python -I -S "{Path(repo).as_posix()}/{KAPI_TAIL}" || true'


def kapi_handlers(repo):
    base = kapi_cmd(repo)
    return [
        {"type": "command", "command": base, "if": "Read(//**/*.md)", "timeout": 10},
        {"type": "command", "command": base, "if": "Read(//**/*.markdown)", "timeout": 10},
    ]


def all_handlers(data, event):
    return [h for g in data.get("hooks", {}).get(event, []) for h in g.get("hooks", [])]


# --- yazılış biçiminden bağımsız tanıma (testin kendi, üretimden bağımsız ölçütü) ---

def _n(cmd) -> str:
    s = str(cmd).replace("\\", "/").replace('"', "").replace("'", "")
    return re.sub(r"/+", "/", s).lower()


def _cmd(h):
    return h.get("command", "") if isinstance(h, dict) else ""


def is_kapi(h) -> bool:
    if h in FOREIGN:
        return False
    c = _n(_cmd(h))
    return "/bellek/kapi/hook.py" in c or "-m bellek.kapi.hook" in c


def is_devir(h) -> bool:
    if h in FOREIGN:
        return False
    c = _n(_cmd(h))
    return "/bellek/devir/hook.py" in c or "-m bellek.devir.hook" in c


def is_ork(h) -> bool:
    return h not in FOREIGN and "opus-orkestra-sessionstart.py" in _n(_cmd(h))


def every_handler(data):
    return [h for groups in data.get("hooks", {}).values() for g in groups for h in g.get("hooks", [])]


def groups_with(data, event, pred):
    return [g for g in data.get("hooks", {}).get(event, []) if any(pred(h) for h in g.get("hooks", []))]


def ours_in(data, event, pred):
    return [h for g in groups_with(data, event, pred) for h in g["hooks"] if pred(h)]


def assert_single_kapi(data, repo):
    """Kapı: PreToolUse'da tek Read grubu (md+markdown), SessionStart'ta tek compact kaydı, başka yerde yok."""
    pre = groups_with(data, "PreToolUse", is_kapi)
    assert len(pre) == 1, pre
    assert pre[0].get("matcher") == "Read"
    assert ours_in(data, "PreToolUse", is_kapi) == kapi_handlers(repo)
    ss = groups_with(data, "SessionStart", is_kapi)
    assert len(ss) == 1, ss
    assert ss[0].get("matcher") == "compact"
    ss_h = ours_in(data, "SessionStart", is_kapi)
    assert len(ss_h) == 1, ss_h
    assert ss_h[0]["command"] == kapi_cmd(repo)
    for event in data.get("hooks", {}):
        if event not in ("PreToolUse", "SessionStart"):
            assert not ours_in(data, event, is_kapi), event


def assert_single_devir(data, repo):
    """Devir: üç olayın her birinde tam bir kayıt; komut repodaki betiği gösterir ve || true ile biter."""
    path = _n(f"{Path(repo).as_posix()}/{DEVIR_TAIL}")
    cmds = set()
    for event, timeout in DEVIR_EVENTS.items():
        hs = ours_in(data, event, is_devir)
        assert len(hs) == 1, (event, hs)
        assert len(groups_with(data, event, is_devir)) == 1
        assert path in _n(hs[0]["command"])
        assert hs[0]["command"].rstrip().endswith("|| true")
        assert hs[0]["timeout"] == timeout
        cmds.add(hs[0]["command"])
    assert len(cmds) == 1
    for event in data.get("hooks", {}):
        if event not in DEVIR_EVENTS:
            assert not ours_in(data, event, is_devir), event


def kapi_pair(cmd):
    return [{"type": "command", "command": cmd, "if": "Read(//**/*.md)", "timeout": 10},
            {"type": "command", "command": cmd, "if": "Read(//**/*.markdown)", "timeout": 10}]


# Bize ait olmayan, kalması gereken hook'lar (yolunda "kapi"/"devir" geçenler dahil).
USER_HOOKS = [
    {"type": "command", "command": "python C:/tools/benim_hook.py"},
    {"type": "command", "command": 'python "C:/baska/kapi/hook.py"', "timeout": 3},
    {"type": "command", "command": "python -m benimpaket.kapi.hook"},
    {"type": "command", "command": 'python -I "C:/baska/devir/hook.py" || true'},
    {"type": "command", "command": "python C:/baska/orkestra/sessionstart.py --parca 1"},
    # h1: yol, yorumlayıcının çalıştırdığı betik değil -> bize ait değil
    {"type": "command", "command": 'node "D:/projelerim/bellek/kapi/hook.py" --benim'},
    {"type": "command", "command": "python my_linter.py --skip /bellek/devir/hook.py"},
    {"type": "command", "command": 'bash -c "python C:/Bellek/src/bellek/kapi/hook.py"'},
]
NODE_HOOK, LINTER_HOOK, BASH_WRAPPED = USER_HOOKS[5], USER_HOOKS[6], USER_HOOKS[7]
PRECOMPACT_LEGACY = {"type": "command",
                     "command": 'python "C:/Bellek/src/bellek/devir/hook.py" --precompact'}
FOREIGN = USER_HOOKS + [PRECOMPACT_LEGACY]


def load_module():
    spec = importlib.util.spec_from_file_location("_settings_hooks_under_test", HELPER)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def main_args(settings, repo, components, *flags):
    return ["--settings", str(settings), "--repo", str(repo), "--components", components, *flags]


# ---------------------------------------------------------------- mevcut testler

def test_kapi_install_empty(settings, repo):
    rep = run(settings, repo, "kapi")
    c = rep["components"]["kapi"]
    assert c["removed"] == 0
    assert c["legacy_removed"] == 0 and c["legacy"] == []
    data = read_settings(settings)
    groups = data["hooks"]["PreToolUse"]
    assert groups == [{"matcher": "Read", "hooks": kapi_handlers(repo)}]
    # Kapı ayrıca SessionStart/compact'a kaydolur (sözleşme d).
    assert sorted(data["hooks"]) == ["PreToolUse", "SessionStart"]
    ss = data["hooks"]["SessionStart"]
    assert len(ss) == 1 and ss[0]["matcher"] == "compact"
    assert [h["command"] for h in ss[0]["hooks"]] == [kapi_cmd(repo)]
    assert c["added"] == len(every_handler(data))


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
    # boşalan eski SessionStart grubu temizlendi; yalnız bizim compact kaydımız kaldı
    assert [h["command"] for h in all_handlers(data, "SessionStart")] == [kapi_cmd(repo)]
    assert all(g["hooks"] for g in data["hooks"]["SessionStart"])
    pre = data["hooks"]["PreToolUse"]
    cmds = [h["command"] for g in pre for h in g["hooks"]]
    assert LEGACY_CMD not in cmds
    assert all(g["hooks"] for g in pre)  # boş grup kalmadı
    assert {"matcher": "Bash", "hooks": [user]} in pre
    assert all_handlers(data, "PreToolUse").count(user) == 1
    for h in kapi_handlers(repo):
        assert all_handlers(data, "PreToolUse").count(h) == 1


def test_legacy_replaced_by_default(settings, repo, tmp_path):
    legacy = {"type": "command", "command": LEGACY_CMD, "timeout": 10}
    write_settings(settings, {"hooks": {"PreToolUse": [{"matcher": "Read", "hooks": [legacy]}]}})
    original = settings.read_text(encoding="utf-8")
    bk = tmp_path / "bk"
    rep = run(settings, repo, "kapi", "--backup-dir", str(bk))
    c = rep["components"]["kapi"]
    assert c["legacy_removed"] == 1
    assert c["legacy"] == []
    data = read_settings(settings)
    assert legacy not in every_handler(data)
    assert_single_kapi(data, repo)
    assert data["hooks"]["PreToolUse"] == [{"matcher": "Read", "hooks": kapi_handlers(repo)}]
    assert (bk / "settings.json").read_text(encoding="utf-8") == original  # yedekli


def test_keep_legacy_keeps_and_reports(settings, repo):
    legacy = {"type": "command", "command": LEGACY_CMD, "timeout": 10}
    write_settings(settings, {"hooks": {"PreToolUse": [{"matcher": "Read", "hooks": [legacy]}]}})
    rep = run(settings, repo, "kapi", "--keep-legacy")
    c = rep["components"]["kapi"]
    assert c["legacy_removed"] == 0
    assert c["legacy"] == [LEGACY_CMD]  # uyarı (install betiği bunu gösterir)
    handlers = all_handlers(read_settings(settings), "PreToolUse")
    assert handlers.count(legacy) == 1
    for h in kapi_handlers(repo):
        assert handlers.count(h) == 1
    first = settings.read_bytes()
    rep2 = run(settings, repo, "kapi", "--keep-legacy")
    assert rep2["changed"] is False and settings.read_bytes() == first


def test_uninstall_only_ours_and_cleans_up(settings, repo):
    legacy = {"type": "command", "command": LEGACY_CMD}
    user = {"type": "command", "command": "echo u"}
    write_settings(settings, {"model": "opus", "hooks": {
        "PreToolUse": [{"matcher": "Read", "hooks": [user, legacy]}]}})
    run(settings, repo, "kapi", "--keep-legacy")
    installed = [h for h in every_handler(read_settings(settings)) if h != legacy and is_kapi(h)]
    rep = run(settings, repo, "kapi", "--uninstall")
    assert rep["components"]["kapi"]["removed"] == len(installed) == 3
    data = read_settings(settings)
    assert data["hooks"] == {"PreToolUse": [{"matcher": "Read", "hooks": [user, legacy]}]}

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
    # -S olabilir de olmayabilir de (sözleşme f)
    devir_re = re.compile(r'^python -I( -S)? "' + re.escape(f"{r}/{DEVIR_TAIL}") + r'" \|\| true$')
    stop = data["hooks"]["Stop"]
    assert len(stop) == 1 and list(stop[0]) == ["hooks"] and len(stop[0]["hooks"]) == 1
    devir_h = stop[0]["hooks"][0]
    assert devir_re.match(devir_h["command"]), devir_h
    assert devir_h == {"type": "command", "command": devir_h["command"], "timeout": 10}
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
            elif event == "SessionStart" and any(is_kapi(h) for h in g["hooks"]):
                assert g["matcher"] == "compact"
                assert all(is_kapi(h) for h in g["hooks"])
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
                    "command": LEGACY_DEVIR_CMD,
                    "timeout": 10}
    legacy_kapi = {"type": "command", "command": LEGACY_CMD, "timeout": 10}
    write_settings(settings, {"hooks": {
        "SessionStart": [{"hooks": [legacy_devir]}],
        "PreToolUse": [{"matcher": "Read", "hooks": [legacy_kapi]}],
    }})
    rep = run(settings, repo, "kapi", "--replace-legacy")
    assert rep["components"]["kapi"]["legacy_removed"] == 1
    data = read_settings(settings)
    # yalnız kapı işlendi: devirin eski kaydı kendi grubunda dokunulmadan durur
    assert {"hooks": [legacy_devir]} in data["hooks"]["SessionStart"]
    assert [g for g in data["hooks"]["SessionStart"] if not any(is_kapi(h) for h in g["hooks"])] \
        == [{"hooks": [legacy_devir]}]
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


# ---------------------------------------------------------------- regresyon testleri

LEGACY_KAPI_VARIANTS = {
    "duz_bolu_tirnakli": LEGACY_CMD,
    "duz_bolu_tirnaksiz": "python -I -S C:/Bellek/src/bellek/kapi/hook.py || true",
    "ters_bolu": 'python -I -S "C:\\Bellek\\src\\bellek\\kapi\\hook.py" || true',
    "cift_ters_bolu": 'python -I -S "C:\\\\Bellek\\\\src\\\\bellek\\\\kapi\\\\hook.py" || true',
    "cift_duz_bolu": 'python -I -S "C://Bellek//src//bellek//kapi//hook.py" || true',
    "tek_tirnak": "python -I -S 'C:/Bellek/src/bellek/kapi/hook.py' || true",
    "modul": "python -m bellek.kapi.hook || true",
    "modul_yalin": "python -m bellek.kapi.hook",
    "py": 'py -I -S "C:/Bellek/src/bellek/kapi/hook.py" || true',
    "python3": 'python3 -I -S "C:/Bellek/src/bellek/kapi/hook.py" || true',
    "python3_12": "python3.12 -I -S C:/Bellek/src/bellek/kapi/hook.py || true",
    "tam_yol_exe": '"C:/Python312/python.exe" -I -S "C:/Bellek/src/bellek/kapi/hook.py" || true',
    "tam_yol_exe_ters": '"C:\\Python312\\python.exe" -I -S "C:\\Bellek\\src\\bellek\\kapi\\hook.py" || true',
    "tam_yol_unix": '/usr/local/bin/python3 -I -S "C:/Bellek/src/bellek/kapi/hook.py" || true',
}
if WINDOWS:
    LEGACY_KAPI_VARIANTS["buyuk_harf"] = 'PYTHON -I -S "C:/BELLEK/SRC/BELLEK/KAPI/HOOK.PY" || true'


@pytest.mark.parametrize("cmd", list(LEGACY_KAPI_VARIANTS.values()), ids=list(LEGACY_KAPI_VARIANTS))
def test_kapi_variant_registration_collapses_to_one(settings, repo, cmd):
    write_settings(settings, {"hooks": {
        "PreToolUse": [{"matcher": "Read", "hooks": kapi_pair(cmd)},
                       {"matcher": "Bash", "hooks": copy.deepcopy(USER_HOOKS)}],
    }})
    run(settings, repo, "kapi")
    data = read_settings(settings)
    assert all(h.get("command") != cmd for h in every_handler(data))
    assert_single_kapi(data, repo)
    assert {"matcher": "Bash", "hooks": USER_HOOKS} in data["hooks"]["PreToolUse"]


def _repo_spellings(repo):
    win = str(repo).replace("/", "\\")
    out = {
        "ters_bolu": win + "\\" + KAPI_TAIL.replace("/", "\\"),
        "cift_ters_bolu": (win + "\\" + KAPI_TAIL.replace("/", "\\")).replace("\\", "\\\\"),
        "cift_duz_bolu": Path(repo).as_posix() + "//" + KAPI_TAIL.replace("/", "//"),
    }
    if WINDOWS:
        out["buyuk_harf"] = (Path(repo).as_posix() + "/" + KAPI_TAIL).upper()
    return out


@pytest.mark.parametrize("spelling", ["ters_bolu", "cift_ters_bolu", "cift_duz_bolu", "buyuk_harf"])
def test_kapi_own_path_other_spelling_no_duplicate(settings, repo, spelling):
    spellings = _repo_spellings(repo)
    if spelling not in spellings:
        pytest.skip("büyük/küçük harf duyarsızlığı yalnız Windows'ta beklenir")
    cmd = f'python -I -S "{spellings[spelling]}" || true'
    write_settings(settings, {"hooks": {"PreToolUse": [{"matcher": "Read", "hooks": kapi_pair(cmd)}]}})
    run(settings, repo, "kapi")
    data = read_settings(settings)
    assert_single_kapi(data, repo)
    assert data["hooks"]["PreToolUse"] == [{"matcher": "Read", "hooks": kapi_handlers(repo)}]


def test_kapi_two_read_groups_collapse(settings, repo):
    write_settings(settings, {"hooks": {"PreToolUse": [
        {"matcher": "Read", "hooks": kapi_handlers(repo)},
        {"matcher": "Bash", "hooks": [USER_HOOKS[0]]},
        {"matcher": "Read", "hooks": kapi_handlers(repo)},
        {"matcher": "Read", "hooks": kapi_pair(LEGACY_CMD)},
    ]}})
    run(settings, repo, "kapi")
    data = read_settings(settings)
    assert_single_kapi(data, repo)
    assert {"matcher": "Bash", "hooks": [USER_HOOKS[0]]} in data["hooks"]["PreToolUse"]


def test_kapi_duplicate_compact_collapses(settings, repo):
    compact = {"matcher": "compact", "hooks": [{"type": "command", "command": kapi_cmd(repo)}]}
    write_settings(settings, {"hooks": {"SessionStart": [compact, copy.deepcopy(compact),
                                                         {"matcher": "compact", "hooks": [
                                                             {"type": "command", "command": LEGACY_CMD}]}]}})
    run(settings, repo, "kapi")
    assert_single_kapi(read_settings(settings), repo)


LEGACY_DEVIR_VARIANTS = {
    "duz_bolu_tirnakli": LEGACY_DEVIR_CMD,
    "duz_bolu_tirnaksiz": "python -I C:/Bellek/src/bellek/devir/hook.py || true",
    "ters_bolu": 'python -I "C:\\Bellek\\src\\bellek\\devir\\hook.py" || true',
    "cift_ters_bolu": 'python -I "C:\\\\Bellek\\\\src\\\\bellek\\\\devir\\\\hook.py" || true',
    "modul": "python -m bellek.devir.hook || true",
}
if WINDOWS:
    LEGACY_DEVIR_VARIANTS["buyuk_harf"] = 'python -I "C:/BELLEK/SRC/BELLEK/DEVIR/HOOK.PY" || true'


@pytest.mark.parametrize("cmd", list(LEGACY_DEVIR_VARIANTS.values()), ids=list(LEGACY_DEVIR_VARIANTS))
def test_devir_variant_registration_collapses_to_one(settings, repo, cmd):
    hooks = {e: [{"hooks": [{"type": "command", "command": cmd, "timeout": t}]},
                 {"hooks": [copy.deepcopy(USER_HOOKS[3])]}]
             for e, t in DEVIR_EVENTS.items()}
    write_settings(settings, {"hooks": hooks})
    run(settings, repo, "devir")
    data = read_settings(settings)
    assert all(h.get("command") != cmd for h in every_handler(data))
    assert_single_devir(data, repo)
    for e in DEVIR_EVENTS:
        assert all_handlers(data, e).count(USER_HOOKS[3]) == 1


def test_devir_own_duplicates_and_spellings_collapse(settings, repo):
    win = (str(repo).replace("/", "\\") + "\\" + DEVIR_TAIL.replace("/", "\\")).replace("\\", "\\\\")
    own = f'python -I "{Path(repo).as_posix()}/{DEVIR_TAIL}" || true'
    hooks = {e: [{"hooks": [{"type": "command", "command": own, "timeout": t}]},
                 {"hooks": [{"type": "command", "command": f'python -I "{win}" || true', "timeout": t}]},
                 {"hooks": [{"type": "command", "command": LEGACY_DEVIR_CMD, "timeout": t}]}]
             for e, t in DEVIR_EVENTS.items()}
    write_settings(settings, {"hooks": hooks})
    run(settings, repo, "devir")
    assert_single_devir(read_settings(settings), repo)


def test_devir_keep_legacy(settings, repo):
    legacy = {"type": "command", "command": LEGACY_DEVIR_CMD, "timeout": 10}
    write_settings(settings, {"hooks": {"Stop": [{"hooks": [legacy]}]}})
    rep = run(settings, repo, "devir", "--keep-legacy")
    assert rep["components"]["devir"]["legacy"] == [LEGACY_DEVIR_CMD]
    stop = all_handlers(read_settings(settings), "Stop")
    assert stop.count(legacy) == 1 and len([h for h in stop if is_devir(h)]) == 2


def test_orkestra_duplicates_collapse_and_commands_tolerate_failure(settings, repo):
    run(settings, repo, "orkestra")
    ours = read_settings(settings)["hooks"]["SessionStart"][0]
    legacy = {"hooks": [{"type": "command",
                         "command": 'python -I "C:\\\\eski\\\\opus-orkestra-sessionstart.py" --parca 1'}]}
    write_settings(settings, {"hooks": {"SessionStart": [ours, copy.deepcopy(ours), legacy,
                                                         {"hooks": [USER_HOOKS[4]]}]}})
    run(settings, repo, "orkestra")
    data = read_settings(settings)
    groups = groups_with(data, "SessionStart", is_ork)
    assert len(groups) == 1 and len(groups[0]["hooks"]) == 4
    for h in groups[0]["hooks"]:
        assert re.search(r"\|\|\s*(true|exit 0|:)\s*$", h["command"]), h["command"]
        assert Path(repo).as_posix() + "/" + ORK_TAIL in h["command"]
    assert {"hooks": [USER_HOOKS[4]]} in data["hooks"]["SessionStart"]


def _messy_settings(repo):
    """Eski kopyalar, yinelenen gruplar ve ilgisiz kullanıcı hook'ları karışık."""
    return {
        "model": "opus",
        "bilinmeyen_anahtar": {"ic": [1, 2, "üç"]},
        "hooks": {
            "PreToolUse": [
                {"matcher": "Read", "hooks": [USER_HOOKS[1], BASH_WRAPPED] + kapi_pair(LEGACY_CMD)},
                {"matcher": "Read", "hooks": kapi_pair(
                    'python -I -S "C:\\\\Bellek\\\\src\\\\bellek\\\\kapi\\\\hook.py" || true')},
                {"matcher": "Read", "hooks": kapi_handlers(repo), "aciklama": "bizim"},
                {"matcher": "Bash", "hooks": [USER_HOOKS[0], USER_HOOKS[2]], "ozel": True},
            ],
            "SessionStart": [
                {"hooks": [{"type": "command", "command": LEGACY_DEVIR_CMD, "timeout": 10}]},
                {"hooks": [USER_HOOKS[4]]},
            ],
            "Stop": [
                {"hooks": [{"type": "command", "command": "python -m bellek.devir.hook || true"},
                           USER_HOOKS[3], LINTER_HOOK]},
            ],
            "PostToolUse": [{"matcher": "Edit", "hooks": [NODE_HOOK]}],
            "PreCompact": [{"hooks": [PRECOMPACT_LEGACY]}],
            "Notification": [{"hooks": [{"type": "command", "command": "echo n", "x-ozel": 1}]}],
        },
    }


def test_user_hooks_and_unknown_keys_preserved(settings, repo):
    original = _messy_settings(repo)
    write_settings(settings, copy.deepcopy(original))
    run(settings, repo, "devir,orkestra,kapi")
    data = read_settings(settings)
    assert data["model"] == "opus" and data["bilinmeyen_anahtar"] == original["bilinmeyen_anahtar"]
    assert data["hooks"]["Notification"] == original["hooks"]["Notification"]
    for u in USER_HOOKS:
        before = sum(h == u for h in every_handler(original))
        assert sum(h == u for h in every_handler(data)) == before, u
    assert {"matcher": "Bash", "hooks": [USER_HOOKS[0], USER_HOOKS[2]], "ozel": True} \
        in data["hooks"]["PreToolUse"]
    assert_single_kapi(data, repo)
    assert_single_devir(data, repo)
    assert len(ours_in(data, "SessionStart", is_ork)) == 4


def test_messy_install_is_byte_idempotent(settings, repo):
    write_settings(settings, _messy_settings(repo))
    run(settings, repo, "devir,orkestra,kapi")
    first = settings.read_bytes()
    rep = run(settings, repo, "devir,orkestra,kapi")
    assert rep["changed"] is False
    assert settings.read_bytes() == first


def test_replace_legacy_flag_same_as_default(settings, repo):
    other = settings.parent / "other.json"
    write_settings(settings, _messy_settings(repo))
    write_settings(other, _messy_settings(repo))
    run(settings, repo, "devir,orkestra,kapi")
    run(other, repo, "devir,orkestra,kapi", "--replace-legacy")
    assert settings.read_bytes() == other.read_bytes()


def test_uninstall_removes_all_ours_keeps_unrelated(settings, repo):
    write_settings(settings, _messy_settings(repo))
    run(settings, repo, "devir,orkestra,kapi")
    run(settings, repo, "devir,orkestra,kapi", "--uninstall")
    data = read_settings(settings)
    r = _n(Path(repo).as_posix())
    assert not any(r in _n(_cmd(h)) for h in every_handler(data))
    assert not any(is_kapi(h) or is_devir(h) or is_ork(h) for h in every_handler(data))
    assert not any(g.get("matcher") == "compact" for g in data.get("hooks", {}).get("SessionStart", []))
    for u in USER_HOOKS:
        assert sum(h == u for h in every_handler(data)) == 1, u
    assert data["bilinmeyen_anahtar"] == {"ic": [1, 2, "üç"]}
    for groups in data["hooks"].values():
        assert all(g["hooks"] for g in groups)


def test_uninstall_kapi_removes_compact_only_ours(settings, repo):
    user_compact = {"matcher": "compact", "hooks": [{"type": "command", "command": "echo sikistirma"}]}
    write_settings(settings, {"hooks": {"SessionStart": [user_compact]}})
    run(settings, repo, "kapi")
    assert_single_kapi(read_settings(settings), repo)
    run(settings, repo, "kapi", "--uninstall")
    assert read_settings(settings) == {"hooks": {"SessionStart": [user_compact]}}


def test_write_guard_reapplies_on_concurrent_change(settings, repo, monkeypatch, capsys):
    write_settings(settings, {"env": {"A": "1"}})
    mod = load_module()
    real_load = mod.load
    calls = []

    def load_then_someone_writes(*a, **kw):
        res = real_load(*a, **kw)
        calls.append(a)
        if len(calls) == 1:  # okuma ile yazma arasında başka biri anahtar ekler
            d = json.loads(settings.read_text(encoding="utf-8"))
            d["araya_giren"] = {"deger": "kaybolmamalı"}
            write_settings(settings, d)
        return res

    monkeypatch.setattr(mod, "load", load_then_someone_writes)
    rc = mod.main(main_args(settings, repo, "kapi"))
    out = capsys.readouterr().out
    assert rc == 0, out
    assert calls, "load çağrılmadı: sarmalama noktası artık kullanılmıyor"
    data = read_settings(settings)
    assert data["araya_giren"] == {"deger": "kaybolmamalı"}
    assert data["env"] == {"A": "1"}
    assert_single_kapi(data, repo)


@pytest.mark.skipif(not WINDOWS, reason="geçici PermissionError (dosya kilidi) Windows'a özgü")
def test_replace_retries_transient_permission_error(settings, repo, monkeypatch, capsys):
    write_settings(settings, {"env": {"A": "1"}})
    mod = load_module()
    real_replace = mod.os.replace
    fails = {"n": 0}

    def flaky(src, dst, *a, **kw):
        if fails["n"] < 2:
            fails["n"] += 1
            raise PermissionError(13, "geçici kilit (ör. antivirüs)", str(dst))
        return real_replace(src, dst, *a, **kw)

    monkeypatch.setattr(mod.os, "replace", flaky)
    monkeypatch.setattr(time, "sleep", lambda s: None)
    rc = mod.main(main_args(settings, repo, "kapi"))
    out = capsys.readouterr().out
    assert rc == 0, out
    assert fails["n"] == 2
    data = read_settings(settings)
    assert data["env"] == {"A": "1"}
    assert_single_kapi(data, repo)
    assert sorted(p.name for p in settings.parent.iterdir()) == ["settings.json"]  # geçici dosya kalmadı


# ------------------------------------------- sözleşme eki h1/h2: yalnız gerçekten bizimkiler

@pytest.mark.parametrize("hook,event,comp", [
    (NODE_HOOK, "PostToolUse", "kapi"),
    (NODE_HOOK, "PreToolUse", "kapi"),
    (LINTER_HOOK, "Stop", "devir"),
    (LINTER_HOOK, "PostToolUse", "devir"),
    (BASH_WRAPPED, "PreToolUse", "kapi"),
    (BASH_WRAPPED, "SessionStart", "kapi"),
    (PRECOMPACT_LEGACY, "PreCompact", "devir"),
], ids=["node_posttooluse", "node_pretooluse", "linter_stop", "linter_posttooluse",
        "bash_sarmal_pretooluse", "bash_sarmal_sessionstart", "precompact_eski_konum"])
def test_foreign_or_other_event_entry_untouched(settings, repo, hook, event, comp):
    group = {"matcher": "Read", "hooks": [hook]} if event == "PreToolUse" else {"hooks": [hook]}
    write_settings(settings, {"hooks": {event: [group]}})
    rep = run(settings, repo, comp)
    data = read_settings(settings)
    assert group in data["hooks"][event]
    assert every_handler(data).count(hook) == 1
    assert rep["components"][comp]["legacy_removed"] == 0
    (assert_single_kapi if comp == "kapi" else assert_single_devir)(data, repo)
    # tekrar çalıştırma da dokunmaz
    run(settings, repo, comp)
    assert group in read_settings(settings)["hooks"][event]


def test_own_event_legacy_replaced_other_event_legacy_kept(settings, repo):
    kapi_post = {"type": "command", "command": LEGACY_CMD}
    write_settings(settings, {"hooks": {
        "Stop": [{"hooks": [{"type": "command", "command": LEGACY_DEVIR_CMD, "timeout": 10}]}],
        "PreCompact": [{"hooks": [PRECOMPACT_LEGACY]}],
        "PreToolUse": [{"matcher": "Read", "hooks": kapi_pair(LEGACY_CMD)}],
        "PostToolUse": [{"matcher": "Read", "hooks": [kapi_post]}],
    }})
    rep = run(settings, repo, "devir,kapi")
    data = read_settings(settings)
    assert rep["components"]["devir"]["legacy_removed"] == 1
    assert rep["components"]["kapi"]["legacy_removed"] == 2
    assert_single_devir(data, repo)
    assert data["hooks"]["PreCompact"] == [{"hooks": [PRECOMPACT_LEGACY]}]
    assert data["hooks"]["PostToolUse"] == [{"matcher": "Read", "hooks": [kapi_post]}]
    assert data["hooks"]["PreToolUse"] == [{"matcher": "Read", "hooks": kapi_handlers(repo)}]


def test_own_command_in_foreign_event_not_touched_on_install(settings, repo):
    other = {"matcher": "Read", "hooks": [{"type": "command", "command": kapi_cmd(repo)}]}
    write_settings(settings, {"hooks": {"PostToolUse": [other]}})
    run(settings, repo, "kapi")
    data = read_settings(settings)
    assert data["hooks"]["PostToolUse"] == [other]


def test_messy_foreign_events_preserved(settings, repo):
    original = _messy_settings(repo)
    write_settings(settings, copy.deepcopy(original))
    run(settings, repo, "devir,orkestra,kapi")
    data = read_settings(settings)
    for ev in ("PostToolUse", "PreCompact"):
        assert data["hooks"][ev] == original["hooks"][ev]
    assert BASH_WRAPPED in all_handlers(data, "PreToolUse")
    assert LINTER_HOOK in all_handlers(data, "Stop")


def test_uninstall_keeps_node_and_wrapped_hooks(settings, repo):
    original = {"hooks": {
        "PostToolUse": [{"matcher": "Edit", "hooks": [NODE_HOOK]}],
        "PreToolUse": [{"matcher": "Read", "hooks": [NODE_HOOK, BASH_WRAPPED]}],
        "Stop": [{"hooks": [LINTER_HOOK]}],
        "PreCompact": [{"hooks": [PRECOMPACT_LEGACY]}],
    }}
    write_settings(settings, copy.deepcopy(original))
    run(settings, repo, "devir,orkestra,kapi", "--uninstall")
    assert read_settings(settings) == original
    run(settings, repo, "devir,orkestra,kapi")
    run(settings, repo, "devir,orkestra,kapi", "--uninstall")
    assert read_settings(settings) == original
