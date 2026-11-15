"""Kurulumun kaydettiği komutlar çalışma klasöründen kod yüklememeli (güvenlik regresyon testleri).

MCP sunucuları Claude Code'un açıldığı klasörde başlar. "python -m bellek.beyin mcp" o klasörü
sys.path'in başına koyar: klasördeki bir "bellek" paketi (ör. kötü niyetli bir depoda) oturum
açılır açılmaz kullanıcının yetkisiyle çalışırdı. Bu dosya:
- install.ps1 ve install_macos.py'nin beyin MCP/servis komutlarının "-I" taşıdığını ve aynı
  olduğunu,
- o komut biçiminin gerçekten çalışma klasöründeki sahte paketi YÜKLEMEDİĞİNİ (geçici bir venv ve
  düzenlenebilir kurulum benzeri bir .pth ile, gerçek beyin verisine dokunmadan),
- doktorun eski (-I'siz) kaydı "GÜVENSİZ" diye işaretlediğini,
- doktorun çıplak program adlarını çalışma klasöründe aramadığını,
- depo izni denetimini sınar.
"""

from __future__ import annotations

import importlib.util
import json
import os
import re
import stat
import subprocess
import sys
from pathlib import Path

import pytest

INSTALLER = Path(__file__).resolve().parents[1]
REPO = INSTALLER.parents[1]
sys.path.insert(0, str(INSTALLER))

import install_macos as im  # noqa: E402


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


doktor = _load("_eren_doktor_guvenli_komut", INSTALLER / "doktor.py")


@pytest.fixture(autouse=True)
def _isolated_home(tmp_path, monkeypatch):
    home = tmp_path / "fake-home"
    home.mkdir()
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setenv("USERPROFILE", str(home))
    monkeypatch.delenv("CLAUDE_CONFIG_DIR", raising=False)


# ---------------------------------------------------------------- install.ps1 / install_macos.py

def _ps1() -> str:
    return (REPO / "install.ps1").read_text(encoding="utf-8-sig")


def ps1_beyin_mcp_args() -> list[str]:
    m = re.search(r"\$P\.BeyinMcp\s*=\s*\[string\[\]\]@\(\$P\.BellekPy,\s*([^)]*)\)", _ps1())
    assert m, "install.ps1'de $P.BeyinMcp tanımı bulunamadı"
    return re.findall(r"'([^']*)'", m.group(1))


def ps1_service_args() -> list[str]:
    m = re.search(r"-Arguments\s+'([^']*bellek\.beyin\s+servis[^']*)'", _ps1())
    assert m, "install.ps1'de servis görevi argümanları bulunamadı"
    return m.group(1).split()


def test_ps1_mcp_adimi_beyinmcp_kullanir():
    assert re.search(r"Invoke-McpRegister 'beyin' \$P\.BeyinMcp\b", _ps1())
    assert "'-m', 'bellek.beyin', 'mcp'" not in _ps1().replace("'-I', '-m'", "")


def test_beyin_mcp_komutu_izole_ve_iki_platformda_ayni():
    assert ps1_beyin_mcp_args() == im.BEYIN_MCP_ARGS == ["-I", "-m", "bellek.beyin", "mcp"]
    steps = im.build_steps(im.Ctx(claude_home=Path("/yok"), skip_mcp=True))
    assert steps["beyin"]  # komut build_steps içinde BEYIN_MCP_ARGS'tan kurulur
    assert doktor._cwd_code_risk(str(im.P["bellek_py"]), im.BEYIN_MCP_ARGS, {}) is None


def test_beyin_servis_komutu_izole_ve_iki_platformda_ayni():
    assert ps1_service_args() == im.BEYIN_SERVICE_ARGS == ["-I", "-m", "bellek.beyin", "servis"]
    assert im.service_plist(im.Ctx(claude_home=Path("/yok"), tailscale_host=""))["ProgramArguments"][1:] \
        == im.BEYIN_SERVICE_ARGS


# ---------------------------------------------------------------- komut biçiminin kanıtı

def _venv_python(venv: Path) -> Path:
    return venv / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


