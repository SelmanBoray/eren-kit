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


def failsafe_exemption(
    cursor: tuple[int, int], last_set: tuple[int, int] | None
) -> tuple[int, int] | None:
    """The agent-set cursor position that stays exempt from the failsafe after seeing ``cursor``.

    The exemption only covers a cursor that never left the point where the agent put it. Once the
    cursor is seen anywhere else, the exemption ends for good (``None``): if the user later moves
    the cursor into that same corner, the failsafe triggers.
    """
    if last_set is None or tuple(cursor) != tuple(last_set):
        return None
    return (int(last_set[0]), int(last_set[1]))


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


def is_terminal(process: str | None, window_class: str = "") -> bool:
    """Whether a window is a terminal, by window class or process name.

    The one terminal test of the server: the keyboard guard and the pointer guard both use it.
    """
    return window_class in TERMINAL_WINDOW_CLASSES or (
        bool(process) and _norm(process or "") in _TERMINAL_NORMALIZED
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
    if is_terminal(process, window_class):
        name = process or window_class
        raise SafetyError(
            f"The foreground window is a terminal ({name}), so keyboard input is refused. "
            "Use your shell tool for terminal work, or focus the target window first "
            "with `windows`/`focus`."
        )


def check_pointer_target(
    process: str | None,
    action: str,
    allow_terminal_input: bool = False,
    window_class: str = "",
    is_own_host: bool = False,
) -> None:
    """Raise if a pointer action that can insert text would hit a terminal or the agent's host.

    Right and middle clicks paste the clipboard in many terminals (Windows Terminal, console
    QuickEdit, mintty, most Unix-style terminals) and a drag can drop text, so these count as
    keyboard input there. Left clicks, scrolling and moving are not checked here. ``action``
    names the refused action in the message, e.g. "A right click".
    """
    if allow_terminal_input:
        return
    if is_own_host:
        raise SafetyError(
            f"{action} on the terminal or editor running you is refused: it can paste or drop "
            "text into it. Check the target point, or bring the target app to the front with "
            "`windows`/`focus`."
        )
    if is_terminal(process, window_class):
        name = process or window_class
        raise SafetyError(
            f"{action} on a terminal ({name}) is refused: it can paste or drop text there, which "
            "counts as keyboard input. Use your shell tool for terminal work."
        )


def check_password_field(is_password: bool | None) -> None:
    """Raise if the focused element is a password field, or if that could not be determined.

    ``None`` means the check could not tell (UI Automation timed out or failed): typing is
    refused then too, so the guard fails closed instead of silently letting text through.
    """
    if is_password is None:
        raise SafetyError(
            "Could not verify that the focused element is not a password field (UI Automation "
            "did not answer; the app may be busy), so typing is refused. Wait a moment and "
            "retry; if it keeps failing, ask the user to type this themselves."
        )
    if is_password:
        raise SafetyError(
            "Refusing to type into a password field. Ask the user to type it themselves."
        )
