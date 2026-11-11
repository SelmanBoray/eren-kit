"""Mouse and keyboard injection through user32 ``SendInput`` (ctypes only).

All coordinates are *screen space*: physical pixels on the Windows virtual desktop, negative for
monitors left of / above the primary. The server makes the process per-monitor DPI aware at
startup; this module never changes DPI awareness itself.

Design notes (for reviewers)
----------------------------
* Pointer placement: one ``MOUSEEVENTF_MOVE | ABSOLUTE | VIRTUALDESK`` event, normalized over the
  virtual-desktop rectangle as ``ceil((x - left) * 65536 / width)``. Windows' reverse mapping is
  undocumented; under the commonly observed ``floor(n * width / 65536)`` (or plain rounding) this
  gives exactly ``x - left`` for every pixel. The result is therefore read back with
  ``GetCursorPos``; if the pointer landed elsewhere (another rounding rule, DPI virtualization in
  a DPI-unaware host) it is corrected with ``SetCursorPos``, and if even that does not stick a
  ``RuntimeError`` is raised instead of clicking at the wrong place. Button and wheel events
  carry no coordinates, so they act at the verified pointer position.
* Keys are sent by virtual-key code plus the scan code of the foreground window's keyboard layout
  (browsers derive ``KeyboardEvent.code`` from it). Keys of the E0 group (arrows, the
  insert/delete/home/end/page block, right-side modifiers, Windows and menu keys, print screen,
  ...) get ``KEYEVENTF_EXTENDEDKEY``.
* Text uses ``KEYEVENTF_UNICODE`` (keyboard-layout independent); characters outside the BMP are
  sent as UTF-16 surrogate pairs. ``\\n``, ``\\r\\n`` and ``\\r`` press Enter, ``\\t`` presses Tab.
* Everything that is pressed is released on every path, including exceptions; a partially
  inserted ``SendInput`` batch releases what was inserted before the error is raised.
* Building INPUT records (the pure ``_*_input`` / ``_*_events`` helpers) is separate from sending
  (``_send``), so the records can be inspected without injecting anything.
* Interruption: inside ``with interrupt_check(fn):`` the multi-step actions (wheel notches, drag
  steps, chords and repeats of ``press_keys``, batches of ``type_text``) call ``fn`` between
  steps. An exception from ``fn`` stops the action there; anything held down is released first.
  The server uses this to re-check the failsafe during long input.
* ``plan_keys`` and ``type_text_segments`` split a key spec / a text into the steps a caller can
  send one by one with its own safety checks in between (the server re-checks the keyboard target
  after every chord and after every Tab/Enter of a text).
"""

from __future__ import annotations

import ctypes
import functools
import logging
import math
import operator
import re
import sys
import threading
import time
from collections.abc import Callable, Iterator, Sequence
from contextlib import contextmanager
from typing import Any

__all__ = [
    "KEY_NAMES",
    "MAX_KEY_EVENTS",
    "chord_types_text",
    "click",
    "cursor_position",
    "drag",
    "focus_settle_after_chord",
    "focus_settle_after_text",
    "interrupt_check",
    "move",
    "parse_keys",
    "plan_keys",
    "press_keys",
    "scroll",
    "type_text",
    "type_text_segments",
]

log = logging.getLogger(__name__)

# --- Timing (seconds) -------------------------------------------------------------------------
MOVE_SETTLE = 0.03  # pointer placed -> first press: lets hover state / WM_MOUSEMOVE be handled
MOVE_VERIFY_TIMEOUT = 0.03  # how long an injected move may take to show up in GetCursorPos
MOVE_VERIFY_POLL = 0.005
CLICK_HOLD = 0.012  # button down -> up
CLICK_INTERVAL = 0.03  # between the clicks of a double/triple click (default limit: 500 ms)
MODIFIER_SETTLE = 0.02  # modifiers down -> click, and last click -> modifiers up
KEY_HOLD = 0.012  # chord held down
KEY_GAP = 0.02  # between chords and repeats
TYPE_BATCH_CHARS = 50  # characters per SendInput call in type_text (Enter/Tab also end a batch)
# The first piece of a type_text call is this short. A focus change caused by the text itself
# most often happens on its first character (a letter that works as an Alt-less mnemonic or a
# Space while a dialog button has the focus); the safety checks run after every piece, so at most
# this many characters can land in a field the checks would have refused.
TYPE_FIRST_PIECE_CHARS = 1
TYPE_BATCH_PAUSE = 0.01
SCROLL_INTERVAL = 0.015  # between wheel notches
DRAG_PRESS_HOLD = 0.05  # button down -> first move
DRAG_STEP_PX = 15  # target distance per intermediate drag step
DRAG_MIN_STEPS = 8
DRAG_MAX_STEPS = 50
DRAG_STEP_DELAY = 0.01
DRAG_DROP_HOLD = 0.1  # hover at the destination before releasing (drop targets need a moment)
RELEASE_RETRY_DELAY = 0.05
# Wait after a key that may move the keyboard focus, before the next safety check reads the focus.
# The target processes injected input asynchronously: a responsive Win32 app moves the focus
# within one message-loop turn (< 1 frame, ~16 ms), but Chromium/Electron forward the key to a
# renderer process and update the accessibility tree UI Automation reads a few frames later
# (~2-3 frames). Tab only moves focus inside the window: 50 ms. Enter, Esc, F-keys and
# ctrl/alt/win shortcuts may close a dialog or open a window: 100 ms. Not measured on a real
# desktop; a focus change that takes longer (a page load after Enter) is not covered.
FOCUS_SETTLE_TAB = 0.05
FOCUS_SETTLE = 0.1

# Most key presses (chords x repeat) in one press_keys call. 200 covers any single chord at the
# repeat limit (100) and a two-chord pattern repeated 100 times ("shift+tab space"), which is
# more than menus, lists and forms need. A plain chord takes ~32 ms (~6.5 s for 200); a chord
# that may move the focus waits FOCUS_SETTLE before the next check (at most ~20 s for 200). The
# failsafe is checked before every press, so even that stays stoppable. Text belongs in type_text.
MAX_KEY_EVENTS = 200

