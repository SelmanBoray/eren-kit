"""eren-kit macOS kurulum betiği (install.sh tarafından çağrılır; install.ps1'in macOS karşılığı).

    ./install.sh [--components beyin,devir,kapi,orkestra] [--assistant-name AD] [--claude-home KLASÖR]
                 [--dry-run] [--uninstall] [--skip-mcp] [--no-service] [--keep-existing]
                 [--tailscale-host HOST] [--help]
    ./install.sh --doctor [--json] [--claude-home KLASÖR]   # yalnız kurulum doktoru (salt okunur)

Kurallar install.ps1 ile aynıdır:
- settings.json birleştirilir (settings_hooks.py), üzerine yazılmaz; değişen her dosya önce
  <ClaudeHome>/backups/eren-kit/<zaman>/ altına yedeklenir.
- Yeniden çalıştırmak güvenlidir: değişeni günceller, kendi kayıtlarını ikiye katlamaz.
- Kaldırma yalnız eren-kit'in kurduğunu kaldırır; venv'ler ve kullanıcı verisi silinmez.
- Aynı hook betiklerinin repo dışındaki eski kopyalarının kayıtları varsayılanda (yedekli)
  yenisiyle değiştirilir; --keep-existing korur. --replace-existing eski uyumluluk içindir.
- Gerçek kurulumun sonunda kurulum doktoru (doktor.py) bir kez çalışır; sonucu bilgi içindir,
  çıkış kodunu değiştirmez. --dry-run'da yalnız komutu yazılır.

macOS farkları:
- Beyin servisi Görev Zamanlayıcı yerine kullanıcı LaunchAgent'ı olarak çalışır
  (~/Library/LaunchAgents/com.eren-kit.beyin-servis.plist; oturum açılışında başlar).
  Servis açıkken günlük yerel beyin yedeğini de alır (~/Library/Application Support/Bellek/
  beyin_yedek); yeniden kurulum servisi yeniden yükler, böylece güncel kod devreye girer.
- Hook'lar PATH'teki "python" yerine 3.11+ bir python3'ün yoluyla kaydedilir
  (macOS'ta "python" komutu genelde yoktur).
- Asistan adı kullanıcı ortam değişkeni yerine settings.json "env" alanına (Claude Code
  oturumu, hook'lar ve MCP sunucuları görür) ve servis plist'ine yazılır.
- computer-use: macOS'ta Claude Code CLI'ın yerleşik computer-use MCP'si vardır;
  Windows sunucusu kurulmaz, etkinleştirme yolu gösterilir.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import plistlib
import re
import shutil
import subprocess
import sys
import time
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(HERE))

import mcp_config  # noqa: E402
import settings_hooks  # noqa: E402

ALL_COMPONENTS = ["beyin", "devir", "kapi", "orkestra", "computer-use", "phone"]
DEFAULT_COMPONENTS = ["beyin", "devir", "kapi", "orkestra"]
SERVICE_LABEL = "com.eren-kit.beyin-servis"
MARKER = ".eren-kit"
ENV_NAME = "EREN_KIT_ASSISTANT_NAME"
SERVICE_PORT = 47321
# Servis bu değişken "1" iken kilit/port çakışmasında 0 ile çıkar (bkz. bellek/beyin/servis.py).
CONFLICT_ENV = "BELLEK_BEYIN_CAKISMADA_TEMIZ_CIK"

P = {
    "bellek": REPO / "packages" / "bellek",
    "orkestra": REPO / "packages" / "opus-orkestra",
    "phone": REPO / "apps" / "phone",
}
P["bellek_py"] = P["bellek"] / ".venv" / "bin" / "python"
P["devir_hook"] = P["bellek"] / "src" / "bellek" / "devir" / "hook.py"
P["devir_skill"] = P["bellek"] / "skills" / "devir"
P["ork_hook"] = P["orkestra"] / "hooks" / "opus-orkestra-sessionstart.py"
P["ork_skill"] = P["orkestra"] / "skill"

# Beyin MCP'si ve servisi yorumlayıcıya "-I" ile verilir: MCP sunucusu Claude Code'un açıldığı
# (güvenilmeyebilecek) klasörde başlar; -I'siz "-m" o klasörü sys.path'in başına koyar ve oradaki
# bir "bellek" paketi bizimkinin yerine çalışır. -I ayrıca PYTHONPATH gibi ortam değişkenlerini yok
# sayar. Eski (-I'siz) kayıt yeniden kurulumda değiştirilir; doktor onu "güvensiz" diye işaretler.
# install.ps1 ile aynı argümanlar (testler ikisini karşılaştırır).
BEYIN_MCP_ARGS = ["-I", "-m", "bellek.beyin", "mcp"]
BEYIN_SERVICE_ARGS = ["-I", "-m", "bellek.beyin", "servis"]


# ---------------------------------------------------------------- çıktı

SYMBOL = {"ok": "✓", "dry": "~", "skip": "-", "warn": "!", "fail": "✗", "info": "·"}
COLOR = {"ok": "32", "dry": "36", "skip": "90", "warn": "33", "fail": "31", "info": "90"}
RANK = {"skip": 0, "ok": 1, "dry": 2, "warn": 3, "fail": 4}
_TTY = sys.stdout.isatty() and not os.environ.get("NO_COLOR")


def line(status: str, msg: str) -> None:
    sym = SYMBOL[status]
    if _TTY:
        sym = f"\033[{COLOR[status]}m{sym}\033[0m"
    # İleti dış kaynaktan (MCP kaydı, alt süreç çıktısı, yollar) parça taşıyabilir: kontrol karakteri/
    # ANSI kaçışı terminale geçmez (iletinin kendi satır yapısı korunur).
    print(f"  {sym} {mcp_config.terminal_safe(msg, keep_newline=True)}", flush=True)


def title(t: str) -> None:
    print(f"\n\033[1m{t}\033[0m" if _TTY else f"\n{t}", flush=True)


@dataclass
class Step:
    status: str
    message: str


class StepError(Exception):
    pass


# ---------------------------------------------------------------- bağlam

@dataclass
class Ctx:
    claude_home: Path
    dry_run: bool = False
    uninstall: bool = False
    skip_mcp: bool = False
    no_service: bool = False
    skip_repo_setup: bool = False
    replace_existing: bool = False
    keep_existing: bool = False
    hook_python: str = "python3"
    venv_python: str | None = None
    assistant_name: str | None = None
    tailscale_host: str | None = None
    claude_exe: str | None = None
    launch_agents: Path = field(default_factory=lambda: Path.home() / "Library" / "LaunchAgents")
    log_dir: Path = field(default_factory=lambda: Path.home() / "Library" / "Logs" / "eren-kit")
    stamp: str = field(default_factory=lambda: datetime.now().strftime("%Y%m%d-%H%M%S"))
    run: Callable[..., subprocess.CompletedProcess] = subprocess.run
    backup_used: bool = False
    venvs_done: set = field(default_factory=set)
    venvs_failed: set = field(default_factory=set)

    @property
    def settings(self) -> Path:
        return self.claude_home / "settings.json"

    @property
    def backup_dir(self) -> Path:
        return self.claude_home / "backups" / "eren-kit" / self.stamp

    def backup_path(self, rel: str) -> Path:
        self.backup_used = True
        p = self.backup_dir / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        return p


def tail(text: str, n: int = 12) -> str:
    rows = [r for r in (text or "").splitlines() if r.strip()]
    return "\n".join("      " + r for r in rows[-n:])


def run_cmd(ctx: Ctx, args: list[str], cwd: Path | None = None, timeout: float = 600) -> subprocess.CompletedProcess:
    return ctx.run(args, cwd=str(cwd) if cwd else None, capture_output=True, text=True, timeout=timeout)


# ---------------------------------------------------------------- python / venv

def python_version(exe: str) -> tuple[int, int, int] | None:
    try:
        r = subprocess.run([exe, "-c", "import sys; print('%d.%d.%d' % sys.version_info[:3])"],
                           capture_output=True, text=True, timeout=20)
    except (OSError, subprocess.TimeoutExpired):
        return None
    m = re.search(r"(\d+)\.(\d+)\.(\d+)", r.stdout)
    return (int(m[1]), int(m[2]), int(m[3])) if r.returncode == 0 and m else None


def find_python(minimum: tuple[int, int]) -> str | None:
    """PATH'te en az `minimum` olan bir python3 (çözümlenmemiş yol: brew güncellemesinde kırılmaz)."""
    names = ["python3", "python3.14", "python3.13", "python3.12", "python3.11", "python"]
    extra = ["/opt/homebrew/bin", "/usr/local/bin"]
    seen: set[str] = set()
    for name in names:
        cands = [shutil.which(name)] + [os.path.join(d, name) for d in extra]
        for c in cands:
            if not c or c in seen or not os.access(c, os.X_OK):
                continue
            seen.add(c)
            v = python_version(c)
            if v and v[:2] >= minimum:
                return c
    return None


