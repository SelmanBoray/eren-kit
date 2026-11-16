"""Kullanıcının mevcut MCP kaydı: sırlar ekrana yazılmaz, geçersiz kayıt kaybolmaz, terminal kirlenmez.

1. Kurulum (Windows: ErenKit.Installer.psm1, macOS/Linux: install_macos.py) ve doktor, var olan bir
   kaydı gösterirken sır yazmamalı: uzak sunucu adresindeki kullanıcı:parola@, yol, sorgu, parça;
   headers ve env değerleri; kullanıcının eklediği argümanlar ("--token=..."); "command" içine gömülü
   parola; dize olmayan command/type değerleri. Kullanıcı hangi kayıttan söz edildiğini yine
   anlayabilmeli: program yolu (izin listesine uyuyorsa), şema://sunucu[:port], argüman sayısı.
2. Claude Code'un geçersiz saydığı kayıt (tests/claude_mcp_sinir.json: gerçek claude 2.1.325 ile
   ölçülmüş kabul/ret sınırı). Claude Code böyle bir kaydı yok sayar, "mcp add-json" reddeder; kurulum
   ve kaldırma kayda dokunmaz, nedeni (yalnız yer ve tür) söylenir. Geçerli kayıtta türe ait olmayan
   alan (stdio'da headers, http'de env) kurulumu durdurmaz.
3. Adres ve kayıt gösterimi iki platformda her girdide aynıdır; şüpheli adres sabit metindir.
4. Kayıttan gelen hiçbir metin terminale kontrol karakteri, ANSI kaçışı ya da satır sonu olarak geçmez.

Gerçek claude yerine, ölçülen sınırı tablo olarak taşıyan bir öykünücü kullanılır (CLAUDE_CONFIG_DIR
geçici; gerçek ~/.claude.json'a dokunulmaz). Öykünücü de denetim de ölçüme karşı sınanır. Testteki tüm
"sırlar" SAHTE ile başlar.
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
U = mcp_config.UNRESOLVED_URL
H = mcp_config.HIDDEN_PROGRAM
# Gözden geçiricinin terminal örneği: env anahtarında satır sonu sahte bir "kaydedildi" satırı üretirdi.
SAHTE_SATIR = "  \u2714 MCP kaydedildi: sahte"
KONTROL_ANAHTAR = "K\r\n" + SAHTE_SATIR
SINIR = json.loads((Path(__file__).resolve().parent / "claude_mcp_sinir.json").read_text(encoding="utf-8"))["vakalar"]


@pytest.fixture(autouse=True)
def _isolated_home(tmp_path, monkeypatch):
    home = tmp_path / "fake-home"
    home.mkdir()
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setenv("USERPROFILE", str(home))
    monkeypatch.delenv("CLAUDE_CONFIG_DIR", raising=False)


def _temiz_terminal(text: str) -> None:
    """Metin terminale ham kontrol karakteri taşımıyor; kayıttan sahte satır üremiyor."""
    t = text.replace("\r\n", "\n")
    assert "\x1b" not in t and "\r" not in t and "\x9b" not in t and "\x08" not in t, repr(text)
    assert not any(ln.startswith(SAHTE_SATIR) for ln in t.split("\n")), repr(text)


# ---------------------------------------------------------------- senaryolar

def _sizinti_kayitlari(py: str) -> dict:
    """Ekranda gösterilirse sır sızdıran ama Claude Code'un kabul ettiği kayıtlar."""
    return {
        "url": {"type": "http", "url": SAHTE_URL, "headers": {"Authorization": "Bearer SAHTEBASLIK"}},
        "yabanci": {"type": "stdio", "command": "C:/baska/sunucu.exe", "args": ["--token=SAHTEARG", "SAHTECIPLAK"],
                    "env": {"K": "SAHTEENV"}},
        "tasinan": {"type": "stdio", "command": py, "args": ["-m", "bellek.beyin", "mcp", "--token=SAHTEARG"],
                    "env": {"K": "SAHTEENV"}},
        # Ayrıştırıcıların farklı okuduğu adresler (Python/.NET): sunucu adı diye kullanıcı bilgisi yazılmaz.
        "url_ters": {"type": "http", "url": "https://h\\@SAHTE/"},
        "url_noktali": {"type": "sse", "url": "https://ex.invalid;SAHTE=1/"},
        "url_parca": {"type": "http", "url": "https://kul:12#SAHTE@example.invalid/"},
        "url_sorgu": {"type": "http", "url": "https://SAHTETOKEN?@example.invalid"},
        # "command" içine gömülü sır.
        "komut_url": {"type": "stdio", "command": "curl https://kul:SAHTEPAROLA@example.invalid", "args": []},
        "komut_bosluk": {"type": "stdio", "command": "C:/araclar/x.exe SAHTETOKEN", "args": []},
        # Türe ait olmayan alan Claude Code'ca yok sayılır: kayıt geçerlidir, kurulum durmaz.
        "stdio_baslik": {"type": "stdio", "command": "C:/baska/sunucu.exe", "args": [],
                         "headers": {"A": 1, "B": "SAHTEBASLIK"}},
        "http_env": {"type": "http", "url": "https://example.invalid/", "env": {"A": 1, "B": "SAHTEENV"},
                     "command": ["SAHTE"]},
        "stdio_url": {"type": "stdio", "command": "C:/baska/sunucu.exe", "args": [], "url": 5},
        # Terminal: komutta ESC[2K\r, env anahtarında satır sonu (Windows PowerShell 5.1'de GetFileName
        # kontrol karakterli yolda hata fırlatıyordu).
        "kontrol": {"type": "stdio", "command": "C:/baska/su\x1b[2K\rnucu.exe", "args": ["SAHTEARG"],
                    "env": {KONTROL_ANAHTAR: "SAHTEENV"}},
    }


