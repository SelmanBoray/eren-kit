"""eren-kit: Claude Code kullanıcı kapsamlı MCP kaydını okur (salt okunur).

    python -I mcp_config.py --name <ad> [--config <.claude.json yolu>]

Kullanıcı kapsamlı MCP sunucuları Claude Code'un ~/.claude.json dosyasında (ya da
CLAUDE_CONFIG_DIR ayarlıysa $CLAUDE_CONFIG_DIR/.claude.json) "mcpServers" altında durur.
"claude mcp get" sunucuyu başlatıp sağlık denetimi yaptığı için onun yerine dosya okunur.
Çıktı: stdout'a tek satır ASCII JSON: {"found": bool, "path": ..., "entry": {...}|null}
"""

from __future__ import annotations

import argparse
import json
import os
import sys


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
            print(json.dumps({"found": False, "path": path, "entry": None}))
            return 0
        with open(path, encoding="utf-8-sig") as f:
            data = json.load(f)
        servers = data.get("mcpServers") if isinstance(data, dict) else None
        entry = servers.get(args.name) if isinstance(servers, dict) else None
        print(json.dumps({"found": isinstance(entry, dict), "path": path,
                          "entry": entry if isinstance(entry, dict) else None}))
        return 0
    except Exception as e:  # noqa: BLE001 - tek satır hata özeti istenir
        print(json.dumps({"error": f"{type(e).__name__}: {e}", "path": path}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