def install_venv(ctx: Ctx, pkg: Path, label: str) -> Step:
    if ctx.skip_repo_setup:
        return Step("skip", f"venv/pip atlandı (--skip-repo-setup): {label}")
    key = str(pkg)
    if key in ctx.venvs_failed:
        raise StepError(f"venv bu çalıştırmada kurulamadı: {label} (hata yukarıda)")
    if key in ctx.venvs_done:
        if ctx.dry_run:
            return Step("dry", f"{label}: venv bu çalıştırmada zaten hazırlanacak")
        return Step("ok", f"venv bu çalıştırmada hazırlandı: {label}")
    if ctx.dry_run:
        ctx.venvs_done.add(key)
        return Step("dry", f"{label}: .venv oluşturulur/güncellenir, pip install -e çalışır")
    try:
        step = _create_venv(ctx, pkg, label)
    except BaseException:
        ctx.venvs_failed.add(key)  # başarısız kurulum "hazır" sayılmaz; sonraki bileşen de düşer
        raise
    ctx.venvs_done.add(key)
    return step


def _create_venv(ctx: Ctx, pkg: Path, label: str) -> Step:
    py = pkg / ".venv" / "bin" / "python"
    if not ctx.venv_python:
        raise StepError("venv için Python 3.12+ bulunamadı (brew install python@3.13)")
    if not py.exists():
        r = run_cmd(ctx, [ctx.venv_python, "-m", "venv", str(pkg / ".venv")])
        if r.returncode != 0:
            raise StepError(f"venv oluşturulamadı:\n{tail(r.stdout + r.stderr)}")
    line("info", f"pip install -e ({label}) çalışıyor...")
    r = run_cmd(ctx, [str(py), "-m", "pip", "install", "-q", "--disable-pip-version-check", "-e", str(pkg)])
    if r.returncode != 0:
        raise StepError(f"pip install başarısız:\n{tail(r.stdout + r.stderr)}")
    return Step("ok", f"venv hazır: {label}/.venv")


# ---------------------------------------------------------------- skill

def _skill_files(src: Path, files: list[str] | None) -> list[str]:
    if files:
        return list(files)
    return sorted(str(p.relative_to(src)) for p in src.rglob("*") if p.is_file())


def _sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def skill_identical(src: Path, dest: Path, files: list[str]) -> bool:
    if not dest.is_dir():
        return False
    have = sorted(str(p.relative_to(dest)) for p in dest.rglob("*") if p.is_file() and p.name != MARKER)
    if have != sorted(files):
        return False
    return all(_sha(src / f) == _sha(dest / f) for f in files)


def _write_marker(dest: Path, component: str, src: Path) -> None:
    data = {"installedBy": "eren-kit", "component": component, "source": str(src),
            "installedAt": datetime.now().isoformat(timespec="seconds")}
    (dest / MARKER).write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def _backup_and_remove(ctx: Ctx, path: Path, rel: str) -> None:
    bk = ctx.backup_path(rel)
    shutil.copytree(path, bk, dirs_exist_ok=True)
    src_files = sorted(str(p.relative_to(path)) for p in path.rglob("*") if p.is_file())
    bk_files = sorted(str(p.relative_to(bk)) for p in bk.rglob("*") if p.is_file())
    if not set(src_files) <= set(bk_files):
        raise StepError(f"yedek eksik, {path} silinmedi")
    shutil.rmtree(path)


def install_skill(ctx: Ctx, component: str, name: str, src: Path, files: list[str] | None = None) -> Step:
    if not src.is_dir():
        raise StepError(f"skill kaynağı bulunamadı: {src}")
    lst = _skill_files(src, files)
    for f in lst:
        if not (src / f).is_file():
            raise StepError(f"skill dosyası bulunamadı: {src / f}")
    dest = ctx.claude_home / "skills" / name
    shown = f"skills/{name}"
    if skill_identical(src, dest, lst):
        if not ctx.dry_run and not (dest / MARKER).exists():
            _write_marker(dest, component, src)
        return Step("ok", f"skill güncel: {shown}")
    exists = dest.exists()
    if ctx.dry_run:
        return Step("dry", f"skill {'yedeklenip yenilenir' if exists else 'kopyalanır'}: {shown}")
    note = ""
    if exists:
        _backup_and_remove(ctx, dest, f"skills/{name}")
        note = " (eskisi yedeklendi)"
    for f in lst:
        (dest / f).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src / f, dest / f)
    _write_marker(dest, component, src)
    return Step("ok", f"skill kopyalandı: {shown}{note}")


