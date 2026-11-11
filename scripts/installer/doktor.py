"""eren-kit kurulum doktoru: kurulu bileşenlerin Claude Code'a doğru bağlanıp bağlanmadığını denetler.

    python scripts/installer/doktor.py [--json] [--claude-home DIR] [--repo DIR] [--no-network]

--claude-home  Claude Code'un kullanıcı dizini (varsayılan: CLAUDE_CONFIG_DIR, yoksa ~/.claude).
--repo         eren-kit deposu (varsayılan: bu betiğin bulunduğu depo).
--no-network   Canlı sistem sorgusu ve kullanıcı dosyalarından gelen dış süreç yok: servis sağlık
               isteği (/api/saglik), servis görevi (Görev Zamanlayıcı / launchd), "bellek doktor"
               alt süreci ve hook yorumlayıcısının sürüm yoklaması atlanır. Yalnız dosya denetimleri
               kalır (telefon:node yalnız sabit adlı "node"u çalıştırır).
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
import shutil
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


def _expand(token: str) -> Path:
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
    return shutil.which(token)


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


def _interpreter_token(cmd: str, key: str, tail: str) -> str | None:
    toks = _tokens(cmd)
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
    issues: list[tuple[str, str]] = []

    legacy = [r for r in recs if r["kind"] == "legacy"]
    ours = [r for r in recs if r["kind"] == "ours"]
    for event in dict.fromkeys(r["event"] for r in legacy):
        ev = [r for r in legacy if r["event"] == event]
        scripts = sorted({_script_token(r["command"], key, tail) or r["command"] for r in ev})
        issues.append((ERROR, f"{event}: eski konumdan {len(ev)} kayıt ({', '.join(scripts)})"))

    for event in dict.fromkeys(r["event"] for r in ours):
        ev = [r for r in ours if r["event"] == event]
        groups = sorted({r["group"] for r in ev})
        if event not in expected:
            issues.append((WARN, f"{event}: beklenmeyen olayda {len(ev)} kayıt"))
            continue
        want = len(expected[event])
        if len(groups) > 1:
            issues.append((ERROR, f"{event}: {len(groups)} grupta kayıt (beklenen 1 grup)"))
            continue
        if len(ev) > want:
            issues.append((ERROR, f"{event}: {len(ev)} kayıt (beklenen {want})"))
        elif len(ev) < want:
            issues.append((WARN, f"{event}: {len(ev)} kayıt, eksik (beklenen {want})"))
        if _m(ev[0]["matcher"]) != _m(matchers.get(event)):
            issues.append((WARN, f"{event}: eşleştirici '{_m(ev[0]['matcher']) or '(yok)'}' "
                                 f"(beklenen '{_m(matchers.get(event)) or '(yok)'}')"))
    if ours:
        present = {r["event"] for r in ours}
        for event in expected:
            if event not in present:
                m = _m(matchers.get(event))
                issues.append((WARN, f"{event}{f' ({m})' if m else ''} kaydı eksik"))

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
            issues.append((WARN, f"betik yolu göreli, denetlenemedi: {tok}"))
        elif not p.is_file():
            issues.append((ERROR, f"betik dosyası yok: {tok}"))
        elif not _under(p, ctx.repo):
            issues.append((WARN, f"kayıt başka bir depo kopyasını gösteriyor: {p} (--repo: {ctx.repo})"))

    if issues:
        status = _worst(s for s, _ in issues)
        issues.sort(key=lambda i: -_SEV[i[0]])
        return Check(name, status, "; ".join(t for _, t in issues) + ". " + FIX_HINT)
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


def _fmt_cmd(entry: dict) -> str:
    parts = [str(entry.get("command", ""))] + [str(a) for a in entry.get("args") or [] if a is not None]
    return " ".join(f'"{p}"' if any(c.isspace() for c in p) else p for p in parts)


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
    typ = str(entry.get("type") or "stdio")
    if typ != "stdio" or (not entry.get("command") and entry.get("url")):
        return Check(name, OK, f"uzak sunucu ({typ}): {entry.get('url', '?')}")
    cmd = entry.get("command")
    if not isinstance(cmd, str) or not cmd.strip():
        return Check(name, ERROR, f"kayıtta komut yok ({ctx.mcp_path}). {FIX_HINT}")
    shown = _fmt_cmd(entry)
    exe = _which(cmd)
    if exe is None:
        return Check(name, ERROR, f"komut bulunamadı: {cmd} (kayıt: {shown}). {FIX_HINT}")
    args = entry.get("args") or []
    if not isinstance(args, list):
        return Check(name, ERROR, f'kayıttaki "args" bir liste değil ({ctx.mcp_path})')
    for a in args:
        if isinstance(a, str) and a.lower().endswith(_SCRIPT_SUFFIXES):
            p = _expand(a)
            if p.is_absolute() and not p.is_file():
                return Check(name, ERROR, f"betik dosyası yok: {a} (kayıt: {shown}). {FIX_HINT}")
    owned = any(_under(_expand(str(v)), ctx.repo) for v in [cmd, *args] if isinstance(v, str) and _expand(v).is_absolute())
    note = "" if owned else " (bu --repo dışında)"
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
    return "servisi elle başlatın: python -m bellek.beyin servis"


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
            r = _run(["schtasks", "/Query", "/TN", SERVICE_TASK, "/XML"], PROBE_TIMEOUT)
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
        if args[:2] == ["-m", "bellek.beyin"] and _is_python_name(entry["command"]):
            exe = _which(entry["command"])
            env = entry.get("env") if isinstance(entry.get("env"), dict) else {}
            if exe and _is_python_name(exe):
                return exe, {str(k): str(v) for k, v in env.items()}
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
        r = _run([exe, "-B", "-m", "bellek", "doktor", "--json"], BELLEK_DOCTOR_TIMEOUT, env=env)
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
    node = shutil.which("node")
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
        print("eren-kit kurulum doktoru")
        print(f"Claude dizini: {claude_home}")
        print(f"Depo: {repo}")
        for c in report["checks"]:
            print(f"{_MARKS.get(c['status'], c['status'])} {c['name']}: {c['detail']}")
        print(f"Genel durum: {_OVERALL[report['status']]}")
    return EXIT[report["status"]]


if __name__ == "__main__":
    sys.exit(main())
