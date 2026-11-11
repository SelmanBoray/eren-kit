"""eren-kit: Claude Code settings.json hook birleştirici.

install.ps1 tarafından çağrılır; elle çalıştırmak da güvenlidir.

    python -I settings_hooks.py --settings <yol> --repo <repo> --components devir,orkestra,kapi
        [--uninstall] [--dry-run] [--keep-legacy | --replace-legacy] [--backup-dir <klasör>]
        [--python <komut>]

--python: hook komutlarındaki yorumlayıcı. Varsayılan "python" (Windows'ta PATH'teki python).
macOS'ta "python" komutu genelde yoktur; install.sh 3.11+ bir python3'ün yolunu verir.
Bir hook'un "bizim" olduğu betik yolundan tanındığı için yorumlayıcı değişse de kayıt
ikiye katlanmaz, yerinde güncellenir.

Kurallar:
- Var olan ayarlar ve başka hook'lar korunur; yalnız eren-kit'in hook'ları eklenir/güncellenir.
- Bir hook "bizim" sayılır, komutu repo-göreli betik yolunu içeriyorsa
  (ör. ".../packages/bellek/src/bellek/devir/hook.py") ya da betiği modül olarak
  çalıştırıyorsa ("python -m bellek.devir.hook"). Tanıma yazılış biçiminden bağımsızdır:
  ters/düz bölü, art arda ayraçlar (JSON'da "C:\\\\x\\\\y"), tırnak ve büyük/küçük harf
  farkı aynı yol sayılır. Böylece repo taşınmışsa eski kayıt güncellenir, aynı komut iki
  kez eklenmez.
- Kurulumda bir bileşenin her olayında tek bir grup kalır: o olaydaki bütün eski
  kayıtlarımız (yinelenen gruplar dahil) çıkarılır, yenisi ilk eşleşmenin yerine konur.
- Repo dışındaki eski kopyaların kayıtları (ör. "C:/Bellek/src/bellek/kapi/hook.py")
  varsayılanda yenisiyle değiştirilir (yedek alınarak). --keep-legacy verilirse korunur
  ve özetteki "legacy" listesinde bildirilir. --replace-legacy eski uyumluluk içindir
  (artık varsayılanla aynı).
- Bir bileşen bir olay için grup düzeyi "matcher" isteyebilir (ör. kapi: PreToolUse +
  "Read", SessionStart + "compact"); matcher'sız bileşenlerin grubu yalnız "hooks" alanını taşır.
- Kaldırmada (--uninstall) bizim kayıtlarımız bütün olaylardan çıkarılır; eski kopyalara
  dokunulmaz.
- Değişiklik yoksa dosyaya dokunulmaz. Değişiklik varsa önce yedek alınır
  (--backup-dir verildiyse ve bu çalıştırmada henüz alınmadıysa).
- Dosya okunduktan sonra yazılmadan önce başka bir süreç (ör. açık Claude Code) değiştirmişse
  üzerine yazılmaz: yeniden okunur, değişiklik yeniden uygulanır (sınırlı deneme).
- Dosya UTF-8 (BOM'suz), 2 boşluk girintili yazılır.
Çıktı: stdout'a tek satır ASCII JSON özet.
"""

from __future__ import annotations

import argparse
import copy
import json
import os
import re
import shutil
import sys
import tempfile
import time

DEVIR_TAIL = "/packages/bellek/src/bellek/devir/hook.py"
ORKESTRA_TAIL = "/packages/opus-orkestra/hooks/opus-orkestra-sessionstart.py"
KAPI_TAIL = "/packages/bellek/src/bellek/kapi/hook.py"

# Betiğin "python -m <modül>" biçimi de bizim kaydımız sayılır (aynı bileşen).
MODULES = {
    DEVIR_TAIL: "bellek.devir.hook",
    KAPI_TAIL: "bellek.kapi.hook",
}