# --- Win32 constants --------------------------------------------------------------------------
_INPUT_MOUSE = 0
_INPUT_KEYBOARD = 1

_KEYEVENTF_EXTENDEDKEY = 0x0001
_KEYEVENTF_KEYUP = 0x0002
_KEYEVENTF_UNICODE = 0x0004

_MOUSEEVENTF_MOVE = 0x0001
_MOUSEEVENTF_LEFTDOWN = 0x0002
_MOUSEEVENTF_LEFTUP = 0x0004
_MOUSEEVENTF_RIGHTDOWN = 0x0008
_MOUSEEVENTF_RIGHTUP = 0x0010
_MOUSEEVENTF_MIDDLEDOWN = 0x0020
_MOUSEEVENTF_MIDDLEUP = 0x0040
_MOUSEEVENTF_WHEEL = 0x0800
_MOUSEEVENTF_HWHEEL = 0x1000
_MOUSEEVENTF_MOVE_NOCOALESCE = 0x2000
_MOUSEEVENTF_VIRTUALDESK = 0x4000
_MOUSEEVENTF_ABSOLUTE = 0x8000
_WHEEL_DELTA = 120

_SM_SWAPBUTTON = 23
_SM_XVIRTUALSCREEN = 76
_SM_YVIRTUALSCREEN = 77
_SM_CXVIRTUALSCREEN = 78
_SM_CYVIRTUALSCREEN = 79
_MONITOR_DEFAULTTONULL = 0
_MAPVK_VK_TO_VSC_EX = 4

_VK_TAB = 0x09
_VK_RETURN = 0x0D
_VK_SHIFT = 0x10
_VK_CONTROL = 0x11
_VK_MENU = 0x12  # Alt
_VK_LWIN = 0x5B
_VK_MASK = 0xE8  # unassigned VK, tapped before releasing Alt/Win held for a click (no menu pop-up)

_COORD_LIMIT = 1_000_000  # sanity bound, far beyond any real virtual desktop


# --- INPUT structures (fixed-width types: identical layout on every platform) ------------------
class _MouseInput(ctypes.Structure):
    _fields_ = (
        ("dx", ctypes.c_int32),
        ("dy", ctypes.c_int32),
        ("mouseData", ctypes.c_uint32),
        ("dwFlags", ctypes.c_uint32),
        ("time", ctypes.c_uint32),
        ("dwExtraInfo", ctypes.c_size_t),
    )


class _KeybdInput(ctypes.Structure):
    _fields_ = (
        ("wVk", ctypes.c_uint16),
        ("wScan", ctypes.c_uint16),
        ("dwFlags", ctypes.c_uint32),
        ("time", ctypes.c_uint32),
        ("dwExtraInfo", ctypes.c_size_t),
    )


class _HardwareInput(ctypes.Structure):
    _fields_ = (
        ("uMsg", ctypes.c_uint32),
        ("wParamL", ctypes.c_uint16),
        ("wParamH", ctypes.c_uint16),
    )


class _InputUnion(ctypes.Union):
    _fields_ = (("mi", _MouseInput), ("ki", _KeybdInput), ("hi", _HardwareInput))


class _Input(ctypes.Structure):
    _fields_ = (("type", ctypes.c_uint32), ("u", _InputUnion))


class _Point(ctypes.Structure):
    _fields_ = (("x", ctypes.c_int32), ("y", ctypes.c_int32))


# --- Key names --------------------------------------------------------------------------------
_MODIFIER_VK: dict[str, int] = {
    "ctrl": _VK_CONTROL,
    "alt": _VK_MENU,
    "shift": _VK_SHIFT,
    "win": _VK_LWIN,
}

_NAMED_VK: dict[str, int] = {
    "enter": _VK_RETURN,
    "esc": 0x1B,
    "tab": _VK_TAB,
    "space": 0x20,
    "backspace": 0x08,
    "delete": 0x2E,
    "insert": 0x2D,
    "home": 0x24,
    "end": 0x23,
    "pageup": 0x21,
    "pagedown": 0x22,
    "up": 0x26,
    "down": 0x28,
    "left": 0x25,
    "right": 0x27,
    "capslock": 0x14,
    "printscreen": 0x2C,
    "menu": 0x5D,  # context-menu (apps) key, not Alt
    # VK_OEM_* keys, named after the US layout; the character they produce depends on the layout.
    "minus": 0xBD,
    "equal": 0xBB,
    "comma": 0xBC,
    "period": 0xBE,
    "slash": 0xBF,
    "backslash": 0xDC,
    "semicolon": 0xBA,
    "quote": 0xDE,
    "backquote": 0xC0,
    "bracketleft": 0xDB,
    "bracketright": 0xDD,
}

_ALIASES: dict[str, str] = {
    "return": "enter",
    "escape": "esc",
    "del": "delete",
    "ins": "insert",
    "pgup": "pageup",
    "pgdn": "pagedown",
    "prtsc": "printscreen",
    "apps": "menu",
    "plus": "equal",
    "control": "ctrl",
    "super": "win",
    "meta": "win",
    "cmd": "win",
}


def _build_vk_table() -> dict[str, int]:
    table: dict[str, int] = {**_MODIFIER_VK, **_NAMED_VK}
    table.update({chr(c): c - 0x20 for c in range(ord("a"), ord("z") + 1)})  # VK 'A'..'Z'
    table.update({str(d): 0x30 + d for d in range(10)})  # VK '0'..'9'
    table.update({f"f{i}": 0x6F + i for i in range(1, 25)})  # VK_F1 (0x70) .. VK_F24 (0x87)
    for alias, target in _ALIASES.items():
        table[alias] = table[target]
    return table


_VK_BY_NAME: dict[str, int] = _build_vk_table()

KEY_NAMES: frozenset[str] = frozenset(_VK_BY_NAME)

