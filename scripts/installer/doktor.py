"""eren-kit kurulum doktoru: kurulu bileşenlerin Claude Code'a doğru bağlanıp bağlanmadığını denetler.

    python scripts/installer/doktor.py [--json] [--claude-home DIR] [--repo DIR] [--no-network]

--claude-home  Claude Code'un kullanıcı dizini (varsayılan: CLAUDE_CONFIG_DIR, yoksa ~/.claude).
--repo         eren-kit deposu (varsayılan: bu betiğin bulunduğu depo).
--no-network   Canlı sistem sorgusu ve kullanıcı dosyalarından gelen dış süreç yok: servis sağlık
               isteği (/api/saglik), servis görevi (Görev Zamanlayıcı / launchd), "bellek doktor"
               alt süreci, hook yorumlayıcısının sürüm yoklaması ve depo klasörü izin denetimi
               (makineye bağlı sonuç) atlanır. Yalnız dosya denetimleri kalır (telefon:node yalnız
               sabit adlı "node"u çalıştırır).
Çıplak program adları (python, node) yalnız PATH'in mutlak klasörlerinde aranır; çalışma klasörü
aranmaz. Windows sistem programları (schtasks, powershell) System32'deki tam yoluyla çağrılır.
Güvenlik: settings.json / .claude.json'dan okunan bir program yalnız adı açıkça bir Python
yorumlayıcısıysa (python, python3, pythonX.Y, py; .exe dahil) ve --no-network verilmemişse
çalıştırılır; diğerleri çalıştırılmaz. Her alt süreç çağrısının zaman aşımı vardır.
--json         stdout'a yalnız {"status", "checks": [{"name", "status", "detail"}]} yazılır (ASCII).

Çıkış kodu: 0 hepsi ok, 1 en az bir warn (error yok), 2 en az bir error.

Kurallar:
- Salt okunur: hiçbir dosya oluşturulmaz, değiştirilmez, silinmez (bayt kodu önbelleği dahil).
- Kurulmamış bileşen hata değildir: ilgili denetim ok döner, ayrıntı "kurulu değil" ile başlar.
- Platforma özgü denetim diğer platformda ok döner ("bu platformda geçerli değil").
- Hiçbir denetim istisna sızdırmaz: beklenmeyen hata o denetimi error yapar, diğerleri sürer.
- Beklenen hook kayıtları settings_hooks.hook_specs'ten türetilir (kurulumla tek kaynak).
- MCP kaydı kurulumun yazdığı yerden okunur (mcp_config.py ile aynı kural): CLAUDE_CONFIG_DIR
  verilmişse <dizin>/.claude.json, varsayılan dizinde ~/.claude.json, "mcpServers" altında.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
from collections.abc import Callable
from pathlib import Path
from typing import NamedTuple

HERE = Path(__file__).resolve().parent
DEFAULT_REPO = HERE.parents[1]

# settings_hooks aynı klasörde; içe aktarma bayt kodu yazmasın (salt okunurluk).
_prev_dwb = sys.dont_write_bytecode
sys.dont_write_bytecode = True
try:
    if str(HERE) not in sys.path:
        sys.path.insert(0, str(HERE))
    import mcp_config  # kayıt gösterimi/denetimi kurulumla ortak (yalnız standart kitaplık)
    import settings_hooks as sh

    _SH_ERROR: str | None = None
except Exception as _e:  # noqa: BLE001 - hook denetimleri error olur, diğerleri sürer
    sh = None  # type: ignore[assignment]
    _SH_ERROR = f"{type(_e).__name__}: {_e}"
finally:
    sys.dont_write_bytecode = _prev_dwb

OK = "ok"
WARN = "warn"
ERROR = "error"
_SEV = {OK: 0, WARN: 1, ERROR: 2}

HOOK_KEYS = ("devir", "kapi", "orkestra")
MCP_NAMES = ("beyin", "computer-use-windows")
HOOK_PYTHON_MIN = (3, 11)  # devir hook'u tomllib kullanır (install.ps1 Test-HookPython ile aynı)
NODE_MIN = 24  # install.ps1 / install_macos.py phone önkoşulu
SERVICE_PORT = 47321  # bellek.beyin.servis.VARSAYILAN_PORT
SERVICE_TASK = "eren-kit-beyin-servis"  # install.ps1 $ServiceTaskName
SERVICE_LABEL = "com.eren-kit.beyin-servis"  # install_macos.py SERVICE_LABEL
SKILL_MARKER = ".eren-kit"  # kurulumun skill klasörüne yazdığı işaret dosyası
HTTP_TIMEOUT = 2.0
PROBE_TIMEOUT = 5.0
BELLEK_DOCTOR_TIMEOUT = 20.0
FIX_HINT = "Düzeltme: kurulumu (install.ps1 / install.sh) yeniden çalıştırın."


# Not: dataclass kullanılmaz; modül sys.modules'a kaydedilmeden (importlib ile dosyadan)
# yüklendiğinde dataclass + "from __future__ import annotations" AttributeError verir.
class Check(NamedTuple):
    name: str
    status: str
    detail: str


def _short(text: object, limit: int = 160) -> str:
    s = " ".join(str(text).split())
    return s if len(s) <= limit else s[: limit - 1] + "…"


def _worst(statuses) -> str:
    worst = OK
    for s in statuses:
        if _SEV.get(s, 2) > _SEV[worst]:
            worst = s if s in _SEV else ERROR
    return worst


def _norm(s: str) -> str:
    if sh is not None:
        return sh.norm(s)
    return re.sub(r"/{2,}", "/", s.replace("\\", "/")).lower()


_HOME_VAR = re.compile(r"^(?:\$HOME|\$\{HOME\})(?=[/\\]|$)")


def _expand(token: str) -> Path:
    # Hook'lar kabukta (Windows'ta Git Bash) çalışır; orada $HOME kullanıcı dizinidir. Windows
    # ortamında HOME tanımlı değilse expandvars onu açamaz: kullanıcı dizinine çevrilir.
    if _HOME_VAR.match(token) and not os.environ.get("HOME"):
        token = _HOME_VAR.sub(lambda _: str(Path.home()).replace("\\", "/"), token)
    return Path(os.path.expandvars(os.path.expanduser(token)))


def _under(path: Path, root: Path) -> bool:
    try:
        p, r = _norm(str(path.resolve())), _norm(str(root.resolve())).rstrip("/")
    except OSError:
        p, r = _norm(str(path)), _norm(str(root)).rstrip("/")
    return p == r or p.startswith(r + "/")


_TOKEN = re.compile(r'"([^"]*)"|\'([^\']*)\'|(\S+)')


def _tokens(cmd: str) -> list[str]:
    return [next(g for g in m.groups() if g is not None) for m in _TOKEN.finditer(cmd)]


def _which(token: str) -> str | None:
    """Komut adı ya da yol -> çalıştırılabilir dosya yolu (yoksa None)."""
    p = _expand(token)
    if p.is_absolute() or "/" in token or "\\" in token:
        if p.is_file():
            return str(p)
        if os.name == "nt" and not p.suffix and p.with_suffix(".exe").is_file():
            return str(p.with_suffix(".exe"))
        return None
    return _path_which(token)


def _path_which(name: str) -> str | None:
    """Çıplak komut adını yalnız PATH'teki MUTLAK klasörlerde arar.

    shutil.which Windows'ta (3.11'de her zaman, 3.12+'da NoDefaultCurrentDirectoryInExePath
    tanımlı değilse) önce çalışma klasörüne bakar: doktoru kötü niyetli bir deponun içinden
    çalıştıran kullanıcıda oradaki git.exe/python.exe gerçek programın yerine çalışırdı. Boş ve
    göreli PATH girdileri de (çalışma klasörüne göre çözüldükleri için) atlanır.
    """
    dirs = []
    for d in os.environ.get("PATH", "").split(os.pathsep):
        d = d.strip().strip('"')
        if d and os.path.isabs(d):
            dirs.append(d)
    if os.name == "nt":
        exts = [e for e in os.environ.get("PATHEXT", ".COM;.EXE;.BAT;.CMD").split(";") if e]
        names = [name] if any(name.lower().endswith(e.lower()) for e in exts) else [name + e for e in exts]
    else:
        names = [name]
    for d in dirs:
        for n in names:
            cand = os.path.join(d, n)
            if os.path.isfile(cand) and (os.name == "nt" or os.access(cand, os.X_OK)):
                return cand
    return None


def _system_exe(name: str) -> str:
    """Windows sistem programının (schtasks, powershell) tam yolu; PATH ve çalışma klasörü aranmaz."""
    root = os.environ.get("SystemRoot") or os.environ.get("windir") or r"C:\Windows"
    if name == "powershell":
        return os.path.join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    return os.path.join(root, "System32", f"{name}.exe")


def _run(args: list[str], timeout: float, env: dict | None = None) -> subprocess.CompletedProcess:
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0
    return subprocess.run(args, capture_output=True, timeout=timeout, stdin=subprocess.DEVNULL,
                          env=env, creationflags=flags)


def _decode(raw: bytes) -> str:
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        pass
    if os.name == "nt":
        try:
            import ctypes

            return raw.decode(f"cp{ctypes.windll.kernel32.GetOEMCP()}", errors="replace")
        except (AttributeError, LookupError, OSError):
            pass
    return raw.decode("latin-1")


def default_claude_home() -> Path:
    d = os.environ.get("CLAUDE_CONFIG_DIR")
    return Path(d) if d else Path.home() / ".claude"


# ------------------------------------------------------------------ bağlam (önbellekli okuma)


class Ctx:
    def __init__(self, claude_home: Path, repo: Path, network: bool) -> None:
        self.claude_home = claude_home
        self.repo = repo
        self.network = network
        self._cache: dict = {}

    @property
    def settings_path(self) -> Path:
        return self.claude_home / "settings.json"

    def settings(self) -> tuple[dict, bool, str | None]:
        """(veri, var mı, hata). Hata varsa veri {}."""
        if "settings" not in self._cache:
            path = self.settings_path
            try:
                if sh is not None:
                    data, existed = sh.load(str(path))
                elif path.exists():
                    text = path.read_bytes().decode("utf-8-sig")
                    data, existed = (json.loads(text) if text.strip() else {}), True
                    if not isinstance(data, dict):
                        raise ValueError("settings.json kökü bir JSON nesnesi değil")
                else:
                    data, existed = {}, False
                self._cache["settings"] = (data, existed, None)
            except json.JSONDecodeError as e:
                self._cache["settings"] = ({}, True, f"geçerli JSON değil (satır {e.lineno}, sütun {e.colno}: {e.msg})")
            except UnicodeDecodeError:
                self._cache["settings"] = ({}, True, "UTF-8 olarak okunamadı")
            except (OSError, ValueError) as e:
                self._cache["settings"] = ({}, True, _short(e))
        return self._cache["settings"]

    @property
    def mcp_path(self) -> Path:
        """Kullanıcı kapsamlı MCP kayıtlarının dosyası (mcp_config.default_config ile aynı kural)."""
        home = self.claude_home
        inside = home / ".claude.json"
        try:
            is_default = home.resolve() == (Path.home() / ".claude").resolve()
        except OSError:
            is_default = False
        if is_default and not os.environ.get("CLAUDE_CONFIG_DIR"):
            return Path.home() / ".claude.json"
        if inside.is_file() or home.name != ".claude":
            return inside
        sibling = home.parent / ".claude.json"  # ~/.claude düzeninin geçici kopyası
        return sibling if sibling.is_file() else inside

    def mcp_servers(self) -> tuple[dict, str | None]:
        if "mcp" not in self._cache:
            path = self.mcp_path
            try:
                if not path.is_file():
                    self._cache["mcp"] = ({}, None)
                else:
                    data = json.loads(path.read_bytes().decode("utf-8-sig") or "{}")
                    servers = data.get("mcpServers") if isinstance(data, dict) else None
                    self._cache["mcp"] = (servers if isinstance(servers, dict) else {}, None)
            except json.JSONDecodeError as e:
                self._cache["mcp"] = ({}, f"{path} geçerli JSON değil (satır {e.lineno}: {e.msg})")
            except (OSError, UnicodeDecodeError) as e:
                self._cache["mcp"] = ({}, f"{path} okunamadı ({type(e).__name__})")
        return self._cache["mcp"]

    def mcp_entry(self, name: str):
        servers, _ = self.mcp_servers()
        return servers.get(name)

    def hook_records(self, key: str) -> list[dict]:
        """settings.json'daki bileşen kayıtları: {event, group, matcher, command, kind: ours|legacy}."""
        ck = f"hooks:{key}"
        if ck not in self._cache:
            data, _, err = self.settings()
            if err:
                raise _SettingsUnreadable(err)
            spec = sh.hook_specs(str(self.repo).replace("\\", "/"))[key]
            tail = spec["tail"]
            hooks = data.get("hooks")
            out: list[dict] = []
            if isinstance(hooks, dict):
                for event, groups in hooks.items():
                    if not isinstance(groups, list):
                        continue
                    for gi, g in enumerate(groups):
                        if not isinstance(g, dict) or not isinstance(g.get("hooks"), list):
                            continue
                        for h in g["hooks"]:
                            kind = "ours" if sh.is_ours(h, tail) else "legacy" if sh.is_legacy(h, key, tail) else None
                            if kind:
                                out.append({"event": event, "group": gi, "matcher": g.get("matcher"),
                                            "command": h["command"], "kind": kind})
            self._cache[ck] = out
        return self._cache[ck]

    def installed(self, what: str) -> bool:
        """Bileşen bu claude-home'da kayıtlı mı (hata olursa False)."""
        try:
            if what == "mcp:beyin":
                return isinstance(self.mcp_entry("beyin"), dict)
            return bool(self.hook_records(what)) if sh is not None else False
        except Exception:  # noqa: BLE001
            return False


