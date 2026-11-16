"""Kullanıcının mevcut MCP kaydı: sırlar ekrana yazılmaz, dize olmayan değerler kaydı kaybettirmez.

1. Kurulum (Windows: ErenKit.Installer.psm1, macOS/Linux: install_macos.py) ve doktor, var olan bir
   kaydı gösterirken sır yazmamalı: uzak sunucu adresindeki kullanıcı:parola@, yol, sorgu, parça;
   headers ve env değerleri; kullanıcının eklediği argümanlar ("--token=..."). Kullanıcı hangi kayıttan
   söz edildiğini yine anlayabilmeli: program yolu, şema://sunucu[:port], argüman sayısı.
2. Elle düzenlenmiş .claude.json'da dize olmayan değer ("env": {"PORT": 8080}, true, null, nesne;
   args içinde sayı/null). Gerçek claude (2.1.x) böyle bir kaydı "Skipped — invalid MCP server config"
   diye yok sayar ve "mcp add-json" ile eklemeyi "Invalid configuration" diye reddeder. Eski kurulum
   kaydı silip yeniden eklemeye çalışıyor, geri yükleme de reddedildiği için kayıt kayboluyordu
   (Windows), değeri sessizce "True"/"None"/"{'a': 1}" yapıyordu (macOS) ya da "zaten kayıtlı"
   diyordu. Artık kayda dokunulmaz ve nedeni (yalnız yer ve tür) söylenir.

Gerçek claude yerine onun bu davranışını taklit eden bir öykünücü kullanılır (CLAUDE_CONFIG_DIR
geçici; gerçek ~/.claude.json'a dokunulmaz). Testteki tüm "sırlar" SAHTE ile başlar.
"""

from __future__ import annotations

import importlib.util
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

INSTALLER = Path(__file__).resolve().parents[1]
REPO = INSTALLER.parents[1]
sys.path.insert(0, str(INSTALLER))

import install_macos as im  # noqa: E402
import mcp_config  # noqa: E402


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


doktor = _load("_eren_doktor_kayit_gizliligi", INSTALLER / "doktor.py")

SIR = "SAHTE"  # bu dizenin çıktıda hiç geçmemesi beklenir
SAHTE_URL = "https://kul:SAHTEPAROLA@example.invalid:8443/mcp/SAHTEYOL?anahtar=SAHTESORGU#SAHTEPARCA"
BEYIN_ARGS = list(im.BEYIN_MCP_ARGS)


@pytest.fixture(autouse=True)
def _isolated_home(tmp_path, monkeypatch):
    home = tmp_path / "fake-home"
    home.mkdir()
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setenv("USERPROFILE", str(home))
    monkeypatch.delenv("CLAUDE_CONFIG_DIR", raising=False)


# ---------------------------------------------------------------- senaryolar

def _sizinti_kayitlari(py: str) -> dict:
    """Ekranda gösterilirse sır sızdıran (ama Claude Code'un kabul ettiği) kayıtlar."""
    return {
        "url": {"type": "http", "url": SAHTE_URL, "headers": {"Authorization": "Bearer SAHTEBASLIK"}},
        "komutsuz": {"type": "stdio", "env": {"TOKEN": "SAHTEENV"}},
        "yabanci": {"type": "stdio", "command": "C:/baska/sunucu.exe", "args": ["--token=SAHTEARG", "SAHTECIPLAK"],
                    "env": {"K": "SAHTEENV"}},
        "tasinan": {"type": "stdio", "command": py, "args": ["-m", "bellek.beyin", "mcp", "--token=SAHTEARG"],
                    "env": {"K": "SAHTEENV"}},
    }