def uninstall_skill(ctx: Ctx, name: str, src: Path, files: list[str] | None = None) -> Step:
    dest = ctx.claude_home / "skills" / name
    shown = f"skills/{name}"
    if not dest.exists():
        return Step("skip", f"skill zaten yok: {shown}")
    ours = (dest / MARKER).exists() or (src.is_dir() and skill_identical(src, dest, _skill_files(src, files)))
    if not ours:
        return Step("warn", f"{shown} eren-kit tarafından kurulmamış ya da elle değiştirilmiş; dokunulmadı")
    if ctx.dry_run:
        return Step("dry", f"skill yedeklenip kaldırılır: {shown}")
    _backup_and_remove(ctx, dest, f"skills/{name}")
    return Step("ok", f"skill kaldırıldı: {shown} (yedeği alındı)")


# ---------------------------------------------------------------- settings.json (hook + env)

def settings_hooks_step(ctx: Ctx, component: str) -> Step:
    ns = argparse.Namespace(
        settings=str(ctx.settings), repo=str(REPO), components=component,
        uninstall=ctx.uninstall, dry_run=ctx.dry_run,
        replace_legacy=ctx.replace_existing and not ctx.keep_existing, keep_legacy=ctx.keep_existing,
        backup_dir=str(ctx.backup_dir), python=ctx.hook_python)
    try:
        rep = settings_hooks.run(ns)
    except Exception as e:  # noqa: BLE001
        raise StepError(f"settings.json güncellenemedi: {type(e).__name__}: {e}") from e
    if rep.get("backup"):
        ctx.backup_used = True
    c = rep["components"][component]
    legacy = c.get("legacy") or []
    if ctx.uninstall:
        if not c["removed"]:
            return Step("skip", f"{component} hook'u settings.json'da yok")
        st = "dry" if ctx.dry_run else "ok"
        return Step(st, f"{component} hook'ları {'kaldırılır' if ctx.dry_run else 'kaldırıldı'} ({c['removed']})")
    if not rep["changed"]:
        st, msg = "ok", f"{component} hook'ları güncel"
    elif ctx.dry_run:
        st, msg = "dry", f"{component} hook'ları settings.json'a yazılır ({c['added']})"
    else:
        st, msg = "ok", f"{component} hook'ları kaydedildi ({c['added']}, yorumlayıcı: {ctx.hook_python})"
    if c.get("legacy_removed"):
        msg += (f"; repo dışındaki eski kopyanın {c['legacy_removed']} hook kaydı "
                f"{'kaldırılır (yedek alınarak; korumak için --keep-existing)' if ctx.dry_run else 'kaldırıldı (yedekli)'}")
    if legacy:
        st = "warn"
        msg += (f"; repo dışında eski kopya hook'u da kayıtlı (--keep-existing: dokunulmadı): "
                f"{legacy[0]}; iki kez çalışır, kaldırmak için --keep-existing olmadan yeniden çalıştır")
    # Bileşenin kendi olayları dışındaki bizim/eski kopya kayıtları: dokunulmaz, yalnız bildirilir.
    # Alan eski settings_hooks.py sürümünde yoktur; o zaman hiçbir şey yazılmaz.
    other = [o for o in (c.get("other_events") or []) if isinstance(o, dict)]
    if other:
        for o in other:
            line("warn", f"{o.get('event')} olayında beklenmeyen kayıt: {o.get('command')}")
        st = "warn"
        msg += (f"; {len(other)} kayıt bileşenin olayları dışında duruyor: kurulum bu kayda dokunmadı; "
                f"gerekmiyorsa settings.json'dan elle kaldırın")
    return Step(st, msg)


def settings_env_step(ctx: Ctx, name: str | None) -> Step:
    """settings.json "env" alanına EREN_KIT_ASSISTANT_NAME yazar (verilmezse mevcut korunur)."""
    data, existed = settings_hooks.load(str(ctx.settings))
    env = data.get("env", {})
    if not isinstance(env, dict):
        raise StepError('settings.json "env" alanı bir JSON nesnesi değil')
    current = env.get(ENV_NAME)
    target = name or current or "Claude"
    if current == target:
        return Step("ok", f'{ENV_NAME} = "{target}" (zaten ayarlı)')
    if ctx.dry_run:
        return Step("dry", f'{ENV_NAME} = "{target}" settings.json "env" alanına yazılır')
    if existed:
        dest = ctx.backup_path("settings.json")
        if not dest.exists():
            shutil.copy2(ctx.settings, dest)
    new = dict(data)
    new["env"] = {**env, ENV_NAME: target}
    settings_hooks.write_atomic(str(ctx.settings), new)
    return Step("ok", f'{ENV_NAME} = "{target}" (settings.json env)')


def current_assistant_name(ctx: Ctx) -> str | None:
    try:
        data, _ = settings_hooks.load(str(ctx.settings))
    except Exception:  # noqa: BLE001
        return None
    env = data.get("env")
    return env.get(ENV_NAME) if isinstance(env, dict) else None


# ---------------------------------------------------------------- MCP

def _entry_owned(entry) -> bool:
    if not isinstance(entry, dict):
        return False
    root = str(REPO).rstrip("/") + "/"
    args = entry.get("args")
    vals = [entry.get("command")] + (args if isinstance(args, list) else [])
    return any(isinstance(v, str) and v.startswith(root) for v in vals)


def _entry_same(entry: dict | None, cmd: list[str]) -> bool:
    """Kayıt istenen komutla aynı mı? env karşılaştırılmaz: kurulum env yazmaz, var olanı korur."""
    if not entry:
        return False
    if entry.get("type") not in (None, "stdio"):
        return False
    return [entry.get("command")] + list(entry.get("args") or []) == cmd


def _carry_over(entry: dict | None, cmd: list[str]) -> tuple[list[str], dict] | None:
    """Eski kayıttan yeni kayda taşınacak (kullanıcının ek argümanları, env); install.ps1
    Get-McpCarryOver ile aynı kural. Eski kayıt aynı programı (dosya adı) çalıştırıyor VE
    argümanları bizimkilerle (ya da "-I" olmadan yazılmış eski biçimiyle) başlıyorsa kalan
    argümanlar kullanıcınındır. Biçim tanınmazsa None: hiçbir şey taşınmaz."""
    if not entry or entry.get("type") not in (None, "stdio") or not isinstance(entry.get("command"), str):
        return None
    if Path(entry["command"]).name != Path(cmd[0]).name:
        return None
    have = [str(a) for a in entry.get("args") or []]
    want = list(cmd[1:])
    variants = [want] + ([[a for a in want if a != "-I"]] if "-I" in want else [])
    env = entry.get("env") if isinstance(entry.get("env"), dict) else {}
    for v in variants:
        if have[: len(v)] == v:
            return have[len(v):], {str(k): str(val) for k, val in env.items()}
    return None