class _SettingsUnreadable(Exception):
    pass


def _script_token(cmd: str, key: str, tail: str) -> str | None:
    """Komuttaki betik yolu (bizim ya da eski konum); "-m modül" biçiminde None."""
    # Her parça tek başına "python <parça>" komutu gibi sınanır: tanıma kuralı (bizim / eski
    # konum) settings_hooks'ta kalır, burada kopyalanmaz.
    for t in _tokens(cmd):
        if '"' in t:
            continue
        h = {"command": f'python "{t}"'}
        if sh.is_ours(h, tail) or sh.is_legacy(h, key, tail):
            return t
    return None


_ASSIGN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=")


def _interpreter_token(cmd: str, key: str, tail: str) -> str | None:
    toks = _tokens(cmd)
    while toks and _ASSIGN.match(toks[0]):  # baştaki ortam atamaları (FOO=1 python ...)
        toks = toks[1:]
    if not toks:
        return None
    script = _script_token(cmd, key, tail)
    return None if script is not None and toks[0] == script else toks[0]


# ------------------------------------------------------------------ denetimler


def check_settings(ctx: Ctx) -> Check:
    data, existed, err = ctx.settings()
    path = ctx.settings_path
    if not existed:
        return Check("settings", OK, f"yok: {path} (hiç hook kaydı yok)")
    if err:
        return Check("settings", ERROR, f"{path} okunamadı: {err}. Claude Code bu dosyadaki ayarları yükleyemez.")
    hooks = data.get("hooks")
    if hooks is None:
        return Check("settings", OK, f"geçerli JSON, hook kaydı yok: {path}")
    if not isinstance(hooks, dict):
        return Check("settings", ERROR, f'{path}: "hooks" alanı bir JSON nesnesi değil')
    bad = [ev for ev, groups in hooks.items() if not isinstance(groups, list)]
    if bad:
        return Check("settings", ERROR, f'{path}: "hooks" altında liste olmayan olay: {", ".join(bad)}')
    return Check("settings", OK, f"geçerli JSON, {len(hooks)} olayda hook kaydı: {path}")