def _dize_olmayan_kayitlar(py: str) -> dict:
    """Elle düzenlenmiş, dize olmayan değer taşıyan kayıtlar -> beklenen sorun parçaları."""
    return {
        "env_sayi": ({"type": "stdio", "command": py, "args": ["-m", "bellek.beyin", "mcp"], "env": {"PORT": 8080}},
                     ["env.PORT: sayı"]),
        # Argümanlar kurulumunkiyle AYNI: eski kod "zaten kayıtlı" diyordu (Claude Code ise yok sayıyor).
        "ayni_karisik": ({"type": "stdio", "command": py, "args": BEYIN_ARGS,
                          "env": {"A": True, "B": None, "C": {"x": 1}, "D": [1]}},
                         ["env.A: true/false", "env.B: null", "env.C: nesne", "env.D: dizi"]),
        "args_sayi": ({"type": "stdio", "command": "C:/baska/sunucu.exe", "args": ["--port", 8080, None]},
                      ["args[1]: sayı", "args[2]: null"]),
        "env_null": ({"type": "stdio", "command": py, "args": ["-m", "bellek.beyin", "mcp"], "env": None},
                     ["env: null (nesne olmalı)"]),
    }


# ---------------------------------------------------------------- claude öykünücüsü
#
# Gerçek claude 2.1.x ile ölçülen davranış: "mcp add-json" command/url dize değilse, args dize
# dizisi değilse, env/headers değerleri dize değilse (null dahil) "Invalid configuration: : Invalid
# input" ile 1 döner, değer yazmaz; "mcp remove" dize olmayan değerli kaydı da siler.

_EMU = r'''
import json, os, sys

def gecerli(e):
    if not isinstance(e, dict):
        return False
    for k in ("command", "url"):
        if k in e and not isinstance(e[k], str):
            return False
    if "args" in e and not (isinstance(e["args"], list) and all(isinstance(x, str) for x in e["args"])):
        return False
    for k in ("env", "headers"):
        if k in e and not (isinstance(e[k], dict) and all(isinstance(x, str) for x in e[k].values())):
            return False
    return True

def calistir(argv, cfg_dir):
    path = os.path.join(cfg_dir, ".claude.json")
    with open(os.path.join(cfg_dir, "calls.log"), "a", encoding="utf-8") as f:
        f.write(json.dumps(argv) + "\n")
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    servers = data.setdefault("mcpServers", {})
    def yaz():
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f)
    if argv[:2] == ["mcp", "remove"]:
        if argv[2] not in servers:
            return 1, "", "No MCP server found"
        del servers[argv[2]]
        yaz()
        return 0, "Removed MCP server", ""
    if argv[:2] in (["mcp", "add-json"], ["mcp", "add"]):
        sayac = os.path.join(cfg_dir, "fail-count")
        kalan = int(open(sayac).read()) if os.path.exists(sayac) else 0
        if kalan > 0:
            open(sayac, "w").write(str(kalan - 1))
            return 1, "", "Error: simulated failure"
        if argv[1] == "add-json":
            name, entry = argv[2], json.loads(argv[3])
        else:
            rest = argv[2:]
            head, cmd = rest[:rest.index("--")], rest[rest.index("--") + 1:]
            name, env = head[0], {}
            for j, t in enumerate(head):
                if t == "-e":
                    k, _, v = head[j + 1].partition("=")
                    env[k] = v
            entry = {"type": "stdio", "command": cmd[0], "args": cmd[1:], "env": env}
        if not gecerli(entry):
            return 1, "", "Invalid configuration: : Invalid input"
        if name in servers:
            return 1, "", f"MCP server {name} already exists in user config"
        servers[name] = entry
        yaz()
        return 0, f"Added MCP server {name}", ""
    return 1, "", "unknown"

if __name__ == "__main__":
    code, out, err = calistir(sys.argv[1:], os.environ["CLAUDE_CONFIG_DIR"])
    sys.stdout.write(out + "\n")
    sys.stderr.write(err + "\n")
    sys.exit(code)
'''

_EMU_CMD = """@ECHO off
SETLOCAL
"{py}" -I "%~dp0emu_claude.py" %*
"""


def _emu_module(tmp_path: Path):
    p = tmp_path / "emu_claude.py"
    p.write_text(_EMU, encoding="utf-8")
    return _load(f"_emu_{abs(hash(str(tmp_path)))}", p)


def _cfg(d: Path, servers: dict, fail: int = 0) -> Path:
    cfg = d / "cfg"
    cfg.mkdir(parents=True, exist_ok=True)
    (cfg / ".claude.json").write_text(json.dumps({"mcpServers": servers}), encoding="utf-8")
    if fail:
        (cfg / "fail-count").write_text(str(fail), encoding="ascii")
    return cfg