def _carry_text(extra: list[str], env: dict) -> str:
    """Taşınanların kısa açıklaması: argümanlar yalnız sayıyla, env yalnız adlarıyla (sır olabilir)."""
    parts = ([f"ek argümanlar ({len(extra)} adet; değerleri yazılmaz)"] if extra else []) \
        + ([f"env: {', '.join(mcp_config.terminal_safe(k) for k in env)}"] if env else [])
    return f"; korunan {'; '.join(parts)}" if parts else ""


def _mcp_get(name: str):
    """Kayıt; yoksa None. null değer "yok" sayılır (claude da öyle sayar). Nesne olmayan değer (5, "x",
    [], {}) olduğu gibi döner: "yok" değildir (claude add-json "already exists" der) ve
    mcp_config.entry_problems onu geçersiz sayar; Windows ve doktor ile aynı karar."""
    path = mcp_config.default_config()
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8-sig") as f:
        data = json.load(f)
    servers = data.get("mcpServers") if isinstance(data, dict) else None
    return servers.get(name) if isinstance(servers, dict) else None


def _mcp_backup(ctx: Ctx, name: str, entry) -> Path:
    """Kaydı claude'a dokunmadan önce yedekler: claude'un bugün ya da ileride reddettiği bir değer olsa
    da yedekte birebir kalır (elle yazılmış hiçbir değer geri getirilemez biçimde kaybolmaz)."""
    bk = ctx.backup_path(f"mcp/{name}.json")
    bk.write_text(json.dumps({"name": name, "scope": "user", "entry": entry}, indent=2) + "\n", encoding="utf-8")
    return bk


def _fmt(cmd: list[str]) -> str:
    return " ".join(f'"{c}"' if " " in c else c for c in cmd)


def mcp_register(ctx: Ctx, name: str, cmd: list[str]) -> Step:
    manual = f"claude mcp add {name} -s user -- {_fmt(cmd)}"
    if ctx.skip_mcp:
        return Step("skip", "MCP kaydı atlandı (--skip-mcp)")
    if not ctx.claude_exe:
        return Step("warn", f"claude CLI yok, MCP kaydı atlandı. Sonra elle: {manual}")
    old = _mcp_get(name)
    # Elle düzenlenmiş kayıtta dize olmayan değer (ör. "env": {"PORT": 8080}): Claude Code kaydı zaten
    # yok sayıyor ve "add-json" onu geri yüklemeyi reddeder. Sessizce dönüştürmek (True -> "True",
    # null -> "None") ya da silmek yerine dokunmadan dur.
    bad = mcp_config.entry_problems(old)
    if bad:
        why = mcp_config.problem_text(name, bad)
        if ctx.dry_run:
            return Step("warn", f'MCP: "{name}" kaydedilemeyecek, hiçbir şey değiştirilmeyecek: {why}')
        raise StepError(f"MCP kaydı yapılmadı, hiçbir şey değiştirilmedi: {why}")
    # Kullanıcının eski kayda eklediği argümanlar ve env yeni kayda taşınır (sessizce düşmez).
    carry = _carry_over(old, cmd)
    extra, env = carry if carry else ([], {})
    kept = _carry_text(extra, env)
    lost = ""
    if old is not None and carry is None:
        old_env = old.get("env") if isinstance(old.get("env"), dict) else {}
        lost = (f"; DİKKAT: eski kaydın env değerleri ({', '.join(mcp_config.terminal_safe(k) for k in old_env)}) "
                "ve argümanları yeni kayda "
                "TAŞINMAZ, yalnız yedekte kalır" if old_env else
                "; DİKKAT: eski kaydın argümanları yeni kayda TAŞINMAZ, yalnız yedekte kalır")
    # Ekranda yalnız bizim komutumuz (shown); taşınan argümanlar kept'te sayıyla geçer. Eski kayıt
    # mcp_config.describe_entry kuralıyla (Windows Format-McpEntry ile aynı): yalnız bilinen önek
    # argümanlar, uzak adresin yalnız şema://sunucu[:port] kısmı.
    shown = _fmt(cmd)
    old_text = mcp_config.describe_entry(old, len(old.get("args") or []) - len(extra) if carry else 0) \
        if old is not None else ""
    cmd = [*cmd, *extra]
    if carry is not None and _entry_same(old, cmd):
        return Step("ok", f"MCP zaten kayıtlı: {name}{kept}")
    env_args = [a for k, v in env.items() for a in ("-e", f"{k}={v}")]
    foreign = old is not None and not _entry_owned(old)
    if ctx.dry_run:
        if foreign:
            return Step("warn", f'MCP: "{name}" şu an repo DIŞINI gösteriyor ve değiştirilecek (eski: {old_text}; '
                                f"yedeklenir) -> {shown}{kept}{lost}")
        if old is not None and lost:
            return Step("warn", f"MCP: güncellenir: {shown}{lost}")
        if old is not None:
            # Elle komut önerilmez: taşınan argüman/env değerleri ekrana yazılmadan verilemez.
            return Step("dry", f"MCP: güncellenir (eski kayıt yedeklenir) -> {shown}{kept}")
        return Step("dry", f"MCP: eklenir: {manual}")
    if not Path(cmd[0]).exists():
        raise StepError(f"MCP sunucu programı yok: {cmd[0]}")
    bk = None
    if old is not None:
        bk = _mcp_backup(ctx, name, old)
        r = run_cmd(ctx, [ctx.claude_exe, "mcp", "remove", name, "-s", "user"], timeout=60)
        if r.returncode != 0:
            raise StepError(f"eski MCP kaydı kaldırılamadı; hiçbir şey değişmedi:\n{tail(r.stdout + r.stderr)}")
    r = run_cmd(ctx, [ctx.claude_exe, "mcp", "add", name, "-s", "user", *env_args, "--", *cmd], timeout=60)
    if r.returncode != 0:
        why = f"MCP kaydı başarısız:\n{tail(r.stdout + r.stderr)}"
        if old is not None:
            rr = run_cmd(ctx, [ctx.claude_exe, "mcp", "add-json", name, json.dumps(old), "-s", "user"], timeout=60)
            why += "\n      eski kayıt geri yüklendi" if rr.returncode == 0 else f"\n      eski kayıt GERİ YÜKLENEMEDİ; yedek: {bk}"
        raise StepError(why)
    if foreign:
        return Step("warn", f"MCP kaydedildi: {name}; repo dışını gösteren eski kayıt değiştirildi (eski: {old_text}; "
                            f"yedek: {bk}){kept}{lost}")
    if old is not None and lost:
        return Step("warn", f"MCP güncellendi: {name} (yedek: {bk}){lost}")
    if old is not None:
        return Step("ok", f"MCP güncellendi: {name} (kullanıcı kapsamı; eski kaydın yedeği: {bk}){kept}")
    return Step("ok", f"MCP kaydedildi: {name} (kullanıcı kapsamı){kept}")