def _gecersiz_kayitlar(py: str) -> dict:
    """Claude Code'un reddettiği (ölçülmüş) kayıtlar -> beklenen sorun parçaları."""
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
        # Gözden geçiricinin örnekleri: dize olmayan command/type değeri hiçbir yolda basılmaz.
        "komut_dizi": ({"type": "stdio", "command": ["C:/x.exe", "--token=SAHTE"]}, ["command: dizi"]),
        "komut_nesne": ({"type": "stdio", "command": {"tok": "SAHTE"}}, ["command: nesne"]),
        "komut_dizi_depoda": ({"command": [py, "--token=SAHTE"], "args": BEYIN_ARGS}, ["command: dizi"]),
        "tur_nesne": ({"type": {"k": "SAHTE"}, "url": "https://example.invalid/"}, ["type: nesne"]),
        "tur_sayi": ({"type": 5, "command": py, "args": BEYIN_ARGS}, ["type: sayı"]),
        "tur_bilinmez": ({"type": "SAHTE\x1b[2K", "command": py, "args": BEYIN_ARGS}, ["type: bilinmeyen tür"]),
        "komutsuz": ({"type": "stdio", "env": {"TOKEN": "SAHTEENV"}}, ["command: yok (zorunlu)"]),
        "zaman": ({"command": py, "args": BEYIN_ARGS, "timeout": 1.5}, ["timeout: sayı (pozitif tam sayı olmalı)"]),
        "baslik_sayi": ({"type": "http", "url": SAHTE_URL, "headers": {"A": 1}}, ["headers.A: sayı"]),
        "kontrol_anahtar": ({"command": py, "args": BEYIN_ARGS, "env": {KONTROL_ANAHTAR: 5}},
                            ["env.K\\x0d\\x0a" + SAHTE_SATIR + ": sayı"]),
    }


# ---------------------------------------------------------------- claude öykünücüsü
#
# Gerçek claude 2.1.325 ile ölçülen davranış (claude_mcp_sinir.json): "mcp add-json" geçersiz kaydı
# "Invalid configuration: : Invalid input" ile 1 döner, yazmaz; geçerli kayıtta türe ait olmayan
# alanları atar ve stdio'ya "args": [] ekler; "mcp remove" geçersiz kaydı da siler. Kabul kararı
# entry_problems'in kopyası değil, ölçümden çıkarılmış bir tablodur; test_oykunucu_olcumle_ayni
# tabloyu ölçülen her vakaya karşı sınar.