def _servers(cfg: Path) -> dict:
    return json.loads((cfg / ".claude.json").read_text(encoding="utf-8"))["mcpServers"]


def _calls(cfg: Path) -> list:
    log = cfg / "calls.log"
    return [json.loads(x) for x in log.read_text(encoding="utf-8").splitlines()] if log.exists() else []


# ---------------------------------------------------------------- Windows: ErenKit.Installer.psm1

def _shells() -> list[str]:
    if os.name != "nt":
        return []
    return [s for s in ("powershell", "pwsh") if shutil.which(s)]


_PS_HARNESS = r"""
param([string]$Module, [string]$Claude, [string]$Helper, [string]$Plan, [string]$Repo)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Import-Module $Module -Force -DisableNameChecking
Set-McpContext -ClaudeExe $Claude -HelperPath $Helper
$senaryolar = @(Get-Content -LiteralPath $Plan -Raw -Encoding UTF8 | ConvertFrom-Json)
foreach ($s in @($senaryolar | ForEach-Object { $_ })) {
    $env:CLAUDE_CONFIG_DIR = $s.cfg
    Set-InstallerOption -DryRun ([bool]$s.dry) -BackupDir $s.bk
    $cmd = [string[]]@($s.cmd | ForEach-Object { $_ })
    Write-Host ('BEGIN:' + $s.id)
    try {
        if ($s.op -eq 'unreg') { $r = Unregister-McpServer -Name 'beyin' -RepoRoot $Repo }
        else { $r = Register-McpServer -Name 'beyin' -ServerCommand $cmd -RepoRoot $Repo }
        $o = @{ id = $s.id; status = $r.Status; message = $r.Message }
    } catch {
        $o = @{ id = $s.id; status = 'error'; message = "$_" }
    }
    Write-Output ('JSON:' + ($o | ConvertTo-Json -Compress))
}
"""


def _run_ps(shell: str, tmp_path: Path, plan: list[dict], repo: Path) -> tuple[dict, dict]:
    """Planı tek PowerShell sürecinde koşar; (id -> sonuç, id -> o senaryonun tüm çıktısı)."""
    emu = tmp_path / "emu"
    emu.mkdir(exist_ok=True)
    (emu / "emu_claude.py").write_text(_EMU, encoding="utf-8")
    (emu / "claude.cmd").write_text(_EMU_CMD.format(py=sys.executable), encoding="ascii")
    script = tmp_path / "harness.ps1"
    script.write_text(_PS_HARNESS, encoding="utf-8-sig")
    plan_file = tmp_path / "plan.json"
    plan_file.write_text(json.dumps(plan), encoding="utf-8")
    env = dict(os.environ)
    if shell == "powershell":
        env.pop("PSModulePath", None)  # pwsh'tan devralınan modül yolu 5.1'i bozmasın
    r = subprocess.run([shell, "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", str(script),
                        "-Module", str(INSTALLER / "ErenKit.Installer.psm1"), "-Claude", str(emu / "claude.cmd"),
                        "-Helper", str(INSTALLER / "mcp_config.py"), "-Plan", str(plan_file), "-Repo", str(repo)],
                       capture_output=True, timeout=600, env=env, cwd=str(tmp_path))
    out = r.stdout.decode("utf-8", "replace") + r.stderr.decode("utf-8", "replace")
    results, texts, cur = {}, {}, None
    for line in out.splitlines():
        if line.startswith("BEGIN:"):
            cur = line[6:]
            texts[cur] = ""
        elif cur is not None:
            texts[cur] += line + "\n"
        if line.startswith("JSON:"):
            o = json.loads(line[5:])
            results[o["id"]] = o
    assert len(results) == len(plan), out
    return results, texts


def _win_repo(tmp_path: Path) -> tuple[Path, str]:
    repo = tmp_path / "repo"
    repo.mkdir(exist_ok=True)
    py = repo / "python.exe"
    py.write_bytes(b"")
    return repo, str(py)