def mcp_unregister(ctx: Ctx, name: str) -> Step:
    if ctx.skip_mcp:
        return Step("skip", "MCP kaldırma atlandı (--skip-mcp)")
    if not ctx.claude_exe:
        return Step("warn", f"claude CLI yok; sonra elle: claude mcp remove {name} -s user")
    old = _mcp_get(name)
    if old is None:
        return Step("skip", f"MCP kaydı yok: {name}")
    old_text = mcp_config.describe_entry(old, 0)
    owned = _entry_owned(old)
    # Geçersiz kayıt (Claude Code zaten yok sayıyor): kurmadaki gibi dokunulmaz. Depoyu gösteriyorsa
    # elle silme komutu söylenir; başka bir programı gösteriyorsa kullanıcınındır, silme önerilmez.
    bad = mcp_config.entry_problems(old)
    if bad:
        if not owned:
            return Step("warn", mcp_config.foreign_problem_text(name, old_text, bad))
        return Step("warn", mcp_config.unregister_problem_text(name, bad))
    if not owned:
        return Step("warn", f'MCP kaydı "{name}" bu repoyu göstermiyor ({old_text}); dokunulmadı')
    if ctx.dry_run:
        return Step("dry", f"MCP: claude mcp remove {name} -s user ({old_text}; eski kayıt yedeklenir)")
    # Silmeden önce yedek: bu denetimin bilmediği (ya da claude'un ileride reddetmeye başladığı) bir alan
    # olsa da elle yazılmış hiçbir değer geri getirilemez biçimde kaybolmaz.
    bk = _mcp_backup(ctx, name, old)
    r = run_cmd(ctx, [ctx.claude_exe, "mcp", "remove", name, "-s", "user"], timeout=60)
    if r.returncode != 0:
        raise StepError(f"MCP kaydı kaldırılamadı; kayıt yerinde:\n{tail(r.stdout + r.stderr)}")
    return Step("ok", f"MCP kaydı kaldırıldı: {name} (yedek: {bk})")


# ---------------------------------------------------------------- launchd servisi

def service_plist(ctx: Ctx) -> dict:
    env = {"PYTHONUNBUFFERED": "1", CONFLICT_ENV: "1"}
    name = ctx.assistant_name or current_assistant_name(ctx)
    if name:
        env[ENV_NAME] = name
    host = ctx.tailscale_host
    if host is None:  # bayrak verilmedi: mevcut plist'teki değer korunur (iPhone erişimi sessizce kapanmaz)
        try:
            with open(_plist_path(ctx), "rb") as f:
                host = plistlib.load(f).get("EnvironmentVariables", {}).get("BELLEK_BEYIN_IZINLI_HOST")
        except (OSError, plistlib.InvalidFileException, AttributeError):
            host = None
    if host:
        env["BELLEK_BEYIN_IZINLI_HOST"] = host
    return {
        "Label": SERVICE_LABEL,
        "ProgramArguments": [str(P["bellek_py"]), *BEYIN_SERVICE_ARGS],
        "WorkingDirectory": str(P["bellek"]),
        "EnvironmentVariables": env,
        "RunAtLoad": True,
        # Çökmede yeniden başlar: sıfır olmayan çıkış (yakalanmamış istisna, sys.exit(1)) ve
        # sinyal. Port/kilit başka bir süreçteyse servis CONFLICT_ENV sayesinde 0 ile çıkar; böylece
        # launchd 30 sn'de bir sonsuza dek yeniden denemez.
        "KeepAlive": {"SuccessfulExit": False, "Crashed": True},
        "ThrottleInterval": 30,
        "ProcessType": "Background",
        "StandardOutPath": str(ctx.log_dir / "beyin-servis.log"),
        "StandardErrorPath": str(ctx.log_dir / "beyin-servis.log"),
    }


def _plist_path(ctx: Ctx) -> Path:
    return ctx.launch_agents / f"{SERVICE_LABEL}.plist"


def _health(port: int = SERVICE_PORT, timeout: float = 1.5) -> bool:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/saglik", timeout=timeout) as r:
            return r.status == 200
    except Exception:  # noqa: BLE001
        return False


def service_install(ctx: Ctx) -> Step:
    if ctx.no_service:
        return Step("skip", "servis atlandı (--no-service)")
    if ctx.skip_repo_setup:
        return Step("skip", "servis atlandı (--skip-repo-setup)")
    path = _plist_path(ctx)
    data = plistlib.dumps(service_plist(ctx))
    same = path.exists() and path.read_bytes() == data
    if ctx.dry_run:
        return Step("dry", f"LaunchAgent {'güncel, yeniden başlatılır' if same else 'yazılır'}: {path}")
    if path.exists() and not same:
        shutil.copy2(path, ctx.backup_path(f"launchd/{path.name}"))
    ctx.launch_agents.mkdir(parents=True, exist_ok=True)
    ctx.log_dir.mkdir(parents=True, exist_ok=True)
    if not same:
        tmp = path.with_suffix(".tmp")
        tmp.write_bytes(data)
        os.replace(tmp, path)
    return _reload_service(ctx, path)


def _reload_service(ctx: Ctx, path: Path) -> Step:
    ctx.log_dir.mkdir(parents=True, exist_ok=True)  # plist'teki günlük yolu launchd'den önce var olmalı
    domain = f"gui/{os.getuid()}"
    run_cmd(ctx, ["launchctl", "bootout", f"{domain}/{SERVICE_LABEL}"], timeout=30)  # yoksa hata: önemsiz
    for _ in range(25):  # bootout eşzamansız: servis domain'den düşene kadar bekle (en çok ~5 sn)
        if run_cmd(ctx, ["launchctl", "print", f"{domain}/{SERVICE_LABEL}"], timeout=10).returncode != 0:
            break
        time.sleep(0.2)
    r = None
    for _ in range(5):  # bootout eşzamansız bitebilir: bootstrap kısa süre "5: I/O error" verebilir
        r = run_cmd(ctx, ["launchctl", "bootstrap", domain, str(path)], timeout=30)
        if r.returncode == 0:
            break
        time.sleep(1)
    if r is None or r.returncode != 0:
        raise StepError(f"launchctl bootstrap başarısız:\n{tail((r.stdout + r.stderr) if r else '')}")
    for _ in range(20):
        if _health():
            return Step("ok", f"beyin servisi çalışıyor (launchd: {SERVICE_LABEL}, 127.0.0.1:{SERVICE_PORT})")
        time.sleep(0.5)
    return Step("warn", f"LaunchAgent yüklendi ama /api/saglik yanıt vermedi; günlük: {ctx.log_dir / 'beyin-servis.log'}")


