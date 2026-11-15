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