MANUAL_HINT = ("Bileşenin kaydetmediği olaydaki kayda kurulum dokunmaz; gerekmiyorsa settings.json'dan "
               "elle kaldırın.")
_FAIL_SILENT = re.compile(r"\|\|\s*(?:true|:|exit\s+0)\s*$", re.IGNORECASE)


def _script_missing(tok: str | None) -> bool:
    """Betik yolu mutlak ve dosya yok mu (-m biçimi ve göreli yol: bilinmiyor -> False)."""
    if tok is None:
        return False
    p = _expand(tok)
    return p.is_absolute() and not p.is_file()


def _m(matcher) -> str:
    return "" if matcher in (None, "", "*") else str(matcher)


def check_hook(ctx: Ctx, key: str) -> Check:
    name = f"hook:{key}"
    if sh is None:
        return Check(name, ERROR, f"settings_hooks.py yüklenemedi; denetlenemedi ({_SH_ERROR})")
    try:
        recs = ctx.hook_records(key)
    except _SettingsUnreadable:
        return Check(name, WARN, "settings.json okunamadığı için hook kayıtları denetlenemedi (bkz. settings)")
    if not recs:
        return Check(name, OK, "kurulu değil (settings.json'da kaydı yok)")

    spec = sh.hook_specs(str(ctx.repo).replace("\\", "/"))[key]
    tail, expected = spec["tail"], spec["events"]
    matchers = spec.get("matchers", {})
    # (durum, metin, öneri türü): "fix" = kurulum düzeltir; "manual" = kurulum dokunmaz, elle.
    issues: list[tuple[str, str, str | None]] = []

    # Bileşenin KENDİ kaydetmediği olaylardaki kayıtlar (bizim ya da eski konum): kurulum
    # (settings_hooks) yalnız bileşenin kendi olaylarına dokunur, bunları silmez; "kurulumu
    # yeniden çalıştırın" demek kullanıcıyı döngüye sokar. Betik dosyası yoksa ve komut hatayı
    # yutmuyorsa ("|| true" yok) hook her tetiklendiğinde hata verir: error; aksi halde warn.
    other = [r for r in recs if r["event"] not in expected]
    for event in dict.fromkeys(r["event"] for r in other):
        ev = [r for r in other if r["event"] == event]
        toks = list(dict.fromkeys(_script_token(r["command"], key, tail) or r["command"] for r in ev))
        dead = [r for r in ev if _script_missing(_script_token(r["command"], key, tail))]
        loud = [r for r in dead if not _FAIL_SILENT.search(r["command"])]
        what = "eski konumdan" if all(r["kind"] == "legacy" for r in ev) else "bileşenin kaydetmediği olayda"
        text = f"{event}: {what} {len(ev)} kayıt ({', '.join(toks)})"
        if loud:
            text += "; betik dosyası yok, hook her tetiklendiğinde hata verir"
        elif dead:
            text += "; betik dosyası yok, hook hiçbir şey yapmaz"
        issues.append((ERROR if loud else WARN, text, "manual"))

    own = [r for r in recs if r["event"] in expected]
    legacy = [r for r in own if r["kind"] == "legacy"]
    ours = [r for r in own if r["kind"] == "ours"]
    for event in dict.fromkeys(r["event"] for r in legacy):
        ev = [r for r in legacy if r["event"] == event]
        scripts = sorted({_script_token(r["command"], key, tail) or r["command"] for r in ev})
        issues.append((ERROR, f"{event}: eski konumdan {len(ev)} kayıt ({', '.join(scripts)})", "fix"))

    for event in dict.fromkeys(r["event"] for r in ours):
        ev = [r for r in ours if r["event"] == event]
        groups = sorted({r["group"] for r in ev})
        want = len(expected[event])
        if len(groups) > 1:
            issues.append((ERROR, f"{event}: {len(groups)} grupta kayıt (beklenen 1 grup)", "fix"))
            continue
        if len(ev) > want:
            issues.append((ERROR, f"{event}: {len(ev)} kayıt (beklenen {want})", "fix"))
        elif len(ev) < want:
            issues.append((WARN, f"{event}: {len(ev)} kayıt, eksik (beklenen {want})", "fix"))
        if _m(ev[0]["matcher"]) != _m(matchers.get(event)):
            issues.append((WARN, f"{event}: eşleştirici '{_m(ev[0]['matcher']) or '(yok)'}' "
                                 f"(beklenen '{_m(matchers.get(event)) or '(yok)'}')", "fix"))
    if ours:
        present = {r["event"] for r in ours}
        for event in expected:
            if event not in present:
                m = _m(matchers.get(event))
                issues.append((WARN, f"{event}{f' ({m})' if m else ''} kaydı eksik", "fix"))

    scripts: dict[str, str] = {}
    module_form = False
    for r in ours:
        tok = _script_token(r["command"], key, tail)
        if tok is None:
            module_form = True
        else:
            scripts.setdefault(_norm(tok), tok)
    for tok in scripts.values():
        p = _expand(tok)
        if not p.is_absolute():
            issues.append((WARN, f"betik yolu göreli, denetlenemedi: {tok}", "fix"))
        elif not p.is_file():
            issues.append((ERROR, f"betik dosyası yok: {tok}", "fix"))
        elif not _under(p, ctx.repo):
            issues.append((WARN, f"kayıt başka bir depo kopyasını gösteriyor: {p} (--repo: {ctx.repo})", "fix"))

    if issues:
        status = _worst(s for s, _, _ in issues)
        issues.sort(key=lambda i: -_SEV[i[0]])
        detail = "; ".join(t for _, t, _ in issues) + "."
        if any(k == "fix" for _, _, k in issues):
            detail += " " + FIX_HINT
        if any(k == "manual" for _, _, k in issues):
            detail += " " + MANUAL_HINT
        return Check(name, status, detail)
    events = ", ".join(e for e in expected)
    where = ", ".join(scripts.values()) or "-"
    extra = " (modül biçimi: -m)" if module_form else ""
    return Check(name, OK, f"{events}: birer grup; betik: {where}{extra}")