_EMU = r'''
import json, os, sys

# Tür -> alan -> kabul edilen biçimler. Tabloda olmayan alan yok sayılır (add-json'da atılır).
TABLO = {
    "stdio": {"command": {"dolu_dize"}, "args": {"dize_dizisi"}, "env": {"dize_nesnesi"},
              "timeout": {"pozitif_guvenli_tam"}},
    "sse": {"url": {"dolu_dize", "bos_dize"}, "headers": {"dize_nesnesi"}, "headersHelper": {"dolu_dize", "bos_dize"},
            "oauth": {"clientId_dize_nesnesi"}, "tools": {"adli_nesne_dizisi"}, "timeout": {"pozitif_guvenli_tam"}},
    "ws": {"url": {"dolu_dize", "bos_dize"}, "headers": {"dize_nesnesi"}, "headersHelper": {"dolu_dize", "bos_dize"},
           "timeout": {"pozitif_guvenli_tam"}},
}
TABLO["http"] = TABLO["sse"]
ZORUNLU = {"stdio": "command", "sse": "url", "http": "url", "ws": "url"}

def bicimler(v):
    b = set()
    if isinstance(v, str):
        b.add("dolu_dize" if v else "bos_dize")
    elif isinstance(v, (int, float)) and not isinstance(v, bool):
        if float(v).is_integer() and 0 < v <= 2 ** 53 - 1:
            b.add("pozitif_guvenli_tam")
    elif isinstance(v, list):
        if all(isinstance(x, str) for x in v):
            b.add("dize_dizisi")
        if all(isinstance(x, dict) and isinstance(x.get("name"), str) for x in v):
            b.add("adli_nesne_dizisi")
    elif isinstance(v, dict):
        if all(isinstance(x, str) for x in v.values()):
            b.add("dize_nesnesi")
        if isinstance(v.get("clientId", ""), str):
            b.add("clientId_dize_nesnesi")
    return b

def kabul(e):
    if not isinstance(e, dict):
        return False
    t = e["type"] if "type" in e else "stdio"
    if not isinstance(t, str) or t not in TABLO or ZORUNLU[t] not in e:
        return False
    return all(bicimler(e[k]) & izin for k, izin in TABLO[t].items() if k in e)

def sakla(e):
    t = e["type"] if "type" in e else "stdio"
    out = {k: v for k, v in e.items() if k == "type" or k in TABLO[t]}
    if t == "stdio":
        out.setdefault("args", [])
    return out

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
        if not kabul(entry):
            return 1, "", "Invalid configuration: : Invalid input"
        if name in servers:
            return 1, "", f"MCP server {name} already exists in user config"
        servers[name] = sakla(entry)
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


# ---------------------------------------------------------------- ölçülen claude sınırı

def test_olcum_dosyasi_beklenen_vakalari_tasir():
    by = {ad: kabul for ad, _, kabul in SINIR}
    assert len(SINIR) > 1000 and set(by.values()) == {True, False}
    # Gözden geçiricinin örnekleri (gerçek claude): türe ait olmayan alan denetlenmez; type 5 reddedilir.
    assert by["stdio|headers|nesne_sayi"] and by["http|env|nesne_sayi"] and by["stdio|url|sayi"]
    assert not by["sayi|-|-"] and not by["stdio|env|nesne_sayi"] and not by["http|headers|nesne_sayi"]


def test_denetim_olculen_claude_siniriyla_ayni():
    yanlis = [(ad, e, kabul, mcp_config.entry_problems(e)) for ad, e, kabul in SINIR
              if (mcp_config.entry_problems(e) == []) != kabul]
    assert not yanlis, yanlis[:10]


def test_oykunucu_olcumle_ayni(tmp_path):
    emu = _emu_module(tmp_path)
    yanlis = [(ad, e, kabul) for ad, e, kabul in SINIR if emu.kabul(e) != kabul]
    assert not yanlis, yanlis[:10]


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


def _ps_env(shell: str) -> dict:
    env = dict(os.environ)
    if shell == "powershell":
        env.pop("PSModulePath", None)  # pwsh'tan devralınan modül yolu 5.1'i bozmasın
    return env


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
    r = subprocess.run([shell, "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", str(script),
                        "-Module", str(INSTALLER / "ErenKit.Installer.psm1"), "-Claude", str(emu / "claude.cmd"),
                        "-Helper", str(INSTALLER / "mcp_config.py"), "-Plan", str(plan_file), "-Repo", str(repo)],
                       capture_output=True, timeout=900, env=_ps_env(shell), cwd=str(tmp_path))
    out = r.stdout.decode("utf-8", "replace") + r.stderr.decode("utf-8", "replace")
    results, texts, cur = {}, {}, None
    for line in out.split("\n"):
        line = line[:-1] if line.endswith("\r") else line
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


_OPS = (("reg", True, 0), ("reg", False, 0), ("reg", False, 1), ("unreg", True, 0), ("unreg", False, 0))


@pytest.mark.skipif(not _shells(), reason="Windows PowerShell gerekli")
@pytest.mark.parametrize("shell", _shells() or ["-"])
def test_windows_mevcut_kayit_sirlari_yazilmaz(shell, tmp_path):
    repo, py = _win_repo(tmp_path)
    emu = _emu_module(tmp_path)
    cmd = [py, *BEYIN_ARGS]
    olds = _sizinti_kayitlari(py)
    plan = []
    for kind, old in olds.items():
        for op, dry, fail in _OPS:
            sid = f"{kind}-{op}-{'dry' if dry else 'real'}-{fail}"
            d = tmp_path / "s" / sid
            plan.append({"id": sid, "cfg": str(_cfg(d, {"beyin": old}, fail)), "bk": str(d / "bk"),
                         "dry": dry, "op": op, "cmd": cmd})
    res, texts = _run_ps(shell, tmp_path, plan, repo)
    for s in plan:
        sid, text = s["id"], texts[s["id"]] + res[s["id"]]["message"]
        assert SIR not in text, (sid, text)
        _temiz_terminal(text)
        cfg = Path(s["cfg"])
        old = olds[sid.split("-")[0]]
        if sid.endswith("reg-real-1"):  # yeni kayıt başarısız: eski kayıt geri yüklenir
            assert res[sid]["status"] == "error" and "geri yüklendi" in text, (sid, text)
            assert _servers(cfg)["beyin"] == emu.sakla(old), sid
        if sid.endswith("reg-real-0") and "-unreg-" not in sid:  # geçerli kayıt: kurulum durmaz
            assert res[sid]["status"] in ("ok", "warn"), (sid, res[sid])
    # Kullanıcı hangi kayıttan söz edildiğini yine anlar.
    assert "http https://example.invalid:8443/…" in res["url-reg-dry-0"]["message"], res["url-reg-dry-0"]
    assert "example.invalid:8443" in res["url-unreg-dry-0"]["message"], res["url-unreg-dry-0"]
    assert "C:/baska/sunucu.exe (+2 argüman daha" in res["yabanci-reg-dry-0"]["message"], res["yabanci-reg-dry-0"]
    assert "-m bellek.beyin mcp (+1 argüman daha" in texts["tasinan-reg-real-0"], texts["tasinan-reg-real-0"]
    for kind in ("url_ters", "url_noktali", "url_parca", "url_sorgu"):
        assert U in res[f"{kind}-reg-dry-0"]["message"], res[f"{kind}-reg-dry-0"]
    for kind in ("komut_url", "komut_bosluk", "kontrol"):
        assert H in res[f"{kind}-reg-dry-0"]["message"], res[f"{kind}-reg-dry-0"]
    assert "korunan" not in res["kontrol-reg-real-0"]["message"]
    assert "env değerleri (K\\x0d\\x0a" in res["kontrol-reg-real-0"]["message"], res["kontrol-reg-real-0"]
    # Taşınan değerler yeni kayda birebir gider (gizleme yalnız ekranda).
    new = _servers(Path(next(s["cfg"] for s in plan if s["id"] == "tasinan-reg-real-0")))["beyin"]
    assert new["args"] == [*BEYIN_ARGS, "--token=SAHTEARG"] and new["env"] == {"K": "SAHTEENV"}, new
    # Depoyu gösteren geçerli kayıt kaldırılır; yabancısına dokunulmaz.
    assert "beyin" not in _servers(Path(next(s["cfg"] for s in plan if s["id"] == "tasinan-unreg-real-0")))
    assert _servers(Path(next(s["cfg"] for s in plan if s["id"] == "yabanci-unreg-real-0")))["beyin"] == olds["yabanci"]


@pytest.mark.skipif(not _shells(), reason="Windows PowerShell gerekli")
@pytest.mark.parametrize("shell", _shells() or ["-"])
def test_windows_gecersiz_kayda_dokunulmaz(shell, tmp_path):
    repo, py = _win_repo(tmp_path)
    cmd = [py, *BEYIN_ARGS]
    cases = _gecersiz_kayitlar(py)
    # Kontrol: tarih biçimli dize (PowerShell 7 ConvertFrom-Json'ı DateTime yapar) ve sayı biçimli
    # dize sorun sayılmaz, birebir taşınır.
    ok_old = {"type": "stdio", "command": py, "args": ["-m", "bellek.beyin", "mcp"],
              "env": {"T": "2026-01-01T00:00:00Z", "PORT": "8080"}}
    plan = []
    for kind, (old, _) in [*cases.items(), ("dize", (ok_old, []))]:
        for op, dry in (("reg", True), ("reg", False), ("unreg", True), ("unreg", False)):
            sid = f"{kind}-{op}-{'dry' if dry else 'real'}"
            d = tmp_path / "s" / sid
            plan.append({"id": sid, "cfg": str(_cfg(d, {"beyin": old})), "bk": str(d / "bk"),
                         "dry": dry, "op": op, "cmd": cmd})
    res, texts = _run_ps(shell, tmp_path, plan, repo)
    for kind, (old, parts) in cases.items():
        dry, real = res[f"{kind}-reg-dry"], res[f"{kind}-reg-real"]
        assert dry["status"] == "warn" and "kaydedilemeyecek" in dry["message"], dry
        assert real["status"] == "error" and "hiçbir şey değiştirilmedi" in real["message"], real
        for op in ("dry", "real"):  # kaldırma da dokunmaz (yedek almadan silerdi)
            u = res[f"{kind}-unreg-{op}"]
            assert u["status"] == "warn" and "kaldırılmadı" in u["message"], u
            assert "claude mcp remove beyin -s user" in u["message"], u
        for p in parts:
            assert all(p in res[f"{kind}-{x}"]["message"] for x in ("reg-dry", "reg-real", "unreg-dry", "unreg-real")), \
                (kind, p, real)
        for s in plan:
            if s["id"].startswith(kind + "-"):
                cfg = Path(s["cfg"])
                assert _servers(cfg)["beyin"] == old, s["id"]  # kayıt yerinde, değeri aynı
                assert _calls(cfg) == [], s["id"]  # claude hiç çağrılmadı
                text = texts[s["id"]] + res[s["id"]]["message"]
                assert SIR not in text, (s["id"], text)
                _temiz_terminal(text)
    assert res["dize-reg-real"]["status"] == "ok", res["dize-reg-real"]
    new = _servers(Path(next(s["cfg"] for s in plan if s["id"] == "dize-reg-real")))["beyin"]
    assert new["env"] == ok_old["env"] and new["args"] == BEYIN_ARGS, new
    assert res["dize-unreg-real"]["status"] == "ok", res["dize-unreg-real"]


@pytest.mark.skipif(not _shells(), reason="Windows PowerShell gerekli")
@pytest.mark.parametrize("shell", _shells() or ["-"])
def test_windows_powershellin_okuyamadigi_kayit_ham_hatayla_durmaz(shell, tmp_path):
    """env'de yalnız harf büyüklüğüyle ayrılan anahtarlar ya da boş anahtar: ConvertFrom-Json iki
    kabukta da hata veriyordu (kurulum ham hatayla duruyordu). Artık açık iletiyle dokunulmaz."""
    repo, py = _win_repo(tmp_path)
    cases = {"buyuk_kucuk": {"command": py, "args": BEYIN_ARGS, "env": {"Path": "SAHTEA", "PATH": "SAHTEB"}},
             "bos_anahtar": {"command": py, "args": BEYIN_ARGS, "env": {"": "SAHTE"}}}
    plan = []
    for kind, old in cases.items():
        for op, dry in (("reg", True), ("reg", False), ("unreg", True), ("unreg", False)):
            sid = f"{kind}-{op}-{'dry' if dry else 'real'}"
            d = tmp_path / "s" / sid
            plan.append({"id": sid, "cfg": str(_cfg(d, {"beyin": old})), "bk": str(d / "bk"),
                         "dry": dry, "op": op, "cmd": [py, *BEYIN_ARGS]})
    res, _ = _run_ps(shell, tmp_path, plan, repo)
    for s in plan:
        r = res[s["id"]]
        assert "okunamıyor" in r["message"] and SIR not in r["message"], r
        assert r["status"] == ("error" if s["id"].endswith("reg-real") and "-unreg-" not in s["id"] else "warn"), r
        assert _servers(Path(s["cfg"]))["beyin"] == cases[s["id"].split("-")[0]] and _calls(Path(s["cfg"])) == []
    assert "Path, PATH" in res["buyuk_kucuk-reg-dry"]["message"] and "boş anahtar" in res["bos_anahtar-reg-dry"]["message"]


@pytest.mark.skipif(not _shells(), reason="Windows PowerShell gerekli")
@pytest.mark.parametrize("shell", _shells() or ["-"])
def test_windows_adim_satiri_kontrol_karakteri_basmaz(shell, tmp_path):
    script = tmp_path / "satir.ps1"
    script.write_text(r"""
param([string]$Module)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Import-Module $Module -Force -DisableNameChecking
Write-StepLine ok ("a" + [char]27 + "[2K" + [char]13 + "b" + [char]0x9b + "c" + [char]8 + [Environment]::NewLine + "      | d")
Write-StepLine info ("e" + [char]0x202e + "f" + [char]0xd800 + "g")
""", encoding="utf-8-sig")
    r = subprocess.run([shell, "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", str(script),
                        "-Module", str(INSTALLER / "ErenKit.Installer.psm1")], capture_output=True, timeout=120,
                       env=_ps_env(shell))
    out = r.stdout.decode("utf-8", "replace").replace("\r\n", "\n")
    assert r.returncode == 0, out + r.stderr.decode("utf-8", "replace")
    assert "a\\x1b[2K\\x0db\\x9bc\\x08\n      | d\n" in out, out  # iletinin kendi satır yapısı korunur
    assert "e\\u202ef\\ud800g" in out, out
    _temiz_terminal(out)


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
    emu = _emu_module(tmp_path)
    for kind, old in _sizinti_kayitlari(py).items():
        for op, dry, fail in _OPS:
            sid = f"{kind}-{op}-{dry}-{fail}"
            status, msg, cfg = _mac(tmp_path, monkeypatch, sid, old, fail, dry, op)
            assert SIR not in msg, (sid, msg)
            _temiz_terminal(msg)
            if op == "reg" and fail:
                assert status == "error" and "geri yüklendi" in msg, (sid, msg)
                assert _servers(cfg)["beyin"] == emu.sakla(old), sid
            if op == "reg" and not fail:
                assert status in ("ok", "warn", "dry"), (sid, status, msg)
    # Windows ile aynı gösterim.
    olds = _sizinti_kayitlari(py)
    _, msg, _ = _mac(tmp_path, monkeypatch, "url-goster", olds["url"], dry=True)
    assert "http https://example.invalid:8443/…" in msg, msg
    _, msg, _ = _mac(tmp_path, monkeypatch, "yabanci-goster", olds["yabanci"], dry=True)
    assert "C:/baska/sunucu.exe (+2 argüman daha" in msg, msg
    for kind in ("url_ters", "url_noktali", "url_parca", "url_sorgu"):
        _, msg, _ = _mac(tmp_path, monkeypatch, f"{kind}-goster", olds[kind], dry=True)
        assert U in msg, msg
    for kind in ("komut_url", "komut_bosluk", "kontrol"):
        _, msg, _ = _mac(tmp_path, monkeypatch, f"{kind}-goster", olds[kind], dry=True)
        assert H in msg, msg


def test_macos_gecersiz_kayda_dokunulmaz_ve_donusturulmez(tmp_path, monkeypatch):
    py = _mac_py(tmp_path)
    for kind, (old, parts) in _gecersiz_kayitlar(py).items():
        for op, dry in (("reg", True), ("reg", False), ("unreg", True), ("unreg", False)):
            status, msg, cfg = _mac(tmp_path, monkeypatch, f"{kind}-{op}-{dry}", old, dry=dry, op=op)
            if op == "reg":
                want = ("warn", "kaydedilemeyecek") if dry else ("error", "hiçbir şey değiştirilmedi")
            else:
                want = ("warn", "kaldırılmadı")
            assert status == want[0] and want[1] in msg and all(p in msg for p in parts), (kind, op, dry, msg)
            assert SIR not in msg, (kind, msg)
            _temiz_terminal(msg)
            assert _servers(cfg)["beyin"] == old, (kind, _servers(cfg))  # True -> "True" gibi dönüşüm yok
            assert _calls(cfg) == [], kind


def test_macos_adim_satiri_kontrol_karakteri_basmaz(capsys):
    im.line("ok", "a\x1b[2K\rb\x9bc\nd")
    out = capsys.readouterr().out
    assert "a\\x1b[2K\\x0db\\x9bc\nd" in out, out
    _temiz_terminal(out)


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
    $g = & $m { param($x) Format-McpProgram $x } $c.prog
    # Metin UTF-16 birimleriyle gelir: ConvertFrom-Json eşi olmayan vekili U+FFFD yapar.
    $txt = -join @($c.units | ForEach-Object { [string][char][int]$_ })
    $t = & $m { param($x) Format-TerminalText $x } $txt
    $tn = & $m { param($x) Format-TerminalText $x -KeepNewline } $txt
    [pscustomobject]@{ d = $d; p = ($p -join '|'); u = $u; g = $g; t = $t; tn = $tn }
}
Write-Output ('JSON:' + (ConvertTo-Json @($out) -Depth 5 -Compress))
"""

_URLS = [
    SAHTE_URL, "https://example.invalid/", "https://example.invalid", "http://example.invalid:80/x",
    "https://example.invalid?k=SAHTE", "http://[::1]:8080/mcp", "HTTPS://Example.Invalid/", "SAHTEDUZMETIN",
    "https://kul:SAHTE@example.invalid", "", "wss://example.invalid:443/", None, 5,
    # Gözden geçiricinin örnekleri ve benzerleri
    "https://h\\@SAHTE/", "https://ex.invalid;SAHTE=1/", "https://kul:12#SAHTE@example.invalid/",
    "https://SAHTETOKEN?@example.invalid", "https://ex\x08ample.invalid/", "https://a\x1bc.invalid/",
    "https://a\x9b.invalid/", "https://ex ample.invalid/", " https://example.invalid/", "ftp://example.invalid/",
    "https://example.invalid./", "https://-x.invalid/", "https://ex_ample.invalid/", "https://example.invalid:/",
    "https://[::1%25eth0]/", "https://[1.2.3.4]/", "https://a@b@example.invalid/", "https://\u00fcnicode.invalid/",
    "https://example.invalid/@SAHTE", "https://example.invalid:0/", "https://example.invalid:08443/x",
    "https://" + "a" * 64 + ".invalid/", "https://xn--bcher-kva.invalid/", "http://127.0.0.1:47321/mcp",
    "https://kul@example.invalid/", "https://:@example.invalid/", "https://k\u00fcl:x@example.invalid/",
]

_PROGS = [
    "C:/Program Files/x/s.exe", "C:\\Program Files (x86)\\x\\y.exe", "C:/My App.exe", "python", "/usr/bin/python3",
    "/opt/homebrew/opt/python@3.12/bin/python3", "C:/Kullan\u0131c\u0131lar/\u015e\u00fckr\u00fc/py.exe",
    "\\\\sunucu\\pay\\x.exe", "~/bin/x", "curl https://kul:SAHTEPAROLA@example.invalid", "C:/araclar/x.exe SAHTETOKEN",
    "C:/x.exe --token=SAHTE", "C:/x.exe -k SAHTE\\a", "ara\u00e7 SAHTE", "C:/x\x1b[2K.exe", "SAHTE=1", " C:/x.exe",
    "C:/x.exe ", "C:/a  b/x.exe", "C:x.exe", "x:y", "C:/a\u00d7b.exe", "C:/a\u0130b.EXE", "C:/a b/x.EXE",
    "", " ", None, 5, ["C:/x.exe"], "C:/a\u202eb.exe", "C:/a b/ \u015f.py",
]

_TEXTS = [
    "", "düz metin", "a\x1b[2K\rb", "K\r\n" + SAHTE_SATIR, "x\x00y\x7fz\x85w\x9b", "\u200b\u200f\u202a\u2066\ufeff",
    "\u2028\u2029", "\ud800yalniz", "son\udfff", "\U0001f600 çift", "\t sekme", "a\nb\r\nc\rd",
]


def _parity_cases() -> list[dict]:
    py = "C:/r/python.exe"
    entries = [*_sizinti_kayitlari(py).values(), *(o for o, _ in _gecersiz_kayitlar(py).values()),
               {"type": "stdio", "command": "C:/Program Files/x/s.exe", "args": ["a b", "c"]},
               {"type": "sse", "url": "SAHTEDUZMETIN"}, {}, {"command": py, "args": [], "env": {}},
               {"command": py, "args": "tek", "headers": {"H": 1}, "url": 5},
               {"command": py, "args": ["-I", 5, "x"]}, {"command": "", "args": ["SAHTE"]}]
    # Ölçülen her claude vakası (PowerShell'in zaten okuyamadığı anahtarlar hariç; bkz. ps_key_problems)
    entries += [e for _, e, _ in SINIR if not mcp_config.ps_key_problems(e)[0]]
    n = max(len(_URLS), len(_PROGS), len(_TEXTS))
    cases = []

    def units(s: str) -> list[int]:
        b = s.encode("utf-16-le", "surrogatepass")
        return [b[i] | (b[i + 1] << 8) for i in range(0, len(b), 2)]

    for i, e in enumerate(entries):
        for shown in ((0, 3) if i < 60 else (0,)):
            j = len(cases)
            cases.append({"entry": e, "shown": shown, "url": _URLS[j % len(_URLS)], "prog": _PROGS[j % len(_PROGS)],
                          "text": _TEXTS[j % len(_TEXTS)]})
    for j in range(n):
        u = _URLS[j % len(_URLS)]
        cases.append({"entry": {"type": "http", "url": u}, "shown": 0, "url": u, "prog": _PROGS[j % len(_PROGS)],
                      "text": _TEXTS[j % len(_TEXTS)]})
    for c in cases:
        c["units"] = units(c["text"])
    return cases


@pytest.mark.skipif(not _shells(), reason="Windows PowerShell gerekli")
@pytest.mark.parametrize("shell", _shells() or ["-"])
def test_gosterim_ve_denetim_iki_platformda_ayni(shell, tmp_path):
    cases = _parity_cases()
    inp = tmp_path / "cases.json"
    inp.write_text(json.dumps(cases), encoding="utf-8")
    script = tmp_path / "parity.ps1"
    script.write_text(_PARITY_HARNESS, encoding="utf-8-sig")
    r = subprocess.run([shell, "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", str(script),
                        "-Module", str(INSTALLER / "ErenKit.Installer.psm1"), "-In", str(inp)],
                       capture_output=True, timeout=600, env=_ps_env(shell))
    out = r.stdout.decode("utf-8", "replace")
    line = [s for s in out.splitlines() if s.startswith("JSON:")]
    assert line, out + r.stderr.decode("utf-8", "replace")
    got = json.loads(line[-1][5:])
    assert len(got) == len(cases)
    for c, g in zip(cases, got):
        assert g["d"] == mcp_config.describe_entry(c["entry"], c["shown"]), (c, g)
        assert (g["p"] or "") == "|".join(mcp_config.entry_problems(c["entry"])), (c, g)
        assert g["u"] == mcp_config.describe_url(c["url"]), (c, g)
        assert g["g"] == mcp_config.describe_program(c["prog"]), (c, g)
        assert (g["t"] or "") == mcp_config.terminal_safe(c["text"]), (c, g)
        assert (g["tn"] or "") == mcp_config.terminal_safe(c["text"], keep_newline=True), (c, g)
        assert SIR not in g["u"] and SIR not in g["g"], (c, g)
        assert c["shown"] or SIR not in g["d"], (c, g)  # gösterilecek argüman istenmediyse hiçbir değer yok
        for v in (g["d"], g["u"], g["g"], g["t"] or ""):
            _temiz_terminal(v)
            assert "\n" not in v, (c, g)


@pytest.mark.parametrize("url, want", [
    (SAHTE_URL, "https://example.invalid:8443/…"),
    ("https://example.invalid/", "https://example.invalid"),
    ("http://example.invalid:80/x", "http://example.invalid/…"),
    ("https://example.invalid?k=SAHTE", "https://example.invalid/…"),
    ("http://[::1]:8080/mcp", "http://[::1]:8080/…"),
    ("HTTPS://Example.Invalid/", "https://example.invalid"),
    ("wss://example.invalid:443/", "wss://example.invalid"),
    ("https://kul:SAHTE@example.invalid", "https://example.invalid/…"),
    ("https://example.invalid:08443/x", "https://example.invalid:8443/…"),
    ("SAHTEDUZMETIN", U),
    ("https://example.invalid:99999/", U),
    (None, "(adres yok)"),
    # Gözden geçiricinin örnekleri: ayrıştırıcılara göre farklı okunan ya da olağandışı adres.
    ("https://h\\@SAHTE/", U),
    ("https://ex.invalid;SAHTE=1/", U),
    ("https://kul:12#SAHTE@example.invalid/", U),
    ("https://SAHTETOKEN?@example.invalid", U),
    ("https://ex\x08ample.invalid/", U),
    ("https://a\x1bc.invalid/", U),
    ("https://a\x9b.invalid/", U),
    ("https://a@b@example.invalid/", U),
    ("https://example.invalid/@SAHTE", U),
    ("ftp://example.invalid/", U),
    ("https://example.invalid./", U),
    ("https://\u00fcnicode.invalid/", U),
])
def test_describe_url(url, want):
    assert mcp_config.describe_url(url) == want


@pytest.mark.parametrize("cmd, shown", [
    ("C:/Program Files/x/s.exe", True),
    ("C:\\Program Files (x86)\\x\\y.exe", True),
    ("C:/My App.exe", True),
    ("/opt/homebrew/opt/python@3.12/bin/python3", True),
    ("C:/Kullan\u0131c\u0131lar/\u015e\u00fckr\u00fc/py.exe", True),
    ("python", True),
    ("curl https://kul:SAHTEPAROLA@example.invalid", False),
    ("C:/araclar/x.exe SAHTETOKEN", False),
    ("C:/x.exe --token=SAHTE", False),
    ("C:/x.exe -k SAHTE\\a", False),
    ("C:/x\x1b[2K\r.exe", False),
    ("SAHTE=1", False),
])
def test_describe_program(cmd, shown):
    got = mcp_config.describe_program(cmd)
    assert (got != H) is shown, got
    assert got == (f'"{cmd}"' if " " in cmd else cmd) if shown else SIR not in got


def test_describe_entry_bilinmeyen_argumanlari_sayar():
    e = {"command": "C:/r/python.exe", "args": ["-I", "-m", "bellek.beyin", "mcp", "--token=SAHTE"]}
    assert mcp_config.describe_entry(e, mcp_config.known_prefix(e, [BEYIN_ARGS])) == \
        "C:/r/python.exe -I -m bellek.beyin mcp (+1 argüman daha; değerleri yazılmaz)"
    assert mcp_config.describe_entry({"type": "stdio", "env": {"TOKEN": "SAHTE"}}) == \
        "(komutu ya da adresi olmayan kayıt; alanlar: type, env)"
    assert mcp_config.describe_entry({"command": ["C:/x.exe", "--token=SAHTE"]}) == \
        "(komutu dize olmayan kayıt: dizi; değeri yazılmaz)"
    assert mcp_config.describe_entry({"type": {"k": "SAHTE"}, "url": "https://example.invalid/"}) == \
        "(türü tanınmayan kayıt: nesne)"
    assert mcp_config.describe_entry({"type": "http", "url": "https://example.invalid/", "command": "C:/x.exe"}) == \
        "http https://example.invalid"  # uzak kayıtta command Claude Code'ca yok sayılır


@pytest.mark.parametrize("text, keep, want", [
    ("a\x1b[2K\rb", False, "a\\x1b[2K\\x0db"),
    ("K\r\n  x", False, "K\\x0d\\x0a  x"),
    ("a\r\nb\rc\n", True, "a\nb\\x0dc\n"),
    ("\x9b\x85\x7f\x00", False, "\\x9b\\x85\\x7f\\x00"),
    ("\u202e\u2066\u200b\ufeff\u2028", False, "\\u202e\\u2066\\u200b\\ufeff\\u2028"),
    ("\ud800x", False, "\\ud800x"),
    ("\U0001f600 ç İ", False, "\U0001f600 ç İ"),
])
def test_terminal_safe(text, keep, want):
    assert mcp_config.terminal_safe(text, keep_newline=keep) == want


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


@pytest.mark.parametrize("url", ["https://h\\@SAHTE/", "https://ex.invalid;SAHTE=1/", "https://kul:12#SAHTE@example.invalid/",
                                 "https://SAHTETOKEN?@example.invalid"])
def test_doktor_supheli_adresi_yazmaz(tmp_path, url):
    c = _doktor_mcp(tmp_path, {"type": "http", "url": url})
    assert c["status"] == "ok" and SIR not in c["detail"] and U in c["detail"], c


@pytest.mark.parametrize("args, shown", [
    (["-m", "bellek.beyin", "mcp", "--token=SAHTEARG"], "-m bellek.beyin mcp (+1 argüman daha"),  # GÜVENSİZ uyarısı
    ([*BEYIN_ARGS, "--token", "SAHTEARG"], " ".join(BEYIN_ARGS) + " (+2 argüman daha"),  # kayıtlı satırı
    # Bilinmeyen biçim: kayıt satırında hiçbir argüman yazılmaz. Göreli betik yolu GÜVENSİZ nedeninde
    # yalnız betik adına benziyorsa (izinli karakterler, bilinen uzantı) adıyla geçer.
    (["-I", "betik.py", "SAHTEARG"], "(+3 argüman daha"),
    (["-Wdefault", "SAHTE-TOKEN"], "değeri yazılmaz"),  # "-W" değeri bitişik: sonraki parça betik sanılır
])
def test_doktor_kullanici_argumanlarini_yazmaz(tmp_path, args, shown):
    c = _doktor_mcp(tmp_path, {"type": "stdio", "command": sys.executable, "args": args, "env": {"K": "SAHTEENV"}})
    assert SIR not in c["detail"] and shown in c["detail"], c


def test_doktor_goreli_betik_adini_yazar():
    risk = doktor._cwd_code_risk("python", ["betik.py"], {})
    assert risk and "(betik.py)" in risk, risk
    risk = doktor._cwd_code_risk("python", ["-Wdefault", "SAHTE-TOKEN"], {})
    assert risk and SIR not in risk and "değeri yazılmaz" in risk, risk


def test_doktor_bilinen_argumanlar_kurulumunkiyle_ayni():
    assert list(doktor._KNOWN_MCP_ARGS["beyin"][0]) == BEYIN_ARGS
    assert list(doktor._KNOWN_MCP_ARGS["beyin"][1]) == [a for a in BEYIN_ARGS if a != "-I"]


@pytest.mark.parametrize("entry, part", [
    ({"type": "stdio", "command": sys.executable, "args": BEYIN_ARGS, "env": {"PORT": 8080}}, "env.PORT: sayı"),
    ({"type": "stdio", "command": sys.executable, "args": [*BEYIN_ARGS, None]}, "args[4]: null"),
    ({"type": "http", "url": "https://example.invalid/", "headers": {"A": True}}, "headers.A: true/false"),
    ({"type": {"k": "SAHTE"}, "url": "https://example.invalid/"}, "type: nesne"),
    ({"type": 5, "command": sys.executable, "args": BEYIN_ARGS}, "type: sayı"),
    ({"type": "SAHTE", "url": "https://example.invalid/"}, "type: bilinmeyen tür"),
    ({"command": ["C:/x.exe", "--token=SAHTE"]}, "command: dizi"),
])
def test_doktor_gecersiz_kaydi_hata_sayar(tmp_path, entry, part):
    c = _doktor_mcp(tmp_path, entry)
    assert c["status"] == "error" and "yok sayıyor" in c["detail"] and part in c["detail"], c
    assert SIR not in c["detail"], c


@pytest.mark.parametrize("entry", [
    {"type": "stdio", "command": sys.executable, "args": BEYIN_ARGS, "headers": {"A": 1}},
    {"type": "stdio", "command": sys.executable, "args": BEYIN_ARGS, "url": 5},
    {"type": "http", "url": "https://example.invalid/", "env": {"A": 1}},
])
def test_doktor_ture_ait_olmayan_alani_denetlemez(tmp_path, entry):
    """Gerçek claude bu kayıtları kabul eder: doktor "yok sayıyor" demez."""
    c = _doktor_mcp(tmp_path, entry)
    assert "yok sayıyor" not in c["detail"], c


def test_doktor_komut_ve_cikti_terminali_kirletmez(tmp_path, capsys, monkeypatch):
    monkeypatch.delenv("NoDefaultCurrentDirectoryInExePath", raising=False)  # main() ayarlar; test sonunda geri alınır
    home = tmp_path / "claude"
    home.mkdir()
    entry = {"type": "stdio", "command": "C:/yok/su\x1b[2K\rnucu.exe", "args": [], "env": {KONTROL_ANAHTAR: "x"}}
    (home / ".claude.json").write_text(json.dumps({"mcpServers": {"beyin": entry, "computer-use-windows": {
        "command": "curl https://kul:SAHTEPAROLA@example.invalid"}}}), encoding="utf-8")
    c = {x["name"]: x for x in doktor.run_checks(home, REPO, network=False)["checks"]}
    assert c["mcp:beyin"]["status"] == "error" and H in c["mcp:beyin"]["detail"], c["mcp:beyin"]
    assert SIR not in c["mcp:computer-use-windows"]["detail"], c["mcp:computer-use-windows"]
    capsys.readouterr()
    doktor.main(["--claude-home", str(home), "--repo", str(REPO), "--no-network"])
    out = capsys.readouterr().out
    assert "mcp:beyin" in out and SIR not in out, out
    _temiz_terminal(out)


def test_doktor_bellek_ortamina_uydurma_deger_vermez(tmp_path):
    home = tmp_path / "claude"
    home.mkdir()
    entry = {"type": "stdio", "command": sys.executable, "args": BEYIN_ARGS, "env": {"A": "1", "B": None, "C": 5}}
    (home / ".claude.json").write_text(json.dumps({"mcpServers": {"beyin": entry}}), encoding="utf-8")
    exe, env = doktor._bellek_python(doktor.Ctx(home, REPO, False))
    assert exe is not None and env == {"A": "1"}, env
