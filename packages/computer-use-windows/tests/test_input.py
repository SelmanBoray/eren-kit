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


# ------------------------------------------- pure helpers (no Windows API calls)


def _decode_batches(batches: list[list[inp._Input]]) -> str:
    """Rebuild the typed text from key-down events (Enter -> newline, Tab -> tab)."""
    units: list[int] = []
    out: list[str] = []

    def flush() -> None:
        if units:
            raw = b"".join(u.to_bytes(2, "little") for u in units)
            out.append(raw.decode("utf-16-le"))
            units.clear()

    for batch in batches:
        for event in batch:
            assert event.type == inp._INPUT_KEYBOARD
            ki = event.u.ki
            if ki.dwFlags & inp._KEYEVENTF_KEYUP:
                continue
            if ki.dwFlags & inp._KEYEVENTF_UNICODE:
                units.append(ki.wScan)
            else:
                flush()
                out.append({inp._VK_RETURN: "\n", inp._VK_TAB: "\t"}[ki.wVk])
    flush()
    return "".join(out)


def test_type_text_batches_turkish_roundtrip() -> None:
    text = "ğüşıöçİĞÜŞÖÇ"
    assert _decode_batches(inp._type_text_batches(text)) == text


def test_type_text_batches_astral_no_loss() -> None:
    text = "a😀b"
    assert _decode_batches(inp._type_text_batches(text)) == text


def test_type_text_batches_surrogate_pair_stays_in_one_batch() -> None:
    # The emoji lands exactly on the batch boundary.
    text = "x" * (inp.TYPE_BATCH_CHARS - 1) + "😀" + "y"
    batches = inp._type_text_batches(text)
    assert _decode_batches(batches) == text
    for batch in batches:
        downs = [
            e.u.ki.wScan
            for e in batch
            if e.u.ki.dwFlags & inp._KEYEVENTF_UNICODE and not e.u.ki.dwFlags & inp._KEYEVENTF_KEYUP
        ]
        for idx, unit in enumerate(downs):
            if 0xD800 <= unit <= 0xDBFF:
                assert idx + 1 < len(downs)
                assert 0xDC00 <= downs[idx + 1] <= 0xDFFF


def test_type_text_batches_crlf_is_single_enter() -> None:
    batches = inp._type_text_batches("a\r\nb")
    events = [e for batch in batches for e in batch]
    enters_down = [
        e
        for e in events
        if e.u.ki.wVk == inp._VK_RETURN and not e.u.ki.dwFlags & inp._KEYEVENTF_KEYUP
    ]
    assert len(enters_down) == 1
    assert _decode_batches(batches) == "a\nb"


@pytest.mark.parametrize(
    ("text", "vk", "expected"),
    [
        ("a\nb", 0x0D, "a\nb"),
        ("a\rb", 0x0D, "a\nb"),
        ("a\tb", 0x09, "a\tb"),
    ],
)
def test_type_text_batches_enter_and_tab_end_a_batch(text: str, vk: int, expected: str) -> None:
    batches = inp._type_text_batches(text)
    assert len(batches) == 2
    # First batch: "a" (down, up) then the key (down, up); the last event is the key's up.
    assert len(batches[0]) == 4
    assert batches[0][-1].u.ki.wVk == vk
    assert batches[0][-2].u.ki.wVk == vk
    assert _decode_batches(batches) == expected


def test_type_text_batches_only_newline() -> None:
    batches = inp._type_text_batches("\n")
    assert len(batches) == 1
    assert _decode_batches(batches) == "\n"


def test_type_text_batches_empty_is_rejected() -> None:
    # Pinned: empty text is an error, not an empty batch list.
    with pytest.raises(ValueError):
        inp._type_text_batches("")


