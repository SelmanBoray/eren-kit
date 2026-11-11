"""doktor.py testleri: kurulum doktoru sözleşmesi (salt okunur denetim).

Yalnız tmp_path altında sahte claude-home ve sahte depo ağacı kullanır; gerçek ~/.claude ve
~/.claude.json okunmaz (HOME/USERPROFILE geçici dizine çevrilir), ağ kullanılmaz (network=False).
Beklenen hook kayıtları elle yazılmaz, settings_hooks.hook_specs'ten türetilir.
"""

from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
from pathlib import Path

import pytest

INSTALLER = Path(__file__).resolve().parents[1]
REAL_REPO = INSTALLER.parents[1]  # worktree kökü (scripts/installer -> kök)
DOKTOR = INSTALLER / "doktor.py"
SETTINGS_HOOKS = INSTALLER / "settings_hooks.py"

HOOK_CHECKS = ("hook:devir", "hook:kapi", "hook:orkestra")
ALL_CHECKS = HOOK_CHECKS + (
    "skill:opus-orkestra",
    "settings",
    "mcp:beyin",
    "mcp:computer-use-windows",
    "servis:beyin",
)
COMPONENTS = ("devir", "kapi", "orkestra")
SKILL_REL = "packages/opus-orkestra/skill/SKILL.md"
LEGACY_KAPI_CMD = 'python -I -S "C:/Bellek/src/bellek/kapi/hook.py" || true'
RANK = {"ok": 0, "warn": 1, "error": 2}


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


sh = _load("_eren_settings_hooks_for_doktor", SETTINGS_HOOKS)


@pytest.fixture(scope="module")
def doktor():
    if not DOKTOR.exists():
        pytest.fail(f"doktor.py henüz yok: {DOKTOR}")
    return _load("_eren_doktor_under_test", DOKTOR)


@pytest.fixture(autouse=True)
def _isolated_home(tmp_path, monkeypatch):
    """Gerçek kullanıcı dizini (~/.claude, ~/.claude.json) hiçbir yoldan okunmasın."""
    home = tmp_path / "fake-home"
    home.mkdir()
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setenv("USERPROFILE", str(home))
    monkeypatch.delenv("CLAUDE_CONFIG_DIR", raising=False)
    return home


# --- yardımcılar ---------------------------------------------------------------------

def repo_str(repo: Path) -> str:
    return str(repo).replace("\\", "/").rstrip("/")


def specs(repo: Path) -> dict:
    return sh.hook_specs(repo_str(repo))


def group(handlers: list, matcher):
    g = {} if matcher is None else {"matcher": matcher}
    g["hooks"] = copy.deepcopy(handlers)
    return g


def component_groups(repo: Path, key: str) -> dict:
    """Bileşen -> {olay: grup} (hook_specs'ten)."""
    s = specs(repo)[key]
    m = s.get("matchers", {})
    return {ev: group(h, m.get(ev)) for ev, h in s["events"].items()}


def build_settings(repo: Path, keys=COMPONENTS) -> dict:
    hooks: dict = {}
    for k in keys:
        for ev, g in component_groups(repo, k).items():
            hooks.setdefault(ev, []).append(g)
    return {"hooks": hooks}


def write_settings(home: Path, data) -> Path:
    home.mkdir(parents=True, exist_ok=True)
    p = home / "settings.json"
    text = data if isinstance(data, str) else json.dumps(data, indent=2, ensure_ascii=False) + "\n"
    p.write_text(text, encoding="utf-8")
    return p


def fake_repo(root: Path, with_hooks: bool = True) -> Path:
    """Gerçek depodaki hook betiklerinin göreli yollarında dosya taşıyan (ya da taşımayan) sahte depo."""
    root.mkdir(parents=True, exist_ok=True)
    if with_hooks:
        for k in COMPONENTS:
            rel = specs(REAL_REPO)[k]["tail"].lstrip("/")
            p = root / rel
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text("# sahte\n", encoding="utf-8")
    return root


def by_name(result: dict) -> dict:
    return {c["name"]: c for c in result["checks"]}


