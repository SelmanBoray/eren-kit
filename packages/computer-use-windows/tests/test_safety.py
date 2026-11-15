"""Unit tests for computer_use_windows.safety (pure, no Windows APIs)."""

from __future__ import annotations

import pytest

from computer_use_windows import safety
from computer_use_windows.safety import (
    TERMINAL_PROCESSES,
    TERMINAL_WINDOW_CLASSES,
    SafetyError,
    check_blocked,
    check_failsafe,
    check_keyboard_target,
    check_password_field,
    monitor_corners,
)

CONTRACT_TERMINALS = [
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
]

SHELLS = ["cmd.exe", "powershell.exe", "pwsh.exe", "conhost.exe"]

CONTRACT_CLASSES = {
    "ConsoleWindowClass",
    "CASCADIA_HOSTING_WINDOW_CLASS",
    "PseudoConsoleWindow",
    "mintty",
    "VirtualConsoleClass",
}

ORDINARY_CLASS = "WindowsForms10.Window.8.app.0.141b42a_r6_ad1"

CORNERS = [(0, 0), (1919, 0), (0, 1079), (1919, 1079)]


# --- SafetyError ---------------------------------------------------------------------------


def test_safety_error_is_exception() -> None:
    assert issubclass(SafetyError, Exception)


# --- monitor_corners -----------------------------------------------------------------------


def test_monitor_corners_single() -> None:
    assert monitor_corners([(0, 0, 1920, 1080)]) == CORNERS


def test_monitor_corners_two_monitors_negative_left() -> None:
    result = monitor_corners([(-1280, 0, 1280, 1024), (0, 0, 1920, 1080)])
    assert result[:4] == [(-1280, 0), (-1, 0), (-1280, 1023), (-1, 1023)]
    assert result[4:] == CORNERS
    assert len(result) == 8


def test_monitor_corners_empty() -> None:
    assert monitor_corners([]) == []


# --- check_failsafe ------------------------------------------------------------------------


@pytest.mark.parametrize("corner", CORNERS)
def test_failsafe_exact_corner_raises(corner: tuple[int, int]) -> None:
    with pytest.raises(SafetyError) as exc:
        check_failsafe(corner, CORNERS, None)
    assert str(exc.value)


def test_failsafe_within_tolerance_raises() -> None:
    with pytest.raises(SafetyError):
        check_failsafe((2, 1), CORNERS, None, tolerance=2)


def test_failsafe_outside_tolerance_ok() -> None:
    check_failsafe((3, 0), CORNERS, None, tolerance=2)


def test_failsafe_chebyshev_not_euclidean() -> None:
    # (2, 2) is Chebyshev distance 2 (Euclidean ~2.83) -> must raise.
    with pytest.raises(SafetyError):
        check_failsafe((2, 2), CORNERS, None, tolerance=2)


def test_failsafe_cursor_equals_last_set_ok() -> None:
    check_failsafe((0, 0), CORNERS, (0, 0))


def test_failsafe_cursor_differs_from_last_set_raises() -> None:
    with pytest.raises(SafetyError):
        check_failsafe((0, 0), CORNERS, (500, 500))


def test_failsafe_disabled_ok() -> None:
    check_failsafe((0, 0), CORNERS, None, enabled=False)


def test_failsafe_away_from_corners_ok() -> None:
    check_failsafe((960, 540), CORNERS, None)


def test_failsafe_custom_tolerance() -> None:
    check_failsafe((5, 5), CORNERS, None, tolerance=2)
    with pytest.raises(SafetyError):
        check_failsafe((5, 5), CORNERS, None, tolerance=5)
    # tolerance 0: only the exact pixel counts
    check_failsafe((1, 0), CORNERS, None, tolerance=0)
    with pytest.raises(SafetyError):
        check_failsafe((0, 0), CORNERS, None, tolerance=0)


def test_failsafe_no_corners_ok() -> None:
    check_failsafe((0, 0), [], None)


def test_failsafe_negative_monitor_corner() -> None:
    corners = monitor_corners([(-1280, 0, 1280, 1024)])
    with pytest.raises(SafetyError):
        check_failsafe((-1280, 0), corners, None)


# --- check_blocked -------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("process", "blocked"),
    [
        ("keepass.exe", ["keepass.exe"]),
        ("KeePass.EXE", ["keepass"]),
        ("keepass.exe", ["KeePass"]),
        ("keepass", ["keepass.exe"]),
        ("keepass.exe", ["notepad", "KEEPASS"]),
    ],
)
def test_blocked_raises(process: str, blocked: list[str]) -> None:
    with pytest.raises(SafetyError):
        check_blocked(process, blocked)


def test_blocked_message_contains_app_name() -> None:
    with pytest.raises(SafetyError) as exc:
        check_blocked("keepass.exe", ["keepass"])
    assert "keepass" in str(exc.value).lower()


def test_blocked_not_in_list_ok() -> None:
    check_blocked("notepad.exe", ["keepass", "1password"])