def service_name_sync(ctx: Ctx) -> Step:
    """Beyin bileşeni kurulmadan ad değişirse kurulu plist'teki adı yeniler (plist yoksa yazmaz)."""
    if ctx.no_service:
        return Step("skip", "servis atlandı (--no-service)")
    path = _plist_path(ctx)
    if not path.exists():
        return Step("skip", "LaunchAgent kurulu değil; servis adı güncellenmedi")
    name = ctx.assistant_name or current_assistant_name(ctx)
    if not name:
        return Step("skip", "asistan adı bilinmiyor; LaunchAgent'a dokunulmadı")
    try:
        data = plistlib.loads(path.read_bytes())
        env = data.setdefault("EnvironmentVariables", {})
        if not isinstance(env, dict):
            raise ValueError("EnvironmentVariables bir sözlük değil")
    except (OSError, ValueError, plistlib.InvalidFileException, AttributeError) as e:
        return Step("warn", f"LaunchAgent okunamadı, servisteki ad güncellenmedi ({type(e).__name__}): {path}")
    if env.get(ENV_NAME) == name:
        return Step("ok", f'servis adı güncel: "{name}"')
    if ctx.dry_run:
        return Step("dry", f"LaunchAgent'taki ad \"{name}\" olarak güncellenir, servis yeniden yüklenir: {path}")
    env[ENV_NAME] = name
    shutil.copy2(path, ctx.backup_path(f"launchd/{path.name}"))
    tmp = path.with_suffix(".tmp")
    tmp.write_bytes(plistlib.dumps(data))
    os.replace(tmp, path)
    r = _reload_service(ctx, path)
    return Step(r.status, f'servis adı "{name}" olarak güncellendi; {r.message}')


def service_uninstall(ctx: Ctx) -> Step:
    if ctx.no_service:
        return Step("skip", "servis atlandı (--no-service)")
    path = _plist_path(ctx)
    if not path.exists():
        return Step("skip", f"LaunchAgent yok: {path.name}")
    if ctx.dry_run:
        return Step("dry", f"LaunchAgent durdurulup kaldırılır: {path}")
    run_cmd(ctx, ["launchctl", "bootout", f"gui/{os.getuid()}/{SERVICE_LABEL}"], timeout=30)
    shutil.copy2(path, ctx.backup_path(f"launchd/{path.name}"))
    path.unlink()
    return Step("ok", f"LaunchAgent durduruldu ve kaldırıldı ({SERVICE_LABEL})")


# ---------------------------------------------------------------- bileşen adımları

def copy_config(ctx: Ctx) -> Step:
    cfg, ex = P["bellek"] / "bellek.toml", P["bellek"] / "bellek.example.toml"
    if cfg.exists():
        return Step("ok", "bellek.toml var, korunuyor")
    if not ex.exists():
        raise StepError(f"repoda beklenen dosya yok: {ex}")
    if ctx.skip_repo_setup:
        return Step("skip", "bellek.toml kopyalama atlandı (--skip-repo-setup)")
    if ctx.dry_run:
        return Step("dry", "bellek.example.toml -> bellek.toml kopyalanır")
    shutil.copy2(ex, cfg)
    return Step("ok", f"bellek.toml oluşturuldu: {cfg} (vault yolunu kendine göre düzenle)")


def import_check(ctx: Ctx) -> Step:
    if ctx.dry_run or ctx.skip_repo_setup:
        return Step("skip", "import denetimi atlandı")
    r = run_cmd(ctx, [str(P["bellek_py"]), "-c", "import bellek.beyin"], timeout=60)
    if r.returncode != 0:
        raise StepError(f"bellek.beyin içe aktarılamadı:\n{tail(r.stdout + r.stderr)}")
    return Step("ok", "bellek.beyin içe aktarılıyor")


def hook_python_step(ctx: Ctx) -> Step:
    v = python_version(ctx.hook_python)
    if v and v[:2] >= (3, 11):
        return Step("ok", f"hook yorumlayıcısı: {ctx.hook_python} ({'.'.join(map(str, v))})")
    raise StepError(f"hook'lar için Python 3.11+ gerekli ({ctx.hook_python}); brew install python@3.13")


def computer_use_info(ctx: Ctx) -> Step:
    if ctx.uninstall:
        return Step("skip", "macOS'ta kaldırılacak computer-use kaydı yok")
    return Step("warn", "macOS'ta Windows sunucusu kurulmaz: Claude Code'un yerleşik computer-use'unu kullan "
                        "(oturumda /mcp -> computer-use -> Enable; Erişilebilirlik + Ekran Kaydı izni; Pro/Max planı)")


def phone_steps(ctx: Ctx) -> list[Callable[[], Step]]:
    def node() -> Step:
        exe = shutil.which("node")
        npm = shutil.which("npm")
        if not exe or not npm:
            raise StepError("Node 24+ ve npm gerekli (brew install node)")
        r = run_cmd(ctx, [exe, "--version"], timeout=20)
        m = re.match(r"v(\d+)", r.stdout.strip())
        if not m or int(m[1]) < 24:
            raise StepError(f"Node {r.stdout.strip() or '?'} çok eski, 24+ gerekli")
        return Step("ok", f"Node {r.stdout.strip()}, npm ({npm})")

    def npm_ci() -> Step:
        if ctx.skip_repo_setup:
            return Step("skip", "npm ci atlandı (--skip-repo-setup)")
        if ctx.dry_run:
            return Step("dry", "apps/phone içinde npm ci çalıştırılır")
        line("info", "npm ci (apps/phone) çalışıyor...")
        r = run_cmd(ctx, [shutil.which("npm") or "npm", "ci", "--no-audit", "--no-fund"], cwd=P["phone"])
        if r.returncode != 0:
            raise StepError(f"npm ci başarısız:\n{tail(r.stdout + r.stderr)}")
        return Step("ok", "bağımlılıklar kuruldu (apps/phone)")

    return [node, npm_ci, lambda: Step("warn", "phone deneyseldir; herhangi bir kayıt yapılmaz, elle başlatılır.")]