@pytest.fixture(scope="module")
def sahte_kurulum(tmp_path_factory):
    """Geçici venv + düzenlenebilir kurulum benzeri .pth ile "bellek.beyin" paketi ve içinde aynı adlı
    sahte paket taşıyan bir "kötü depo" klasörü. Gerçek bellek kodu ve verisi kullanılmaz."""
    root = tmp_path_factory.mktemp("guvenli-komut")
    venv = root / "venv"
    subprocess.run([sys.executable, "-m", "venv", "--without-pip", str(venv)], check=True, timeout=180)
    py = _venv_python(venv)
    purelib = subprocess.run([str(py), "-I", "-c", "import sysconfig; print(sysconfig.get_paths()['purelib'])"],
                             check=True, capture_output=True, text=True, timeout=60).stdout.strip()
    src = root / "src"
    (src / "bellek" / "beyin").mkdir(parents=True)
    (src / "bellek" / "__init__.py").write_text("", encoding="utf-8")
    (src / "bellek" / "beyin" / "__init__.py").write_text("", encoding="utf-8")
    (src / "bellek" / "beyin" / "__main__.py").write_text(
        "import sys\nprint('GERCEK_PAKET', sys.argv[1:])\n", encoding="utf-8")
    Path(purelib, "__editable__.bellek.pth").write_text(str(src) + "\n", encoding="utf-8")
    kotu = root / "kotu-depo"
    (kotu / "bellek" / "beyin").mkdir(parents=True)
    (kotu / "bellek" / "__init__.py").write_text("print('SAHTE_PAKET_CALISTI')\n", encoding="utf-8")
    (kotu / "bellek" / "beyin" / "__init__.py").write_text("print('SAHTE_PAKET_CALISTI')\n", encoding="utf-8")
    (kotu / "bellek" / "beyin" / "__main__.py").write_text("print('SAHTE_PAKET_CALISTI')\n", encoding="utf-8")
    return py, kotu


def _calistir(py: Path, args: list[str], cwd: Path, **env) -> str:
    e = dict(os.environ)
    e.pop("PYTHONSAFEPATH", None)
    e.update(env)
    r = subprocess.run([str(py), *args], cwd=str(cwd), capture_output=True, text=True, timeout=60, env=e)
    return r.stdout + r.stderr


def test_kontrol_eski_bicim_sahte_paketi_yukler(sahte_kurulum):
    """Testin kendisini doğrular: -I'siz biçim çalışma klasöründeki paketi gerçekten yükler."""
    py, kotu = sahte_kurulum
    out = _calistir(py, ["-m", "bellek.beyin", "mcp"], kotu)
    assert "SAHTE_PAKET_CALISTI" in out, out


@pytest.mark.parametrize("kaynak", ["windows", "macos"])
def test_kurulum_komutu_calisma_klasorunden_yuklemez(sahte_kurulum, kaynak):
    py, kotu = sahte_kurulum
    args = ps1_beyin_mcp_args() if kaynak == "windows" else im.BEYIN_MCP_ARGS
    out = _calistir(py, args, kotu)
    assert "SAHTE_PAKET_CALISTI" not in out, out
    assert "GERCEK_PAKET ['mcp']" in out, out  # modül venv'deki (düzenlenebilir) kurulumdan bulunur
    # PYTHONPATH ile çalışma klasörünü öne koymak da işe yaramaz (-I ortamı yok sayar).
    out = _calistir(py, args, kotu, PYTHONPATH=str(kotu))
    assert "SAHTE_PAKET_CALISTI" not in out and "GERCEK_PAKET" in out, out


def test_servis_komutu_calisma_klasorunden_yuklemez(sahte_kurulum):
    py, kotu = sahte_kurulum
    out = _calistir(py, ps1_service_args(), kotu)
    assert "SAHTE_PAKET_CALISTI" not in out and "GERCEK_PAKET ['servis']" in out, out


# ---------------------------------------------------------------- yeniden kurulum: kullanıcı argümanları ve env

_PS_HARNESS = r"""
param([string]$Module, [string]$OldFile, [string]$CmdFile, [string]$Bk, [string]$Mode, [string]$Repo)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Import-Module $Module -Force -DisableNameChecking
Set-InstallerOption -DryRun ($Mode -eq 'dry') -BackupDir $Bk
$old = $null
if ($OldFile) { $old = Get-Content -LiteralPath $OldFile -Raw -Encoding UTF8 | ConvertFrom-Json }
$global:eklenen = New-Object System.Collections.Generic.List[object]
$global:silinen = 0
Set-McpApi @{
    Get    = { param($Name) $old }.GetNewClosure()
    Add    = { param($Name, $Entry) $global:eklenen.Add($Entry); [pscustomobject]@{ ExitCode = 0; Output = @() } }
    Remove = { param($Name) $global:silinen++; [pscustomobject]@{ ExitCode = 0; Output = @() } }
}
# PowerShell 5.1'de ConvertFrom-Json diziyi tek nesne olarak verir: öğeler ayrıca açılır.
$cmd = [string[]]@((Get-Content -LiteralPath $CmdFile -Raw -Encoding UTF8 | ConvertFrom-Json) | ForEach-Object { $_ })
$r = Register-McpServer -Name 'x' -ServerCommand $cmd -RepoRoot $Repo
$added = $null
if ($global:eklenen.Count -gt 0) { $added = $global:eklenen[0] }
Write-Output ('JSON:' + (@{ status = $r.Status; message = $r.Message; added = $added; removed = $global:silinen } | ConvertTo-Json -Depth 10 -Compress))
"""


