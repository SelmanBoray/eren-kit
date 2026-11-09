"""eren-kit: Claude Code settings.json hook birleştirici.

install.ps1 tarafından çağrılır; elle çalıştırmak da güvenlidir.

    python -I settings_hooks.py --settings <yol> --repo <repo> --components devir,orkestra,kapi
        [--uninstall] [--dry-run] [--replace-legacy] [--backup-dir <klasör>] [--python <komut>]

--python: hook komutlarındaki yorumlayıcı. Varsayılan "python" (Windows'ta PATH'teki python).
macOS'ta "python" komutu genelde yoktur; install.sh 3.11+ bir python3'ün yolunu verir.
Bir hook'un "bizim" olduğu betik yolundan tanındığı için yorumlayıcı değişse de kayıt
ikiye katlanmaz, yerinde güncellenir.

Kurallar:
- Var olan ayarlar ve başka hook'lar korunur; yalnız eren-kit'in hook'ları eklenir/güncellenir.
- Bir hook "bizim" sayılır, komutu repo-göreli betik yolunu içeriyorsa
  (ör. ".../packages/bellek/src/bellek/devir/hook.py"). Böylece repo taşınmışsa eski
  kayıt güncellenir, aynı komut iki kez eklenmez.
- Bir bileşen bir olay için grup düzeyi "matcher" isteyebilir (ör. kapi: PreToolUse + "Read");
  matcher'sız bileşenlerin grubu yalnız "hooks" alanını taşır.
- Değişiklik yoksa dosyaya dokunulmaz. Değişiklik varsa önce yedek alınır
  (--backup-dir verildiyse ve bu çalıştırmada henüz alınmadıysa).
- Dosya UTF-8 (BOM'suz), 2 boşluk girintili yazılır.
Çıktı: stdout'a tek satır ASCII JSON özet.
"""

from __future__ import annotations

import argparse
import copy
import json
import os
import shutil
import sys
import tempfile

DEVIR_TAIL = "/packages/bellek/src/bellek/devir/hook.py"
ORKESTRA_TAIL = "/packages/opus-orkestra/hooks/opus-orkestra-sessionstart.py"
KAPI_TAIL = "/packages/bellek/src/bellek/kapi/hook.py"

# Repo dışından kurulmuş olası eski kopyalar: varsayılan olarak yalnız uyarılır;
# --replace-legacy (install.ps1 -ReplaceExisting) verilirse kayıtları kaldırılır.
LEGACY_HINTS = {
    "devir": "/bellek/devir/hook.py",
    "orkestra": "opus-orkestra-sessionstart.py",
    "kapi": "/bellek/kapi/hook.py",
}


def _quote_exe(python: str) -> str:
    """Boşluk içeren yorumlayıcı yolu tırnaklanır; düz komut adı ("python") olduğu gibi kalır."""
    return f'"{python}"' if any(c.isspace() for c in python) else python


def hook_specs(repo: str, python: str = "python") -> dict:
    """Bileşen -> {"tail", "events": {olay: [handler]}, isteğe bağlı "matchers": {olay: matcher}}."""
    py = _quote_exe(python)
    devir_cmd = f'{py} -I "{repo}{DEVIR_TAIL}" || true'
    ork = f"{repo}{ORKESTRA_TAIL}"
    ork_hooks = []
    for n in range(1, 5):
        h = {"type": "command", "command": f'{py} -I "{ork}" --parca {n}', "timeout": 15}
        if n == 1:
            h["statusMessage"] = "Opus Orkestra kuralı yükleniyor..."
        ork_hooks.append(h)
    kapi_cmd = f'{py} -I -S "{repo}{KAPI_TAIL}" || true'
    kapi_hooks = [
        {"type": "command", "command": kapi_cmd, "if": f"Read(//**/*.{ext})", "timeout": 10}
        for ext in ("md", "markdown")
    ]
    return {
        "devir": {
            "tail": DEVIR_TAIL,
            "events": {
                "SessionStart": [{"type": "command", "command": devir_cmd, "timeout": 10}],
                "UserPromptSubmit": [{"type": "command", "command": devir_cmd, "timeout": 5}],
                "Stop": [{"type": "command", "command": devir_cmd, "timeout": 10}],
            },
        },
        "orkestra": {
            "tail": ORKESTRA_TAIL,
            "events": {"SessionStart": ork_hooks},
        },
        "kapi": {
            "tail": KAPI_TAIL,
            "events": {"PreToolUse": kapi_hooks},
            "matchers": {"PreToolUse": "Read"},
        },
    }


def make_group(handlers: list, matcher: str | None) -> dict:
    """Olay listesine eklenecek grup; matcher yoksa alan hiç yazılmaz (eski kayıtlarla bayt düzeyinde aynı)."""
    group = {} if matcher is None else {"matcher": matcher}
    group["hooks"] = copy.deepcopy(handlers)
    return group


def norm(s: str) -> str:
    return s.replace("\\", "/").lower()


def is_ours(hook, tail: str) -> bool:
    return (
        isinstance(hook, dict)
        and isinstance(hook.get("command"), str)
        and norm(tail) in norm(hook["command"])
    )


def is_legacy(hook, key: str, tail: str) -> bool:
    """Aynı betiğin repo dışındaki eski bir kopyası (ör. D:/eski-kopya/.../devir/hook.py)."""
    return (
        isinstance(hook, dict)
        and isinstance(hook.get("command"), str)
        and norm(LEGACY_HINTS[key]) in norm(hook["command"])
        and not is_ours(hook, tail)
    )


