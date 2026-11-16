"""eren-kit: Claude Code kullanıcı kapsamlı MCP kaydını okur (salt okunur).

    python -I mcp_config.py --name <ad> [--config <.claude.json yolu>]

Kullanıcı kapsamlı MCP sunucuları Claude Code'un ~/.claude.json dosyasında (ya da
CLAUDE_CONFIG_DIR ayarlıysa $CLAUDE_CONFIG_DIR/.claude.json) "mcpServers" altında durur.
"claude mcp get" sunucuyu başlatıp sağlık denetimi yaptığı için onun yerine dosya okunur.
Çıktı: stdout'a tek satır ASCII JSON:
    {"found": bool, "path": ..., "entry": {...}|null, "safe": {...}|null}

"safe", kaydın değerlerini PowerShell nesnesine dönüştürmeden (ConvertFrom-Json PowerShell 7'de
tarih biçimli dizeleri DateTime'a çevirir) yeniden yazabilmek içindir: "entry" kaydın tamamı,
"args" her argüman (None'lar atlanır), "env" env nesnesi safe_json biçiminde; "pretty" yedek
dosyası için okunur JSON. install.ps1 bunları "claude mcp add-json" komutuna olduğu gibi koyar.
"""

from __future__ import annotations

import argparse
import json
import os
import string
import sys

# safe_json'da dizelerin içinde çıplak kalan karakterler; gerisi \uXXXX olur. Böylece JSON'da
# cmd.exe'nin yorumladığı hiçbir karakter (% ^ & | < > ! ( ) satır sonu) ve dize içinde " ya da \
# kalmaz: komut satırına (claude.cmd sarmalayıcısı dahil) birebir ve komut olarak yorumlanmadan
# geçer. ErenKit.Installer.psm1'deki $script:JsonSafeChars ile aynı küme.
_SAFE = frozenset(string.ascii_letters + string.digits + " ._,:/=+@#~-")


def safe_json(v) -> str:
    """Değeri JSON'a çevirir; dizelerde güvenli küme dışındaki her UTF-16 birimi \\uXXXX olur."""
    if isinstance(v, str):
        out = ['"']
        for ch in v:
            if ch in _SAFE:
                out.append(ch)
            else:
                b = ch.encode("utf-16-be", "surrogatepass")
                out.extend("\\u%02x%02x" % (b[i], b[i + 1]) for i in range(0, len(b), 2))
        out.append('"')
        return "".join(out)
    if v is None or isinstance(v, (bool, int, float)):
        return json.dumps(v)
    if isinstance(v, dict):
        return "{" + ",".join(safe_json(str(k)) + ":" + safe_json(x) for k, x in v.items()) + "}"
    if isinstance(v, (list, tuple)):
        return "[" + ",".join(safe_json(x) for x in v) + "]"
    return safe_json(str(v))


def safe_parts(entry: dict) -> dict:
    args = entry.get("args")
    env = entry.get("env")
    return {
        "entry": safe_json(entry),
        "args": [safe_json(a) for a in args if a is not None] if isinstance(args, list) else [],
        "env": safe_json(env) if isinstance(env, dict) else None,
        "pretty": json.dumps(entry, indent=2, ensure_ascii=False),
    }


# ---------------------------------------------------------------- kaydı göstermek ve denetlemek
#
# Kurulum (install_macos.py, ErenKit.Installer.psm1'deki eşleri) ve doktor aynı kuralı uygular.
# Kullanıcının kaydı sır taşıyabilir (uzak sunucu adresinde belirteç, Authorization başlığı,
# "--token=..." argümanı, env değeri). Ekrana yazılan metin terminal kaydına, ekran paylaşımına ve
# yapıştırılan hata raporuna gider; bu yüzden kayıttan yalnız şunlar gösterilir:
# - program yolu (kaydın kimliği; sır yeri değil),
# - kurulumun kendi yazdığı (depoda herkese açık) önek argümanlar; kalanlar yalnız sayıyla,
# - uzak sunucu için tür ve şema://sunucu[:port]; kullanıcı:parola@, yol, sorgu ve parça gizlenir,
# - env/headers yalnız adlarıyla (değerleri hiçbir yerde).

# Gösterilecek port yalnız şemanın varsayılanı değilse yazılır (.NET Uri.IsDefaultPort ile aynı).
_DEFAULT_PORTS = {"http": 80, "https": 443, "ws": 80, "wss": 443}


def describe_url(url) -> str:
    """Uzak sunucu adresinin sır taşımayan kısmı: şema://sunucu[:port], gerisi '/…'."""
    from urllib.parse import urlsplit

    if not isinstance(url, str) or not url:
        return "(adres yok)"
    try:
        u = urlsplit(url)
        host, port = u.hostname, u.port
    except ValueError:
        return "(adres çözümlenemedi; gösterilmez)"
    if not u.scheme or not host:
        return "(adres çözümlenemedi; gösterilmez)"
    scheme = u.scheme.lower()
    text = f"{scheme}://" + (f"[{host}]" if ":" in host else host)
    if port is not None and port != _DEFAULT_PORTS.get(scheme):
        text += f":{port}"
    hidden = u.username is not None or u.password is not None or u.path not in ("", "/") or u.query or u.fragment
    return text + ("/…" if hidden else "")