# Generic and side-specific modifier VKs (only the generic ones and VK_LWIN can be named).
_MODIFIER_VKS: frozenset[int] = frozenset(
    {_VK_SHIFT, _VK_CONTROL, _VK_MENU, _VK_LWIN, 0x5C, 0xA0, 0xA1, 0xA2, 0xA3, 0xA4, 0xA5}
)

# Keys whose scan code carries the E0 prefix -> KEYEVENTF_EXTENDEDKEY.
_EXTENDED_VKS: frozenset[int] = frozenset(
    (
        0x03,  # VK_CANCEL (Break)
        *(0x21, 0x22, 0x23, 0x24),  # page up, page down, end, home
        *(0x25, 0x26, 0x27, 0x28),  # arrows
        *(0x2C, 0x2D, 0x2E),  # print screen, insert, delete
        *(0x5B, 0x5C, 0x5D),  # left/right Windows, apps (menu)
        *(0x6F, 0x90),  # numpad divide, num lock
        *(0xA3, 0xA5),  # right ctrl, right alt
        *range(0xA6, 0xB8),  # browser, volume, media and launch keys
    )
)

_VALID_KEYS_HINT = (
    "Valid names: a-z, 0-9, f1-f24, enter, esc, tab, space, backspace, delete, insert, home, end, "
    "pageup, pagedown, up, down, left, right, capslock, printscreen, menu, ctrl, alt, shift, win, "
    "minus, plus, comma, period, slash, backslash, semicolon, quote, backquote, bracketleft, "
    "bracketright. Use type_text for text."
)

_BUTTONS = ("left", "right", "middle")
_DIRECTIONS = ("up", "down", "left", "right")
_BUTTON_FLAGS: dict[str, tuple[int, int]] = {
    "left": (_MOUSEEVENTF_LEFTDOWN, _MOUSEEVENTF_LEFTUP),
    "right": (_MOUSEEVENTF_RIGHTDOWN, _MOUSEEVENTF_RIGHTUP),
    "middle": (_MOUSEEVENTF_MIDDLEDOWN, _MOUSEEVENTF_MIDDLEUP),
}

_LOCK = threading.RLock()  # one input action at a time, even from several worker threads

# Per-thread interruption check, see interrupt_check(). Called between the steps of an action with
# the cursor position this module expects (it just put the pointer there), or None for keys.
InterruptCheck = Callable[[tuple[int, int] | None], None]
_interrupt = threading.local()


@contextmanager
def interrupt_check(check: InterruptCheck | None) -> Iterator[None]:
    """Make multi-step actions in this thread call ``check(expected_cursor)`` between steps.

    ``expected_cursor`` is where this module last put the pointer (wheel notches, drag steps) or
    None (keys, text). An exception raised by ``check`` stops the action: held keys and buttons
    are released, then the exception propagates. ``None`` disables checking inside the block.
    """
    previous = getattr(_interrupt, "check", None)
    _interrupt.check = check
    try:
        yield
    finally:
        _interrupt.check = previous


def _checkpoint(expected: tuple[int, int] | None = None) -> None:
    check: InterruptCheck | None = getattr(_interrupt, "check", None)
    if check is not None:
        check(expected)


# --- Validation (pure) ------------------------------------------------------------------------
def _as_int(name: str, value: Any) -> int:
    if isinstance(value, bool):
        raise ValueError(f"{name} must be an integer, got {value!r}")
    try:
        return operator.index(value)
    except TypeError:
        raise ValueError(f"{name} must be an integer, got {value!r}") from None


def _int_in_range(name: str, value: Any, lo: int, hi: int) -> int:
    number = _as_int(name, value)
    if not lo <= number <= hi:
        raise ValueError(f"{name} must be between {lo} and {hi}, got {number}")
    return number


def _coord(name: str, value: Any) -> int:
    number = _as_int(name, value)
    if abs(number) > _COORD_LIMIT:
        raise ValueError(f"{name}={number} is not a plausible screen coordinate")
    return number


def _choice(name: str, value: Any, choices: tuple[str, ...]) -> str:
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in choices:
            return normalized
    raise ValueError(f"{name} must be one of: {', '.join(choices)} (got {value!r})")


def _modifier_vks(modifiers: Sequence[str] | str | None) -> list[int]:
    """Validate click modifiers (ctrl/alt/shift/win or their aliases); duplicates are dropped."""
    if modifiers is None:
        return []
    if isinstance(modifiers, str):
        items: list[Any] = [part for part in re.split(r"[+,\s]+", modifiers) if part]
    else:
        try:
            items = list(modifiers)
        except TypeError:
            raise ValueError("modifiers must be a list such as ['ctrl', 'shift']") from None
    vks: list[int] = []
    for item in items:
        name = item.strip().lower() if isinstance(item, str) else None
        vk = _VK_BY_NAME.get(name) if name else None
        if vk is None or vk not in _MODIFIER_VKS:
            raise ValueError(f"unknown modifier {item!r}; use ctrl, alt, shift or win")
        if vk not in vks:
            vks.append(vk)
    return vks


def parse_keys(spec: str) -> list[list[int]]:
    """Parse a key spec into chords of virtual-key codes, modifiers first.

    Chords are separated by whitespace, keys inside a chord joined by ``+``, case-insensitive:
    ``"ctrl+s"`` -> ``[[0x11, 0x53]]``, ``"tab tab enter"`` -> three chords. A chord holds any
    modifiers plus at most one other key. Raises ``ValueError`` naming the offending token.
    """
    if not isinstance(spec, str):
        raise ValueError("keys must be a string such as 'ctrl+s' or 'tab tab enter'")
    chord_texts = spec.split()
    if not chord_texts:
        raise ValueError("no keys given; examples: 'ctrl+s', 'tab tab enter', 'alt+f4'")
    chords: list[list[int]] = []
    for chord_text in chord_texts:
        modifiers: list[int] = []
        others: list[str] = []
        other_vks: list[int] = []
        for part in chord_text.split("+"):
            name = part.lower()
            if not name:
                raise ValueError(
                    f"empty key name in {chord_text!r}: join keys with a single '+' "
                    "and write the +/= key as 'plus'"
                )
            vk = _VK_BY_NAME.get(name)
            if vk is None:
                raise ValueError(f"unknown key {part!r} in {spec!r}. {_VALID_KEYS_HINT}")
            if vk in modifiers or vk in other_vks:
                raise ValueError(f"key {part!r} appears twice in {chord_text!r}")
            if vk in _MODIFIER_VKS:
                modifiers.append(vk)
            else:
                others.append(part)
                other_vks.append(vk)
        if len(other_vks) > 1:
            raise ValueError(
                f"{chord_text!r} combines {len(other_vks)} non-modifier keys "
                f"({', '.join(others)}); a chord is modifiers plus one key. Separate keys with "
                "spaces to press them one after another, or use type_text for text."
            )
        chords.append(modifiers + other_vks)
    return chords