# Kullanıcı dosyasından (settings.json, .claude.json) okunan bir program YALNIZ adı açıkça bir
# Python yorumlayıcısıysa çalıştırılır (sürüm sormak için). Başka her şey çalıştırılmaz:
# aksi halde doktor, settings.json'a yazılmış herhangi bir programı çalıştırabilirdi.
_PYTHON_NAME = re.compile(r"^(?:python(?:\d+(?:\.\d+)?)?|py)(?:\.exe)?$", re.IGNORECASE)


def _is_python_name(path_or_name: str) -> bool:
    return bool(_PYTHON_NAME.match(Path(path_or_name.replace("\\", "/")).name))


def _python_version(exe: str) -> tuple[tuple[int, ...] | None, str]:
    if not _is_python_name(exe):  # savunma: çağıranlar zaten denetler
        return None, "yorumlayıcı tanınmadı, çalıştırılmadı"
    try:
        r = _run([exe, "-I", "-c", "import sys;print('.'.join(map(str,sys.version_info[:3])))"], PROBE_TIMEOUT)
    except subprocess.TimeoutExpired:
        return None, "sürüm sorgusu zaman aşımına uğradı"
    except OSError as e:
        return None, f"çalıştırılamadı ({type(e).__name__})"
    m = re.search(r"(\d+)\.(\d+)\.(\d+)", _decode(r.stdout))
    if r.returncode != 0 or not m:
        return None, f"çalışmadı (çıkış {r.returncode}; Microsoft Store kısayolu olabilir)"
    return tuple(int(x) for x in m.groups()), m.group(0)


def check_hook_python(ctx: Ctx) -> Check:
    name = "hook:python"
    if sh is None:
        return Check(name, ERROR, f"settings_hooks.py yüklenemedi; denetlenemedi ({_SH_ERROR})")
    if ctx.settings()[2]:
        return Check(name, WARN, "settings.json okunamadığı için denetlenemedi (bkz. settings)")
    if not ctx.network:
        return Check(name, OK, "atlandı (--no-network: settings.json'daki programlar çalıştırılmaz)")
    specs = sh.hook_specs(str(ctx.repo).replace("\\", "/"))
    interps: dict[str, list[str]] = {}
    for key in HOOK_KEYS:
        for r in ctx.hook_records(key):
            if r["kind"] != "ours":
                continue
            tok = _interpreter_token(r["command"], key, specs[key]["tail"])
            if tok and key not in interps.setdefault(tok, []):
                interps[tok].append(key)
    if not interps:
        return Check(name, OK, "kurulu değil (eren-kit hook kaydı yok)")
    issues: list[tuple[str, str]] = []
    oks: list[str] = []
    want = ".".join(map(str, HOOK_PYTHON_MIN))
    for tok, keys in interps.items():
        who = ", ".join(keys)
        if not _is_python_name(tok):
            issues.append((WARN, f"'{tok}' bir Python yorumlayıcısı olarak tanınmadı ({who}); "
                                 "çalıştırılmadı, sürüm denetlenemedi"))
            continue
        exe = _which(tok)
        if exe is None:
            issues.append((WARN, f"'{tok}' bulunamadı ({who}); hook'lar sessizce çalışmaz. "
                                 "Python 3.11+ kurup PATH'e ekleyin"))
            continue
        ver, text = _python_version(exe)
        if ver is None:
            issues.append((WARN, f"'{tok}' -> {exe}: {text} ({who})"))
        elif ver[:2] < HOOK_PYTHON_MIN:
            issues.append((WARN, f"'{tok}' -> {exe}: Python {text}, en az {want} gerekli ({who})"))
        else:
            oks.append(f"'{tok}' -> {exe} (Python {text})")
    if issues:
        return Check(name, _worst(s for s, _ in issues), "; ".join(t for _, t in issues))
    return Check(name, OK, "; ".join(oks))


def _skill_files(root: Path) -> dict[str, Path]:
    return {p.relative_to(root).as_posix(): p for p in root.rglob("*") if p.is_file()}


def check_skill_orkestra(ctx: Ctx) -> Check:
    name = "skill:opus-orkestra"
    installed_dir = ctx.claude_home / "skills" / "opus-orkestra"
    installed = installed_dir / "SKILL.md"
    source = ctx.repo / "packages" / "opus-orkestra" / "skill" / "SKILL.md"
    if not installed.is_file():
        if installed_dir.is_dir():
            return Check(name, WARN, f"skill klasörü var ama SKILL.md yok: {installed_dir}. {FIX_HINT}")
        return Check(name, OK, "kurulu değil (skills/opus-orkestra yok)")
    if not source.is_file():
        return Check(name, WARN, f"depoda kaynak yok, karşılaştırılamadı: {source}")
    if installed.read_bytes() == source.read_bytes():
        return Check(name, OK, f"kurulu kopya depodakiyle aynı: {installed}")
    return Check(name, WARN, f"kurulu kopya depodakinden farklı ({installed}); hook eski kuralı enjekte eder. "
                             f"{FIX_HINT}")


def check_skill_devir(ctx: Ctx) -> Check:
    name = "skill:devir"
    dest = ctx.claude_home / "skills" / "devir"
    src = ctx.repo / "packages" / "bellek" / "skills" / "devir"
    if not dest.is_dir():
        return Check(name, OK, "kurulu değil (skills/devir yok)")
    if not src.is_dir():
        return Check(name, WARN, f"depoda kaynak yok, karşılaştırılamadı: {src}")
    have = {k: v for k, v in _skill_files(dest).items() if k != SKILL_MARKER}
    want = _skill_files(src)
    missing = sorted(set(want) - set(have))
    extra = sorted(set(have) - set(want))
    changed = sorted(k for k in set(want) & set(have) if want[k].read_bytes() != have[k].read_bytes())
    if not (missing or extra or changed):
        return Check(name, OK, f"kurulu kopya depodakiyle aynı ({len(want)} dosya): {dest}")
    parts = []
    for label, items in (("farklı", changed), ("eksik", missing), ("fazla", extra)):
        if items:
            parts.append(f"{label}: {', '.join(items[:3])}{' …' if len(items) > 3 else ''}")
    return Check(name, WARN, f"kurulu kopya depodakinden farklı ({dest}; {'; '.join(parts)}). {FIX_HINT}")


_SCRIPT_SUFFIXES = (".py", ".pyw", ".js", ".mjs", ".cjs", ".exe", ".cmd", ".bat", ".ps1", ".sh")


# Kurulumun kendi yazdığı argümanlar (install.ps1 $P.BeyinMcp / install_macos BEYIN_MCP_ARGS ve
# -I'siz eski biçimi; computer-use-windows argümansız). Doktor kaydı gösterirken yalnız bu öneki
# yazar, kullanıcının eklediği argümanları sayar (değerleri sır olabilir).
_KNOWN_MCP_ARGS = {
    "beyin": (("-I", "-m", "bellek.beyin", "mcp"), ("-m", "bellek.beyin", "mcp")),
    "computer-use-windows": ((),),
}


