"""Regression tests for keyboard-path safety (tool level, through the in-memory MCP client).

Contract under test (shared with the production change):

a. ``type_text``: after every Tab/Enter the keyboard checks (password field, terminal, blocked
   app) run again before the rest is typed; if they now refuse, the rest is NOT typed and the tool
   returns an error whose text contains the number of characters typed.
b. ``key``: with focus in a password field, chords without ctrl/alt/win that produce a printable
   character are refused (nothing sent); navigation/editing keys and ctrl/alt/win shortcuts stay
   allowed. With several chords the check runs before every chord.
c. Password detection is three-state; "undetectable" (UIA timeout/exception) is retried once and
   then typing (and printable ``key`` chords) is refused with an explicit error.
d. The failsafe (cursor in a screen corner) is re-checked between type_text batches, key
   chords/repeats, scroll notches and drag steps; when it fires the input stops there.
e. ``input.MAX_KEY_EVENTS``: chords x repeat above it is refused before any key is sent.
f. Once the cursor has been seen away from the point the agent left it, that point is no longer
   exempt from the failsafe.

Nothing here touches the real desktop. The real ``input`` module runs, but its user32 layer
(``input._api``) is a fake that records every INPUT record and can change the fake desktop in
between (focus moves into a password field, a terminal comes to the front, the user parks the
mouse in a corner). UI Automation is faked at its lowest layer (the focused-element query), so the
password check is observed whatever shape the production code gives it. Assertions are on what a
user would see: the tool result and the key/character stream that reached the fake SendInput.
"""

from __future__ import annotations

import ctypes
import dataclasses
import functools
import re
import sys
from collections.abc import AsyncIterator, Callable, Iterator
from contextlib import asynccontextmanager, contextmanager
from datetime import timedelta
from types import SimpleNamespace
from typing import Any

import anyio
import pytest
from anyio.from_thread import BlockingPortal, start_blocking_portal
from mcp import types
from mcp.client.session import ClientSession
from mcp.shared.memory import create_client_server_memory_streams

from computer_use_windows import input as inp
from computer_use_windows import screen, uia
from computer_use_windows import server as server_mod
from computer_use_windows.config import Config
from computer_use_windows.screen import CoordMap, MonitorInfo
from computer_use_windows.uia import WindowInfo

pytestmark = pytest.mark.skipif(sys.platform != "win32", reason="input.py needs Windows ctypes")

VK_TAB = 0x09
VK_RETURN = 0x0D
VK_RIGHT = 0x27
VK_A = 0x41

_KEYEVENTF_KEYUP = 0x0002
_KEYEVENTF_UNICODE = 0x0004
_MOUSEEVENTF_MOVE = 0x0001
_MOUSEEVENTF_LEFTDOWN = 0x0002
_MOUSEEVENTF_LEFTUP = 0x0004
_MOUSEEVENTF_WHEEL = 0x0800
_MOUSEEVENTF_HWHEEL = 0x1000
_MOUSEEVENTF_MOVE_NOCOALESCE = 0x2000
_UIA_E_TIMEOUT = 0x80131505  # HRESULT of a UI Automation call that timed out

MONITOR = MonitorInfo(index=1, left=0, top=0, width=1920, height=1080, primary=True)
CORNER = (0, 0)

NOTEPAD = WindowInfo(
    handle=1001, title="Untitled - Notepad", process="notepad.exe", pid=4001,
    left=100, top=100, right=1100, bottom=1000, foreground=False, minimized=False,
    class_name="Notepad",
)  # fmt: skip
KEEPASS = WindowInfo(
    handle=1003, title="Passwords.kdbx - KeePass", process="keepass.exe", pid=4003,
    left=1200, top=600, right=1800, bottom=1000, foreground=False, minimized=False,
    class_name="WindowsForms10.Window.8.app.0.33c0d9d",
)  # fmt: skip
TERMINAL = WindowInfo(
    handle=1004, title="Windows PowerShell", process="windowsterminal.exe", pid=4004,
    left=1100, top=0, right=1900, bottom=500, foreground=False, minimized=False,
    class_name="CASCADIA_HOSTING_WINDOW_CLASS",
)  # fmt: skip

Event = tuple[Any, ...]