def plan_keys(spec: str, repeat: int = 1) -> list[tuple[str, list[int]]]:
    """Validate a key spec and expand it into the key presses to send, one ``(chord, vks)`` each.

    ``chord`` is the chord's own text (a valid spec for ``press_keys``), ``vks`` its parsed
    virtual-key codes; the list holds the chords of ``spec`` ``repeat`` times in order. Raises
    ``ValueError`` (before anything is sent) for a bad spec, a repeat outside 1..100, or more than
    ``MAX_KEY_EVENTS`` presses.
    """
    repeat = _int_in_range("repeat", repeat, 1, 100)
    chords = parse_keys(spec)
    total = len(chords) * repeat
    if total > MAX_KEY_EVENTS:
        raise ValueError(
            f"{len(chords)} chord(s) x repeat {repeat} = {total} key presses; one key call "
            f"allows at most {MAX_KEY_EVENTS}. Split it into several key calls, or use type_text "
            "for text."
        )
    texts = spec.split()
    return [
        (text, list(chord))
        for _ in range(repeat)
        for text, chord in zip(texts, chords, strict=True)
    ]


# Keys that type a character (letters, digits, space and the VK_OEM punctuation keys).
_TEXT_VKS: frozenset[int] = frozenset(
    {0x20, *range(0x30, 0x3A), *range(0x41, 0x5B), *range(0xBA, 0xC1), *range(0xDB, 0xDF)}
)
# Keys that edit or move inside a field and do not move the keyboard focus elsewhere.
_IN_FIELD_VKS: frozenset[int] = frozenset(
    {0x08, 0x2E, 0x2D, 0x24, 0x23, 0x21, 0x22, 0x25, 0x26, 0x27, 0x28, 0x14}
)
_CTRL_VKS = frozenset({_VK_CONTROL, 0xA2, 0xA3})
_ALT_VKS = frozenset({_VK_MENU, 0xA4, 0xA5})
_WIN_VKS = frozenset({_VK_LWIN, 0x5C})


def chord_types_text(chord: Sequence[int]) -> bool:
    """True if the chord types a character: a letter/digit/space/punctuation key, alone or with
    shift. ctrl+alt (+shift) counts too: Windows treats it as AltGr, which types characters such
    as ``@`` or ``{`` on many layouts. Win, or ctrl or alt alone, makes it a shortcut."""
    held = set(chord)
    keys = [vk for vk in chord if vk not in _MODIFIER_VKS]
    if not keys or keys[0] not in _TEXT_VKS or held & _WIN_VKS:
        return False
    return bool(held & _CTRL_VKS) == bool(held & _ALT_VKS)


def focus_settle_after_chord(chord: Sequence[int]) -> float:
    """Seconds to wait after ``chord`` before reading the keyboard focus again (0: none needed).

    Tab moves the focus inside the window; Enter, Esc, F-keys, the menu key and ctrl/alt/win
    shortcuts may close a dialog or open a window. Typing a character or editing/moving inside a
    field (arrows, home/end, page keys, backspace, delete) keeps the focus where it is.
    """
    held = set(chord)
    keys = [vk for vk in chord if vk not in _MODIFIER_VKS]
    if not keys:
        return 0.0  # a lone modifier
    if held & (_CTRL_VKS | _ALT_VKS | _WIN_VKS) and not chord_types_text(chord):
        return FOCUS_SETTLE
    if keys[0] == _VK_TAB:
        return FOCUS_SETTLE_TAB
    if keys[0] in _TEXT_VKS or keys[0] in _IN_FIELD_VKS:
        return 0.0
    return FOCUS_SETTLE


def focus_settle_after_text(piece: str, first: bool = False) -> float:
    """Seconds to wait after typing ``piece`` before reading the keyboard focus again (0: none).

    A piece ending in Tab or Enter (see ``type_text_segments``) is likely to have moved the
    focus, and so is the short first piece (``first``: a mnemonic letter, Space on a button).
    """
    if piece.endswith(("\r", "\n")):
        return FOCUS_SETTLE
    if piece.endswith("\t") or first:
        return FOCUS_SETTLE_TAB
    return 0.0


def type_text_segments(text: str) -> list[str]:
    """Validate ``text`` like ``type_text`` and split it into pieces to type one by one.

    A piece ends right after every Enter (``\\n``, ``\\r\\n``, ``\\r``) or Tab, because those can
    move the keyboard focus, after the first ``TYPE_FIRST_PIECE_CHARS`` characters (the text's
    own first key may move it too) and then after every ``TYPE_BATCH_CHARS`` characters, so the
    safety checks run again at regular points of a long text. Each piece is one ``type_text``
    batch; joined, the pieces give ``text`` back. ``\\r\\n`` and surrogate pairs are never split.
    Raises ``ValueError`` like ``type_text``.
    """
    _type_text_batches(text)  # validation only
    pieces: list[str] = []
    start = chars = 0
    i, length = 0, len(text)
    while i < length:
        ch = text[i]
        ends = ch in "\r\n\t"
        if ch == "\r" and i + 1 < length and text[i + 1] == "\n":
            i += 1
        elif 0xD800 <= ord(ch) <= 0xDBFF and i + 1 < length:
            i += 1  # validated above: a high surrogate here is followed by its low half
        i += 1
        chars += 1
        cap = TYPE_BATCH_CHARS if pieces else TYPE_FIRST_PIECE_CHARS
        if ends or chars >= cap:
            pieces.append(text[start:i])
            start, chars = i, 0
    if start < length:
        pieces.append(text[start:])
    return pieces