def strip_event(groups: list, pred):
    """pred'e uyan hook'ları gruplardan çıkarır. Doner: (yeni liste, ilk eşleşme konumu, silinen sayısı)."""
    out, first, removed = [], None, 0
    for g in groups:
        if not isinstance(g, dict) or not isinstance(g.get("hooks"), list):
            out.append(g)
            continue
        kept = [h for h in g["hooks"] if not pred(h)]
        n = len(g["hooks"]) - len(kept)
        if n:
            removed += n
            if first is None:
                first = len(out)
            if not kept:
                continue  # yalnız bizimkileri içeren grup tamamen düşer
            g = dict(g)
            g["hooks"] = kept
        out.append(g)
    return out, first, removed


def find_legacy(hooks: dict, key: str, tail: str) -> list[str]:
    found = []
    for groups in hooks.values():
        if not isinstance(groups, list):
            continue
        for g in groups:
            if not isinstance(g, dict) or not isinstance(g.get("hooks"), list):
                continue
            for h in g["hooks"]:
                if is_legacy(h, key, tail) and h["command"] not in found:
                    found.append(h["command"])
    return found


def load(path: str):
    if not os.path.exists(path):
        return {}, False
    with open(path, encoding="utf-8-sig") as f:
        text = f.read()
    if not text.strip():
        return {}, True
    data = json.loads(text)
    if not isinstance(data, dict):
        raise ValueError("settings.json kökü bir JSON nesnesi değil")
    return data, True


def write_atomic(path: str, data: dict) -> None:
    # settings.json bir sembolik bağ olabilir (ör. dotfiles deposu): bağı koparmamak için
    # hedef dosyanın kendisi atomik olarak değiştirilir.
    target = os.path.realpath(path)
    d = os.path.dirname(target)
    os.makedirs(d, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".settings.", suffix=".tmp", dir=d)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
            f.write(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
        os.replace(tmp, target)
    except BaseException:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise


def run(args) -> dict:
    repo = args.repo.replace("\\", "/").rstrip("/")
    specs = hook_specs(repo, args.python)
    keys = [k.strip() for k in args.components.split(",") if k.strip()]
    for k in keys:
        if k not in specs:
            raise ValueError(f"bilinmeyen hook bileşeni: {k}")

    original, existed = load(args.settings)
    data = copy.deepcopy(original)
    hooks = data.get("hooks", {})
    if not isinstance(hooks, dict):
        raise ValueError('"hooks" alanı bir JSON nesnesi değil')

    report = {"components": {}}
    for k in keys:
        spec = specs[k]
        tail = spec["tail"]
        matchers = spec.get("matchers", {})
        added = removed_total = legacy_removed = 0
        if args.replace_legacy and not args.uninstall:
            # Eski kopyalar her olaydan çıkarılır; bizimki ilgili olayda onların yerine konur.
            legacy_pos = {}
            for event in list(hooks.keys()):
                groups = hooks[event]
                if not isinstance(groups, list):
                    continue
                groups, first, n = strip_event(groups, lambda h, k=k, t=tail: is_legacy(h, k, t))
                if n:
                    legacy_removed += n
                    legacy_pos[event] = first
                    if groups:
                        hooks[event] = groups
                    else:
                        hooks.pop(event)
        else:
            legacy_pos = {}
        for event, desired in spec["events"].items():
            groups = hooks.get(event, [])
            if not isinstance(groups, list):
                raise ValueError(f'"hooks.{event}" bir liste değil')
            groups, first, removed = strip_event(groups, lambda h, t=tail: is_ours(h, t))
            if first is None:
                first = legacy_pos.get(event)
            removed_total += removed
            if args.uninstall:
                if removed and not groups:
                    hooks.pop(event, None)  # olay listesinde yalnız bizimkiler vardı
                elif event in hooks:
                    hooks[event] = groups
            else:
                pos = len(groups) if first is None else min(first, len(groups))
                groups.insert(pos, make_group(desired, matchers.get(event)))
                hooks[event] = groups
                added += len(desired)
        report["components"][k] = {
            "added": added,
            "removed": removed_total,
            "legacy_removed": legacy_removed,
            "legacy": find_legacy(hooks, k, tail),
        }

    removed_any = any(c["removed"] or c["legacy_removed"] for c in report["components"].values())
    if hooks:
        data["hooks"] = hooks
    elif args.uninstall and removed_any:
        data.pop("hooks", None)  # yalnız bizim hook'larımız vardı

    changed = data != original
    report.update(
        {"settings": args.settings, "existed": existed, "changed": changed, "backup": None,
         "dry_run": bool(args.dry_run)}
    )
    if changed and not args.dry_run:
        if existed and args.backup_dir:
            os.makedirs(args.backup_dir, exist_ok=True)
            dest = os.path.join(args.backup_dir, "settings.json")
            if not os.path.exists(dest):  # bu çalıştırmanın ilk (özgün) hali korunur
                shutil.copy2(args.settings, dest)
            report["backup"] = dest
        write_atomic(args.settings, data)
    return report


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="eren-kit settings.json hook birleştirici")
    p.add_argument("--settings", required=True)
    p.add_argument("--repo", required=True)
    p.add_argument("--components", required=True)
    p.add_argument("--uninstall", action="store_true")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--replace-legacy", action="store_true",
                   help="aynı betiğin repo dışındaki eski kopyalarının hook kayıtlarını kaldır")
    p.add_argument("--backup-dir")
    p.add_argument("--python", default="python",
                   help='hook komutlarındaki yorumlayıcı (varsayılan "python")')
    args = p.parse_args(argv)
    try:
        report = run(args)
    except Exception as e:  # noqa: BLE001 - tek satır hata özeti istenir
        print(json.dumps({"error": f"{type(e).__name__}: {e}"}))
        return 1
    print(json.dumps(report))
    return 0


if __name__ == "__main__":
    sys.exit(main())