# Delays of the real input module, zeroed so that long calls stay fast (a missing name is fine).
_INPUT_DELAYS = (
    "MOVE_SETTLE",
    "MOVE_VERIFY_TIMEOUT",
    "CLICK_HOLD",
    "CLICK_INTERVAL",
    "MODIFIER_SETTLE",
    "KEY_HOLD",
    "KEY_GAP",
    "TYPE_BATCH_PAUSE",
    "SCROLL_INTERVAL",
    "DRAG_PRESS_HOLD",
    "DRAG_STEP_DELAY",
    "DRAG_DROP_HOLD",
    "RELEASE_RETRY_DELAY",
)


# --------------------------------------------------------------------------------------------
# Fakes
# --------------------------------------------------------------------------------------------


class FakeComError(Exception):
    """Stands in for comtypes' COMError: carries an HRESULT."""

    def __init__(self, hresult: int, text: str) -> None:
        super().__init__(hresult, text)
        self.hresult = hresult


class FakeDesktop:
    """The fake world behind user32 and UI Automation, plus a recording of all injected input."""

    def __init__(self) -> None:
        self.windows: list[WindowInfo] = [NOTEPAD, KEEPASS, TERMINAL]
        self.foreground = NOTEPAD.handle
        self.cursor: tuple[int, int] = (960, 540)
        self.password = False  # the focused element is a password field
        self.uia_failures: list[BaseException] = []  # raised by the next focused-element queries
        self.uia_queries = 0
        self.events: list[Event] = []
        self.sends = 0
        # Hooks that change the world in the middle of an action.
        self.on_event: Callable[[Event], None] | None = None  # after every INPUT record
        self.on_send: Callable[[set[str]], None] | None = None  # after every SendInput call
        self.unexpected: list[str] = []

    # ---- user32 (input._api) -----------------------------------------------------------------
    def apply(self, event: Any) -> Event:
        if event.type == 1:  # INPUT_KEYBOARD
            ki = event.u.ki
            up = bool(ki.dwFlags & _KEYEVENTF_KEYUP)
            if ki.dwFlags & _KEYEVENTF_UNICODE:
                return ("char", int(ki.wScan), up)
            return ("key", int(ki.wVk), up)
        mi = event.u.mi
        flags = int(mi.dwFlags)
        if flags & _MOUSEEVENTF_MOVE:
            x = MONITOR.left + int(mi.dx) * MONITOR.width // 65536
            y = MONITOR.top + int(mi.dy) * MONITOR.height // 65536
            self.cursor = (x, y)
            return ("move", x, y, bool(flags & _MOUSEEVENTF_MOVE_NOCOALESCE))
        if flags & (_MOUSEEVENTF_WHEEL | _MOUSEEVENTF_HWHEEL):
            return ("wheel", ctypes.c_int32(mi.mouseData).value)
        return ("button", flags)

    def send_input(self, count: int, array: Any, size: int) -> int:
        kinds: set[str] = set()
        for i in range(int(count)):
            record = self.apply(array[i])
            self.events.append(record)
            kinds.add(record[0])
            if self.on_event is not None:
                self.on_event(record)
        self.sends += 1
        if self.on_send is not None:
            self.on_send(kinds)
        return int(count)

    def get_cursor_pos(self, ref: Any) -> int:
        point = ref._obj  # ctypes.byref(point)
        point.x, point.y = self.cursor
        return 1

    def set_cursor_pos(self, x: int, y: int) -> int:
        self.cursor = (int(x), int(y))
        return 1

    def get_system_metrics(self, index: int) -> int:
        return {76: MONITOR.left, 77: MONITOR.top, 78: MONITOR.width, 79: MONITOR.height}.get(
            int(index), 0
        )

    def monitor_from_point(self, point: Any, flags: int) -> int:
        on = MONITOR.left <= point.x < MONITOR.left + MONITOR.width
        return int(on and MONITOR.top <= point.y < MONITOR.top + MONITOR.height)

    def get_foreground_window(self) -> int:
        return self.foreground

    def get_window_thread_process_id(self, hwnd: Any, pid: Any) -> int:
        return 1

    def get_keyboard_layout(self, thread_id: int) -> int:
        return 0x0409

    def map_virtual_key_ex(self, code: int, map_type: int, layout: Any) -> int:
        return int(code) & 0xFF

    # ---- UI Automation -----------------------------------------------------------------------
    def GetFocusedElement(self) -> Any:  # noqa: N802 - COM method name
        self.uia_queries += 1
        if self.uia_failures:
            raise self.uia_failures.pop(0)
        return SimpleNamespace(CurrentIsPassword=self.password)

    def list_windows(self) -> list[WindowInfo]:
        ordered = sorted(self.windows, key=lambda w: w.handle != self.foreground)
        return [dataclasses.replace(w, foreground=w.handle == self.foreground) for w in ordered]

    def foreground_window(self) -> WindowInfo | None:
        return next((w for w in self.list_windows() if w.foreground), None)

    def window_at(self, x: int, y: int) -> WindowInfo | None:
        for w in self.list_windows():
            if w.left <= x < w.right and w.top <= y < w.bottom:
                return w
        return None

    def capture(self, monitor: int | None = None, *args: Any, **kwargs: Any) -> Any:
        return b"\x89PNG\r\n\x1a\n", CoordMap(monitor=MONITOR, image_width=1920, image_height=1080)

    # ---- observations ------------------------------------------------------------------------
    def typed(self) -> str:
        """Text that reached the keyboard: unicode characters, Tab as \\t and Enter as \\n."""
        units: list[int] = []
        for kind, code, *rest in self.events:
            if kind == "char" and not rest[0]:
                units.append(code)
            elif kind == "key" and not rest[0] and code in (VK_TAB, VK_RETURN):
                units.append(0x09 if code == VK_TAB else 0x0A)
        return b"".join(u.to_bytes(2, "little") for u in units).decode("utf-16-le")

    def key_downs(self) -> list[int]:
        return [e[1] for e in self.events if e[0] == "key" and not e[2]]

    def unreleased(self) -> list[Event]:
        """Keys and mouse buttons pressed and never released."""
        held: dict[tuple[str, int], int] = {}
        for e in self.events:
            if e[0] in ("key", "char"):
                held[(e[0], e[1])] = held.get((e[0], e[1]), 0) + (-1 if e[2] else 1)
            elif e[0] == "button":
                if e[1] & _MOUSEEVENTF_LEFTDOWN:
                    held[("button", 0)] = held.get(("button", 0), 0) + 1
                if e[1] & _MOUSEEVENTF_LEFTUP:
                    held[("button", 0)] = held.get(("button", 0), 0) - 1
        return [key for key, count in held.items() if count > 0]

    def wheels(self) -> int:
        return sum(1 for e in self.events if e[0] == "wheel")

    def drag_steps(self) -> int:
        return sum(1 for e in self.events if e[0] == "move" and e[3])