# --- INPUT builders (pure: no Windows calls) --------------------------------------------------
def _key_input(vk: int, *, up: bool, scan: int = 0) -> _Input:
    flags = _KEYEVENTF_KEYUP if up else 0
    if vk in _EXTENDED_VKS:
        flags |= _KEYEVENTF_EXTENDEDKEY
    event = _Input(type=_INPUT_KEYBOARD)
    event.u.ki = _KeybdInput(wVk=vk, wScan=scan & 0xFF, dwFlags=flags, time=0, dwExtraInfo=0)
    return event


def _unicode_input(unit: int, *, up: bool) -> _Input:
    flags = _KEYEVENTF_UNICODE | (_KEYEVENTF_KEYUP if up else 0)
    event = _Input(type=_INPUT_KEYBOARD)
    event.u.ki = _KeybdInput(wVk=0, wScan=unit, dwFlags=flags, time=0, dwExtraInfo=0)
    return event


def _tap(vk: int) -> list[_Input]:
    return [_key_input(vk, up=False), _key_input(vk, up=True)]


def _unicode_tap(unit: int) -> list[_Input]:
    return [_unicode_input(unit, up=False), _unicode_input(unit, up=True)]


def _chord_events(chord: Sequence[int]) -> tuple[list[_Input], list[_Input]]:
    """(downs in order, ups in reverse order) for one chord."""
    downs = [_key_input(vk, up=False) for vk in chord]
    ups = [_key_input(vk, up=True) for vk in reversed(chord)]
    return downs, ups


def _type_text_batches(text: str) -> list[list[_Input]]:
    """Validate ``text`` and build its events, grouped into SendInput batches.

    A character's events never straddle two batches; a batch ends after Enter or Tab.
    """
    if not isinstance(text, str):
        raise ValueError("text must be a string")
    if not text:
        raise ValueError("text is empty; nothing to type")
    batches: list[list[_Input]] = []
    batch: list[_Input] = []
    chars_in_batch = 0
    i, length = 0, len(text)
    while i < length:
        ch = text[i]
        cp = ord(ch)
        ends_batch = False
        if ch in "\r\n":
            if ch == "\r" and i + 1 < length and text[i + 1] == "\n":
                i += 1  # "\r\n" is one Enter
            group = _tap(_VK_RETURN)
            ends_batch = True
        elif ch == "\t":
            group = _tap(_VK_TAB)
            ends_batch = True
        elif cp < 0x20 or cp == 0x7F:
            raise ValueError(
                f"text contains control character U+{cp:04X} at index {i}; type_text accepts only "
                "\\n, \\r and \\t as control characters. Press other keys with key "
                "(e.g. 'backspace')."
            )
        elif 0xD800 <= cp <= 0xDBFF and i + 1 < length and 0xDC00 <= ord(text[i + 1]) <= 0xDFFF:
            group = _unicode_tap(cp) + _unicode_tap(ord(text[i + 1]))  # already a UTF-16 pair
            i += 1
        elif 0xD800 <= cp <= 0xDFFF:
            raise ValueError(f"text contains an unpaired UTF-16 surrogate U+{cp:04X} at index {i}")
        elif cp > 0xFFFF:
            offset = cp - 0x10000
            group = _unicode_tap(0xD800 + (offset >> 10)) + _unicode_tap(0xDC00 + (offset & 0x3FF))
        else:
            group = _unicode_tap(cp)
        batch.extend(group)
        chars_in_batch += 1
        if ends_batch or chars_in_batch >= TYPE_BATCH_CHARS:
            batches.append(batch)
            batch, chars_in_batch = [], 0
        i += 1
    if batch:
        batches.append(batch)
    return batches


def _fill_scan_codes(events: Sequence[_Input], scan_of: Callable[[int], int]) -> None:
    """Set the scan code of virtual-key keyboard events (unicode events keep theirs)."""
    for event in events:
        if event.type == _INPUT_KEYBOARD:
            ki = event.u.ki
            if not ki.dwFlags & _KEYEVENTF_UNICODE and ki.wVk:
                ki.wScan = scan_of(ki.wVk) & 0xFF


def _normalize(x: int, y: int, vrect: tuple[int, int, int, int]) -> tuple[int, int]:
    """Screen pixel -> 0..65535 absolute coordinate over the virtual desktop (round-trip exact)."""
    left, top, width, height = vrect
    nx = ((x - left) * 65536 + width - 1) // width
    ny = ((y - top) * 65536 + height - 1) // height
    return min(max(nx, 0), 65535), min(max(ny, 0), 65535)


def _denormalize(nx: int, ny: int, vrect: tuple[int, int, int, int]) -> tuple[int, int]:
    """Windows' mapping of an absolute VIRTUALDESK coordinate back to a pixel (for checks)."""
    left, top, width, height = vrect
    return left + nx * width // 65536, top + ny * height // 65536


def _mouse_input(flags: int, dx: int = 0, dy: int = 0, data: int = 0) -> _Input:
    event = _Input(type=_INPUT_MOUSE)
    event.u.mi = _MouseInput(
        dx=dx, dy=dy, mouseData=data & 0xFFFFFFFF, dwFlags=flags, time=0, dwExtraInfo=0
    )
    return event


def _move_input(
    x: int, y: int, vrect: tuple[int, int, int, int], *, nocoalesce: bool = False
) -> _Input:
    nx, ny = _normalize(x, y, vrect)
    flags = _MOUSEEVENTF_MOVE | _MOUSEEVENTF_ABSOLUTE | _MOUSEEVENTF_VIRTUALDESK
    if nocoalesce:
        flags |= _MOUSEEVENTF_MOVE_NOCOALESCE
    return _mouse_input(flags, nx, ny)


