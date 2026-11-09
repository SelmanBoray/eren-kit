"""Unit tests for computer_use_windows.input (no real input is ever sent)."""

from __future__ import annotations

import string
import sys

import pytest

from computer_use_windows import input as inp

windows_only = pytest.mark.skipif(sys.platform != "win32", reason="Windows only")

CANONICAL_NAMES = (
    list(string.ascii_lowercase)
    + list(string.digits)
    + [f"f{i}" for i in range(1, 25)]
    + [
        "enter", "esc", "tab", "space", "backspace", "delete", "insert", "home", "end",
        "pageup", "pagedown", "up", "down", "left", "right", "capslock", "printscreen",
        "menu", "ctrl", "alt", "shift", "win",
        "minus", "plus", "equal", "comma", "period", "slash", "backslash", "semicolon",
        "quote", "backquote", "bracketleft", "bracketright",
    ]
)  # fmt: skip

ALIASES = {
    "return": "enter",
    "escape": "esc",
    "del": "delete",
    "ins": "insert",
    "pgup": "pageup",
    "pgdn": "pagedown",
    "prtsc": "printscreen",
    "apps": "menu",
    "control": "ctrl",
    "super": "win",
    "meta": "win",
    "cmd": "win",
}

SINGLE_VK = {
    "enter": 0x0D,
    "esc": 0x1B,
    "tab": 0x09,
    "space": 0x20,
    "backspace": 0x08,
    "f1": 0x70,
    "f24": 0x87,
    "win": 0x5B,
}

GENERIC_OR_LEFT = {"ctrl": {0x11, 0xA2}, "alt": {0x12, 0xA4}, "shift": {0x10, 0xA0}}
MODIFIER_VKS = {0x11, 0xA2, 0x12, 0xA4, 0x10, 0xA0, 0x5B}


# ---------------------------------------------------------------- KEY_NAMES


def test_key_names_is_frozenset() -> None:
    assert isinstance(inp.KEY_NAMES, frozenset)


@pytest.mark.parametrize("name", CANONICAL_NAMES)
def test_key_names_contains_canonical(name: str) -> None:
    assert name in inp.KEY_NAMES


@pytest.mark.parametrize("alias", sorted(ALIASES))
def test_key_names_contains_alias(alias: str) -> None:
    assert alias in inp.KEY_NAMES


def test_key_names_all_lowercase() -> None:
    assert all(n == n.lower() for n in inp.KEY_NAMES)


# ---------------------------------------------------------------- parse_keys


@pytest.mark.parametrize("ch", string.ascii_lowercase)
def test_parse_letters(ch: str) -> None:
    assert inp.parse_keys(ch) == [[ord(ch.upper())]]


@pytest.mark.parametrize("d", string.digits)
def test_parse_digits(d: str) -> None:
    assert inp.parse_keys(d) == [[ord(d)]]


@pytest.mark.parametrize("n", range(1, 25))
def test_parse_function_keys(n: int) -> None:
    assert inp.parse_keys(f"f{n}") == [[0x70 + n - 1]]


@pytest.mark.parametrize(("name", "vk"), sorted(SINGLE_VK.items()))
def test_parse_single_vk(name: str, vk: int) -> None:
    assert inp.parse_keys(name) == [[vk]]


@pytest.mark.parametrize("name", sorted(GENERIC_OR_LEFT))
def test_parse_modifier_vk(name: str) -> None:
    chords = inp.parse_keys(name)
    assert len(chords) == 1 and len(chords[0]) == 1
    assert chords[0][0] in GENERIC_OR_LEFT[name]


def test_parse_ctrl_s() -> None:
    chords = inp.parse_keys("ctrl+s")
    assert len(chords) == 1
    assert len(chords[0]) == 2
    assert chords[0][0] in GENERIC_OR_LEFT["ctrl"]
    assert chords[0][1] == ord("S")


def test_parse_ctrl_shift_esc() -> None:
    chords = inp.parse_keys("ctrl+shift+esc")
    assert len(chords) == 1
    chord = chords[0]
    assert len(chord) == 3
    assert chord[0] in GENERIC_OR_LEFT["ctrl"]
    assert chord[1] in GENERIC_OR_LEFT["shift"]
    assert chord[2] == 0x1B


def test_parse_win_chord() -> None:
    assert inp.parse_keys("win+d")[0] == [0x5B, ord("D")]


def test_modifiers_first_regardless_of_order() -> None:
    chord = inp.parse_keys("s+ctrl+shift")[0]
    assert len(chord) == 3
    assert chord[-1] == ord("S")
    assert all(vk in MODIFIER_VKS for vk in chord[:-1])


def test_parse_sequence() -> None:
    assert inp.parse_keys("tab tab enter") == [[0x09], [0x09], [0x0D]]