def _fmt_cmd(server: str, entry: dict) -> str:
    return mcp_config.describe_entry(entry, mcp_config.known_prefix(entry, _KNOWN_MCP_ARGS.get(server, ())))


_PY_OPTS_WITH_ARG = set("WX")  # "-W arg", "-X arg": argüman alan (mod dışı) Python seçenekleri
# Değeri ayrı argümanda gelen uzun seçenekler ("--check-hash-based-pycs always").
_PY_LONG_OPTS_WITH_ARG = {"--check-hash-based-pycs"}


def _cwd_code_risk(command: str, args: list, env: dict) -> str | None:
    """Python komutu, sürecin çalışma klasöründeki bir dosyayı kod olarak yükleyebiliyorsa nedeni.

    MCP sunucuları Claude Code'un açıldığı klasörde başlar. "-m modül" ya da "-c kod" çalışma
    klasörünü sys.path'in başına koyar (-I ya da -P yoksa, PYTHONSAFEPATH de yoksa); göreli bir
    betik yolu doğrudan o klasörden okunur. Python dışı programlar (ör. konsol betiği .exe)
    için None.
    """
    if not _is_python_name(command):
        return None
    safe = False
    ignore_env = False
    toks = [str(a) for a in args]
    i = 0
    while i < len(toks):
        t = toks[i]
        if t == "--" or t == "-" or not t.startswith("-"):
            if t == "--":
                i += 1
                t = toks[i] if i < len(toks) else ""
            if t and t != "-" and not _expand(t).is_absolute():
                # Yalnız betik adına benzeyen (izinli karakterler, bilinen uzantı) yol yazılır: bu
                # konum bir seçeneğin değeri de olabilir (ör. "-Wdefault GİZLİ"); sır basılmaz.
                looks = mcp_config.program_shown(t) and " " not in t and t.lower().endswith(_SCRIPT_SUFFIXES)
                return f"betik yolu göreli ({t if looks else 'değeri yazılmaz'}); çalışma klasöründen okunur"
            return None
        if t.startswith("--"):  # --version, --help ...; değer alan uzun seçeneğin değeri atlanır
            i += 2 if t in _PY_LONG_OPTS_WITH_ARG else 1
            continue
        flags = t[1:]
        for j, ch in enumerate(flags):
            if ch in "IP":
                safe = True
                if ch == "I":
                    ignore_env = True
            elif ch == "E":
                ignore_env = True
            elif ch in "mc":
                env_safe = bool(str((env or {}).get("PYTHONSAFEPATH", "")).strip()) and not ignore_env
                if safe or env_safe:
                    return None
                return (f'"python -{ch}" -I (ya da -P) olmadan çalışıyor; sunucu Claude Code\'u açtığınız '
                        "klasörü Python arama yolunun başına koyar, oradaki aynı adlı bir paket gerçeğinin "
                        "yerine çalışır")
            elif ch in _PY_OPTS_WITH_ARG:
                if j == len(flags) - 1:
                    i += 1  # argüman sonraki parçada
                break
        i += 1
    return None


def check_mcp(ctx: Ctx, server: str) -> Check:
    name = f"mcp:{server}"
    servers, err = ctx.mcp_servers()
    if err:
        return Check(name, ERROR, f"Claude yapılandırması okunamadı: {err}")
    entry = servers.get(server)
    if entry is None:
        return Check(name, OK, f"kurulu değil ({ctx.mcp_path} içinde kayıt yok)")
    if not isinstance(entry, dict):
        return Check(name, ERROR, f"kayıt bir JSON nesnesi değil ({ctx.mcp_path})")
    # Claude Code'un kabul/ret sınırı (gerçek claude ile ölçülmüş; bkz. mcp_config.entry_problems).
    bad = mcp_config.entry_problems(entry)
    if bad:
        return Check(name, ERROR, f"Claude Code bu kaydı yok sayıyor: geçersiz değer ({', '.join(bad)}). "
                                  f"{ctx.mcp_path} içinde değeri düzeltin (ör. sayıysa tırnak içine alın: "
                                  '8080 -> "8080"); kurulum bu kayda dokunmaz.')
    typ = mcp_config._entry_type(entry)
    if typ in mcp_config.REMOTE_TYPES:
        # Adresin yalnız şema://sunucu[:port] kısmı: yol/sorgu/kullanıcı bilgisi belirteç taşıyabilir.
        return Check(name, OK, f"uzak sunucu ({typ}): {mcp_config.describe_url(entry.get('url'))}")
    cmd = entry["command"]  # entry_problems: stdio kaydında boş olmayan dize
    if not cmd.strip():
        return Check(name, ERROR, f"kayıtta komut yok ({ctx.mcp_path}). {FIX_HINT}")
    shown = _fmt_cmd(server, entry)
    exe = _which(cmd)
    if exe is None:
        return Check(name, ERROR, f"komut bulunamadı (kayıt: {shown}). {FIX_HINT}")
    args = entry.get("args") or []
    for a in args:
        if isinstance(a, str) and a.lower().endswith(_SCRIPT_SUFFIXES):
            p = _expand(a)
            if p.is_absolute() and not p.is_file():
                return Check(name, ERROR, f"betik dosyası yok: {mcp_config.describe_program(a)} (kayıt: {shown}). "
                                          f"{FIX_HINT}")
    owned = any(_under(_expand(str(v)), ctx.repo) for v in [cmd, *args] if isinstance(v, str) and _expand(v).is_absolute())
    note = "" if owned else " (bu --repo dışında)"
    env = entry.get("env") if isinstance(entry.get("env"), dict) else {}
    risk = _cwd_code_risk(cmd, args, env)
    if risk:
        fix = FIX_HINT if owned else "Kaydı -I ile yeniden ekleyin (claude mcp remove/add)."
        return Check(name, WARN, f"GÜVENSİZ kayıt: {risk}. Kayıt: {shown}{note}. {fix}")
    return Check(name, OK, f"kayıtlı: {shown}{note}")


def _service_port(ctx: Ctx) -> int:
    entry = ctx.mcp_entry("beyin")
    env = entry.get("env") if isinstance(entry, dict) and isinstance(entry.get("env"), dict) else {}
    for raw in (env.get("BELLEK_BEYIN_PORT"), os.environ.get("BELLEK_BEYIN_PORT")):
        try:
            port = int(str(raw).strip())
        except (TypeError, ValueError):
            continue
        if 0 < port < 65536:
            return port
    return SERVICE_PORT


def _service_hint() -> str:
    if sys.platform == "win32":
        return f'Görev Zamanlayıcı\'da "{SERVICE_TASK}" görevini başlatın ya da oturumu yeniden açın'
    if sys.platform == "darwin":
        return f"launchctl kickstart gui/$(id -u)/{SERVICE_LABEL}"
    return "servisi elle başlatın: python -I -m bellek.beyin servis"