@pytest.mark.skipif(not _shells(), reason="Windows PowerShell gerekli")
@pytest.mark.parametrize("shell", _shells() or ["-"])
def test_windows_mevcut_kayit_sirlari_yazilmaz(shell, tmp_path):
    repo, py = _win_repo(tmp_path)
    cmd = [py, *BEYIN_ARGS]
    olds = _sizinti_kayitlari(py)
    plan = []
    for kind, old in olds.items():
        for op, dry, fail in (("reg", True, 0), ("reg", False, 0), ("reg", False, 1), ("unreg", True, 0)):
            sid = f"{kind}-{op}-{'dry' if dry else 'real'}-{fail}"
            d = tmp_path / "s" / sid
            plan.append({"id": sid, "cfg": str(_cfg(d, {"beyin": old}, fail)), "bk": str(d / "bk"),
                         "dry": dry, "op": op, "cmd": cmd})
    res, texts = _run_ps(shell, tmp_path, plan, repo)
    for s in plan:
        sid, text = s["id"], texts[s["id"]] + res[s["id"]]["message"]
        assert SIR not in text, (sid, text)
        cfg = Path(s["cfg"])
        if sid.endswith("real-1"):  # yeni kayıt başarısız: eski kayıt birebir geri yüklenir
            assert res[sid]["status"] == "error" and "geri yüklendi" in text, (sid, text)
            assert _servers(cfg)["beyin"] == olds[sid.split("-")[0]], sid
        if sid.endswith("real-0"):
            assert res[sid]["status"] in ("ok", "warn"), (sid, res[sid])
    # Kullanıcı hangi kayıttan söz edildiğini yine anlar.
    assert "http https://example.invalid:8443/…" in res["url-reg-dry-0"]["message"], res["url-reg-dry-0"]
    assert "example.invalid:8443" in res["url-unreg-dry-0"]["message"], res["url-unreg-dry-0"]
    assert "alanlar: type, env" in res["komutsuz-reg-dry-0"]["message"], res["komutsuz-reg-dry-0"]
    assert "C:/baska/sunucu.exe (+2 argüman daha" in res["yabanci-reg-dry-0"]["message"], res["yabanci-reg-dry-0"]
    assert "-m bellek.beyin mcp (+1 argüman daha" in texts["tasinan-reg-real-0"], texts["tasinan-reg-real-0"]
    # Taşınan değerler yeni kayda birebir gider (gizleme yalnız ekranda).
    new = _servers(Path(next(s["cfg"] for s in plan if s["id"] == "tasinan-reg-real-0")))["beyin"]
    assert new["args"] == [*BEYIN_ARGS, "--token=SAHTEARG"] and new["env"] == {"K": "SAHTEENV"}, new


@pytest.mark.skipif(not _shells(), reason="Windows PowerShell gerekli")
@pytest.mark.parametrize("shell", _shells() or ["-"])
def test_windows_dize_olmayan_deger_kaydi_kaybettirmez(shell, tmp_path):
    repo, py = _win_repo(tmp_path)
    cmd = [py, *BEYIN_ARGS]
    cases = _dize_olmayan_kayitlar(py)
    # Kontrol: tarih biçimli dize (PowerShell 7 ConvertFrom-Json'ı DateTime yapar) ve sayı biçimli
    # dize sorun sayılmaz, birebir taşınır.
    ok_old = {"type": "stdio", "command": py, "args": ["-m", "bellek.beyin", "mcp"],
              "env": {"T": "2026-01-01T00:00:00Z", "PORT": "8080"}}
    plan = []
    for kind, (old, _) in [*cases.items(), ("dize", (ok_old, []))]:
        for dry in (True, False):
            sid = f"{kind}-{'dry' if dry else 'real'}"
            d = tmp_path / "s" / sid
            plan.append({"id": sid, "cfg": str(_cfg(d, {"beyin": old})), "bk": str(d / "bk"),
                         "dry": dry, "op": "reg", "cmd": cmd})
    res, texts = _run_ps(shell, tmp_path, plan, repo)
    for kind, (old, parts) in cases.items():
        dry, real = res[f"{kind}-dry"], res[f"{kind}-real"]
        assert dry["status"] == "warn" and "kaydedilemeyecek" in dry["message"], dry
        assert real["status"] == "error" and "hiçbir şey değiştirilmedi" in real["message"], real
        for p in parts:
            assert p in dry["message"] and p in real["message"], (kind, p, real)
        for s in plan:
            if s["id"].startswith(kind + "-"):
                cfg = Path(s["cfg"])
                assert _servers(cfg)["beyin"] == old, s["id"]  # kayıt yerinde, değeri aynı
                assert _calls(cfg) == [], s["id"]  # claude hiç çağrılmadı
    assert res["dize-real"]["status"] == "ok", res["dize-real"]
    new = _servers(Path(next(s["cfg"] for s in plan if s["id"] == "dize-real")))["beyin"]
    assert new["env"] == ok_old["env"] and new["args"] == BEYIN_ARGS, new