def check(result: dict, name: str) -> dict:
    checks = by_name(result)
    assert name in checks, f"{name} yok: {sorted(checks)}"
    return checks[name]


def snapshot(root: Path) -> dict:
    if not root.exists():
        return {}
    return {
        p.relative_to(root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in sorted(root.rglob("*"))
        if p.is_file()
    } | {p.relative_to(root).as_posix() + "/": "dir" for p in root.rglob("*") if p.is_dir()}


def run(doktor, home: Path, repo: Path = REAL_REPO) -> dict:
    return doktor.run_checks(home, repo, network=False)


def run_main(doktor, home: Path, repo: Path = REAL_REPO, json_out: bool = False) -> int:
    argv = ["--no-network", "--claude-home", str(home), "--repo", str(repo)]
    if json_out:
        argv.insert(0, "--json")
    return doktor.main(argv)


def assert_well_formed(result: dict) -> None:
    assert result["status"] in RANK
    for c in result["checks"]:
        assert set(c) >= {"name", "status", "detail"}, c
        assert all(isinstance(c[k], str) for k in ("name", "status", "detail")), c
        assert c["status"] in RANK, c
    worst = max((RANK[c["status"]] for c in result["checks"]), default=0)
    assert RANK[result["status"]] == worst


# --- 1. boş claude-home ----------------------------------------------------------------

@pytest.mark.parametrize("exists", [True, False], ids=["bos-dizin", "dizin-yok"])
def test_bos_claude_home(doktor, tmp_path, exists):
    home = tmp_path / "claude"
    if exists:
        home.mkdir()
    res = run(doktor, home)
    assert_well_formed(res)
    assert res["status"] == "ok", res
    names = by_name(res)
    for n in ALL_CHECKS:
        assert n in names, n
        assert names[n]["status"] == "ok", names[n]
    for n in HOOK_CHECKS:
        assert names[n]["detail"].startswith("kurulu değil"), names[n]
    for n in ("mcp:beyin", "mcp:computer-use-windows"):
        assert names[n]["detail"].startswith("kurulu değil"), names[n]
    assert run_main(doktor, home) == 0


# --- 2 + 9. doğru kurulum ------------------------------------------------------------

def test_dogru_kurulum_hooklar_ok(doktor, tmp_path):
    home = tmp_path / "claude"
    write_settings(home, build_settings(REAL_REPO))
    res = run(doktor, home)
    assert_well_formed(res)
    for n in HOOK_CHECKS:
        assert check(res, n)["status"] == "ok", check(res, n)
        assert not check(res, n)["detail"].startswith("kurulu değil")
    assert check(res, "settings")["status"] == "ok"


def test_dogru_kurulum_settings_hooks_run_ile(doktor, tmp_path, capsys):
    """settings.json'u üretim birleştiricisi yazsın (kayıt biçimi ondan gelir)."""
    home = tmp_path / "claude"
    home.mkdir()
    rc = sh.main(["--settings", str(home / "settings.json"), "--repo", str(REAL_REPO),
                  "--components", ",".join(COMPONENTS)])
    capsys.readouterr()
    assert rc == 0
    res = run(doktor, home)
    for n in HOOK_CHECKS:
        assert check(res, n)["status"] == "ok", check(res, n)


def test_kapi_md_markdown_cift_handler_yineleme_sayilmaz(doktor, tmp_path):
    kapi = component_groups(REAL_REPO, "kapi")
    pre = kapi.get("PreToolUse")
    assert pre is not None and len(pre["hooks"]) >= 2, "kapı PreToolUse grubu md+markdown handler'ı taşımalı"
    home = tmp_path / "claude"
    write_settings(home, build_settings(REAL_REPO, ("kapi",)))
    c = check(run(doktor, home), "hook:kapi")
    assert c["status"] == "ok", c


# --- 3. yalnız bir bileşen -----------------------------------------------------------

@pytest.mark.parametrize("key", COMPONENTS)
def test_yalniz_bir_bilesen(doktor, tmp_path, key):
    home = tmp_path / "claude"
    write_settings(home, build_settings(REAL_REPO, (key,)))
    res = run(doktor, home)
    for k in COMPONENTS:
        c = check(res, f"hook:{k}")
        assert c["status"] == "ok", c
        if k == key:
            assert not c["detail"].startswith("kurulu değil"), c
        else:
            assert c["detail"].startswith("kurulu değil"), c


# --- 4. yinelenen grup ---------------------------------------------------------------

def _duplicate_kapi_settings() -> dict:
    data = build_settings(REAL_REPO)
    data["hooks"]["PreToolUse"].append(component_groups(REAL_REPO, "kapi")["PreToolUse"])
    return data


def test_yinelenen_grup_error(doktor, tmp_path):
    home = tmp_path / "claude"
    write_settings(home, _duplicate_kapi_settings())
    res = run(doktor, home)
    c = check(res, "hook:kapi")
    assert c["status"] == "error", c
    assert "PreToolUse" in c["detail"] and "2" in c["detail"], c
    assert res["status"] == "error"
    assert run_main(doktor, home) == 2


# --- 5. eski konum kaydı -------------------------------------------------------------

def test_eski_konum_kaydi_error(doktor, tmp_path):
    home = tmp_path / "claude"
    data = build_settings(REAL_REPO)
    data["hooks"]["PreToolUse"].append(
        {"matcher": "Read", "hooks": [{"type": "command", "command": LEGACY_KAPI_CMD, "timeout": 10}]}
    )
    write_settings(home, data)
    res = run(doktor, home)
    c = check(res, "hook:kapi")
    assert c["status"] == "error", c
    assert res["status"] == "error"


# --- 6. betik dosyası yok -------------------------------------------------------------

def test_betik_dosyasi_yok_error(doktor, tmp_path):
    repo = fake_repo(tmp_path / "bos-depo", with_hooks=False)
    home = tmp_path / "claude"
    write_settings(home, build_settings(repo))
    res = run(doktor, home, repo)
    for n in HOOK_CHECKS:
        assert check(res, n)["status"] == "error", check(res, n)
    assert res["status"] == "error"


# --- 7. başka depo kopyası -------------------------------------------------------------

def test_baska_depo_kopyasi_warn(doktor, tmp_path):
    other = fake_repo(tmp_path / "baska-depo")
    home = tmp_path / "claude"
    write_settings(home, build_settings(REAL_REPO))  # kayıtlar gerçek worktree'yi gösteriyor
    res = run(doktor, home, other)
    for n in HOOK_CHECKS:
        assert check(res, n)["status"] == "warn", check(res, n)
    assert res["status"] == "warn"
    assert run_main(doktor, home, other) == 1


# --- 8. eksik olay ---------------------------------------------------------------------

def test_eksik_olay_warn(doktor, tmp_path):
    events = list(specs(REAL_REPO)["kapi"]["events"])
    if len(events) < 2:
        pytest.skip("hook_specs kapı için tek olay veriyor (SessionStart/compact kaydı henüz yok)")
    missing = next((e for e in events if e != "PreToolUse"), events[-1])
    home = tmp_path / "claude"
    data = build_settings(REAL_REPO, ("kapi",))
    del data["hooks"][missing]
    write_settings(home, data)
    c = check(run(doktor, home), "hook:kapi")
    assert c["status"] == "warn", c
    assert missing in c["detail"], c


# --- 10. skill ---------------------------------------------------------------------------

def test_skill_kopyasi(doktor, tmp_path):
    home = tmp_path / "claude"
    home.mkdir()
    c = check(run(doktor, home), "skill:opus-orkestra")
    assert c["status"] == "ok" and c["detail"].startswith("kurulu değil"), c

    src = (REAL_REPO / SKILL_REL).read_bytes()
    dst = home / "skills" / "opus-orkestra" / "SKILL.md"
    dst.parent.mkdir(parents=True)
    dst.write_bytes(src)
    res = run(doktor, home)
    assert check(res, "skill:opus-orkestra")["status"] == "ok"
    assert res["status"] == "ok", res
    assert run_main(doktor, home) == 0

    dst.write_bytes(src[:-1] + bytes([src[-1] ^ 0x01]))  # tek bayt farklı
    res = run(doktor, home)
    assert check(res, "skill:opus-orkestra")["status"] == "warn"
    assert res["status"] == "warn", res
    assert run_main(doktor, home) == 1


# --- 11. bozuk settings.json ----------------------------------------------------------

def test_bozuk_settings_error_istisna_yok(doktor, tmp_path):
    home = tmp_path / "claude"
    write_settings(home, "{")
    res = run(doktor, home)  # istisna fırlatmamalı
    assert_well_formed(res)
    assert check(res, "settings")["status"] == "error"
    assert res["status"] == "error"
    names = by_name(res)
    for n in ALL_CHECKS:
        assert n in names, n
    assert run_main(doktor, home) == 2


# --- 12. ilgisiz kullanıcı hook'ları ----------------------------------------------------

UNRELATED = [
    {"type": "command", "command": "python C:/tools/benim_hook.py"},
    {"type": "command", "command": 'python "C:/baska/kapi/hook.py" || true'},
]


@pytest.mark.parametrize("installed", [True, False], ids=["kurulu", "kurulu-degil"])
def test_ilgisiz_hooklar_etkilemez(doktor, tmp_path, installed):
    home = tmp_path / "claude"
    data = build_settings(REAL_REPO) if installed else {"hooks": {}}
    for ev, matcher in (("PreToolUse", "Read"), ("SessionStart", None), ("Stop", None)):
        data["hooks"].setdefault(ev, []).append(group(UNRELATED, matcher))
    write_settings(home, data)
    res = run(doktor, home)
    for n in HOOK_CHECKS:
        c = check(res, n)
        assert c["status"] == "ok", c
        assert c["detail"].startswith("kurulu değil") != installed, c


# --- 13. salt okunur --------------------------------------------------------------------

@pytest.mark.parametrize("scenario", ["dogru", "yinelenen", "bozuk"])
def test_salt_okunur(doktor, tmp_path, scenario):
    home = tmp_path / "claude"
    content = {"dogru": build_settings(REAL_REPO), "yinelenen": _duplicate_kapi_settings(), "bozuk": "{"}[scenario]
    write_settings(home, content)
    skill = home / "skills" / "opus-orkestra" / "SKILL.md"
    skill.parent.mkdir(parents=True)
    skill.write_bytes(b"farkli")
    before = snapshot(home)
    run(doktor, home)
    run_main(doktor, home, json_out=True)
    assert snapshot(home) == before


def test_salt_okunur_claude_home_yok(doktor, tmp_path, capsys):
    home = tmp_path / "yok" / "claude"
    run(doktor, home)
    run_main(doktor, home, json_out=True)
    capsys.readouterr()
    assert not home.exists()
    assert not home.parent.exists()


# --- 14. JSON sözleşmesi ----------------------------------------------------------------

@pytest.mark.parametrize("scenario", ["ok", "warn", "error"])
def test_json_cikti(doktor, tmp_path, capsys, scenario):
    home = tmp_path / "claude"
    repo = REAL_REPO
    if scenario == "warn":
        write_settings(home, build_settings(REAL_REPO))
        repo = fake_repo(tmp_path / "baska-depo")
    elif scenario == "error":
        write_settings(home, "{")
    capsys.readouterr()
    rc = run_main(doktor, home, repo, json_out=True)
    out = capsys.readouterr().out
    data = json.loads(out)  # stdout'ta yalnız tek JSON nesnesi
    assert isinstance(data, dict)
    assert isinstance(data.get("checks"), list) and data["checks"]
    assert_well_formed(data)
    assert data["status"] == scenario, data
    assert rc == RANK[scenario]
    assert data == run(doktor, home, repo)


# --- 15. --no-network ---------------------------------------------------------------------

def test_no_network_servis_atlandi(doktor, tmp_path, capsys):
    home = tmp_path / "claude"
    c = check(run(doktor, home), "servis:beyin")
    assert c["status"] == "ok" and "atlandı" in c["detail"], c
    run_main(doktor, home, json_out=True)
    c = check(json.loads(capsys.readouterr().out), "servis:beyin")
    assert c["status"] == "ok" and "atlandı" in c["detail"], c