def check_service(ctx: Ctx) -> Check:
    name = "servis:beyin"
    if not ctx.network:
        return Check(name, OK, "atlandı (--no-network)")
    if not ctx.installed("mcp:beyin"):
        return Check(name, OK, "kurulu değil (beyin MCP kaydı yok)")
    port = _service_port(ctx)
    url = f"http://127.0.0.1:{port}/api/saglik"
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(urllib.request.Request(url, headers={"Accept": "application/json"}),
                         timeout=HTTP_TIMEOUT) as resp:
            body = resp.read(65536)
    except urllib.error.HTTPError as e:
        return Check(name, WARN, f"{url} sağlıksız yanıt verdi (HTTP {e.code})")
    except (urllib.error.URLError, OSError, ValueError) as e:
        reason = getattr(e, "reason", e)
        why = type(reason).__name__ if isinstance(reason, BaseException) else _short(reason, 60)
        return Check(name, WARN, f"{url} ulaşılamıyor ({why}); servis kapalıyken beyin yazmaları kuyrukta "
                                 f"bekler. {_service_hint()}.")
    try:
        data = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        data = None
    if isinstance(data, dict) and data.get("durum") == "ok":
        return Check(name, OK, f"{url} sağlıklı (sürüm {data.get('surum', '?')})")
    return Check(name, WARN, f"{url} beklenmeyen yanıt verdi (beyin servisi değil ya da sağlıksız)")


def _task_xml_fields(xml_text: str) -> dict:
    import xml.etree.ElementTree as ET

    xml_text = re.sub(r"^\s*<\?xml[^>]*\?>", "", xml_text)
    root = ET.fromstring(xml_text)
    out: dict = {}
    for el in root.iter():
        tag = el.tag.rsplit("}", 1)[-1]
        if tag in ("Command", "Arguments") and tag not in out:
            out[tag] = (el.text or "").strip()
        elif tag == "Enabled" and el.text is not None:
            out.setdefault("Enabled", el.text.strip().lower())
    return out


def check_service_task(ctx: Ctx) -> Check:
    name = "servis:gorev"
    if not ctx.network:
        return Check(name, OK, "atlandı (--no-network)")
    if not ctx.installed("mcp:beyin"):
        return Check(name, OK, "kurulu değil (beyin MCP kaydı yok)")
    if sys.platform == "win32":
        try:
            r = _run([_system_exe("schtasks"), "/Query", "/TN", SERVICE_TASK, "/XML"], PROBE_TIMEOUT)
        except (OSError, subprocess.TimeoutExpired) as e:
            return Check(name, WARN, f"Görev Zamanlayıcı sorgulanamadı ({type(e).__name__})")
        if r.returncode != 0:
            return Check(name, WARN, f'"{SERVICE_TASK}" görevi yok; beyin servisi oturum açılışında kendiliğinden '
                                     "başlamaz (servisi elle yönetiyorsanız yok sayın). " + FIX_HINT)
        f = _task_xml_fields(_decode(r.stdout))
        prog, args = f.get("Command", ""), f.get("Arguments", "")
        where = f"{prog} {args}".strip()
    elif sys.platform == "darwin":
        import plistlib

        path = Path.home() / "Library" / "LaunchAgents" / f"{SERVICE_LABEL}.plist"
        if not path.is_file():
            return Check(name, WARN, f"LaunchAgent yok ({path}); beyin servisi oturum açılışında başlamaz. "
                                     + FIX_HINT)
        data = plistlib.loads(path.read_bytes())
        argv = data.get("ProgramArguments") or []
        prog = str(argv[0]) if argv else ""
        where = " ".join(map(str, argv))
        f = {"Enabled": "false" if data.get("Disabled") else "true"}
    else:
        return Check(name, OK, "bu platformda geçerli değil")
    if not prog:
        return Check(name, ERROR, f"servis görevinde program yok. {FIX_HINT}")
    p = _expand(prog.strip('"'))
    if not p.is_file():
        return Check(name, ERROR, f"servis görevinin programı yok: {prog}. {FIX_HINT}")
    if f.get("Enabled") == "false":
        return Check(name, WARN, f"servis görevi devre dışı: {where}")
    if not _under(p, ctx.repo):
        return Check(name, WARN, f"servis görevi başka bir depo kopyasını çalıştırıyor: {where} (--repo: {ctx.repo})")
    return Check(name, OK, f"servis görevi kayıtlı: {where}")


def _bellek_python(ctx: Ctx) -> tuple[str | None, dict]:
    """bellek doktor için yorumlayıcı ve ek ortam: önce beyin MCP'sinin kullandığı, sonra depo venv'i."""
    entry = ctx.mcp_entry("beyin")
    if isinstance(entry, dict) and isinstance(entry.get("command"), str):
        args = [str(a) for a in entry.get("args") or []]
        # .claude.json'dan gelen komut yalnız adı Python yorumlayıcısıysa kullanılır;
        # değilse deponun kendi venv'ine düşülür.
        while args and args[0] in ("-I", "-P", "-B", "-E", "-s", "-S", "-u"):  # "-I -m bellek.beyin" (güncel biçim)
            args = args[1:]
        if args[:2] == ["-m", "bellek.beyin"] and _is_python_name(entry["command"]):
            exe = _which(entry["command"])
            env = entry.get("env") if isinstance(entry.get("env"), dict) else {}
            if exe and _is_python_name(exe):
                # Dize olmayan değer (elle düzenlenmiş kayıt) "None"/"True" gibi uydurma bir değere dönüşmez.
                return exe, {str(k): v for k, v in env.items() if isinstance(v, str)}
    venv = ctx.repo / "packages" / "bellek" / ".venv"
    exe = venv / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    return (str(exe), {}) if exe.is_file() else (None, {})


def check_bellek_doctor(ctx: Ctx) -> Check:
    name = "bellek:doktor"
    if not ctx.network:
        return Check(name, OK, "atlandı (--no-network)")
    if not any(ctx.installed(w) for w in ("mcp:beyin", "devir", "kapi")):
        return Check(name, OK, "kurulu değil (beyin MCP'si ve devir/kapı hook'u yok)")
    exe, extra_env = _bellek_python(ctx)
    if exe is None:
        return Check(name, OK, "bellek ortamı (packages/bellek/.venv) bulunamadı; atlandı")
    env = dict(os.environ)
    env.update(extra_env)
    env.update({"PYTHONDONTWRITEBYTECODE": "1", "PYTHONIOENCODING": "utf-8"})
    try:
        # -I: "-m bellek" doktorun çalıştığı klasördeki bir "bellek" paketini yüklemesin (kullanıcı
        # doktoru herhangi bir klasörden çalıştırabilir); BELLEK_* değişkenleri -I'dan etkilenmez.
        r = _run([exe, "-I", "-B", "-m", "bellek", "doktor", "--json"], BELLEK_DOCTOR_TIMEOUT, env=env)
    except subprocess.TimeoutExpired:
        return Check(name, WARN, f"bellek doktor {BELLEK_DOCTOR_TIMEOUT:.0f} sn içinde bitmedi")
    except OSError as e:
        return Check(name, WARN, f"bellek doktor çalıştırılamadı ({type(e).__name__})")
    try:
        report = json.loads(r.stdout.decode("utf-8"))
        checks = report["checks"]
        status = report["status"] if report["status"] in _SEV else ERROR
    except (ValueError, KeyError, TypeError, UnicodeDecodeError):
        lines = _decode(r.stderr).strip().splitlines()
        return Check(name, WARN, f"bellek doktor çıktısı okunamadı (çıkış {r.returncode}): "
                                 f"{_short(lines[-1] if lines else '-', 100)}")
    bad = [c for c in checks if isinstance(c, dict) and c.get("status") != OK]
    if not bad:
        return Check(name, OK, f"bellek doktor: {len(checks)} denetim tamam")
    shown = "; ".join(f"{c.get('name')}: {_short(c.get('detail', ''), 100)}" for c in bad[:3])
    more = f"; ve {len(bad) - 3} sorun daha" if len(bad) > 3 else ""
    return Check(name, status, f"bellek doktor {len(bad)} sorun bildirdi: {shown}{more} "
                               f"(ayrıntı: {exe} -m bellek doktor)")