# ---------------------------------------------------------------- macOS/Linux: install_macos.py

def _mac(tmp_path: Path, monkeypatch, sid: str, old: dict, fail: int = 0, dry: bool = False, op: str = "reg"):
    d = tmp_path / "s" / sid
    cfg = _cfg(d, {"beyin": old}, fail)
    monkeypatch.setenv("CLAUDE_CONFIG_DIR", str(cfg))
    emu = _emu_module(tmp_path)

    def run(args, **kw):
        code, out, err = emu.calistir(list(args[1:]), str(cfg))
        return subprocess.CompletedProcess(args, code, out, err)

    ctx = im.Ctx(claude_home=d / "home", claude_exe="claude", run=run, dry_run=dry)
    try:
        s = im.mcp_unregister(ctx, "beyin") if op == "unreg" else im.mcp_register(ctx, "beyin", [_mac_py(tmp_path), *BEYIN_ARGS])
        return s.status, s.message, cfg
    except im.StepError as e:
        return "error", str(e), cfg


def _mac_py(tmp_path: Path) -> str:
    p = tmp_path / "repo" / "python"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(b"")
    return str(p)


def test_macos_mevcut_kayit_sirlari_yazilmaz(tmp_path, monkeypatch):
    py = _mac_py(tmp_path)
    for kind, old in _sizinti_kayitlari(py).items():
        for op, dry, fail in (("reg", True, 0), ("reg", False, 0), ("reg", False, 1), ("unreg", True, 0)):
            sid = f"{kind}-{op}-{dry}-{fail}"
            status, msg, cfg = _mac(tmp_path, monkeypatch, sid, old, fail, dry, op)
            assert SIR not in msg, (sid, msg)
            if fail:
                assert status == "error" and "geri yüklendi" in msg, (sid, msg)
                assert _servers(cfg)["beyin"] == old, sid
    # Windows ile aynı gösterim.
    _, msg, _ = _mac(tmp_path, monkeypatch, "url-goster", _sizinti_kayitlari(py)["url"], dry=True)
    assert "http https://example.invalid:8443/…" in msg, msg
    _, msg, _ = _mac(tmp_path, monkeypatch, "yabanci-goster", _sizinti_kayitlari(py)["yabanci"], dry=True)
    assert "C:/baska/sunucu.exe (+2 argüman daha" in msg, msg


def test_macos_dize_olmayan_deger_kaydi_kaybettirmez_ve_donusturmez(tmp_path, monkeypatch):
    py = _mac_py(tmp_path)
    for kind, (old, parts) in _dize_olmayan_kayitlar(py).items():
        status, msg, cfg = _mac(tmp_path, monkeypatch, f"{kind}-dry", old, dry=True)
        assert status == "warn" and "kaydedilemeyecek" in msg and all(p in msg for p in parts), (kind, msg)
        assert _calls(cfg) == []
        status, msg, cfg = _mac(tmp_path, monkeypatch, f"{kind}-real", old)
        assert status == "error" and "hiçbir şey değiştirilmedi" in msg and all(p in msg for p in parts), (kind, msg)
        assert _servers(cfg)["beyin"] == old, (kind, _servers(cfg))  # True -> "True" gibi dönüşüm yok
        assert _calls(cfg) == [], kind


# ---------------------------------------------------------------- iki platform aynı kuralı uygular