def _shells() -> list[str]:
    import shutil

    if os.name != "nt":
        return []
    return [s for s in ("powershell", "pwsh") if shutil.which(s)]


def _register(shell: str, tmp_path: Path, old: dict | None, cmd: list[str], mode: str = "real") -> dict:
    script = tmp_path / "harness.ps1"
    script.write_text(_PS_HARNESS, encoding="utf-8-sig")
    # JSON dosyayla geçer: Windows PowerShell 5.1 yerel argümanlardaki çift tırnakları atar.
    old_file, cmd_file = tmp_path / "old.json", tmp_path / "cmd.json"
    old_file.write_text(json.dumps(old) if old else "null", encoding="utf-8")
    cmd_file.write_text(json.dumps(cmd), encoding="utf-8")
    args = [shell, "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", str(script),
            "-Module", str(INSTALLER / "ErenKit.Installer.psm1"), "-OldFile", str(old_file) if old else "",
            "-CmdFile", str(cmd_file), "-Bk", str(tmp_path / "bk"), "-Mode", mode, "-Repo", str(tmp_path / "repo")]
    env = dict(os.environ)
    if shell == "powershell":
        env.pop("PSModulePath", None)  # pwsh'tan devralınan modül yolu 5.1'i bozmasın
    r = subprocess.run(args, capture_output=True, timeout=120, env=env)
    out = r.stdout.decode("utf-8", "replace")
    line = [s for s in out.splitlines() if s.startswith("JSON:")]
    assert line, out + r.stderr.decode("utf-8", "replace")
    return json.loads(line[-1][5:])


def _args(entry: dict) -> list[str]:
    a = entry.get("args") or []
    return [a] if isinstance(a, str) else list(a)


@pytest.mark.skipif(not _shells(), reason="Windows PowerShell gerekli")
@pytest.mark.parametrize("shell", _shells() or ["-"])
def test_ps_yeniden_kurulum_kullanici_argumanlarini_ve_envi_korur(shell, tmp_path):
    exe = tmp_path / "repo" / "cuw.exe"
    exe.parent.mkdir(parents=True)
    exe.write_bytes(b"")
    old = {"type": "stdio", "command": str(exe), "args": ["--block", "notepad.exe"], "env": {"CUW_X": "1"}}
    res = _register(shell, tmp_path, old, [str(exe)])
    assert res["status"] == "ok" and "zaten kayıtlı" in res["message"], res  # aynı: dokunulmaz
    assert res["added"] is None and res["removed"] == 0

    # Eski, -I'siz beyin kaydı: yeni komutla değişir; env ve kullanıcının ek argümanı korunur.
    py = tmp_path / "repo" / "python.exe"
    py.write_bytes(b"")
    old = {"type": "stdio", "command": str(py), "args": ["-m", "bellek.beyin", "mcp", "--ek"],
           "env": {"BELLEK_BEYIN_PORT": "47999"}}
    res = _register(shell, tmp_path, old, [str(py), *ps1_beyin_mcp_args()])
    assert res["status"] == "ok", res
    assert _args(res["added"]) == [*ps1_beyin_mcp_args(), "--ek"], res
    assert res["added"]["env"] == {"BELLEK_BEYIN_PORT": "47999"}, res
    assert "BELLEK_BEYIN_PORT" in res["message"] and "47999" not in res["message"], res  # değer yazılmaz

    dry = _register(shell, tmp_path, old, [str(py), *ps1_beyin_mcp_args()], mode="dry")
    assert dry["status"] == "dry" and "-I" in dry["message"] and "BELLEK_BEYIN_PORT" in dry["message"], dry

    # Biçimi tanınmayan eski kayıt: taşınamayan env açıkça söylenir (warn).
    old = {"type": "stdio", "command": str(py), "args": ["baska.py"], "env": {"GIZLI": "x"}}
    res = _register(shell, tmp_path, old, [str(py), *ps1_beyin_mcp_args()])
    assert res["status"] == "warn" and "TAŞINMAZ" in res["message"] and "GIZLI" in res["message"], res
    assert "env" not in res["added"] or not res["added"]["env"], res