def check_phone(ctx: Ctx) -> Check:
    name = "telefon:node"
    phone = ctx.repo / "apps" / "phone"
    if not (phone / "node_modules").is_dir():
        return Check(name, OK, "kurulu değil (apps/phone/node_modules yok)")
    node = _path_which("node")
    if node is None:
        return Check(name, WARN, f"telefon bağımlılıkları kurulu ama node bulunamadı; Node {NODE_MIN}+ kurun")
    try:
        r = _run([node, "--version"], PROBE_TIMEOUT)
    except (OSError, subprocess.TimeoutExpired) as e:
        return Check(name, WARN, f"node çalıştırılamadı ({type(e).__name__}): {node}")
    m = re.search(r"v(\d+)\.(\d+)\.(\d+)", _decode(r.stdout))
    if not m:
        return Check(name, WARN, f"node sürümü okunamadı: {node}")
    if int(m.group(1)) < NODE_MIN:
        return Check(name, WARN, f"Node {m.group(0)[1:]} çok eski, {NODE_MIN}+ gerekli: {node}")
    return Check(name, OK, f"Node {m.group(0)[1:]}: {node}")


# Herkesi kapsayan gruplar (SID -> ad): bunlara yazma izni veren ACE, makinedeki her hesaba izin verir.
_BROAD_SIDS = {
    "S-1-1-0": "Everyone",
    "S-1-5-11": "Authenticated Users",
    "S-1-5-32-545": "Users",
    "S-1-5-4": "INTERACTIVE",
    "S-1-5-32-546": "Guests",
    "S-1-5-2": "NETWORK",
    "S-1-5-7": "ANONYMOUS LOGON",
}
# Yazma sayılan haklar: WriteData/CreateFiles, AppendData/CreateDirectories, DeleteChild, DELETE,
# WRITE_DAC, WRITE_OWNER, GENERIC_ALL, GENERIC_WRITE (genel haklar devralınacak ACE'lerde görünür).
_WRITE_MASK = 0x2 | 0x4 | 0x40 | 0x10000 | 0x40000 | 0x80000 | 0x10000000 | 0x40000000


def _rights_text(mask: int) -> str:
    if mask & 0x10000000 or mask & 0x1F01FF == 0x1F01FF:
        return "tam denetim"
    if mask & 0x40000000 or (mask & 0x2 and mask & 0x10000):
        return "değiştirme"
    if mask & 0x2:
        return "yazma"
    if mask & 0x4:
        return "klasör oluşturma"
    return "silme/izin değiştirme"


def _broad_writers_windows(path: Path) -> tuple[list[str] | None, str]:
    """(geniş gruplara yazma veren izinler, hata); liste None ise denetlenemedi.

    DACL Win32 API'siyle (ctypes) okunur: alt süreç yok, hiçbir dosyaya yazılmaz. Devralınacak
    (yalnız alt öğelere uygulanan) ACE'ler de sayılır: depodaki dosyalar onlardan izin alır.
    """
    import ctypes
    from ctypes import wintypes

    class _Acl(ctypes.Structure):
        _fields_ = [("AclRevision", ctypes.c_ubyte), ("Sbz1", ctypes.c_ubyte), ("AclSize", wintypes.WORD),
                    ("AceCount", wintypes.WORD), ("Sbz2", wintypes.WORD)]

    class _AceHeader(ctypes.Structure):
        _fields_ = [("AceType", ctypes.c_ubyte), ("AceFlags", ctypes.c_ubyte), ("AceSize", wintypes.WORD)]

    class _AllowedAce(ctypes.Structure):
        _fields_ = [("Header", _AceHeader), ("Mask", wintypes.DWORD), ("SidStart", wintypes.DWORD)]

    try:
        advapi = ctypes.WinDLL("advapi32", use_last_error=True)
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    except (AttributeError, OSError) as e:
        return None, f"Windows API yüklenemedi ({type(e).__name__})"
    get_info = advapi.GetNamedSecurityInfoW
    get_info.argtypes = [wintypes.LPCWSTR, ctypes.c_int, wintypes.DWORD] + [ctypes.POINTER(ctypes.c_void_p)] * 5
    get_info.restype = wintypes.DWORD
    get_ace = advapi.GetAce
    get_ace.argtypes = [ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(ctypes.c_void_p)]
    get_ace.restype = wintypes.BOOL
    sid_str = advapi.ConvertSidToStringSidW
    sid_str.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_void_p)]
    sid_str.restype = wintypes.BOOL
    local_free = kernel.LocalFree
    local_free.argtypes = [ctypes.c_void_p]
    local_free.restype = ctypes.c_void_p

    dacl, sd = ctypes.c_void_p(), ctypes.c_void_p()
    # SE_FILE_OBJECT = 1, DACL_SECURITY_INFORMATION = 4
    rc = get_info(str(path), 1, 4, None, None, ctypes.byref(dacl), None, ctypes.byref(sd))
    if rc != 0:
        return None, f"ACL okunamadı (Windows hata {rc})"
    found: dict[str, int] = {}
    try:
        if not dacl.value:
            return ["DACL yok (herkes tam denetimli)"], ""
        acl = _Acl.from_address(dacl.value)
        for i in range(acl.AceCount):
            ace_p = ctypes.c_void_p()
            if not get_ace(dacl, i, ctypes.byref(ace_p)) or not ace_p.value:
                continue
            if _AceHeader.from_address(ace_p.value).AceType != 0:  # ACCESS_ALLOWED_ACE_TYPE
                continue
            ace = _AllowedAce.from_address(ace_p.value)
            if not ace.Mask & _WRITE_MASK:
                continue
            buf = ctypes.c_void_p()
            if not sid_str(ace_p.value + _AllowedAce.SidStart.offset, ctypes.byref(buf)):
                continue
            try:
                sid = ctypes.wstring_at(buf.value)
            finally:
                local_free(buf)
            if sid in _BROAD_SIDS:
                found[sid] = found.get(sid, 0) | ace.Mask
    finally:
        local_free(sd)
    return [f"{_BROAD_SIDS[s]}: {_rights_text(m)}" for s, m in found.items()], ""



def _private_group(gid: int) -> bool:
    """Grup yalnız bu kullanıcının kişisel grubu mu (Linux'taki kullanıcıya özel grup düzeni)?
    macOS'taki "staff" gibi herkesin üye olduğu grup kişisel sayılmaz."""
    try:
        import grp
        import pwd

        me = pwd.getpwuid(os.getuid()).pw_name
        g = grp.getgrgid(gid)
    except (ImportError, KeyError, OSError, AttributeError):
        return False
    return g.gr_name == me and all(m == me for m in g.gr_mem)