# Repo dışından kurulmuş olası eski kopyalar (aynı betik, başka konum). Varsayılanda
# kayıtları yenisiyle değiştirilir; --keep-legacy verilirse yalnız bildirilir.
LEGACY_HINTS = {
    "devir": "/bellek/devir/hook.py",
    "orkestra": "opus-orkestra-sessionstart.py",
    "kapi": "/bellek/kapi/hook.py",
}

# Yazım koruması: okuma ile yazma arasında dosya değişirse yeniden deneme sayısı.
WRITE_ATTEMPTS = 5
# os.replace hedef dosya başka süreçte açıkken (Windows) geçici PermissionError verebilir.
REPLACE_TRIES = 8
REPLACE_DELAY = 0.05  # saniye; her denemede ikiye katlanır (en kötü durumda toplam ~6,4 s)


class SettingsChanged(Exception):
    """settings.json okunduktan sonra başka bir süreç tarafından değiştirildi."""


def _quote_exe(python: str) -> str:
    """Boşluk içeren yorumlayıcı yolu tırnaklanır; düz komut adı ("python") olduğu gibi kalır."""
    return f'"{python}"' if any(c.isspace() for c in python) else python


def hook_specs(repo: str, python: str = "python") -> dict:
    """Bileşen -> {"tail", "events": {olay: [handler]}, isteğe bağlı "matchers": {olay: matcher}}."""
    py = _quote_exe(python)
    # -S: site atlanır (devir hook'u yalnız stdlib + kendi paketi; açılış ~15 ms kısalır).
    devir_cmd = f'{py} -I -S "{repo}{DEVIR_TAIL}" || true'
    ork = f"{repo}{ORKESTRA_TAIL}"
    ork_hooks = []
    for n in range(1, 5):
        h = {"type": "command", "command": f'{py} -I "{ork}" --parca {n} || true', "timeout": 15}
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
            "events": {
                "PreToolUse": kapi_hooks,
                # Sıkıştırma sonrası "harita gösterildi" işaretlerini sıfırlar (aynı komut).
                "SessionStart": [{"type": "command", "command": kapi_cmd, "timeout": 10}],
            },
            "matchers": {"PreToolUse": "Read", "SessionStart": "compact"},
        },
    }


def make_group(handlers: list, matcher: str | None) -> dict:
    """Olay listesine eklenecek grup; matcher yoksa alan hiç yazılmaz (eski kayıtlarla bayt düzeyinde aynı)."""
    group = {} if matcher is None else {"matcher": matcher}
    group["hooks"] = copy.deepcopy(handlers)
    return group


_SEP_RUN = re.compile(r"/{2,}")


def norm(s: str) -> str:
    """Yol karşılaştırması için: ters bölü -> düz bölü, art arda ayraçlar teke, küçük harf."""
    return _SEP_RUN.sub("/", s.replace("\\", "/")).lower()


def _norm_cmd(cmd: str) -> str:
    """Komut metni için norm(); tırnaklar boşluğa çevrilir (yol sınırı gibi davranır)."""
    return norm(cmd.replace('"', " ").replace("'", " "))


# Yolun bittiğini gösteren karakterler: metin sonu, boşluk, kabuk işleçleri.
_END = r"(?=$|[\s;|&)<>,])"


def _path_in(cmd: str, path: str) -> bool:
    """path (normalize) komutta tam bir yol parçası olarak geçiyor mu ("hook.pyc" eşleşmez)."""
    p = norm(path)
    start = "" if p.startswith("/") else r"(?<![\w.\-])"
    return re.search(start + re.escape(p) + _END, _norm_cmd(cmd)) is not None


def _module_in(cmd: str, module: str) -> bool:
    """Komut betiği "-m <modül>" biçiminde çalıştırıyor mu."""
    pat = r"(?:^|\s)-m\s*" + re.escape(module.lower()) + _END
    return re.search(pat, _norm_cmd(cmd)) is not None


def _command(hook) -> str | None:
    if isinstance(hook, dict) and isinstance(hook.get("command"), str):
        return hook["command"]
    return None