def _button_input(button: str, *, up: bool, swapped: bool = False) -> _Input:
    """``button`` is logical (left = primary); with swapped buttons the physical flag flips."""
    if swapped and button in ("left", "right"):
        button = "right" if button == "left" else "left"
    down_flag, up_flag = _BUTTON_FLAGS[button]
    return _mouse_input(up_flag if up else down_flag)


def _wheel_input(direction: str) -> _Input:
    """One wheel notch; positive data = up (vertical) or right (horizontal)."""
    flags = _MOUSEEVENTF_WHEEL if direction in ("up", "down") else _MOUSEEVENTF_HWHEEL
    delta = _WHEEL_DELTA if direction in ("up", "right") else -_WHEEL_DELTA
    return _mouse_input(flags, data=delta)


def _drag_path(x0: int, y0: int, x1: int, y1: int) -> list[tuple[int, int]]:
    """Intermediate drag points after the start, ending exactly at (x1, y1)."""
    distance = max(abs(x1 - x0), abs(y1 - y0))
    steps = min(DRAG_MAX_STEPS, max(DRAG_MIN_STEPS, math.ceil(distance / DRAG_STEP_PX)))
    return [
        (x0 + round((x1 - x0) * i / steps), y0 + round((y1 - y0) * i / steps))
        for i in range(1, steps + 1)
    ]


def _release_events_for(events: Sequence[_Input]) -> list[_Input]:
    """Up events for every key/button pressed in ``events`` and not released there (LIFO)."""
    held: dict[tuple[str, int, int], _Input] = {}
    for event in events:
        if event.type == _INPUT_KEYBOARD:
            ki = event.u.ki
            unicode = bool(ki.dwFlags & _KEYEVENTF_UNICODE)
            key = ("key", ki.wVk, ki.wScan if unicode else 0)
            if ki.dwFlags & _KEYEVENTF_KEYUP:
                held.pop(key, None)
            else:
                up = _Input(type=_INPUT_KEYBOARD)
                up.u.ki = _KeybdInput(
                    wVk=ki.wVk,
                    wScan=ki.wScan,
                    dwFlags=ki.dwFlags | _KEYEVENTF_KEYUP,
                    time=0,
                    dwExtraInfo=0,
                )
                held.pop(key, None)
                held[key] = up
        elif event.type == _INPUT_MOUSE:
            flags = event.u.mi.dwFlags
            for down_flag, up_flag in _BUTTON_FLAGS.values():
                key = ("button", down_flag, 0)
                if flags & down_flag:
                    held.pop(key, None)
                    held[key] = _mouse_input(up_flag)
                if flags & up_flag:
                    held.pop(key, None)
    return list(reversed(held.values()))


_KEY_FLAG_NAMES = (
    (_KEYEVENTF_EXTENDEDKEY, "EXTENDEDKEY"),
    (_KEYEVENTF_KEYUP, "KEYUP"),
    (_KEYEVENTF_UNICODE, "UNICODE"),
)
_MOUSE_FLAG_NAMES = (
    (_MOUSEEVENTF_MOVE, "MOVE"),
    (_MOUSEEVENTF_LEFTDOWN, "LEFTDOWN"),
    (_MOUSEEVENTF_LEFTUP, "LEFTUP"),
    (_MOUSEEVENTF_RIGHTDOWN, "RIGHTDOWN"),
    (_MOUSEEVENTF_RIGHTUP, "RIGHTUP"),
    (_MOUSEEVENTF_MIDDLEDOWN, "MIDDLEDOWN"),
    (_MOUSEEVENTF_MIDDLEUP, "MIDDLEUP"),
    (_MOUSEEVENTF_WHEEL, "WHEEL"),
    (_MOUSEEVENTF_HWHEEL, "HWHEEL"),
    (_MOUSEEVENTF_MOVE_NOCOALESCE, "NOCOALESCE"),
    (_MOUSEEVENTF_VIRTUALDESK, "VIRTUALDESK"),
    (_MOUSEEVENTF_ABSOLUTE, "ABSOLUTE"),
)


def _describe(event: _Input) -> str:
    """Human-readable form of one INPUT record (debugging and tests)."""
    if event.type == _INPUT_KEYBOARD:
        ki = event.u.ki
        flags = "|".join(name for bit, name in _KEY_FLAG_NAMES if ki.dwFlags & bit) or "0"
        if ki.dwFlags & _KEYEVENTF_UNICODE:
            return f"key unicode=U+{ki.wScan:04X} flags={flags}"
        return f"key vk=0x{ki.wVk:02X} scan=0x{ki.wScan:02X} flags={flags}"
    mi = event.u.mi
    flags = "|".join(name for bit, name in _MOUSE_FLAG_NAMES if mi.dwFlags & bit) or "0"
    data = ctypes.c_int32(mi.mouseData).value
    return f"mouse dx={mi.dx} dy={mi.dy} data={data} flags={flags}"


# --- Windows layer ----------------------------------------------------------------------------
def _require_windows() -> None:
    if sys.platform != "win32":
        raise RuntimeError("mouse and keyboard input is only available on Windows")


def _bind(fn: Any, restype: Any, argtypes: list[Any]) -> Any:
    fn.restype = restype
    fn.argtypes = argtypes
    return fn