class _NoWin32:
    """uia._win() replacement: the tests fake every Win32 query uia needs here."""

    def __init__(self, desk: FakeDesktop) -> None:
        self._desk = desk

    def __getattr__(self, name: str) -> Any:
        self._desk.unexpected.append(f"uia Win32 API {name}")
        raise AttributeError(name)


def _refuse(attempts: list[str], name: str, *args: Any, **kwargs: Any) -> Any:
    attempts.append(name)
    raise AssertionError(f"unit test reached the real {name}")


@pytest.fixture(autouse=True)
def _no_real_input(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Defense in depth: fail if anything reaches the real user32 input/foreground APIs."""
    attempts: list[str] = []
    user32 = ctypes.windll.user32  # type: ignore[attr-defined]
    for name in ("SendInput", "SetCursorPos", "mouse_event", "keybd_event", "SetForegroundWindow"):
        monkeypatch.setattr(user32, name, functools.partial(_refuse, attempts, name))
    monkeypatch.setattr(inp, "_User32", functools.partial(_refuse, attempts, "input._User32"))
    yield
    assert attempts == [], f"real Windows input APIs were called: {attempts}"


@pytest.fixture(autouse=True)
def desk(monkeypatch: pytest.MonkeyPatch) -> Iterator[FakeDesktop]:
    fake = FakeDesktop()
    monkeypatch.setattr(inp, "_api", lambda: fake)
    for name in _INPUT_DELAYS:
        monkeypatch.setattr(inp, name, 0, raising=False)
    monkeypatch.setattr(server_mod, "_SETTLE_SECONDS", 0, raising=False)
    monkeypatch.setattr(screen, "list_monitors", lambda: [MONITOR])
    monkeypatch.setattr(screen, "capture", fake.capture)
    for name in ("list_windows", "foreground_window", "window_at"):
        monkeypatch.setattr(uia, name, getattr(fake, name))
    monkeypatch.setattr(uia, "ancestor_pids", lambda: frozenset({7001, 7002}))
    # Password detection: the focus is not a plain Win32 edit control (as in a browser), so the
    # Win32 ES_PASSWORD probe cannot tell (None, falsy for older code) and UI Automation decides.
    monkeypatch.setattr(uia, "_win", lambda: _NoWin32(fake))
    monkeypatch.setattr(uia, "_win32_focus_is_password", lambda api: None)
    context = SimpleNamespace(automation=fake, timeouts=False, set_timeout=lambda ms: None)
    monkeypatch.setattr(uia, "_context", lambda: context)
    yield fake
    assert fake.unexpected == [], fake.unexpected


# --------------------------------------------------------------------------------------------
# In-memory MCP client
# --------------------------------------------------------------------------------------------


@dataclasses.dataclass
class Reply:
    result: types.CallToolResult

    @property
    def is_error(self) -> bool:
        return bool(self.result.isError)

    @property
    def text(self) -> str:
        return "\n".join(c.text for c in self.result.content if isinstance(c, types.TextContent))


@dataclasses.dataclass
class Client:
    portal: BlockingPortal
    session: ClientSession

    def call(self, name: str, **arguments: Any) -> Reply:
        return Reply(self.portal.call(self.session.call_tool, name, arguments))


@asynccontextmanager
async def _open_session(mcp_server: Any) -> AsyncIterator[ClientSession]:
    low = mcp_server._mcp_server
    async with create_client_server_memory_streams() as (client_streams, server_streams):
        async with anyio.create_task_group() as tg:
            tg.start_soon(
                functools.partial(
                    low.run,
                    server_streams[0],
                    server_streams[1],
                    low.create_initialization_options(),
                    raise_exceptions=False,
                )
            )
            try:
                async with ClientSession(
                    client_streams[0],
                    client_streams[1],
                    read_timeout_seconds=timedelta(seconds=60),
                ) as session:
                    await session.initialize()
                    yield session
            finally:
                tg.cancel_scope.cancel()


@contextmanager
def connect(config: Config | None = None) -> Iterator[Client]:
    mcp_server = server_mod.build_server(config if config is not None else Config())
    with (
        start_blocking_portal() as portal,
        portal.wrap_async_context_manager(_open_session(mcp_server)) as session,
    ):
        yield Client(portal, session)


def call(tool: str, config: Config | None = None, **arguments: Any) -> Reply:
    with connect(config) as client:
        return client.call(tool, **arguments)


def assert_ok(reply: Reply) -> None:
    assert not reply.is_error, reply.text
    assert re.search(r"\bok\b", reply.text), reply.text


def assert_error(reply: Reply, *needles: str) -> None:
    assert reply.is_error, f"expected a tool error, got: {reply.text!r}"
    for needle in needles:
        assert needle.lower() in reply.text.lower(), f"{needle!r} not in {reply.text!r}"


def numbers_in(text: str) -> set[int]:
    return {int(n) for n in re.findall(r"\d+", text)}


def after_key_down(vk: int, action: Callable[[], None]) -> Callable[[Event], None]:
    """Hook: run ``action`` right after every key-down of ``vk`` reaches the fake keyboard."""

    def hook(event: Event) -> None:
        if event[0] == "key" and event[1] == vk and not event[2]:
            action()

    return hook


def once(predicate: Callable[[Event], bool], action: Callable[[], None]) -> Callable[[Event], None]:
    """Hook: run ``action`` after the first event matching ``predicate``."""
    fired = False

    def hook(event: Event) -> None:
        nonlocal fired
        if not fired and predicate(event):
            fired = True
            action()

    return hook


def user_parks_mouse_in_corner(desk: FakeDesktop) -> Callable[[], None]:
    def action() -> None:
        desk.cursor = CORNER

    return action


# --------------------------------------------------------------------------------------------
# a. type_text re-checks the keyboard target after every Tab / Enter
# --------------------------------------------------------------------------------------------


def test_type_text_stops_when_tab_moves_focus_into_password_field(desk: FakeDesktop) -> None:
    desk.on_event = after_key_down(VK_TAB, lambda: setattr(desk, "password", True))
    reply = call("type_text", text="kullanici\tSifre123")
    assert_error(reply, "password")
    assert desk.typed() == "kullanici\t"  # nothing of "Sifre123" reached the keyboard
    # the reply says how much was typed ("kullanici" = 9 characters, 10 with the Tab)
    assert numbers_in(reply.text) & {9, 10}, reply.text
    assert desk.unreleased() == []


def test_type_text_stops_when_enter_brings_a_terminal_to_front(desk: FakeDesktop) -> None:
    desk.on_event = after_key_down(VK_RETURN, lambda: setattr(desk, "foreground", TERMINAL.handle))
    reply = call("type_text", text="cmd\nkomut")
    assert_error(reply, "terminal")
    assert desk.typed() == "cmd\n"
    assert numbers_in(reply.text) & {3, 4}, reply.text
    assert desk.unreleased() == []


def test_type_text_stops_when_tab_brings_a_blocked_app_to_front(desk: FakeDesktop) -> None:
    desk.on_event = after_key_down(VK_TAB, lambda: setattr(desk, "foreground", KEEPASS.handle))
    reply = call("type_text", Config(blocked_processes=("keepass.exe",)), text="ara\tgizli")
    assert_error(reply, "keepass")
    assert desk.typed() == "ara\t"
    assert numbers_in(reply.text) & {3, 4}, reply.text


def test_type_text_with_tab_and_enter_types_everything_when_target_stays_safe(
    desk: FakeDesktop,
) -> None:
    text = "ad\tsoyad\nşehir\tİzmir"
    reply = call("type_text", text=text)
    assert_ok(reply)
    assert desk.typed() == text
    # the password state was looked at again after each of the three Tab/Enter presses
    assert desk.uia_queries >= 4


def test_type_text_without_tab_or_enter_is_checked_once(desk: FakeDesktop) -> None:
    text = "Merhaba dünya ğüşıöçİ 😀"
    reply = call("type_text", text=text)
    assert_ok(reply)
    assert desk.typed() == text
    assert desk.uia_queries == 1


# --------------------------------------------------------------------------------------------
# b. key in a password field
# --------------------------------------------------------------------------------------------

PRINTABLE_CHORDS = ["a", "shift+a", "1", "space", "shift+1", "comma", "period", "shift+space"]
FREE_CHORDS = [
    "tab",
    "enter",
    "ctrl+a",
    "backspace",
    "esc",
    "left",
    "up",
    "home",
    "end",
    "delete",
    "shift+tab",
    "shift+left",
    "ctrl+shift+z",
    "alt+f4",
]


@pytest.mark.parametrize("keys", PRINTABLE_CHORDS)
def test_printable_key_in_password_field_is_refused(desk: FakeDesktop, keys: str) -> None:
    desk.password = True
    reply = call("key", keys=keys)
    assert_error(reply, "password")
    assert desk.events == []


@pytest.mark.parametrize("keys", FREE_CHORDS)
def test_navigation_and_shortcut_keys_in_password_field_are_allowed(
    desk: FakeDesktop, keys: str
) -> None:
    desk.password = True
    reply = call("key", keys=keys)
    assert_ok(reply)
    assert desk.key_downs() == inp.parse_keys(keys)[0]
    assert desk.unreleased() == []


def test_printable_key_outside_password_field_is_allowed(desk: FakeDesktop) -> None:
    reply = call("key", keys="a")
    assert_ok(reply)
    assert desk.key_downs() == [VK_A]


def test_key_chords_are_rechecked_after_tab_moves_into_password_field(desk: FakeDesktop) -> None:
    desk.on_event = after_key_down(VK_TAB, lambda: setattr(desk, "password", True))
    reply = call("key", keys="tab a")
    assert_error(reply, "password")
    assert desk.key_downs() == [VK_TAB]
    assert desk.unreleased() == []


def test_key_chords_before_the_password_field_are_sent(desk: FakeDesktop) -> None:
    desk.on_event = after_key_down(VK_TAB, lambda: setattr(desk, "password", True))
    reply = call("key", keys="a tab b")
    assert_error(reply, "password")
    assert desk.key_downs() == [VK_A, VK_TAB]


# --------------------------------------------------------------------------------------------
# c. undetectable password state: one retry, then refuse
# --------------------------------------------------------------------------------------------


def _uia_timeout() -> BaseException:
    return FakeComError(_UIA_E_TIMEOUT - (1 << 32), "UIA call timed out")


def _uia_crash() -> BaseException:
    return RuntimeError("UI Automation provider disconnected")


UIA_FAILURES = [pytest.param(_uia_timeout, id="timeout"), pytest.param(_uia_crash, id="exception")]


@pytest.mark.parametrize("failure", UIA_FAILURES)
def test_type_text_retries_undetectable_password_state_once(
    desk: FakeDesktop, failure: Callable[[], BaseException]
) -> None:
    desk.uia_failures = [failure()]
    reply = call("type_text", text="abc")
    assert_ok(reply)
    assert desk.typed() == "abc"
    assert desk.uia_queries == 2


@pytest.mark.parametrize("failure", UIA_FAILURES)
def test_type_text_refused_when_password_state_stays_undetectable(
    desk: FakeDesktop, failure: Callable[[], BaseException]
) -> None:
    desk.uia_failures = [failure(), failure(), failure()]
    reply = call("type_text", text="abc")
    assert_error(reply)
    assert desk.events == []
    assert desk.uia_queries == 2  # one retry, not more


def test_type_text_retry_that_finds_a_password_field_refuses(desk: FakeDesktop) -> None:
    desk.uia_failures = [_uia_timeout()]
    desk.password = True
    reply = call("type_text", text="abc")
    assert_error(reply, "password")
    assert desk.events == []


@pytest.mark.parametrize("failure", UIA_FAILURES)
def test_printable_key_retries_undetectable_password_state_once(
    desk: FakeDesktop, failure: Callable[[], BaseException]
) -> None:
    desk.uia_failures = [failure()]
    reply = call("key", keys="a")
    assert_ok(reply)
    assert desk.key_downs() == [VK_A]
    assert desk.uia_queries == 2


@pytest.mark.parametrize("failure", UIA_FAILURES)
def test_printable_key_refused_when_password_state_stays_undetectable(
    desk: FakeDesktop, failure: Callable[[], BaseException]
) -> None:
    desk.uia_failures = [failure(), failure(), failure()]
    reply = call("key", keys="a")
    assert_error(reply)
    assert desk.events == []
    assert desk.uia_queries == 2


def test_navigation_key_is_not_blocked_by_undetectable_password_state(desk: FakeDesktop) -> None:
    desk.uia_failures = [_uia_timeout() for _ in range(5)]
    reply = call("key", keys="tab")
    assert_ok(reply)
    assert desk.key_downs() == [VK_TAB]


# --------------------------------------------------------------------------------------------
# d. failsafe during long input
# --------------------------------------------------------------------------------------------


def test_failsafe_stops_type_text_between_batches(desk: FakeDesktop) -> None:
    text = "x" * (2 * inp.TYPE_BATCH_CHARS + 10)
    fired = False

    def on_send(kinds: set[str]) -> None:
        nonlocal fired
        if "char" in kinds and not fired:
            fired = True
            desk.cursor = CORNER

    desk.on_send = on_send
    reply = call("type_text", text=text)
    assert_error(reply, "corner")
    typed = desk.typed()
    assert 0 < len(typed) <= inp.TYPE_BATCH_CHARS
    assert text.startswith(typed)
    assert desk.unreleased() == []


def test_failsafe_stops_key_between_chords(desk: FakeDesktop) -> None:
    desk.on_event = once(lambda e: e[0] == "key" and not e[2], user_parks_mouse_in_corner(desk))
    reply = call("key", keys="right right right")
    assert_error(reply, "corner")
    assert desk.key_downs() == [VK_RIGHT]
    assert desk.unreleased() == []


def test_failsafe_stops_key_between_repeats(desk: FakeDesktop) -> None:
    desk.on_event = once(lambda e: e[0] == "key" and not e[2], user_parks_mouse_in_corner(desk))
    reply = call("key", keys="right", repeat=5)
    assert_error(reply, "corner")
    assert desk.key_downs() == [VK_RIGHT]
    assert desk.unreleased() == []


def test_failsafe_stops_scroll_between_notches(desk: FakeDesktop) -> None:
    desk.on_event = once(lambda e: e[0] == "wheel", user_parks_mouse_in_corner(desk))
    reply = call("scroll", direction="down", amount=5)
    assert_error(reply, "corner")
    assert desk.wheels() == 1


def test_failsafe_stops_drag_between_steps_and_releases_the_button(desk: FakeDesktop) -> None:
    desk.on_event = once(lambda e: e[0] == "move" and e[3], user_parks_mouse_in_corner(desk))
    with connect() as client:
        client.call("screenshot")
        reply = client.call("drag", x0=200, y0=200, x1=900, y1=800)
    assert_error(reply, "corner")
    assert desk.drag_steps() == 1
    assert ("move", 900, 800, False) not in desk.events  # never reached the drop point
    assert desk.unreleased() == []


# --------------------------------------------------------------------------------------------
# e. MAX_KEY_EVENTS
# --------------------------------------------------------------------------------------------


def _max_key_events() -> int:
    limit = inp.MAX_KEY_EVENTS
    assert type(limit) is int and limit >= 1, limit
    return limit


def test_key_over_max_events_is_refused_without_sending(desk: FakeDesktop) -> None:
    limit = _max_key_events()
    reply = call("key", keys=" ".join(["right"] * (limit + 1)))
    assert_error(reply)
    assert desk.events == []


def test_key_over_max_events_through_repeat_is_refused_without_sending(desk: FakeDesktop) -> None:
    limit = _max_key_events()
    chords = limit // 2 + 1  # x 2 repeats = limit + 1 or limit + 2
    reply = call("key", keys=" ".join(["right"] * chords), repeat=2)
    assert_error(reply)
    assert desk.events == []


def test_key_at_max_events_is_accepted(desk: FakeDesktop) -> None:
    limit = _max_key_events()
    reply = call("key", keys=" ".join(["right"] * limit))
    assert_ok(reply)
    assert desk.key_downs() == [VK_RIGHT] * limit


# --------------------------------------------------------------------------------------------
# f. the agent's own corner stops being exempt once the cursor was seen elsewhere
# --------------------------------------------------------------------------------------------

OBSERVERS = [
    pytest.param("wait", {"seconds": 0.01}, id="wait"),
    pytest.param("key", {"keys": "right"}, id="key"),
    pytest.param("type_text", {"text": "x"}, id="type_text"),
]


@pytest.mark.parametrize(("tool", "args"), OBSERVERS)
def test_failsafe_exemption_ends_once_cursor_was_seen_elsewhere(
    desk: FakeDesktop, tool: str, args: dict[str, Any]
) -> None:
    with connect() as client:
        client.call("screenshot")
        assert_ok(client.call("click", x=0, y=0))  # the agent itself clicks the corner
        assert desk.cursor == CORNER
        desk.cursor = (500, 500)  # the user takes the mouse ...
        assert_ok(client.call(tool, **args))  # ... and the server sees it there
        desk.cursor = CORNER  # ... then parks it in the corner the agent used
        before = len(desk.events)
        reply = client.call("key", keys="right")
    assert_error(reply, "corner")
    assert desk.events[before:] == []


def test_failsafe_exemption_ends_when_cursor_moves_during_long_type_text(
    desk: FakeDesktop,
) -> None:
    text = "y" * (3 * inp.TYPE_BATCH_CHARS)
    positions = [(500, 500), CORNER]

    def on_send(kinds: set[str]) -> None:
        if "char" in kinds and positions:
            desk.cursor = positions.pop(0)

    with connect() as client:
        client.call("screenshot")
        assert_ok(client.call("click", x=0, y=0))
        desk.on_send = on_send
        reply = client.call("type_text", text=text)
    assert_error(reply, "corner")
    assert len(desk.typed()) < len(text)


def test_failsafe_still_ignores_the_agents_corner_while_the_cursor_stays_there(
    desk: FakeDesktop,
) -> None:
    with connect() as client:
        client.call("screenshot")
        assert_ok(client.call("click", x=0, y=0))
        reply = client.call("key", keys="right")
    assert_ok(reply)
    assert desk.key_downs() == [VK_RIGHT]