def test_macos_yeniden_kurulum_kullanici_argumanlarini_ve_envi_korur(tmp_path, monkeypatch):
    calls = []

    def run(args, **kw):
        calls.append(list(args))
        return subprocess.CompletedProcess(args, 0, "", "")

    repo = tmp_path / "repo"
    repo.mkdir()
    # Sahiplik (yol öneki) burada sınanmaz; macOS yol ayracına bağlı, ayrı testi var.
    monkeypatch.setattr(im, "_entry_owned", lambda entry: True)
    ctx = im.Ctx(claude_home=tmp_path, claude_exe="claude", run=run)
    py = str(repo / "python").replace("\\", "/")
    Path(py).write_bytes(b"")
    old = {"type": "stdio", "command": py, "args": ["-m", "bellek.beyin", "mcp", "--ek"],
           "env": {"BELLEK_BEYIN_PORT": "47999"}}
    monkeypatch.setattr(im, "_mcp_get", lambda name: old)
    r = im.mcp_register(ctx, "beyin", [py, *im.BEYIN_MCP_ARGS])
    assert r.status == "ok" and "BELLEK_BEYIN_PORT" in r.message and "47999" not in r.message, r
    add = next(c for c in calls if c[1:3] == ["mcp", "add"])
    assert add[add.index("--") + 1:] == [py, *im.BEYIN_MCP_ARGS, "--ek"]
    assert add[add.index("-e") + 1] == "BELLEK_BEYIN_PORT=47999"

    cuw = {"type": "stdio", "command": "/r/cuw", "args": ["--block", "x"], "env": {"A": "1"}}
    monkeypatch.setattr(im, "_mcp_get", lambda name: cuw)
    calls.clear()
    assert im.mcp_register(ctx, "computer-use-windows", ["/r/cuw"]).message.startswith("MCP zaten kayıtlı")
    assert calls == []

    monkeypatch.setattr(im, "_mcp_get", lambda name: {"command": py, "args": ["baska.py"], "env": {"GIZLI": "x"}})
    r = im.mcp_register(ctx, "beyin", [py, *im.BEYIN_MCP_ARGS])
    assert r.status == "warn" and "TAŞINMAZ" in r.message and "GIZLI" in r.message, r
    add = next(c for c in calls if c[1:3] == ["mcp", "add"])
    assert "-e" not in add


# ---------------------------------------------------------------- doktor: güvensiz kayıt

@pytest.mark.parametrize("cmd, args, env, risky", [
    ("python", ["-m", "bellek.beyin", "mcp"], {}, True),
    ("C:/r/.venv/Scripts/python.exe", ["-m", "bellek.beyin", "mcp"], {}, True),
    ("/r/.venv/bin/python3.12", ["-B", "-m", "x"], {}, True),
    ("python", ["-c", "import x"], {}, True),
    ("python", ["-X", "utf8", "-m", "x"], {}, True),
    ("python", ["-W", "ignore", "-m", "x"], {}, True),
    ("python", ["-E", "-m", "x"], {"PYTHONSAFEPATH": "1"}, True),
    ("python", ["hook.py"], {}, True),  # göreli betik çalışma klasöründen okunur
    ("python", ["-I", "-m", "bellek.beyin", "mcp"], {}, False),
    ("python", ["-P", "-m", "x"], {}, False),
    ("python", ["-IB", "-m", "x"], {}, False),
    ("python", ["-Im", "x"], {}, False),
    ("python", ["-X", "utf8", "-I", "-m", "x"], {}, False),
    ("python", ["-m", "x"], {"PYTHONSAFEPATH": "1"}, False),
    ("python", ["/abs/hook.py"] if os.name != "nt" else ["C:/abs/hook.py"], {}, False),
    ("C:/r/.venv/Scripts/computer-use-windows.exe", [], {}, False),  # konsol betiği: Python adı değil
    ("node", ["server.js"], {}, False),
])
def test_cwd_kod_riski(cmd, args, env, risky):
    assert (doktor._cwd_code_risk(cmd, args, env) is not None) is risky


def _mcp_home(tmp_path: Path, servers: dict) -> Path:
    home = tmp_path / "claude"
    home.mkdir(exist_ok=True)
    (home / ".claude.json").write_text(json.dumps({"mcpServers": servers}), encoding="utf-8")
    return home


def _check(res: dict, name: str) -> dict:
    return {c["name"]: c for c in res["checks"]}[name]