def build_steps(ctx: Ctx) -> dict[str, list[Callable[[], Step]]]:
    beyin_cmd = [str(P["bellek_py"]), *BEYIN_MCP_ARGS]
    if ctx.uninstall:
        return {
            "beyin": [lambda: mcp_unregister(ctx, "beyin"), lambda: service_uninstall(ctx)],
            "devir": [lambda: settings_hooks_step(ctx, "devir"),
                      lambda: uninstall_skill(ctx, "devir", P["devir_skill"])],
            "kapi": [lambda: settings_hooks_step(ctx, "kapi")],
            "orkestra": [lambda: settings_hooks_step(ctx, "orkestra"),
                         lambda: uninstall_skill(ctx, "opus-orkestra", P["ork_skill"], ["SKILL.md"])],
            "computer-use": [lambda: computer_use_info(ctx)],
            "phone": [lambda: Step("skip", "phone için kaldırılacak kayıt yok (node_modules silinmez)")],
        }
    return {
        "beyin": [lambda: install_venv(ctx, P["bellek"], "packages/bellek"), lambda: copy_config(ctx),
                  lambda: import_check(ctx), lambda: service_install(ctx),
                  lambda: mcp_register(ctx, "beyin", beyin_cmd)],
        "devir": [lambda: install_venv(ctx, P["bellek"], "packages/bellek"), lambda: hook_python_step(ctx),
                  lambda: settings_hooks_step(ctx, "devir"),
                  lambda: install_skill(ctx, "devir", "devir", P["devir_skill"])],
        "kapi": [lambda: hook_python_step(ctx), lambda: settings_hooks_step(ctx, "kapi")],
        "orkestra": [lambda: hook_python_step(ctx),
                     lambda: install_skill(ctx, "orkestra", "opus-orkestra", P["ork_skill"], ["SKILL.md"]),
                     lambda: settings_hooks_step(ctx, "orkestra")],
        "computer-use": [lambda: computer_use_info(ctx)],
        "phone": phone_steps(ctx),
    }


TITLES = {"beyin": "Beyin (bellek + MCP + launchd servisi)", "devir": "Devir (hook + skill)",
          "kapi": "Belge kapısı (PreToolUse hook)",
          "orkestra": "Opus Orkestra (skill + hook)", "computer-use": "Computer use",
          "phone": "Phone (deneysel)"}


def run_component(key: str, steps: list[Callable[[], Step]]) -> tuple[str, str]:
    title(f"[{key}] {TITLES[key]}")
    status, note = "skip", ""
    for fn in steps:
        try:
            r = fn()
        except StepError as e:
            line("fail", str(e))
            return "fail", str(e).splitlines()[0]
        except Exception as e:  # noqa: BLE001
            line("fail", f"{type(e).__name__}: {e}")
            return "fail", f"{type(e).__name__}"
        line(r.status, r.message)
        if RANK[r.status] > RANK[status]:
            status = r.status
            if r.status == "warn":
                note = r.message
    return status, note


# ---------------------------------------------------------------- kurulum doktoru

DOCTOR = HERE / "doktor.py"
DOCTOR_TIMEOUT = 180


def doctor_command(claude_home: Path | str | None, as_json: bool = False) -> list[str] | None:
    """Doktoru çalıştıran komut; doktor.py yoksa None. -B: depoda __pycache__ bırakmaz."""
    if not DOCTOR.is_file():
        return None
    cmd = [sys.executable, "-I", "-B", str(DOCTOR)]
    if claude_home:
        cmd += ["--claude-home", str(claude_home)]
    if as_json:
        cmd.append("--json")
    return cmd


def run_doctor_only(claude_home: str | None, as_json: bool, dry_run: bool) -> int:
    """--doctor: yalnız doktor çalışır; çıktısı olduğu gibi akar, çıkış kodu doktorunkidir."""
    cmd = doctor_command(claude_home, as_json)
    if cmd is None:
        print(f"Kurulum doktoru bulunamadı: {DOCTOR}", file=sys.stderr)
        return 2
    if dry_run:
        print(f"dry-run: kurulum doktoru çalıştırılmadı. Çalıştırılacak komut: {_fmt(cmd)}")
        return 0
    try:
        return subprocess.run(cmd, check=False).returncode
    except OSError as e:
        print(f"Kurulum doktoru çalıştırılamadı: {e}", file=sys.stderr)
        return 2


def post_install_doctor(ctx: Ctx) -> None:
    """Gerçek kurulumun sonunda doktoru bir kez çalıştırır. Yalnız bilgi verir: sonucu kurulumun
    çıkış kodunu değiştirmez; doktor yoksa ya da çökerse sessizce uyarıp geçer."""
    title("Kurulum doktoru")
    cmd = doctor_command(ctx.claude_home)
    if cmd is None:
        line("skip", f"doktor bulunamadı: {DOCTOR}")
        return
    if ctx.dry_run:
        line("dry", f"kurulumdan sonra doktor çalıştırılır: {_fmt(cmd)}")
        return
    try:
        r = ctx.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace",
                    timeout=DOCTOR_TIMEOUT)
    except Exception as e:  # noqa: BLE001 - doktor kurulumu asla düşürmez
        line("warn", f"doktor çalıştırılamadı ({type(e).__name__}: {e}); kurulumu etkilemez. Elle: ./install.sh --doctor")
        return
    for row in ((r.stdout or "") + (r.stderr or "")).splitlines():
        if row.strip():
            print(f"    {mcp_config.terminal_safe(row)}", flush=True)
    if r.returncode == 0:
        line("ok", "doktor: her şey yolunda")
    elif r.returncode == 1:
        line("warn", "doktor uyarı buldu (yukarıda); kurulum yine de tamamlandı. Yeniden denetim: ./install.sh --doctor")
    elif r.returncode == 2:
        line("warn", "doktor hata buldu (yukarıda); kurulum adımları yine de bitti. Yeniden denetim: ./install.sh --doctor")
    else:
        line("warn", f"doktor beklenmedik biçimde bitti (çıkış {r.returncode}); kurulumu etkilemez. Elle: ./install.sh --doctor")


# ---------------------------------------------------------------- giriş

