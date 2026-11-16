"""Kullanıcının mevcut MCP kaydı: sırlar ekrana yazılmaz, geçersiz kayıt kaybolmaz, terminal kirlenmez.

1. Kurulum (Windows: ErenKit.Installer.psm1, macOS/Linux: install_macos.py) ve doktor, var olan bir
   kaydı gösterirken sır yazmamalı: uzak sunucu adresindeki kullanıcı:parola@, yol, sorgu, parça;
   headers ve env değerleri; kullanıcının eklediği argümanlar ("--token=..."); "command" içine gömülü
   parola; dize olmayan command/type değerleri. Kullanıcı hangi kayıttan söz edildiğini yine
   anlayabilmeli: program yolu (izin listesine uyuyorsa), şema://sunucu[:port], argüman sayısı.
2. Claude Code'un geçersiz saydığı kayıt (tests/claude_mcp_sinir.json: gerçek claude 2.1.325 ile
   ölçülmüş kabul/ret sınırı). Claude Code böyle bir kaydı yok sayar, "mcp add-json" reddeder; kurulum
   ve kaldırma kayda dokunmaz, nedeni (yalnız yer ve tür) söylenir. Geçerli kayıtta türe ait olmayan
   alan (stdio'da headers, http'de env) kurulumu durdurmaz. Denetimin bilmediği bir ret de değer
   kaybettirmez: kayda dokunan her yol önce yedekler (dosyanın sonundaki üçüncü tur testleri).
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
_OLCUM = json.loads((Path(__file__).resolve().parent / "claude_mcp_sinir.json").read_text(encoding="utf-8"))
SINIR = _OLCUM["vakalar"] + [[ad, {"type": t, "url": "https://example.invalid/" + "a" * (n - 24)}, kabul]
                             for ad, t, n, kabul in _OLCUM["uzun_url"]]
# Denetimin bilerek taklit etmediği ölçülmüş ret (bkz. mcp_config.entry_problems "Bilinen eksik"):
# claude authServerMetadataUrl'yi WHATWG URL ayrıştırıcısıyla da denetler. Bu vakalar ve claude'un
# ileride reddetmeye başlayacağı alanlar için güvence yedektir (test_*_denetimin_bilmedigi_ret_*).
BILINEN_EKSIK = {"sse|oauth.authServerMetadataUrl|yalniz_sema", "http|oauth.authServerMetadataUrl|yalniz_sema"}


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
# alanları atar ve stdio'ya "args": [] ekler; "mcp remove" geçersiz kaydı da siler. null değerli kayıt
# "yok" sayılır (add-json ekler, remove "yok" der); nesne olmayan değer (5, "x", [], {}) "var"dır
# (add-json "already exists" der, remove siler). Kabul kararı entry_problems'in kopyası değil, ölçümden
# çıkarılmış bir tablodur; test_oykunucu_olcumle_ayni tabloyu ölçülen her vakaya karşı sınar.
# Yapılandırma klasöründe "reddedilen-alanlar" dosyası varsa (satır başına bir alan adı) öykünücü o
# alanı taşıyan kaydı reddeder: claude'un ileride yeni bir alanı reddetmeye başladığı durum.

_EMU = r'''
import json, os, sys

from urllib.parse import urlsplit

# Tür -> alan -> kabul edilen biçimler. Tabloda olmayan alan yok sayılır (add-json'da atılır).
ORTAK = {"timeout": {"pozitif_guvenli_tam"}, "alwaysLoad": {"bool"}, "bareElicitationCapability": {"bool"}}
TABLO = {
    "stdio": {"command": {"dolu_dize"}, "args": {"dize_dizisi"}, "env": {"dize_nesnesi"}, **ORTAK},
    "sse": {"url": {"kisa_dize"}, "headers": {"dize_nesnesi"}, "headersHelper": {"dolu_dize", "bos_dize"},
            "oauth": {"gecerli_oauth"}, "tools": {"adli_nesne_dizisi"}, "toolPermissions": {"izin_nesnesi"},
            "discoveryCache": {"bool"}, **ORTAK},
    "ws": {"url": {"kisa_dize"}, "headers": {"dize_nesnesi"}, "headersHelper": {"dolu_dize", "bos_dize"}, **ORTAK},
}
TABLO["http"] = TABLO["sse"]
ZORUNLU = {"stdio": "command", "sse": "url", "http": "url", "ws": "url"}

def pozitif_tam(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and float(v).is_integer() and 0 < v <= 2 ** 53 - 1

def u16(s):
    return len(s.encode("utf-16-le", "surrogatepass")) // 2

def gecerli_oauth(o):
    if "clientId" in o and not isinstance(o["clientId"], str):
        return False
    if "callbackPort" in o and not pozitif_tam(o["callbackPort"]):
        return False
    if "scopes" in o and not (isinstance(o["scopes"], str) and o["scopes"]):
        return False
    if "xaa" in o and not isinstance(o["xaa"], bool):
        return False
    if "authServerMetadataUrl" in o:
        m = o["authServerMetadataUrl"]
        if not isinstance(m, str) or u16(m) > 4096:
            return False
        m = m.strip()  # claude (zod url()) baştaki/sondaki boşluğu atıp URL olarak ayrıştırır
        if not m.startswith("https://") or not urlsplit(m).netloc:
            return False
    return True

def bicimler(v):
    b = set()
    if isinstance(v, bool):
        b.add("bool")
    elif isinstance(v, str):
        b.add("dolu_dize" if v else "bos_dize")
        if u16(v) <= 65536:
            b.add("kisa_dize")
    elif pozitif_tam(v):
        b.add("pozitif_guvenli_tam")
    elif isinstance(v, list):
        if all(isinstance(x, str) for x in v):
            b.add("dize_dizisi")
        if all(isinstance(x, dict) and isinstance(x.get("name"), str)
               and x.get("permission_policy", "always_ask") in ("always_allow", "always_ask", "always_deny") for x in v):
            b.add("adli_nesne_dizisi")
    elif isinstance(v, dict):
        if all(isinstance(x, str) for x in v.values()):
            b.add("dize_nesnesi")
        if all(x in ("allow", "ask", "blocked") for x in v.values()):
            b.add("izin_nesnesi")
        if gecerli_oauth(v):
            b.add("gecerli_oauth")
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
        if servers.get(argv[2]) is None:
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
        red = os.path.join(cfg_dir, "reddedilen-alanlar")
        yeni_ret = open(red, encoding="utf-8").read().split() if os.path.exists(red) else []
        if not kabul(entry) or any(k in entry for k in yeni_ret):
            return 1, "", "Invalid configuration: : Invalid input"
        if servers.get(name) is not None:
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
    # Tek fark bilinen eksik: claude reddediyor, denetim geçerli sayıyor (tersi, yani gereksiz ret, yok).
    assert {ad for ad, *_ in yanlis} == BILINEN_EKSIK, [y for y in yanlis if y[0] not in BILINEN_EKSIK][:10]
    assert all(not kabul for _, _, kabul, _ in yanlis)


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
        for op in ("dry", "real"):  # kaldırma da dokunmaz
            _kaldirma_iletisi(res[f"{kind}-unreg-{op}"], _sahip(old, repo))
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

def _mac(tmp_path: Path, monkeypatch, sid: str, old, fail: int = 0, dry: bool = False, op: str = "reg",
         reject: tuple = ()):
    d = tmp_path / "s" / sid
    cfg = _cfg(d, {"beyin": old}, fail)
    if reject:
        (cfg / "reddedilen-alanlar").write_text("\n".join(reject), encoding="utf-8")
    monkeypatch.setenv("CLAUDE_CONFIG_DIR", str(cfg))
    monkeypatch.setattr(im, "REPO", tmp_path / "repo")  # sahiplik: kayıt sınama deposunu mu gösteriyor
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
    return f"{p.parent}/python"  # install_macos sahipliği '/' ayırıcısıyla sınar (Windows'ta da)


def _sahip(entry, repo: Path) -> bool:
    """Kayıt sınama deposunu gösteriyor mu (kurulumların ölçütü: dize command/args depo altında)."""
    if not isinstance(entry, dict):
        return False
    args = entry.get("args") if isinstance(entry.get("args"), list) else []
    root = str(repo).replace("\\", "/").rstrip("/").lower() + "/"
    return any(isinstance(v, str) and v.replace("\\", "/").lower().startswith(root) for v in [entry.get("command"), *args])


def _kaldirma_iletisi(u: dict, owned: bool) -> None:
    """Geçersiz kayıtta kaldırma: dokunulmaz; elle silme yalnız depoyu gösteren kayıtta önerilir."""
    assert u["status"] == "warn", u
    if owned:
        assert "kaldırılmadı" in u["message"] and "claude mcp remove beyin -s user" in u["message"], u
    else:  # başka bir programın kaydı: kullanıcınındır, silmeye yönlendirilmez
        assert "bu repoyu göstermiyor" in u["message"] and "yok sayıyor" in u["message"], u
        assert "claude mcp remove" not in u["message"], u


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
                assert status == want[0] and want[1] in msg, (kind, op, dry, msg)
            else:
                _kaldirma_iletisi({"status": status, "message": msg}, _sahip(old, tmp_path / "repo"))
            assert all(p in msg for p in parts), (kind, op, dry, msg)
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


# ---------------------------------------------------------------- üçüncü tur: kayıp, boş kayıt, yol, anahtar
#
# 1. Kurulum da kaldırma da elle yazılmış bir değeri geri getirilemez biçimde kaybettirmez. Biçim
#    denetimi (entry_problems) claude'un ölçülen sınırını izler ama her sürümü kovalayamaz; asıl güvence
#    yedektir: kayda dokunan her yol (güncelleme, kaldırma) önce kaydı birebir yedekler. Testler claude'un
#    denetimin bilmediği bir alanı reddettiği durumu (öykünücüde "reddedilen-alanlar"; ve ölçülmüş
#    BILINEN_EKSIK) iki platformda sınar.
# 2. Var ama geçersiz kayıt ({}, 5, "x", []) her yerde "geçersiz"dir, "yok" değil; null "yok"tur.
# 3. Her yazı sisteminden harfli program yolu gösterilir; kural iki kabukta ve Python'da aynıdır.
# 4. PowerShell'in okuyamadığı anahtar kararı kabuğun kendi ConvertFrom-Json davranışıdır.

def _yedek(bk_root: Path):
    files = sorted(bk_root.rglob("beyin.json")) if bk_root.exists() else []
    return json.loads(files[0].read_text(encoding="utf-8")) if files else None


def _gelecek_kayitlari(py: str) -> dict:
    """(kayıt, öykünücünün ayrıca reddettiği alanlar). Denetim ikisini de geçerli sayar."""
    return {
        # claude'un ileride reddetmeye başladığı bir alan (öykünücü "gelecekAlan"ı reddeder).
        "gelecek": ({"type": "stdio", "command": py, "args": ["-m", "bellek.beyin", "mcp", "--SAHTEek"],
                     "env": {"K": "SAHTEENV"}, "gelecekAlan": {"SAHTEalt": 5}}, ("gelecekAlan",)),
        # Bugün ölçülmüş, denetimin taklit etmediği ret (BILINEN_EKSIK): yalnız "https://".
        "eksik": ({"type": "http", "url": "https://example.invalid/", "headers": {"A": "SAHTEBASLIK"},
                   "oauth": {"authServerMetadataUrl": "https://", "clientId": "SAHTEistemci"}}, ()),
    }


def test_denetimin_bilmedigi_ret_gercekten_bilinmiyor(tmp_path):
    """Senaryonun kendisi: denetim bu kayıtları geçerli sayar, claude (öykünücü/ölçüm) reddeder."""
    emu = _emu_module(tmp_path)
    for kind, (old, reject) in _gelecek_kayitlari("C:/r/python.exe").items():
        assert mcp_config.entry_problems(old) == [], kind
        assert reject or not emu.kabul(old), kind


def _gelecek_beklenen(kind, op, fail, status, msg, cfg, yedek, old):
    """İki platformda aynı beklenti: değer ya kayıtta yerinde ya da yedekte birebir."""
    if op == "unreg":
        if kind == "gelecek":  # depoyu gösteren geçerli kayıt: yedeklenip kaldırılır
            assert status == "ok" and "yedek:" in msg, (kind, msg)
            assert "beyin" not in _servers(cfg) and yedek["entry"] == old, (kind, yedek)
        else:  # yabancı kayıt: dokunulmaz
            assert status == "warn" and _servers(cfg)["beyin"] == old, (kind, msg)
        return
    assert yedek is not None and yedek["entry"] == old, (kind, op, fail, yedek)  # her durumda birebir yedek
    if fail:  # yeni kayıt başarısız; claude eski kaydı geri almaz, değeri yedekte
        assert status == "error" and "GERİ YÜKLENEMEDİ" in msg, (kind, msg)
    else:  # yeni kayıt yazıldı; eski kaydın değerleri yedekte
        new = _servers(cfg)["beyin"]
        assert status in ("ok", "warn") and new["args"][:len(BEYIN_ARGS)] == BEYIN_ARGS, (kind, msg, new)
        if kind == "gelecek":  # kullanıcının argümanı ve env değeri yeni kayda da taşınır
            assert new["args"][len(BEYIN_ARGS):] == ["--SAHTEek"] and new["env"] == {"K": "SAHTEENV"}, new


@pytest.mark.skipif(not _shells(), reason="Windows PowerShell gerekli")
@pytest.mark.parametrize("shell", _shells() or ["-"])
def test_windows_denetimin_bilmedigi_ret_degeri_kaybettirmez(shell, tmp_path):
    repo, py = _win_repo(tmp_path)
    cases = _gelecek_kayitlari(py)
    plan = []
    for kind, (old, reject) in cases.items():
        for op, fail in (("reg", 0), ("reg", 1), ("unreg", 0)):
            sid = f"{kind}-{op}-{fail}"
            d = tmp_path / "s" / sid
            cfg = _cfg(d, {"beyin": old}, fail)
            if reject:
                (cfg / "reddedilen-alanlar").write_text("\n".join(reject), encoding="utf-8")
            plan.append({"id": sid, "cfg": str(cfg), "bk": str(d / "bk"), "dry": False, "op": op,
                         "cmd": [py, *BEYIN_ARGS]})
    res, texts = _run_ps(shell, tmp_path, plan, repo)
    for s in plan:
        kind, op, fail = s["id"].split("-")
        r = res[s["id"]]
        text = texts[s["id"]] + r["message"]
        assert SIR not in text, (s["id"], text)
        _temiz_terminal(text)
        _gelecek_beklenen(kind, op, int(fail), r["status"], r["message"], Path(s["cfg"]),
                          _yedek(Path(s["bk"])), cases[kind][0])


def test_macos_denetimin_bilmedigi_ret_degeri_kaybettirmez(tmp_path, monkeypatch):
    py = _mac_py(tmp_path)
    cases = _gelecek_kayitlari(py)
    for kind, (old, reject) in cases.items():
        for op, fail in (("reg", 0), ("reg", 1), ("unreg", 0)):
            sid = f"{kind}-{op}-{fail}"
            status, msg, cfg = _mac(tmp_path, monkeypatch, sid, old, fail, op=op, reject=reject)
            assert SIR not in msg, (sid, msg)
            _temiz_terminal(msg)
            _gelecek_beklenen(kind, op, fail, status, msg, cfg, _yedek(tmp_path / "s" / sid / "home"), old)


def _alan_kayitlari(py: str) -> dict:
    """Gözden geçiricinin örnekleri: gerçek claude 2.1.325 reddediyor (ölçüm: claude_mcp_sinir.json)."""
    return {
        "alwaysload": ({"command": py, "args": BEYIN_ARGS, "env": {"K": "SAHTEENV"}, "alwaysLoad": "true"},
                       "alwaysLoad: dize (true/false olmalı)"),
        "port": ({"type": "http", "url": "https://example.invalid/", "oauth": {"callbackPort": "8080"}},
                 "oauth.callbackPort: dize (pozitif tam sayı olmalı)"),
        "kapsam": ({"type": "sse", "url": "https://example.invalid/", "oauth": {"scopes": 5}}, "oauth.scopes: sayı (dize olmalı)"),
        "meta": ({"type": "http", "url": "https://example.invalid/", "oauth": {"authServerMetadataUrl": 5}},
                 "oauth.authServerMetadataUrl: sayı (dize olmalı)"),
    }


@pytest.mark.skipif(not _shells(), reason="Windows PowerShell gerekli")
@pytest.mark.parametrize("shell", _shells() or ["-"])
def test_windows_olculen_yeni_alanlar_kayda_dokundurmaz(shell, tmp_path):
    repo, py = _win_repo(tmp_path)
    cases = _alan_kayitlari(py)
    plan = []
    for kind, (old, _) in cases.items():
        for op, dry in (("reg", True), ("reg", False), ("unreg", True), ("unreg", False)):
            sid = f"{kind}-{op}-{'dry' if dry else 'real'}"
            d = tmp_path / "s" / sid
            plan.append({"id": sid, "cfg": str(_cfg(d, {"beyin": old})), "bk": str(d / "bk"),
                         "dry": dry, "op": op, "cmd": [py, *BEYIN_ARGS]})
    res, _ = _run_ps(shell, tmp_path, plan, repo)
    for s in plan:
        kind, op, mode = s["id"].split("-")
        old, part = cases[kind]
        r = res[s["id"]]
        assert part in r["message"] and SIR not in r["message"], r
        if op == "reg":
            assert r["status"] == ("warn" if mode == "dry" else "error"), r
        else:
            _kaldirma_iletisi(r, _sahip(old, repo))
        assert _servers(Path(s["cfg"]))["beyin"] == old and _calls(Path(s["cfg"])) == [], s["id"]
    # İletinin önerisi alanın beklediği türü söyler (callbackPort'ta "8080 -> \"8080\"" ters yöndü).
    assert "parantez içinde başka bir tür" in res["port-reg-dry"]["message"]


def test_macos_ve_doktor_olculen_yeni_alanlar_kayda_dokundurmaz(tmp_path, monkeypatch):
    py = _mac_py(tmp_path)
    for kind, (old, part) in _alan_kayitlari(py).items():
        for op, dry in (("reg", True), ("reg", False), ("unreg", True), ("unreg", False)):
            status, msg, cfg = _mac(tmp_path, monkeypatch, f"{kind}-{op}-{dry}", old, dry=dry, op=op)
            assert part in msg and SIR not in msg, (kind, op, msg)
            if op == "reg":
                assert status == ("warn" if dry else "error"), (kind, msg)
            else:
                _kaldirma_iletisi({"status": status, "message": msg}, _sahip(old, tmp_path / "repo"))
            assert _servers(cfg)["beyin"] == old and _calls(cfg) == [], kind
        c = _doktor_mcp(tmp_path, old)
        assert c["status"] == "error" and "yok sayıyor" in c["detail"] and part in c["detail"], c


# Var ama geçersiz kayıt: claude add-json "already exists" der (kurulum o hatayla dururdu), remove siler.
_VAR_GECERSIZ = {"bos": ({}, "command: yok (zorunlu)"), "sayi": (5, "kayıt: sayı (nesne olmalı)"),
                 "dize": ("SAHTEDIZE", "kayıt: dize (nesne olmalı)"), "dizi": (["SAHTE"], "kayıt: dizi (nesne olmalı)")}


def _var_gecersiz_beklenen(kind, op, dry, status, msg, cfg):
    if kind == "null":  # null "kayıt yok" sayılır (claude da öyle sayar)
        if op == "reg":
            assert status == ("dry" if dry else "ok"), msg
            assert (_servers(cfg)["beyin"] is None) if dry else isinstance(_servers(cfg)["beyin"], dict), msg
        else:
            assert status == "skip" and "MCP kaydı yok" in msg, msg
        return
    old, part = _VAR_GECERSIZ[kind]
    assert part in msg and "MCP kaydı yok" not in msg and SIR not in msg, (kind, op, msg)
    if op == "reg":
        assert status == ("warn" if dry else "error") and "değiştiril" in msg, (kind, msg)
    else:
        assert status == "warn" and "yok sayıyor" in msg and "claude mcp remove" not in msg, (kind, msg)
    assert _servers(cfg)["beyin"] == old and _calls(cfg) == [], (kind, op)


@pytest.mark.skipif(not _shells(), reason="Windows PowerShell gerekli")
@pytest.mark.parametrize("shell", _shells() or ["-"])
def test_windows_var_ama_gecersiz_kayit_yok_sayilmaz(shell, tmp_path):
    repo, py = _win_repo(tmp_path)
    plan = []
    for kind, old in [*((k, v[0]) for k, v in _VAR_GECERSIZ.items()), ("null", None)]:
        for op, dry in (("reg", True), ("reg", False), ("unreg", True), ("unreg", False)):
            sid = f"{kind}-{op}-{'dry' if dry else 'real'}"
            d = tmp_path / "s" / sid
            plan.append({"id": sid, "cfg": str(_cfg(d, {"beyin": old})), "bk": str(d / "bk"),
                         "dry": dry, "op": op, "cmd": [py, *BEYIN_ARGS]})
    res, _ = _run_ps(shell, tmp_path, plan, repo)
    for s in plan:
        kind, op, mode = s["id"].split("-")
        r = res[s["id"]]
        _var_gecersiz_beklenen(kind, op, mode == "dry", r["status"], r["message"], Path(s["cfg"]))


def test_macos_ve_doktor_var_ama_gecersiz_kayit_yok_sayilmaz(tmp_path, monkeypatch):
    for kind, old in [*((k, v[0]) for k, v in _VAR_GECERSIZ.items()), ("null", None)]:
        for op, dry in (("reg", True), ("reg", False), ("unreg", True), ("unreg", False)):
            _mac_py(tmp_path)
            status, msg, cfg = _mac(tmp_path, monkeypatch, f"{kind}-{op}-{dry}", old, dry=dry, op=op)
            _var_gecersiz_beklenen(kind, op, dry, status, msg, cfg)
        c = _doktor_mcp(tmp_path, old)
        if kind == "null":
            assert c["status"] == "ok" and "kurulu değil" in c["detail"], c
        else:
            assert c["status"] == "error" and SIR not in c["detail"], c


# ---------------------------------------------------------------- program yolu: her yazı sistemi

_YAZI_YOLLARI = [
    "D:/Ev/\u0418\u0432\u0430\u043d/x.exe",  # Kiril
    "D:/Ev/\u738b\u5c0f\u660e/x.exe",  # CJK
    "D:/Ev/\u0393\u03b9\u03ce\u03c1\u03b3\u03bf\u03c2/x.exe",  # Yunanca
    "/home/\u05e9\u05e8\u05d4/bin/x", "/home/\u0645\u062d\u0645\u062f/bin/x",  # İbranice, Arapça
    "D:/Ev/\uae40\ubbfc\uc900/x.exe", "D:/Ev/\u3072\u308d\u3057/x.exe", "D:/Ev/\u30bf\u30ed\u30a6/x.exe",
    "D:/Ev/\u0930\u093e\u092e/x.exe", "D:/Ev/Nguy\u1ec5n/x.exe", "D:/Ev/\u10d2\u10d8\u10dd/x.exe",
    "D:/Ev/O'Brien/x.exe", "C:/R&D, Ar-Ge/C#/x.exe", "C:/Program Files/R&D/x.exe",
]
_GIZLI_YOLLAR = [  # boşluk/ayırıcı benzeri, görünmez, yön ve BMP dışı karakterler; ASCII ayırıcılar
    "C:/a\u00a0b.exe", "C:/a\u3000b.exe", "C:/a\uff1db.exe", "C:/a\uff1ab.exe", "C:/a\u037eb.exe", "C:/a\u1361b.exe",
    "C:/a\u115fb.exe", "C:/a\u3164b.exe", "C:/a\u00adb.exe", "C:/a\u30fbb.exe", "C:/a\u200eb.exe", "C:/a\u202eb.exe",
    "C:/a\U0001f600.exe", "C:/a\U00020000.exe", "C:/a%b.exe", "C:/a=b.exe", "C:/a;b.exe", "C:/a!b.exe",
    'C:/a"b.exe', "C:/a?b.exe", "C:/a$b.exe", "C:/a|b.exe", "C:/a`b.exe", "C:/a*b.exe",
    "C:/x.exe --token=SAHTE", "C:/R&D/x.exe SAHTE", "C:/O'Brien/x.exe -k", "curl https://kul:SAHTE@example.invalid",
]


@pytest.mark.parametrize("cmd", _YAZI_YOLLARI)
def test_describe_program_her_yazi_sistemi(cmd):
    assert mcp_config.describe_program(cmd) == (f'"{cmd}"' if " " in cmd else cmd)


@pytest.mark.parametrize("cmd", _GIZLI_YOLLAR)
def test_describe_program_supheli_karakter(cmd):
    assert mcp_config.describe_program(cmd) == H


def test_doktor_her_yazi_sisteminden_yolu_gosterir(tmp_path):
    exe = tmp_path / "\u0418\u0432\u0430\u043d \u738b" / "O'Brien & Co" / "x.exe"
    exe.parent.mkdir(parents=True)
    exe.write_bytes(b"")
    c = _doktor_mcp(tmp_path, {"command": str(exe), "args": BEYIN_ARGS})
    assert H not in c["detail"] and str(exe) in c["detail"], c


_PROGRAM_HARNESS = r"""
param([string]$Module, [string]$In)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$m = Import-Module $Module -Force -DisableNameChecking -PassThru
$izinli = & $m {
    $l = New-Object System.Collections.Generic.List[int]
    for ($c = 0; $c -le 0xFFFF; $c++) { if (Test-McpProgramShown ('a' + [string][char]$c)) { $l.Add($c) } }
    , $l.ToArray()
}
$paths = @(Get-Content -LiteralPath $In -Raw -Encoding UTF8 | ConvertFrom-Json)
$g = @(foreach ($p in @($paths | ForEach-Object { $_ })) { & $m { param($x) Format-McpProgram $x } $p })
Write-Output ('JSON:' + (ConvertTo-Json @{ izinli = @($izinli); g = $g } -Depth 3 -Compress))
"""


@pytest.mark.skipif(not _shells(), reason="Windows PowerShell gerekli")
@pytest.mark.parametrize("shell", _shells() or ["-"])
def test_program_yolu_kurali_tum_bmpde_iki_kabukta_ayni(shell, tmp_path):
    """Tablo Unicode sınıfına dayanmaz: .NET Framework 4.x, .NET 8+ ve Python her BMP karakterinde
    aynı kararı verir (vekil birimleri ve BMP dışı karakterler iki tarafta da gösterilmez)."""
    paths = _YAZI_YOLLARI + _GIZLI_YOLLAR
    inp = tmp_path / "yollar.json"
    inp.write_text(json.dumps(paths), encoding="utf-8")
    script = tmp_path / "program.ps1"
    script.write_text(_PROGRAM_HARNESS, encoding="utf-8-sig")
    r = subprocess.run([shell, "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", str(script),
                        "-Module", str(INSTALLER / "ErenKit.Installer.psm1"), "-In", str(inp)],
                       capture_output=True, timeout=600, env=_ps_env(shell))
    out = r.stdout.decode("utf-8", "replace")
    line = [x for x in out.splitlines() if x.startswith("JSON:")]
    assert line, out + r.stderr.decode("utf-8", "replace")
    got = json.loads(line[-1][5:])
    beklenen = [c for c in range(0x10000) if mcp_config.program_shown("a" + chr(c))]
    assert got["izinli"] == beklenen, sorted(set(got["izinli"]) ^ set(beklenen))[:20]
    assert got["g"] == [mcp_config.describe_program(p) for p in paths], got["g"]


# ---------------------------------------------------------------- Windows: anahtar kararı kabuğun kendisi

_ANAHTAR_ENV = {  # env'de yalnız harf büyüklüğüyle (ya da özel adıyla) ayrılan anahtarlar
    "i_noktasiz": {"\u0131": "SAHTEa", "I": "SAHTEb"}, "uzun_s": {"\u017f": "SAHTEa", "S": "SAHTEb"},
    "dz": {"\u01c4": "SAHTEa", "\u01c5": "SAHTEb"}, "sigma": {"\u03c2": "SAHTEa", "\u03a3": "SAHTEb"},
    "mikro": {"\u00b5": "SAHTEa", "\u039c": "SAHTEb"}, "path": {"Path": "SAHTEa", "PATH": "SAHTEb"},
    "tip": {"__type": "SAHTEt"},
}

_OKU_HARNESS = r"""
param([string]$In)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$cases = Get-Content -LiteralPath $In -Raw -Encoding UTF8 | ConvertFrom-Json
$out = @{}
foreach ($p in $cases.PSObject.Properties) {
    try { $o = $p.Value | ConvertFrom-Json; $out[$p.Name] = @($o.PSObject.Properties).Count }
    catch { $out[$p.Name] = -1 }
}
Write-Output ('JSON:' + (ConvertTo-Json $out -Compress))
"""


def _kabuk_okur(shell: str, tmp_path: Path) -> dict:
    """Kabuğun ConvertFrom-Json'ı her env'i eksiksiz okuyor mu (kurulumdan bağımsız ölçüm)."""
    inp = tmp_path / "oku.json"
    inp.write_text(json.dumps({k: json.dumps(v) for k, v in _ANAHTAR_ENV.items()}), encoding="utf-8")
    script = tmp_path / "oku.ps1"
    script.write_text(_OKU_HARNESS, encoding="utf-8-sig")
    r = subprocess.run([shell, "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", str(script),
                        "-In", str(inp)], capture_output=True, timeout=120, env=_ps_env(shell))
    line = [x for x in r.stdout.decode("utf-8", "replace").splitlines() if x.startswith("JSON:")]
    got = json.loads(line[-1][5:])
    return {k: got[k] == len(v) for k, v in _ANAHTAR_ENV.items()}


@pytest.mark.skipif(not _shells(), reason="Windows PowerShell gerekli")
@pytest.mark.parametrize("shell", _shells() or ["-"])
def test_windows_anahtar_karari_kabugun_kendi_okumasidir(shell, tmp_path):
    repo, py = _win_repo(tmp_path)
    okur = _kabuk_okur(shell, tmp_path)
    # Ölçülen gerçek (gözden geçirici + bu tur): iki kabuk ı/I ve ſ/S'yi ayrı okur, Path/PATH'i okuyamaz;
    # yalnız 5.1 "__type"ı atar.
    assert okur["i_noktasiz"] and okur["uzun_s"] and not okur["path"], okur
    assert okur["tip"] == (shell == "pwsh"), okur
    plan = []
    for kind, env in _ANAHTAR_ENV.items():
        old = {"type": "stdio", "command": py, "args": ["-m", "bellek.beyin", "mcp"], "env": env}  # eski biçim: güncellenir
        for op, dry in (("reg", True), ("reg", False), ("unreg", False)):
            sid = f"{kind}-{op}-{'dry' if dry else 'real'}"
            d = tmp_path / "s" / sid
            plan.append({"id": sid, "cfg": str(_cfg(d, {"beyin": old})), "bk": str(d / "bk"),
                         "dry": dry, "op": op, "cmd": [py, *BEYIN_ARGS]})
    res, texts = _run_ps(shell, tmp_path, plan, repo)
    for s in plan:
        kind, op, mode = s["id"].split("-")
        r, cfg = res[s["id"]], Path(s["cfg"])
        assert SIR not in texts[s["id"]] + r["message"], r
        if okur[kind]:  # kabuk okuyabiliyor: normal akış, değerler yeni kayda birebir
            assert "okunamıyor" not in r["message"], r
            if op == "reg" and mode == "real":
                assert r["status"] == "ok" and _servers(cfg)["beyin"]["env"] == _ANAHTAR_ENV[kind], (r, _servers(cfg))
            if op == "unreg":
                assert r["status"] == "ok" and "beyin" not in _servers(cfg), r
                assert _yedek(Path(s["bk"]))["entry"]["env"] == _ANAHTAR_ENV[kind]
        else:  # okuyamıyor (ya da 5.1'de "__type" düşerdi): açık ileti, kayda dokunulmaz
            assert "okunamıyor" in r["message"], r
            assert r["status"] == ("error" if (op, mode) == ("reg", "real") else "warn"), r
            assert _calls(cfg) == [] and _servers(cfg)["beyin"]["env"] == _ANAHTAR_ENV[kind], s["id"]
            if kind == "tip":
                assert '"__type" anahtarı' in r["message"], r