_PARITY_HARNESS = r"""
param([string]$Module, [string]$In)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$m = Import-Module $Module -Force -DisableNameChecking -PassThru
$cases = @(Get-Content -LiteralPath $In -Raw -Encoding UTF8 | ConvertFrom-Json)
$out = foreach ($c in @($cases | ForEach-Object { $_ })) {
    $d = & $m { param($e, $n) Format-McpEntry $e $n } $c.entry ([int]$c.shown)
    $p = @(& $m { param($e) Get-McpEntryProblem $e } $c.entry)
    $u = & $m { param($x) Format-McpUrl $x } $c.url
    [pscustomobject]@{ d = $d; p = ($p -join '|'); u = $u }
}
Write-Output ('JSON:' + (ConvertTo-Json @($out) -Depth 5 -Compress))
"""

_URLS = [
    SAHTE_URL, "https://example.invalid/", "https://example.invalid", "http://example.invalid:80/x",
    "https://example.invalid?k=SAHTE", "http://[::1]:8080/mcp", "HTTPS://Example.Invalid/", "SAHTEDUZMETIN",
    "https://kul:SAHTE@example.invalid", "", "wss://example.invalid:443/",
]


def _parity_cases() -> list[dict]:
    py = "C:/r/python.exe"
    entries = [*_sizinti_kayitlari(py).values(), *(o for o, _ in _dize_olmayan_kayitlar(py).values()),
               {"type": "stdio", "command": "C:/Program Files/x/s.exe", "args": ["a b", "c"]},
               {"type": "sse", "url": "SAHTEDUZMETIN"}, {}, {"command": py, "args": [], "env": {}},
               {"command": py, "args": "tek", "headers": {"H": 1}, "url": 5}]
    cases = []
    for i, e in enumerate(entries):
        for shown in (0, 3):
            cases.append({"entry": e, "shown": shown, "url": _URLS[i % len(_URLS)]})
    for u in _URLS:
        cases.append({"entry": {"type": "http", "url": u}, "shown": 0, "url": u})
    return cases


@pytest.mark.skipif(not _shells(), reason="Windows PowerShell gerekli")
@pytest.mark.parametrize("shell", _shells() or ["-"])
def test_gosterim_ve_denetim_iki_platformda_ayni(shell, tmp_path):
    cases = _parity_cases()
    inp = tmp_path / "cases.json"
    inp.write_text(json.dumps(cases), encoding="utf-8")
    script = tmp_path / "parity.ps1"
    script.write_text(_PARITY_HARNESS, encoding="utf-8-sig")
    env = dict(os.environ)
    if shell == "powershell":
        env.pop("PSModulePath", None)
    r = subprocess.run([shell, "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", str(script),
                        "-Module", str(INSTALLER / "ErenKit.Installer.psm1"), "-In", str(inp)],
                       capture_output=True, timeout=180, env=env)
    out = r.stdout.decode("utf-8", "replace")
    line = [s for s in out.splitlines() if s.startswith("JSON:")]
    assert line, out + r.stderr.decode("utf-8", "replace")
    got = json.loads(line[-1][5:])
    assert len(got) == len(cases)
    for c, g in zip(cases, got):
        want_d = mcp_config.describe_entry(c["entry"], c["shown"])
        assert g["d"] == want_d, (c, g)
        assert (g["p"] or "") == "|".join(mcp_config.entry_problems(c["entry"])), (c, g)
        assert g["u"] == mcp_config.describe_url(c["url"]), (c, g)
        assert SIR not in g["u"], (c, g)
        assert c["shown"] or SIR not in g["d"], (c, g)  # gösterilecek argüman istenmediyse hiçbir değer yok


@pytest.mark.parametrize("url, want", [
    (SAHTE_URL, "https://example.invalid:8443/…"),
    ("https://example.invalid/", "https://example.invalid"),
    ("http://example.invalid:80/x", "http://example.invalid/…"),
    ("https://example.invalid?k=SAHTE", "https://example.invalid/…"),
    ("http://[::1]:8080/mcp", "http://[::1]:8080/…"),
    ("SAHTEDUZMETIN", "(adres çözümlenemedi; gösterilmez)"),
    ("https://example.invalid:99999/", "(adres çözümlenemedi; gösterilmez)"),
    (None, "(adres yok)"),
])
def test_describe_url(url, want):
    assert mcp_config.describe_url(url) == want