def test_parse_sequence_extra_whitespace() -> None:
    assert inp.parse_keys("  tab \t enter\n") == [[0x09], [0x0D]]


def test_parse_mixed_sequence() -> None:
    chords = inp.parse_keys("ctrl+a delete")
    assert len(chords) == 2
    assert chords[0][-1] == ord("A")
    assert chords[1] == inp.parse_keys("delete")[0]


def test_parse_case_insensitive() -> None:
    assert inp.parse_keys("CTRL+S") == inp.parse_keys("ctrl+s")
    assert inp.parse_keys("Ctrl+Shift+Esc") == inp.parse_keys("ctrl+shift+esc")
    assert inp.parse_keys("ENTER") == inp.parse_keys("enter")
    assert inp.parse_keys("F5") == [[0x74]]


@pytest.mark.parametrize(("alias", "canonical"), sorted(ALIASES.items()))
def test_alias_matches_canonical(alias: str, canonical: str) -> None:
    assert inp.parse_keys(alias) == inp.parse_keys(canonical)


def test_alias_in_chord() -> None:
    assert inp.parse_keys("control+pgdn") == inp.parse_keys("ctrl+pagedown")
    assert inp.parse_keys("cmd+e") == inp.parse_keys("win+e")


@pytest.mark.parametrize("name", CANONICAL_NAMES)
def test_every_canonical_name_parses(name: str) -> None:
    chords = inp.parse_keys(name)
    assert len(chords) == 1
    assert len(chords[0]) == 1
    assert 0 < chords[0][0] < 0x100


def test_plus_and_equal_parse() -> None:
    assert len(inp.parse_keys("plus")) == 1
    assert len(inp.parse_keys("ctrl+plus")[0]) == 2
    assert len(inp.parse_keys("equal")) == 1


def test_unknown_token_names_token() -> None:
    with pytest.raises(ValueError, match="bogus"):
        inp.parse_keys("bogus")


def test_unknown_token_in_chord_and_sequence() -> None:
    with pytest.raises(ValueError, match="zzzkey"):
        inp.parse_keys("ctrl+zzzkey")
    with pytest.raises(ValueError, match="nonsense"):
        inp.parse_keys("tab nonsense enter")


def test_two_non_modifier_keys_rejected() -> None:
    with pytest.raises(ValueError):
        inp.parse_keys("a+b")
    with pytest.raises(ValueError):
        inp.parse_keys("ctrl+enter+tab")


@pytest.mark.parametrize("spec", ["", "   ", "\t\n"])
def test_empty_spec_rejected(spec: str) -> None:
    with pytest.raises(ValueError):
        inp.parse_keys(spec)


# ------------------------------------------------- validation before sending
# Safety: every pointer call below uses the CURRENT cursor position as coordinates, so
# even an implementation that sends input before validating cannot move the mouse.


@pytest.fixture
def pos() -> tuple[int, int]:
    if sys.platform != "win32":
        pytest.skip("Windows only")
    return inp.cursor_position()


@windows_only
def test_cursor_position_returns_int_pair() -> None:
    x, y = inp.cursor_position()
    assert isinstance(x, int) and isinstance(y, int)


def test_click_bad_button(pos: tuple[int, int]) -> None:
    with pytest.raises(ValueError):
        inp.click(*pos, button="bogus")


@pytest.mark.parametrize("count", [0, 4, -1])
def test_click_bad_count(pos: tuple[int, int], count: int) -> None:
    with pytest.raises(ValueError):
        inp.click(*pos, count=count)


def test_click_bad_modifier(pos: tuple[int, int]) -> None:
    with pytest.raises(ValueError):
        inp.click(*pos, modifiers=["bogus"])


def test_scroll_bad_direction(pos: tuple[int, int]) -> None:
    with pytest.raises(ValueError):
        inp.scroll(*pos, "sideways")


@pytest.mark.parametrize("amount", [0, 51, -3])
def test_scroll_bad_amount(pos: tuple[int, int], amount: int) -> None:
    with pytest.raises(ValueError):
        inp.scroll(*pos, "down", amount=amount)


@pytest.mark.parametrize("repeat", [0, 101, -1])
def test_press_keys_bad_repeat(repeat: int) -> None:
    with pytest.raises(ValueError):
        inp.press_keys("shift", repeat=repeat)


def test_press_keys_unknown_key_raises_before_sending() -> None:
    with pytest.raises(ValueError, match="bogus"):
        inp.press_keys("bogus")


def test_type_text_empty() -> None:
    with pytest.raises(ValueError):
        inp.type_text("")


def test_drag_bad_button(pos: tuple[int, int]) -> None:
    with pytest.raises(ValueError):
        inp.drag(pos[0], pos[1], pos[0], pos[1], button="bogus")