def parse(argv: list[str] | None) -> argparse.Namespace:
    p = argparse.ArgumentParser(prog="install.sh", description="eren-kit macOS kurulumu")
    p.add_argument("--components", default=",".join(DEFAULT_COMPONENTS),
                   help=f"virgülle: {', '.join(ALL_COMPONENTS)} (varsayılan: {', '.join(DEFAULT_COMPONENTS)})")
    p.add_argument("--assistant-name")
    p.add_argument("--claude-home")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--uninstall", action="store_true")
    p.add_argument("--skip-mcp", action="store_true")
    p.add_argument("--no-service", action="store_true")
    legacy = p.add_mutually_exclusive_group()
    legacy.add_argument("--keep-existing", action="store_true",
                        help="aynı hook betiklerinin repo dışındaki eski kopyalarının settings.json kayıtlarını "
                             "koru (verilmezse yedek alınarak yenisiyle değiştirilir)")
    legacy.add_argument("--replace-existing", action="store_true",
                        help="eski uyumluluk: eski kopyaların değiştirilmesi artık varsayılan, etkisi yok")
    p.add_argument("--doctor", action="store_true",
                   help="kurulum yapmaz; yalnız kurulum doktorunu (salt okunur) çalıştırır ve onun çıkış "
                        "koduyla çıkar (0 tamam, 1 uyarı, 2 hata); --claude-home doktora geçirilir")
    p.add_argument("--json", action="store_true", help="--doctor ile: doktor çıktısını JSON olarak ver")
    p.add_argument("--skip-repo-setup", action="store_true", help=argparse.SUPPRESS)
    p.add_argument("--tailscale-host",
                   help="beyin web arayüzüne iPhone/iPad'den erişim için izinli Host (ör. mac.tailnet.ts.net); "
                        "verilmezse mevcut değer korunur, \"\" verilirse kaldırılır")
    p.add_argument("--hook-python", help=argparse.SUPPRESS)
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    a = parse(argv)
    if a.json and not a.doctor:
        print("--json yalnız --doctor ile kullanılır.", file=sys.stderr)
        return 2
    if a.doctor:  # doktor platformdan bağımsızdır ve salt okunurdur; kurulum yapılmaz
        return run_doctor_only(a.claude_home, a.json, a.dry_run)
    if sys.platform != "darwin" and not os.environ.get("EREN_KIT_FORCE_MACOS"):
        print("Bu betik macOS içindir. Windows'ta install.ps1 kullan.", file=sys.stderr)
        return 2
    selected: list[str] = []
    for part in a.components.split(","):
        k = part.strip().lower()
        if not k:
            continue
        if k not in ALL_COMPONENTS:
            print(f"Bilinmeyen bileşen: '{k}'. Geçerli olanlar: {', '.join(ALL_COMPONENTS)}", file=sys.stderr)
            return 2
        if k not in selected:
            selected.append(k)
    if not selected:
        print("Hiç bileşen seçilmedi.", file=sys.stderr)
        return 2
    selected = [k for k in ALL_COMPONENTS if k in selected]
    if a.assistant_name is not None and not a.assistant_name.strip():
        print("--assistant-name boş olamaz.", file=sys.stderr)
        return 2
    home = a.claude_home or os.environ.get("CLAUDE_CONFIG_DIR") or str(Path.home() / ".claude")
    ctx = Ctx(claude_home=Path(home).expanduser().resolve(), dry_run=a.dry_run, uninstall=a.uninstall,
              skip_mcp=a.skip_mcp, no_service=a.no_service, skip_repo_setup=a.skip_repo_setup,
              replace_existing=a.replace_existing, keep_existing=a.keep_existing,
              assistant_name=a.assistant_name.strip() if a.assistant_name else None,
              tailscale_host=None if a.tailscale_host is None else a.tailscale_host.strip().lower())

    mode = "Kaldırma" if a.uninstall else "Kurulum"
    if a.dry_run:
        mode += " (dry-run: hiçbir şey değiştirilmeyecek)"
    print(f"\neren-kit (macOS) - {mode}")
    line("info", f"Repo:        {REPO}")
    line("info", f"Claude Home: {ctx.claude_home}")
    line("info", f"Bileşenler:  {', '.join(selected)}")

    title("Önkoşullar")
    need_py = any(k in selected for k in ("beyin", "devir", "kapi", "orkestra"))
    ctx.hook_python = a.hook_python or find_python((3, 11)) or "python3"
    ctx.venv_python = find_python((3, 12))
    if need_py and not a.uninstall:
        if ctx.venv_python:
            line("ok", f"Python (venv): {ctx.venv_python}")
        elif any(k in selected for k in ("beyin", "devir")):
            line("fail", "Python 3.12+ bulunamadı: brew install python@3.13")
    ctx.claude_exe = shutil.which("claude") or next(
        (c for c in (Path.home() / ".local/bin/claude", Path.home() / ".claude/local/claude") if c.exists()), None)
    ctx.claude_exe = str(ctx.claude_exe) if ctx.claude_exe else None
    if a.skip_mcp:
        line("skip", "claude CLI denetlenmedi (--skip-mcp)")
    elif ctx.claude_exe:
        line("ok", f"claude CLI ({ctx.claude_exe})")
    elif "beyin" in selected:
        line("warn", "claude CLI bulunamadı: MCP kayıt adımları atlanacak (curl -fsSL https://claude.ai/install.sh | bash)")

    results: list[tuple[str, str, str]] = []
    if not a.uninstall and any(k in selected for k in ("beyin", "devir", "kapi", "orkestra")):
        title("Asistan adı")
        try:
            r = settings_env_step(ctx, ctx.assistant_name)
            line(r.status, r.message)
        except Exception as e:  # noqa: BLE001
            line("fail", f"asistan adı yazılamadı: {e}")
            results.append(("asistan-adı", "fail", str(e)))
        if "beyin" not in selected:  # beyin seçiliyse servis adımı plist'i zaten yeniden yazar
            try:
                r = service_name_sync(ctx)
                line(r.status, r.message)
                if r.status in ("warn", "fail"):
                    results.append(("servis-adı", r.status, r.message))
            except Exception as e:  # noqa: BLE001
                line("fail", f"servis adı güncellenemedi: {e}")
                results.append(("servis-adı", "fail", str(e)))

    steps = build_steps(ctx)
    for k in selected:
        st, note = run_component(k, steps[k])
        results.append((k, st, note))

    title("Özet")
    for k, st, note in results:
        line(st, f"{k}{(': ' + note) if note and st in ('warn', 'fail') else ''}")
    if ctx.backup_used and not ctx.dry_run:
        line("info", f"Yedekler: {ctx.backup_dir} (eski settings.json ve MCP kayıtları, env değerleri dahil düz "
                     "metin; sır içerebilir, kaldırma silmez; gerekmiyorsa sil)")
    if not a.dry_run and not a.uninstall and any(st in ("ok", "warn") for _, st, _ in results):
        line("info", "Claude Code'u yeniden başlat; yeni hook, skill ve MCP'ler oturum açılışında yüklenir.")
        if "beyin" in selected:
            line("info", f"Web arayüzü: {P['bellek'] / '.venv/bin/beyin'} ac")
    if not a.uninstall:
        try:
            post_install_doctor(ctx)
        except Exception as e:  # noqa: BLE001 - doktor kurulumun sonucunu değiştirmez
            line("warn", f"doktor çalıştırılamadı ({type(e).__name__}); kurulumu etkilemez")
    return 1 if any(st == "fail" for _, st, _ in results) else 0


if __name__ == "__main__":
    sys.exit(main())