class _User32:
    """Typed user32 entry points on a private WinDLL (argtypes never clash with other modules)."""

    def __init__(self) -> None:
        dll = ctypes.WinDLL("user32", use_last_error=True)  # type: ignore[attr-defined]
        u32, i32, ptr = ctypes.c_uint32, ctypes.c_int, ctypes.c_void_p
        self.send_input = _bind(
            dll.SendInput, ctypes.c_uint, [ctypes.c_uint, ctypes.POINTER(_Input), i32]
        )
        self.get_cursor_pos = _bind(dll.GetCursorPos, i32, [ctypes.POINTER(_Point)])
        self.set_cursor_pos = _bind(dll.SetCursorPos, i32, [i32, i32])
        self.get_system_metrics = _bind(dll.GetSystemMetrics, i32, [i32])
        self.monitor_from_point = _bind(dll.MonitorFromPoint, ptr, [_Point, u32])
        self.get_foreground_window = _bind(dll.GetForegroundWindow, ptr, [])
        self.get_window_thread_process_id = _bind(
            dll.GetWindowThreadProcessId, u32, [ptr, ctypes.POINTER(u32)]
        )
        self.get_keyboard_layout = _bind(dll.GetKeyboardLayout, ptr, [u32])
        self.map_virtual_key_ex = _bind(
            dll.MapVirtualKeyExW, ctypes.c_uint, [ctypes.c_uint, ctypes.c_uint, ptr]
        )


@functools.cache
def _api() -> _User32:
    _require_windows()
    return _User32()


def _blocked_message(sent: int, total: int, error: int) -> str:
    return (
        f"SendInput failed: Windows accepted {sent} of {total} input events (error {error}). "
        "The target window most likely belongs to an app running as administrator, and a "
        "non-elevated process cannot send input to it (UIPI); a UAC prompt or the lock screen "
        "blocks input the same way. Ask the user to do this step themselves."
    )


def _send_count(events: Sequence[_Input]) -> tuple[int, int]:
    """One SendInput call. Returns (events inserted, GetLastError if not all were inserted)."""
    count = len(events)
    array = (_Input * count)(*events)
    sent = int(_api().send_input(count, array, ctypes.sizeof(_Input)))
    return sent, (ctypes.get_last_error() if sent != count else 0)


def _send(events: Sequence[_Input]) -> None:
    """Insert ``events`` atomically; on a short count release what got in, then raise."""
    if not events:
        return
    sent, error = _send_count(events)
    if sent == len(events):
        return
    leftovers = _release_events_for(events[:sent])
    if leftovers:
        try:
            if _send_count(leftovers)[0] != len(leftovers):
                log.error(
                    "could not release %d key/button(s) after a failed SendInput", len(leftovers)
                )
        except Exception:  # never mask the original failure
            log.exception("releasing keys/buttons after a failed SendInput raised")
    raise RuntimeError(_blocked_message(sent, len(events), error))


def _release(ups: Sequence[_Input], *, quiet: bool) -> None:
    """Send key/button-up events, retrying the rest once. ``quiet``: log instead of raising."""
    pending = list(ups)
    sent, error = 0, 0
    try:
        for attempt in range(2):
            if not pending:
                return
            if attempt:
                time.sleep(RELEASE_RETRY_DELAY)
            sent, error = _send_count(pending)
            pending = pending[sent:]
        if not pending:
            return
        message = (
            _blocked_message(len(ups) - len(pending), len(ups), error)
            + " Some keys or mouse buttons may still be held down; ask the user to "
            "press and release them."
        )
    except Exception as exc:
        if not quiet:
            raise
        log.exception("releasing keys/buttons failed: %s", exc)
        return
    if quiet:
        log.error("%s", message)
        return
    raise RuntimeError(message)


@contextmanager
def _held(downs: Sequence[_Input], ups: Sequence[_Input]) -> Iterator[None]:
    """Press ``downs``, run the body, and always send ``ups`` afterwards."""
    _send(downs)  # on partial insertion this releases what got in and raises
    try:
        yield
    except BaseException:
        _release(ups, quiet=True)
        raise
    _release(ups, quiet=False)


def _live_scan_of() -> Callable[[int], int]:
    """VK -> scan code using the keyboard layout of the foreground window's thread."""
    api = _api()
    hwnd = api.get_foreground_window()
    thread_id = api.get_window_thread_process_id(hwnd, None) if hwnd else 0
    layout = api.get_keyboard_layout(thread_id)

    @functools.cache
    def scan_of(vk: int) -> int:
        return int(api.map_virtual_key_ex(vk, _MAPVK_VK_TO_VSC_EX, layout)) & 0xFF

    return scan_of


def _virtual_rect() -> tuple[int, int, int, int]:
    metrics = _api().get_system_metrics
    rect = (
        int(metrics(_SM_XVIRTUALSCREEN)),
        int(metrics(_SM_YVIRTUALSCREEN)),
        int(metrics(_SM_CXVIRTUALSCREEN)),
        int(metrics(_SM_CYVIRTUALSCREEN)),
    )
    if rect[2] <= 0 or rect[3] <= 0:
        raise RuntimeError("could not read the virtual desktop size (GetSystemMetrics)")
    return rect


def _get_cursor() -> tuple[int, int]:
    point = _Point()
    if not _api().get_cursor_pos(ctypes.byref(point)):
        raise RuntimeError(
            f"GetCursorPos failed (error {ctypes.get_last_error()}); the screen may be locked "
            "or a secure desktop (UAC prompt) is active"
        )
    return int(point.x), int(point.y)


def _check_on_screen(x: int, y: int) -> None:
    if _api().monitor_from_point(_Point(x, y), _MONITOR_DEFAULTTONULL):
        return
    left, top, width, height = _virtual_rect()
    raise ValueError(
        f"point ({x}, {y}) is not on any monitor (the virtual desktop spans "
        f"x {left}..{left + width - 1}, y {top}..{top + height - 1}); "
        "take a new screenshot and use its coordinates"
    )


def _buttons_swapped() -> bool:
    return bool(_api().get_system_metrics(_SM_SWAPBUTTON))