def test_type_text_batches_long_plain_text_respects_limit() -> None:
    text = "ab" * (inp.TYPE_BATCH_CHARS * 3 // 2 + 7)
    batches = inp._type_text_batches(text)
    assert len(batches) > 1
    for batch in batches:
        assert len(batch) <= 2 * inp.TYPE_BATCH_CHARS  # key down + key up per character
    assert _decode_batches(batches) == text


_VRECTS = [(-1920, 0, 3840, 1080), (-1280, -200, 3200, 1224), (0, 0, 1920, 1080)]


@pytest.mark.parametrize("vrect", _VRECTS)
def test_normalize_denormalize_roundtrip(vrect: tuple[int, int, int, int]) -> None:
    left, top, width, height = vrect
    xs = [left, left + 1, left + width // 3, left + width // 2, left + width - 1]
    ys = [top, top + 1, top + height // 3, top + height // 2, top + height - 1]
    for x in xs:
        for y in ys:
            nx, ny = inp._normalize(x, y, vrect)
            rx, ry = inp._denormalize(nx, ny, vrect)
            assert abs(rx - x) <= 1
            assert abs(ry - y) <= 1


@pytest.mark.parametrize("vrect", _VRECTS)
def test_normalize_corners_map_to_extremes(vrect: tuple[int, int, int, int]) -> None:
    left, top, width, height = vrect
    assert inp._normalize(left, top, vrect) == (0, 0)
    nx, ny = inp._normalize(left + width - 1, top + height - 1, vrect)
    assert 0 <= nx <= 65535
    assert 0 <= ny <= 65535
    assert nx > 65535 - 65536 // width - 1
    assert ny > 65535 - 65536 // height - 1
    # Out-of-range pixels are clamped to 0..65535.
    assert inp._normalize(left - 500, top - 500, vrect) == (0, 0)
    assert inp._normalize(left + width + 500, top + height + 500, vrect) == (65535, 65535)


def test_release_events_empty() -> None:
    assert inp._release_events_for([]) == []


def _key_state(event: inp._Input) -> tuple[int, bool]:
    return event.u.ki.wVk, bool(event.u.ki.dwFlags & inp._KEYEVENTF_KEYUP)


def test_release_events_each_held_key_once_in_reverse_order() -> None:
    ctrl, shift, a = 0xA2, 0xA0, 0x41
    events = [inp._key_input(vk, up=False) for vk in (ctrl, shift, a)]
    released = inp._release_events_for(events)
    assert [_key_state(e) for e in released] == [(a, True), (shift, True), (ctrl, True)]


def test_release_events_skips_already_released_and_dedups() -> None:
    events = [
        inp._key_input(0x41, up=False),
        inp._key_input(0x41, up=True),
        inp._key_input(0x42, up=False),
        inp._key_input(0x42, up=False),
    ]
    assert [_key_state(e) for e in inp._release_events_for(events)] == [(0x42, True)]


def test_release_events_mouse_button() -> None:
    events = [inp._button_input("left", up=False), inp._key_input(0x11, up=False)]
    released = inp._release_events_for(events)
    assert len(released) == 2
    assert released[0].type == inp._INPUT_KEYBOARD
    assert released[1].type == inp._INPUT_MOUSE
    assert released[1].u.mi.dwFlags == inp._BUTTON_FLAGS["left"][1]
    after_up = inp._release_events_for([*events, inp._button_input("left", up=True)])
    assert len(after_up) == 1
    assert after_up[0].type == inp._INPUT_KEYBOARD


def test_drag_path_ends_at_destination_and_stays_in_rect() -> None:
    x0, y0, x1, y1 = 100, 400, 700, 50
    path = inp._drag_path(x0, y0, x1, y1)
    assert path[-1] == (x1, y1)
    for px, py in path:
        assert min(x0, x1) <= px <= max(x0, x1)
        assert min(y0, y1) <= py <= max(y0, y1)


def test_drag_path_step_count_bounds() -> None:
    assert len(inp._drag_path(0, 0, 1, 0)) == inp.DRAG_MIN_STEPS
    assert len(inp._drag_path(0, 0, 100000, 0)) == inp.DRAG_MAX_STEPS
    distance = inp.DRAG_STEP_PX * (inp.DRAG_MIN_STEPS + 4)
    assert len(inp._drag_path(0, 0, distance, 0)) == inp.DRAG_MIN_STEPS + 4


def test_drag_path_same_start_and_end() -> None:
    path = inp._drag_path(5, 7, 5, 7)
    assert len(path) == inp.DRAG_MIN_STEPS
    assert set(path) == {(5, 7)}