def describe_entry(entry, shown_args: int = 0) -> str:
    """Kaydın ekranda gösterilecek biçimi (bkz. yukarıdaki kural). shown_args: baştan kaç argüman
    yazılır (yalnız kurulumun bildiği önek); kalanlar sayılır."""
    if not isinstance(entry, dict):
        return "(kayıt bir JSON nesnesi değil)"
    cmd = entry.get("command")
    if not cmd:
        if entry.get("url"):
            return f"{entry.get('type') or '?'} {describe_url(entry.get('url'))}"
        return f"(komutu ya da adresi olmayan kayıt; alanlar: {', '.join(map(str, entry)) or '-'})"
    args = entry.get("args")
    args = [a for a in args if a is not None] if isinstance(args, list) else []
    shown_args = max(0, min(shown_args, len(args)))
    parts = [str(cmd)] + [str(a) for a in args[:shown_args]]
    text = " ".join(f'"{p}"' if any(c.isspace() for c in p) else p for p in parts)
    hidden = len(args) - shown_args
    return text + (f" (+{hidden} argüman daha; değerleri yazılmaz)" if hidden else "")


def known_prefix(entry, variants) -> int:
    """Kaydın argümanları bu öneklerden biriyle başlıyorsa en uzun eşleşenin uzunluğu, yoksa 0."""
    args = entry.get("args") if isinstance(entry, dict) else None
    if not isinstance(args, list):
        return 0
    best = 0
    for v in variants:
        v = list(v)
        if len(v) > best and args[: len(v)] == v:
            best = len(v)
    return best


def _kind(v) -> str:
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true/false"
    if isinstance(v, (int, float)):
        return "sayı"
    if isinstance(v, dict):
        return "nesne"
    if isinstance(v, list):
        return "dizi"
    if isinstance(v, str):
        return "dize"
    return type(v).__name__


def entry_problems(entry) -> list[str]:
    """Claude Code'un kabul etmediği değerlerin yeri ve türü (değer yazılmaz).

    Elle düzenlenmiş .claude.json'da "env": {"PORT": 8080} gibi dize olmayan bir değer varsa
    Claude Code o kaydı yok sayar ("Skipped — invalid MCP server config") ve "claude mcp add-json"
    aynı kaydı reddeder: böyle bir kayıt silinirse geri yüklenemez. Kurulum bu durumda kayda
    dokunmaz, doktor hata verir. Denetlenen: command/url dize; args dize dizisi; env/headers
    değerleri dize olan nesne (alan varsa; null da reddedilir)."""
    if not isinstance(entry, dict):
        return []
    out: list[str] = []
    for key in ("command", "url"):
        if key in entry and not isinstance(entry[key], str):
            out.append(f"{key}: {_kind(entry[key])}")
    if "args" in entry:
        a = entry["args"]
        if not isinstance(a, list):
            out.append(f"args: {_kind(a)} (dizi olmalı)")
        else:
            out.extend(f"args[{i}]: {_kind(x)}" for i, x in enumerate(a) if not isinstance(x, str))
    for key in ("env", "headers"):
        if key in entry:
            d = entry[key]
            if not isinstance(d, dict):
                out.append(f"{key}: {_kind(d)} (nesne olmalı)")
            else:
                out.extend(f"{key}.{k}: {_kind(x)}" for k, x in d.items() if not isinstance(x, str))
    return out


def problem_text(name: str, problems: list[str]) -> str:
    """entry_problems için kullanıcı iletisi (ErenKit.Installer.psm1 Format-McpProblem ile aynı)."""
    return (f'"{name}" kaydında Claude Code\'un kabul etmediği, dize olmayan değer var ({", ".join(problems)}); '
            "Claude Code bu kaydı şu an yok sayıyor. .claude.json'da değeri tırnak içine alın "
            '(ör. 8080 -> "8080") ya da kaydı silin, sonra yeniden çalıştırın')


def default_config() -> str:
    d = os.environ.get("CLAUDE_CONFIG_DIR")
    if d:
        return os.path.join(d, ".claude.json")
    return os.path.join(os.path.expanduser("~"), ".claude.json")


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="eren-kit MCP kaydı okuyucu")
    p.add_argument("--name", required=True)
    p.add_argument("--config")
    args = p.parse_args(argv)
    path = args.config or default_config()
    try:
        if not os.path.exists(path):
            print(json.dumps({"found": False, "path": path, "entry": None, "safe": None}))
            return 0
        with open(path, encoding="utf-8-sig") as f:
            data = json.load(f)
        servers = data.get("mcpServers") if isinstance(data, dict) else None
        entry = servers.get(args.name) if isinstance(servers, dict) else None
        if not isinstance(entry, dict):
            entry = None
        print(json.dumps({"found": entry is not None, "path": path, "entry": entry,
                          "safe": safe_parts(entry) if entry is not None else None}))
        return 0
    except Exception as e:  # noqa: BLE001 - tek satır hata özeti istenir
        print(json.dumps({"error": f"{type(e).__name__}: {e}", "path": path}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