def _move_to(x: int, y: int) -> None:
    """Absolute move through SendInput, then verify; fix rounding misses with SetCursorPos."""
    _send([_move_input(x, y, _virtual_rect())])
    deadline = time.monotonic() + MOVE_VERIFY_TIMEOUT
    position = _get_cursor()
    while position != (x, y) and time.monotonic() < deadline:
        time.sleep(MOVE_VERIFY_POLL)
        position = _get_cursor()
    if position == (x, y):
        return
    log.debug("SendInput move landed at %s instead of %s; correcting", position, (x, y))
    if not _api().set_cursor_pos(x, y):
        raise RuntimeError(
            f"SetCursorPos({x}, {y}) failed (error {ctypes.get_last_error()}); the screen may be "
            "locked or a secure desktop (UAC prompt) is active"
        )
    position = _get_cursor()
    if position != (x, y):
        raise RuntimeError(
            f"the pointer could not be placed at ({x}, {y}); it is at {position}. Another program "
            "may be confining or moving the cursor; retry, or ask the user."
        )


# --- Public API -------------------------------------------------------------------------------
def cursor_position() -> tuple[int, int]:
    """Current pointer position in screen space."""
    _require_windows()
    return _get_cursor()


def move(x: int, y: int) -> None:
    """Move the pointer to screen point (x, y) (hover)."""
    x, y = _coord("x", x), _coord("y", y)
    _require_windows()
    with _LOCK:
        _check_on_screen(x, y)
        _move_to(x, y)


def click(
    x: int,
    y: int,
    button: str = "left",
    count: int = 1,
    modifiers: Sequence[str] = (),
) -> None:
    """Click at screen point (x, y). ``count`` 2/3 = double/triple click.

    ``button`` is logical (left = primary button, also for left-handed setups). ``modifiers``
    (ctrl/alt/shift/win) are held for the whole click and always released afterwards.
    """
    x, y = _coord("x", x), _coord("y", y)
    button = _choice("button", button, _BUTTONS)
    count = _int_in_range("count", count, 1, 3)
    mod_vks = _modifier_vks(modifiers)
    _require_windows()
    with _LOCK:
        _check_on_screen(x, y)
        swapped = _buttons_swapped()
        mod_downs, mod_ups = _chord_events(mod_vks)
        if _VK_MENU in mod_vks or _VK_LWIN in mod_vks:
            # A lone Alt/Win press-release would open the menu bar / Start menu.
            mod_ups = _tap(_VK_MASK) + mod_ups
        if mod_vks:
            _fill_scan_codes(mod_downs + mod_ups, _live_scan_of())
        down = [_button_input(button, up=False, swapped=swapped)]
        up = [_button_input(button, up=True, swapped=swapped)]
        _move_to(x, y)
        time.sleep(MOVE_SETTLE)
        with _held(mod_downs, mod_ups):
            if mod_vks:
                time.sleep(MODIFIER_SETTLE)
            for i in range(count):
                if i:
                    time.sleep(CLICK_INTERVAL)
                with _held(down, up):
                    time.sleep(CLICK_HOLD)
            if mod_vks:
                time.sleep(MODIFIER_SETTLE)


def scroll(x: int, y: int, direction: str, amount: int = 3) -> None:
    """Scroll the wheel at screen point (x, y): ``amount`` notches up/down/left/right."""
    x, y = _coord("x", x), _coord("y", y)
    direction = _choice("direction", direction, _DIRECTIONS)
    amount = _int_in_range("amount", amount, 1, 50)
    _require_windows()
    with _LOCK:
        _check_on_screen(x, y)
        _move_to(x, y)
        time.sleep(MOVE_SETTLE)
        for i in range(amount):
            if i:
                time.sleep(SCROLL_INTERVAL)
                _checkpoint((x, y))
            _send([_wheel_input(direction)])


def drag(x0: int, y0: int, x1: int, y1: int, button: str = "left") -> None:
    """Press at (x0, y0), move in small steps to (x1, y1), release (the button is always let go)."""
    x0, y0 = _coord("x0", x0), _coord("y0", y0)
    x1, y1 = _coord("x1", x1), _coord("y1", y1)
    button = _choice("button", button, _BUTTONS)
    _require_windows()
    with _LOCK:
        _check_on_screen(x0, y0)
        _check_on_screen(x1, y1)
        swapped = _buttons_swapped()
        vrect = _virtual_rect()
        path = _drag_path(x0, y0, x1, y1)
        down = [_button_input(button, up=False, swapped=swapped)]
        up = [_button_input(button, up=True, swapped=swapped)]
        _move_to(x0, y0)
        time.sleep(MOVE_SETTLE)
        with _held(down, up):  # an interruption below still releases the button
            time.sleep(DRAG_PRESS_HOLD)
            last = (x0, y0)
            for px, py in path[:-1]:
                _checkpoint(last)
                _send([_move_input(px, py, vrect, nocoalesce=True)])
                last = (px, py)
                time.sleep(DRAG_STEP_DELAY)
            _checkpoint(last)
            _move_to(x1, y1)
            time.sleep(DRAG_DROP_HOLD)


def press_keys(spec: str, repeat: int = 1) -> None:
    """Press the chords of ``spec`` (see ``parse_keys``) ``repeat`` times (1..100).

    At most ``MAX_KEY_EVENTS`` presses in total; see ``plan_keys``.
    """
    steps = plan_keys(spec, repeat)
    _require_windows()
    with _LOCK:
        scan_of = _live_scan_of()
        for i, (_, chord) in enumerate(steps):
            if i:
                time.sleep(KEY_GAP)
                _checkpoint()
            downs, ups = _chord_events(chord)
            _fill_scan_codes(downs + ups, scan_of)
            with _held(downs, ups):
                time.sleep(KEY_HOLD)


def type_text(text: str) -> None:
    """Type ``text`` as Unicode, independent of the keyboard layout.

    ``\\n``, ``\\r\\n`` and ``\\r`` press Enter, ``\\t`` presses Tab; other control characters
    are rejected. Characters outside the BMP (emoji) are sent as surrogate pairs.
    """
    batches = _type_text_batches(text)
    _require_windows()
    with _LOCK:
        scan_of = _live_scan_of()
        for i, batch in enumerate(batches):
            if i:
                time.sleep(TYPE_BATCH_PAUSE)
                _checkpoint()
            _fill_scan_codes(batch, scan_of)
            _send(batch)