def is_ours(hook, tail: str) -> bool:
    cmd = _command(hook)
    if cmd is None:
        return False
    if _path_in(cmd, tail):
        return True
    mod = MODULES.get(tail)
    return mod is not None and _module_in(cmd, mod)


def is_legacy(hook, key: str, tail: str) -> bool:
    """Aynı betiğin repo dışındaki eski bir kopyası (ör. C:/Bellek/src/bellek/kapi/hook.py)."""
    cmd = _command(hook)
    return cmd is not None and _path_in(cmd, LEGACY_HINTS[key]) and not is_ours(hook, tail)


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


_ANY = object()


def _current_bytes(path: str):
    """Dosyanın ham baytları; yoksa None. Yazım korumasında karşılaştırılır."""
    try:
        with open(path, "rb") as f:
            return f.read()
    except FileNotFoundError:
        return None


def write_atomic(path: str, data: dict, expected=_ANY) -> None:
    """Atomik yazım. expected verilirse (ham bayt; None = dosya yoktu) dosya o haldeyse yazılır,
    değilse SettingsChanged fırlatılır. Geçici PermissionError'da (Windows'ta dosya başka süreçte
    açıkken, antivirüs) artan beklemeyle yeniden denenir."""
    # settings.json bir sembolik bağ olabilir (ör. dotfiles deposu): bağı koparmamak için
    # hedef dosyanın kendisi atomik olarak değiştirilir.
    target = os.path.realpath(path)
    d = os.path.dirname(target)
    os.makedirs(d, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".settings.", suffix=".tmp", dir=d)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
            f.write(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
        delay = REPLACE_DELAY
        for i in range(REPLACE_TRIES):
            try:
                if expected is not _ANY and _current_bytes(target) != expected:
                    raise SettingsChanged(target)
                os.replace(tmp, target)
                break
            except PermissionError as e:
                if i == REPLACE_TRIES - 1:
                    raise PermissionError(
                        f"settings.json yazılamadı ({target}): dosya başka bir süreç tarafından "
                        f"kullanılıyor ya da erişim yok ({REPLACE_TRIES} deneme): {e}"
                    ) from e
                time.sleep(delay)
                delay *= 2
    except BaseException:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise


def _apply(original: dict, args, specs: dict, keys: list) -> tuple[dict, dict]:
    """Bellekteki ayarlara bileşenleri uygular. Doner: (yeni veri, rapor)."""
    data = copy.deepcopy(original)
    hooks = data.get("hooks", {})
    if not isinstance(hooks, dict):
        raise ValueError('"hooks" alanı bir JSON nesnesi değil')
    replace_legacy = bool(getattr(args, "replace_legacy", False)) or not getattr(args, "keep_legacy", False)

    def set_event(event: str, groups: list) -> None:
        if groups:
            hooks[event] = groups
        else:
            hooks.pop(event, None)  # olay listesinde yalnız bizimkiler vardı

    report = {"components": {}}
    for k in keys:
        spec = specs[k]
        tail = spec["tail"]
        matchers = spec.get("matchers", {})
        added = removed_total = legacy_removed = 0
        legacy_pos = {}
        if args.uninstall:
            # Bizim kayıtlarımız hangi olayda olursa olsun çıkarılır; eski kopyalara dokunulmaz.
            for event in list(hooks.keys()):
                groups = hooks[event]
                if not isinstance(groups, list):
                    continue
                groups, _, n = strip_event(groups, lambda h, t=tail: is_ours(h, t))
                if n:
                    removed_total += n
                    set_event(event, groups)
        else:
            if replace_legacy:
                # Eski kopyalar her olaydan çıkarılır; bizimki ilgili olayda onların yerine konur.
                for event in list(hooks.keys()):
                    groups = hooks[event]
                    if not isinstance(groups, list):
                        continue
                    groups, first, n = strip_event(groups, lambda h, k=k, t=tail: is_legacy(h, k, t))
                    if n:
                        legacy_removed += n
                        legacy_pos[event] = first
                        set_event(event, groups)
            for event, desired in spec["events"].items():
                groups = hooks.get(event, [])
                if not isinstance(groups, list):
                    raise ValueError(f'"hooks.{event}" bir liste değil')
                # Olaydaki bütün kayıtlarımız (yinelenen gruplar dahil) çıkar, tek grup girer.
                groups, first, removed = strip_event(groups, lambda h, t=tail: is_ours(h, t))
                removed_total += removed
                cands = [p for p in (first, legacy_pos.get(event)) if p is not None]
                pos = min(min(cands), len(groups)) if cands else len(groups)
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
    elif removed_any:
        data.pop("hooks", None)  # yalnız bizim hook'larımız vardı
    return data, report


def _write_backup(dest: str, src: str, raw: bytes) -> None:
    """Yedek: okunan özgün baytlar (okuma ile kopyalama arasındaki değişiklik yedeğe karışmaz)."""
    with open(dest, "wb") as f:
        f.write(raw)
    try:
        shutil.copystat(src, dest)
    except OSError:
        pass


def run(args) -> dict:
    repo = args.repo.replace("\\", "/").rstrip("/")
    specs = hook_specs(repo, args.python)
    keys = [k.strip() for k in args.components.split(",") if k.strip()]
    for k in keys:
        if k not in specs:
            raise ValueError(f"bilinmeyen hook bileşeni: {k}")

    backup_made = False  # bu çağrı yedeği kendisi oluşturduysa yeniden denemede tazelenir
    for attempt in range(WRITE_ATTEMPTS):
        # Ham bayt load'dan ÖNCE alınır: ikisi arasında dosya değişirse yazım denetimi
        # (expected=raw) bunu yakalar ve tur yeniden başlar; değişiklik kaybolmaz.
        raw = _current_bytes(args.settings)
        original, existed = load(args.settings)
        data, report = _apply(original, args, specs, keys)
        changed = data != original
        report.update(
            {"settings": args.settings, "existed": existed, "changed": changed, "backup": None,
             "dry_run": bool(args.dry_run)}
        )
        if not changed or args.dry_run:
            return report
        if existed != (raw is not None):  # iki okuma arasında dosya oluştu/silindi
            time.sleep(0.05 * (attempt + 1))
            continue
        if existed and args.backup_dir:
            os.makedirs(args.backup_dir, exist_ok=True)
            dest = os.path.join(args.backup_dir, "settings.json")
            if backup_made or not os.path.exists(dest):  # bu çalıştırmanın ilk (özgün) hali korunur
                _write_backup(dest, args.settings, raw)
                backup_made = True
            report["backup"] = dest
        try:
            write_atomic(args.settings, data, expected=raw)
        except SettingsChanged:
            time.sleep(0.05 * (attempt + 1))
            continue
        if attempt:
            report["retries"] = attempt
        return report
    raise RuntimeError(
        f"settings.json okunduktan sonra başka bir süreç tarafından değiştirildi; "
        f"{WRITE_ATTEMPTS} denemede tutarlı yazılamadı. Dosyayı açık tutan programı "
        f"(ör. Claude Code ayar ekranı) kapatıp yeniden deneyin."
    )


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="eren-kit settings.json hook birleştirici")
    p.add_argument("--settings", required=True)
    p.add_argument("--repo", required=True)
    p.add_argument("--components", required=True)
    p.add_argument("--uninstall", action="store_true")
    p.add_argument("--dry-run", action="store_true")
    legacy = p.add_mutually_exclusive_group()
    legacy.add_argument("--keep-legacy", action="store_true",
                        help="aynı betiğin repo dışındaki eski kopyalarının hook kayıtlarını koru (yalnız bildir)")
    legacy.add_argument("--replace-legacy", action="store_true",
                        help="eski kopyaların kayıtlarını yenisiyle değiştir (varsayılan; uyumluluk için)")
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