def check_repo_permissions(ctx: Ctx) -> Check:
    """Depo klasörü başka kullanıcılarca yazılabilir mi? Hook'lar, servis ve MCP sunucuları buradaki
    kodu kurulumu yapan kullanıcının yetkisiyle çalıştırır; yazabilen başka bir kullanıcı onun
    adına kod çalıştırır. Tek kullanıcılı makinede zararsızdır, yine de uyarılır."""
    name = "depo:izin"
    if not (any(ctx.installed(w) for w in ("mcp:beyin", *HOOK_KEYS))
            or isinstance(ctx.mcp_entry("computer-use-windows"), dict)):
        return Check(name, OK, "kurulu değil (eren-kit hook'u ya da MCP kaydı yok)")
    # Sonuç makineye göre değiştiği için (aynı depo başka makinede başka izinli) yalnız dosya
    # denetimlerinin kaldığı --no-network kipinde atlanır.
    if not ctx.network:
        return Check(name, OK, "atlandı (--no-network)")
    repo = ctx.repo
    if not repo.is_dir():
        return Check(name, WARN, f"depo klasörü yok: {repo}")
    if os.name == "nt":
        found, err = _broad_writers_windows(repo)
        if found is None:
            return Check(name, WARN, f"depo klasörünün izinleri denetlenemedi: {err}")
        if not found:
            return Check(name, OK, f"depo yalnız size (ve yöneticilere) yazılabilir: {repo}")
        return Check(name, WARN, f"depo klasörü başka kullanıcılarca yazılabilir: {repo} ({'; '.join(found[:4])}). "
                                 "Hook'lar, beyin servisi ve MCP sunucuları buradaki kodu sizin yetkinizle "
                                 "çalıştırır; makinede başka hesap varsa depoyu kullanıcı klasörünüze (ör. "
                                 "%USERPROFILE%\\eren-kit) klonlayıp kurulumu oradan yeniden çalıştırın ya da "
                                 "bu grupların yazma iznini kaldırın.")
    import stat

    st = repo.stat()
    issues = []
    if st.st_mode & stat.S_IWOTH:
        issues.append("herkese yazılabilir (o+w)")
    if st.st_mode & stat.S_IWGRP and not _private_group(st.st_gid):
        issues.append("gruba yazılabilir (g+w)")
    getuid = getattr(os, "getuid", None)
    if getuid is not None and st.st_uid not in (getuid(), 0):
        issues.append(f"sahibi başka bir kullanıcı (uid {st.st_uid})")
    if not issues:
        return Check(name, OK, f"depo yalnız size yazılabilir: {repo}")
    return Check(name, WARN, f"depo klasörü: {', '.join(issues)}: {repo}. Hook'lar, beyin servisi ve MCP "
                             "sunucuları buradaki kodu sizin yetkinizle çalıştırır; chmod go-w ile kapatın "
                             "ya da depoyu kendi kullanıcı klasörünüze klonlayın.")


# ------------------------------------------------------------------ çalıştırma


def _safe(name: str, func: Callable[[], Check]) -> Check:
    try:
        c = func()
        if c.status not in _SEV:
            return Check(name, ERROR, f"geçersiz durum: {c.status}")
        return c
    except Exception as e:  # noqa: BLE001 - tek denetim raporu kesmemeli
        return Check(name, ERROR, f"denetim beklenmedik şekilde başarısız oldu: {type(e).__name__}: {_short(e, 200)}")


def run_checks(claude_home: Path, repo: Path, network: bool = True) -> dict:
    """Bütün denetimleri sabit sırayla çalıştırır; hiçbir dosyayı değiştirmez."""
    ctx = Ctx(Path(claude_home), Path(repo), bool(network))
    plan: list[tuple[str, Callable[[], Check]]] = [("settings", lambda: check_settings(ctx))]
    plan += [(f"hook:{k}", lambda k=k: check_hook(ctx, k)) for k in HOOK_KEYS]
    plan += [
        ("hook:python", lambda: check_hook_python(ctx)),
        ("skill:opus-orkestra", lambda: check_skill_orkestra(ctx)),
        ("skill:devir", lambda: check_skill_devir(ctx)),
    ]
    plan += [(f"mcp:{s}", lambda s=s: check_mcp(ctx, s)) for s in MCP_NAMES]
    plan += [
        ("servis:beyin", lambda: check_service(ctx)),
        ("servis:gorev", lambda: check_service_task(ctx)),
        ("bellek:doktor", lambda: check_bellek_doctor(ctx)),
        ("telefon:node", lambda: check_phone(ctx)),
        ("depo:izin", lambda: check_repo_permissions(ctx)),
    ]
    checks = [_safe(n, f) for n, f in plan]
    return {
        "status": _worst(c.status for c in checks),
        "checks": [{"name": c.name, "status": c.status, "detail": c.detail} for c in checks],
    }


EXIT = {OK: 0, WARN: 1, ERROR: 2}
_MARKS = {OK: "[tamam]", WARN: "[uyarı]", ERROR: "[hata] "}
_OVERALL = {OK: "tamam", WARN: "uyarı", ERROR: "hata"}


def _setup_streams() -> None:
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            try:
                reconfigure(encoding="utf-8")
            except (OSError, ValueError):
                pass


def main(argv: list[str] | None = None) -> int:
    _setup_streams()
    if os.name == "nt":
        # Alt süreçler (bellek doktor vb.) de çıplak program adlarını çalışma klasöründe aramasın.
        os.environ.setdefault("NoDefaultCurrentDirectoryInExePath", "1")
    p = argparse.ArgumentParser(prog="doktor.py",
                                description="eren-kit kurulum doktoru (salt okunur denetim)")
    p.add_argument("--json", action="store_true", help="çıktıyı JSON olarak ver")
    p.add_argument("--claude-home", help="Claude Code dizini (varsayılan: CLAUDE_CONFIG_DIR ya da ~/.claude)")
    p.add_argument("--repo", help="eren-kit deposu (varsayılan: bu betiğin deposu)")
    p.add_argument("--no-network", action="store_true",
                   help="canlı sistem sorgularını atla (servis sağlığı, servis görevi, bellek doktor)")
    try:
        args = p.parse_args(argv)
    except SystemExit as e:
        return e.code if isinstance(e.code, int) else 2
    claude_home = Path(args.claude_home).expanduser() if args.claude_home else default_claude_home()
    repo = Path(args.repo).expanduser() if args.repo else DEFAULT_REPO
    report = run_checks(claude_home, repo, network=not args.no_network)
    if args.json:
        print(json.dumps(report, ensure_ascii=True))
    else:
        # Ayrıntılar dış kaynaktan (kayıtlar, yollar, alt süreç çıktısı) parça taşır: terminale kontrol
        # karakteri/ANSI kaçışı olarak geçmesin (mcp_config.terminal_safe; satır yapısı korunur).
        safe = mcp_config.terminal_safe
        print("eren-kit kurulum doktoru")
        print(f"Claude dizini: {safe(claude_home)}")
        print(f"Depo: {safe(repo)}")
        for c in report["checks"]:
            print(safe(f"{_MARKS.get(c['status'], c['status'])} {c['name']}: {c['detail']}", keep_newline=True))
        print(f"Genel durum: {_OVERALL[report['status']]}")
    return EXIT[report["status"]]


if __name__ == "__main__":
    sys.exit(main())
