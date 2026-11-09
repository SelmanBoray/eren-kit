"""Pure safety checks: failsafe corner, process blocklist, terminal and password guards.

No Windows calls and no side effects, so everything here is testable on any platform.
"""

from __future__ import annotations

from collections.abc import Sequence


class SafetyError(Exception):
    """A policy refusal. The message tells the agent what happened and what to do next."""


TERMINAL_PROCESSES: frozenset[str] = frozenset(
    {
        "windowsterminal.exe",
        "openconsole.exe",
        "wezterm-gui.exe",
        "alacritty.exe",
        "mintty.exe",
        "kitty.exe",
        "hyper.exe",
        "tabby.exe",
        "conemu.exe",
        "conemu64.exe",
    }
)

# Win32 window classes of terminal windows (exact, case-sensitive).
TERMINAL_WINDOW_CLASSES: frozenset[str] = frozenset(
    {
        "ConsoleWindowClass",
        "CASCADIA_HOSTING_WINDOW_CLASS",
        "PseudoConsoleWindow",
        "mintty",
        "VirtualConsoleClass",
    }
)


def _norm(name: str) -> str:
    """Lowercase, strip, and drop a trailing ``.exe``."""
    return name.strip().lower().removesuffix(".exe")


_TERMINAL_NORMALIZED = frozenset(_norm(n) for n in TERMINAL_PROCESSES)


def monitor_corners(monitors: Sequence[tuple[int, int, int, int]]) -> list[tuple[int, int]]:
    """Return the 4 corners of every monitor given as (left, top, width, height)."""
    corners: list[tuple[int, int]] = []
    for left, top, width, height in monitors:
        right = left + width - 1
        bottom = top + height - 1
        corners.extend([(left, top), (right, top), (left, bottom), (right, bottom)])
    return corners


def check_failsafe(
    cursor: tuple[int, int],
    corners: Sequence[tuple[int, int]],
    last_set: tuple[int, int] | None,
    enabled: bool = True,
    tolerance: int = 2,
) -> None:
    """Raise if the user (not the agent) parked the cursor in a screen corner."""
    if not enabled:
        return
    if last_set is not None and tuple(cursor) == tuple(last_set):
        return
    cx, cy = cursor
    for x, y in corners:
        if max(abs(cx - x), abs(cy - y)) <= tolerance:
            raise SafetyError(
                "The user moved the mouse to a screen corner to stop automation. "
                "Stop and ask the user before continuing."
            )


def check_blocked(process: str | None, blocked: Sequence[str]) -> None:
    """Raise if ``process`` is on the user's blocklist (case and ``.exe`` insensitive)."""
    if not process or not process.strip():
        return
    target = _norm(process)
    if not target:
        return
    for entry in blocked:
        if entry and _norm(entry) == target:
            raise SafetyError(
                f"{process} is blocked by the user's configuration. "
                "Ask the user to do this step themselves."
            )


def check_keyboard_target(
    process: str | None,
    allow_terminal_input: bool = False,
    window_class: str = "",
    is_own_host: bool = False,
) -> None:
    """Raise if keyboard input would go to a terminal or to the agent's own host window."""
    if allow_terminal_input:
        return
    if is_own_host:
        raise SafetyError(
            "The foreground window is the terminal or editor running you, so keyboard input "
            "is refused. Bring the target app to the front first with `windows`/`focus`."
        )
    is_terminal = window_class in TERMINAL_WINDOW_CLASSES or (
        bool(process) and _norm(process or "") in _TERMINAL_NORMALIZED
    )
    if is_terminal:
        name = process or window_class
        raise SafetyError(
            f"The foreground window is a terminal ({name}), so keyboard input is refused. "
            "Use your shell tool for terminal work, or focus the target window first "
            "with `windows`/`focus`."
        )


def check_password_field(is_password: bool) -> None:
    """Raise if the focused element is a password field."""
    if is_password:
        raise SafetyError(
            "Refusing to type into a password field. Ask the user to type it themselves."
        )