def test_doktor_eski_kaydi_guvensiz_isaretler(tmp_path):
    home = _mcp_home(tmp_path, {"beyin": {"type": "stdio", "command": sys.executable,
                                          "args": ["-m", "bellek.beyin", "mcp"], "env": {}}})
    c = _check(doktor.run_checks(home, REPO, network=False), "mcp:beyin")
    assert c["status"] == "warn" and "GÜVENSİZ" in c["detail"] and "-I" in c["detail"], c


def test_doktor_yeni_kayit_ok_ve_bellek_python_bulunur(tmp_path):
    entry = {"type": "stdio", "command": sys.executable, "args": list(im.BEYIN_MCP_ARGS), "env": {}}
    home = _mcp_home(tmp_path, {"beyin": entry})
    c = _check(doktor.run_checks(home, REPO, network=False), "mcp:beyin")
    assert c["status"] == "ok", c
    exe, _ = doktor._bellek_python(doktor.Ctx(home, REPO, False))
    assert exe is not None and Path(exe).resolve() == Path(sys.executable).resolve()


# ---------------------------------------------------------------- doktor: çalışma klasöründeki program

def test_path_which_calisma_klasorunu_aramaz(tmp_path, monkeypatch):
    cwd = tmp_path / "kotu"
    cwd.mkdir()
    name = "erenkitdeneme"
    fake = cwd / (name + (".exe" if os.name == "nt" else ""))
    fake.write_bytes(b"")
    fake.chmod(0o755)
    monkeypatch.chdir(cwd)
    monkeypatch.setenv("PATH", os.pathsep.join(["", ".", "kotu", str(tmp_path / "bos")]))
    assert doktor._path_which(name) is None
    assert doktor._which(name) is None
    good = tmp_path / "gercek"
    good.mkdir()
    real = good / fake.name
    real.write_bytes(b"")
    real.chmod(0o755)
    monkeypatch.setenv("PATH", os.pathsep.join([".", str(good)]))
    assert Path(doktor._path_which(name)) == real


@pytest.mark.skipif(os.name != "nt", reason="Windows sistem programı yolu")
def test_schtasks_tam_yolla():
    p = Path(doktor._system_exe("schtasks"))
    assert p.is_absolute() and p.name.lower() == "schtasks.exe" and p.parent.name.lower() == "system32"


# ---------------------------------------------------------------- doktor: depo izinleri

def _kurulu_home(tmp_path: Path) -> Path:
    return _mcp_home(tmp_path, {"computer-use-windows": {"type": "stdio", "command": "/yok/cuw", "args": []}})


def test_depo_izni_kurulu_degilse_ve_ag_kapaliysa_ok(tmp_path):
    home = tmp_path / "bos"
    home.mkdir()
    assert _check(doktor.run_checks(home, tmp_path, network=True), "depo:izin")["status"] == "ok"
    c = _check(doktor.run_checks(_kurulu_home(tmp_path), tmp_path, network=False), "depo:izin")
    assert c["status"] == "ok" and "atlandı" in c["detail"], c


@pytest.mark.skipif(os.name != "nt", reason="Windows ACL")
def test_depo_izni_windows(tmp_path, monkeypatch):
    repo = tmp_path / "depo"
    repo.mkdir()
    found, err = doktor._broad_writers_windows(repo)  # gerçek API: hata vermeden okunur
    assert found is not None, err
    assert doktor._broad_writers_windows(tmp_path / "yok")[0] is None
    monkeypatch.setattr(doktor, "_broad_writers_windows", lambda p: (["Authenticated Users: değiştirme"], ""))
    c = _check(doktor.run_checks(_kurulu_home(tmp_path), repo, network=True), "depo:izin")
    assert c["status"] == "warn" and "Authenticated Users" in c["detail"], c
    monkeypatch.setattr(doktor, "_broad_writers_windows", lambda p: ([], ""))
    assert _check(doktor.run_checks(_kurulu_home(tmp_path), repo, network=True), "depo:izin")["status"] == "ok"


@pytest.mark.skipif(os.name == "nt", reason="POSIX izin bitleri")
def test_depo_izni_posix(tmp_path):
    repo = tmp_path / "depo"
    repo.mkdir()
    repo.chmod(0o755)
    assert _check(doktor.run_checks(_kurulu_home(tmp_path), repo, network=True), "depo:izin")["status"] == "ok"
    repo.chmod(0o777)
    try:
        c = _check(doktor.run_checks(_kurulu_home(tmp_path), repo, network=True), "depo:izin")
        assert c["status"] == "warn" and "o+w" in c["detail"], c
    finally:
        repo.chmod(stat.S_IRWXU)