def test_describe_entry_bilinmeyen_argumanlari_sayar():
    e = {"command": "C:/r/python.exe", "args": ["-I", "-m", "bellek.beyin", "mcp", "--token=SAHTE"]}
    assert mcp_config.describe_entry(e, mcp_config.known_prefix(e, [BEYIN_ARGS])) == \
        "C:/r/python.exe -I -m bellek.beyin mcp (+1 argüman daha; değerleri yazılmaz)"
    assert mcp_config.describe_entry({"type": "stdio", "env": {"TOKEN": "SAHTE"}}) == \
        "(komutu ya da adresi olmayan kayıt; alanlar: type, env)"


# ---------------------------------------------------------------- doktor

def _doktor_mcp(tmp_path: Path, entry) -> dict:
    home = tmp_path / "claude"
    home.mkdir(exist_ok=True)
    (home / ".claude.json").write_text(json.dumps({"mcpServers": {"beyin": entry}}), encoding="utf-8")
    res = doktor.run_checks(home, REPO, network=False)
    return {c["name"]: c for c in res["checks"]}["mcp:beyin"]


def test_doktor_uzak_kayit_adresini_gizler(tmp_path):
    c = _doktor_mcp(tmp_path, {"type": "http", "url": SAHTE_URL, "headers": {"Authorization": "Bearer SAHTEBASLIK"}})
    assert c["status"] == "ok" and SIR not in c["detail"], c
    assert "https://example.invalid:8443/…" in c["detail"], c


@pytest.mark.parametrize("args, shown", [
    (["-m", "bellek.beyin", "mcp", "--token=SAHTEARG"], "-m bellek.beyin mcp (+1 argüman daha"),  # GÜVENSİZ uyarısı
    ([*BEYIN_ARGS, "--token", "SAHTEARG"], " ".join(BEYIN_ARGS) + " (+2 argüman daha"),  # kayıtlı satırı
    # Bilinmeyen biçim: kayıt satırında hiçbir argüman yazılmaz. (Göreli betik yolu GÜVENSİZ
    # nedeninde adıyla geçer: bir dosya yoludur, sır yeri değil; kullanıcı neyi düzelteceğini görür.)
    (["-I", "betik.py", "SAHTEARG"], "(+3 argüman daha"),
])
def test_doktor_kullanici_argumanlarini_yazmaz(tmp_path, args, shown):
    c = _doktor_mcp(tmp_path, {"type": "stdio", "command": sys.executable, "args": args, "env": {"K": "SAHTEENV"}})
    assert SIR not in c["detail"] and shown in c["detail"], c


def test_doktor_bilinen_argumanlar_kurulumunkiyle_ayni():
    assert list(doktor._KNOWN_MCP_ARGS["beyin"][0]) == BEYIN_ARGS
    assert list(doktor._KNOWN_MCP_ARGS["beyin"][1]) == [a for a in BEYIN_ARGS if a != "-I"]


@pytest.mark.parametrize("entry, part", [
    ({"type": "stdio", "command": sys.executable, "args": BEYIN_ARGS, "env": {"PORT": 8080}}, "env.PORT: sayı"),
    ({"type": "stdio", "command": sys.executable, "args": [*BEYIN_ARGS, None]}, "args[4]: null"),
    ({"type": "http", "url": "https://example.invalid/", "headers": {"A": True}}, "headers.A: true/false"),
])
def test_doktor_dize_olmayan_degeri_hata_sayar(tmp_path, entry, part):
    c = _doktor_mcp(tmp_path, entry)
    assert c["status"] == "error" and "yok sayıyor" in c["detail"] and part in c["detail"], c


def test_doktor_bellek_ortamina_uydurma_deger_vermez(tmp_path):
    home = tmp_path / "claude"
    home.mkdir()
    entry = {"type": "stdio", "command": sys.executable, "args": BEYIN_ARGS, "env": {"A": "1", "B": None, "C": 5}}
    (home / ".claude.json").write_text(json.dumps({"mcpServers": {"beyin": entry}}), encoding="utf-8")
    exe, env = doktor._bellek_python(doktor.Ctx(home, REPO, False))
    assert exe is not None and env == {"A": "1"}, env