def test_blocked_empty_list_ok() -> None:
    check_blocked("keepass.exe", [])


@pytest.mark.parametrize("process", [None, ""])
def test_blocked_no_process_ok(process: str | None) -> None:
    check_blocked(process, ["keepass", ""])


@pytest.mark.parametrize(
    ("process", "blocked", "expected"),
    [
        ("KeePass.EXE", ["notepad", "keepass"], True),
        ("notepad.exe", ["keepass"], False),
        ("keepass.exe", [], False),
        (None, ["keepass", ""], False),
        ("", ["keepass", ""], False),
    ],
)
def test_is_blocked_matches_check_blocked(
    process: str | None, blocked: list[str], expected: bool
) -> None:
    assert safety.is_blocked(process, blocked) is expected


# --- check_keyboard_target -----------------------------------------------------------------


def test_terminal_processes_is_frozenset_matching_contract() -> None:
    assert isinstance(TERMINAL_PROCESSES, frozenset)
    assert TERMINAL_PROCESSES == frozenset(CONTRACT_TERMINALS)


@pytest.mark.parametrize("name", CONTRACT_TERMINALS)
def test_keyboard_target_terminal_raises(name: str) -> None:
    bare = name[: -len(".exe")]
    for variant in (name, bare, name.upper(), bare.title(), name.title()):
        with pytest.raises(SafetyError) as exc:
            check_keyboard_target(variant)
        assert str(exc.value)


@pytest.mark.parametrize("name", CONTRACT_TERMINALS)
def test_keyboard_target_terminal_allowed(name: str) -> None:
    check_keyboard_target(name, allow_terminal_input=True)


def test_keyboard_target_notepad_ok() -> None:
    check_keyboard_target("notepad.exe")


def test_keyboard_target_none_ok() -> None:
    check_keyboard_target(None)


def test_keyboard_target_empty_ok() -> None:
    check_keyboard_target("")


@pytest.mark.parametrize("shell", SHELLS)
def test_shells_not_terminal_processes(shell: str) -> None:
    assert shell not in TERMINAL_PROCESSES
    check_keyboard_target(shell, window_class=ORDINARY_CLASS)
    check_keyboard_target(shell)


def test_terminal_window_classes_matches_contract() -> None:
    assert isinstance(TERMINAL_WINDOW_CLASSES, frozenset)
    assert TERMINAL_WINDOW_CLASSES == frozenset(CONTRACT_CLASSES)


@pytest.mark.parametrize("cls", sorted(CONTRACT_CLASSES))
@pytest.mark.parametrize("process", ["powershell.exe", "notepad.exe", None, ""])
def test_keyboard_target_terminal_class_raises(cls: str, process: str | None) -> None:
    with pytest.raises(SafetyError) as exc:
        check_keyboard_target(process, window_class=cls)
    assert str(exc.value)


@pytest.mark.parametrize("cls", sorted(CONTRACT_CLASSES))
def test_keyboard_target_terminal_class_allowed(cls: str) -> None:
    check_keyboard_target("powershell.exe", allow_terminal_input=True, window_class=cls)


def test_keyboard_target_class_case_sensitive() -> None:
    check_keyboard_target("notepad.exe", window_class="consolewindowclass")
    check_keyboard_target("notepad.exe", window_class="CONSOLEWINDOWCLASS")
    check_keyboard_target("notepad.exe", window_class="MINTTY")


def test_keyboard_target_ordinary_class_ok() -> None:
    check_keyboard_target("powershell.exe", window_class=ORDINARY_CLASS)


def test_keyboard_target_process_still_refused_with_ordinary_class() -> None:
    with pytest.raises(SafetyError):
        check_keyboard_target("WindowsTerminal", window_class=ORDINARY_CLASS)


def test_keyboard_target_own_host_raises_with_distinct_message() -> None:
    with pytest.raises(SafetyError) as host:
        check_keyboard_target("code.exe", window_class=ORDINARY_CLASS, is_own_host=True)
    with pytest.raises(SafetyError) as term:
        check_keyboard_target("cmd.exe", window_class="ConsoleWindowClass")
    assert str(host.value) != str(term.value)
    assert "front" in str(host.value).lower()


def test_keyboard_target_own_host_allowed() -> None:
    check_keyboard_target("code.exe", allow_terminal_input=True, is_own_host=True)


def test_keyboard_target_not_own_host_ok() -> None:
    check_keyboard_target("code.exe", window_class=ORDINARY_CLASS, is_own_host=False)


# --- check_password_field ------------------------------------------------------------------


def test_password_field_true_raises() -> None:
    with pytest.raises(SafetyError) as exc:
        check_password_field(True)
    assert str(exc.value)


def test_password_field_false_ok() -> None:
    check_password_field(False)


def test_module_exports() -> None:
    for name in ("SafetyError", "TERMINAL_PROCESSES", "monitor_corners", "check_failsafe"):
        assert hasattr(safety, name)
