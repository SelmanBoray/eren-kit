"""Per-platform local data directory (stdlib only; the devir hook imports it too).

Windows: ``%LOCALAPPDATA%\\Bellek`` (``~/AppData/Local/Bellek`` when unset).
macOS:   ``~/Library/Application Support/Bellek``.
Other:   ``$XDG_DATA_HOME/Bellek`` (``~/.local/share/Bellek`` when unset).

``LOCALAPPDATA`` wins on every platform when set: Windows behaviour stays identical,
and tests or relocated installs can redirect everything with one variable.
"""

from __future__ import annotations

import os
import sys
from collections.abc import Mapping
from pathlib import Path

APP_NAME = "Bellek"


def data_dir(env: Mapping[str, str] | None = None, platform: str | None = None) -> Path:
    """Machine-local Bellek folder (database, queue, logs, state)."""
    env = os.environ if env is None else env
    platform = sys.platform if platform is None else platform
    local = env.get("LOCALAPPDATA")
    if local:
        return Path(local) / APP_NAME
    if platform == "win32":
        return Path.home() / "AppData" / "Local" / APP_NAME
    if platform == "darwin":
        return Path.home() / "Library" / "Application Support" / APP_NAME
    xdg = env.get("XDG_DATA_HOME")
    if xdg and os.path.isabs(xdg):
        return Path(xdg) / APP_NAME
    return Path.home() / ".local" / "share" / APP_NAME
