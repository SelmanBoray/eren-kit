"""Regression tests for pointer- and window-path safety (tool level, in-memory MCP client).

Contract under test (shared with the production change):

a. ``focus``: a target window that does not respond (hung) gives a clear error quickly; the tool
   never waits without bound and does not lock up later calls of the server.
b. ``click`` with ``button`` right or middle is refused, without any mouse event, when the window
   under the point is a terminal or the agent's own window; left clicks behave as before. ``drag``
   is refused when its start or end point is over a terminal or the agent's own window.
c. ``focus(handle)``: the blocklist is checked against the processes of the handle's ROOT and
   ROOT-OWNER windows, so a blocked app is not brought forward even through a handle that is not
   in the window list. For pointer actions both the root and the root-owner process of the window
   under the point are checked against the blocklist.
d. ``click(element=...)``: when the window the ids came from is gone, moved, resized, or another
   window is now at the target point, nothing is clicked and the error says the element list is
   stale and ``elements`` must be called again.
e. ``elements``: a scan cut short by its time/size limits says so in the result. A scan that
   finished and found exactly ``limit`` elements does not claim to be cut.
f. ``--max-size`` (and its env var) accepts at most 2576; larger values are invalid (ValueError).
g. The element scan stays within its announced time budget (~2 s) even when controls do not
   answer.

Nothing here touches the real desktop. The real ``server``, ``uia`` and ``input`` modules run; the
layers below them are fakes: ``uia._win()`` returns a fake user32 (a subclass of ``uia._Win32``
whose raw entry points are fakes, so the real helper methods run on top of them), ``uia._context()``
returns a real ``uia._Context`` object wired to a fake UI Automation tree, and ``input._api()`` is a
fake SendInput layer that records every mouse event. Assertions are on what a user would see: the
tool result, the mouse events that reached the fake SendInput, and the window-manager calls that
reached the fake user32 (bring-to-front, show, attach-thread-input).
"""

from __future__ import annotations

import ctypes
import dataclasses
import functools
import os
import re
import sys
import threading
import time
import types
from collections.abc import AsyncIterator, Callable, Iterator, Sequence
from contextlib import asynccontextmanager, contextmanager
from ctypes import wintypes
from datetime import timedelta
from typing import Any

import anyio
import pytest
from anyio.from_thread import BlockingPortal, start_blocking_portal
from mcp import types as mcp_types
from mcp.client.session import ClientSession
from mcp.shared.memory import create_client_server_memory_streams

from computer_use_windows import input as inp
from computer_use_windows import screen, uia
from computer_use_windows import server as server_mod
from computer_use_windows.config import Config, load_config
from computer_use_windows.screen import CoordMap, MonitorInfo

pytestmark = pytest.mark.skipif(sys.platform != "win32", reason="input.py needs Windows ctypes")

MONITOR = MonitorInfo(index=1, left=0, top=0, width=1920, height=1080, primary=True)

# The real "which processes are the agent's own" function, kept before any fixture patches it:
# the shell tests run it (over the fake process table) instead of a canned pid set.
_REAL_ANCESTOR_PIDS = uia.ancestor_pids

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
_KEYEVENTF_KEYUP = 0x0002
_KEYEVENTF_UNICODE = 0x0004

_GA_PARENT = 1
_GA_ROOT = 2
_GA_ROOTOWNER = 3
_GW_HWNDNEXT = 2
_GW_HWNDPREV = 3
_GW_OWNER = 4
_GW_CHILD = 5
_GWL_STYLE = -16
_GWL_EXSTYLE = -20
_WS_CHILD = 0x40000000
_WS_VISIBLE = 0x10000000
_WS_CAPTION = 0x00C00000
_WS_EX_TOOLWINDOW = 0x00000080
_SW_HIDE = 0
_SW_MINIMIZE = 6
_SW_RESTORE = 9

_UIA_E_TIMEOUT = 0x80131505
_E_FAIL = 0x80004005

# UIA control type ids (UIAutomationClient.h).
ROLE_IDS = {
    "button": 50000,
    "edit": 50004,
    "text": 50020,
    "pane": 50033,
    "window": 50032,
    "separator": 50038,
}
_P_CONTROL_TYPE = 30003
_P_NAME = 30005
_P_IS_ENABLED = 30010
_P_IS_PASSWORD = 30019
_P_NATIVE_HWND = 30020
_P_IS_OFFSCREEN = 30022

# The element scan's announced budget: "~2 s" (uia module docs: a 1.4 s walk plus a margin for the
# last in-flight call). The scan may overshoot its internal budget a little, not by seconds.
SCAN_PROMISE_S = 2.0

# A hung focus must come back "quickly": far below this (real seconds).
FOCUS_QUICK_S = 3.0
# Hard guard for every test that could hang: the whole session must end within this.
SESSION_GUARD_S = 15.0

# Roots of an error that says the element ids are stale and elements must be called again.
STALE_ROOTS = (
    "stale",
    "again",
    "re-run",
    "rerun",
    "refresh",
    "outdated",
    "no longer",
    "changed",
    "moved",
    "closed",
)
# Roots of a note that the element scan was cut short.
CUT_ROOTS = (
    "truncat",
    "incomplete",
    "partial",
    "cut ",
    "cut;",
    "cut.",
    "cut,",
    "stopped",
    "interrupt",
    "time limit",
    "time budget",
    "timed out",
    "timeout",
    "size limit",
    "size cap",
    "not all",
    "missing",
    "more elements",
    "limit",
)
# Roots of an error that says the target window does not respond.
HUNG_ROOTS = ("respond", "hung", "frozen", "busy", "hanging", " hangs")  # not "hang": "change"
# Roots of a refusal because of the blocklist.
BLOCKED_ROOTS = ("blocked", "keepass")
# Roots of a refusal because the pointer target is a terminal / the agent's own window.
TERMINAL_ROOTS = ("terminal",)
OWN_WINDOW_ROOTS = ("terminal", "running you", "your own", "own window", "agent", "host", "editor")


def mentions(text: str, roots: Sequence[str]) -> bool:
    low = text.lower()
    return any(root in low for root in roots)


# --------------------------------------------------------------------------------------------
# The fake world
# --------------------------------------------------------------------------------------------


@dataclasses.dataclass
class Win:
    handle: int
    title: str
    process: str
    pid: int
    rect: tuple[int, int, int, int]
    class_name: str = "AppWindow"
    parent: int = 0  # child windows: the parent window (GA_PARENT)
    owner: int = 0  # top-level owned windows (dialogs, popups): the owner (GW_OWNER)
    visible: bool = True
    minimized: bool = False
    hung: bool = False
    toolwindow: bool = False

    @property
    def center(self) -> tuple[int, int]:
        left, top, right, bottom = self.rect
        return ((left + right) // 2, (top + bottom) // 2)


def notepad() -> Win:
    return Win(1001, "Untitled - Notepad", "notepad.exe", 4001, (100, 100, 1000, 1000), "Notepad")


def paint() -> Win:
    return Win(1002, "Untitled - Paint", "mspaint.exe", 4002, (1520, 520, 1900, 800), "MSPaintApp")


def keepass() -> Win:
    return Win(
        1003, "Passwords.kdbx - KeePass", "keepass.exe", 4003, (1100, 820, 1900, 1060),
        "WindowsForms10.Window.8.app.0.33c0d9d",
    )  # fmt: skip


def terminal() -> Win:
    return Win(
        1004, "Windows PowerShell", "windowsterminal.exe", 4004, (1100, 0, 1900, 300),
        "CASCADIA_HOSTING_WINDOW_CLASS",
    )  # fmt: skip


def console() -> Win:
    return Win(
        1005, "Command Prompt", "cmd.exe", 4005, (1100, 310, 1900, 500), "ConsoleWindowClass"
    )


def editor() -> Win:  # the editor whose integrated terminal runs the agent (see own_window())
    return Win(
        1007, "main.py - project - Visual Studio Code", "code.exe", 4007, (1100, 520, 1500, 800),
        "Chrome_WidgetWin_1",
    )  # fmt: skip


NOTEPAD = notepad()
PAINT = paint()
KEEPASS = keepass()
TERMINAL = terminal()
CONSOLE = console()
EDITOR = editor()


class FakeClock:
    """Time as the uia module sees it (only where a test installs it); advanced by the fakes."""

    def __init__(self) -> None:
        self.now = 1000.0

    def monotonic(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.now += max(0.0, float(seconds))

    def advance(self, seconds: float) -> None:
        self.now += max(0.0, float(seconds))


class FakeComError(Exception):
    """Stands in for comtypes' COMError: carries an HRESULT."""

    def __init__(self, hresult: int, text: str) -> None:
        super().__init__(hresult, text)
        self.hresult = hresult


class FakeDesktop:
    """Windows, z-order, UIA trees and a recording of every injected mouse event."""

    def __init__(self) -> None:
        self.wins: dict[int, Win] = {}
        self.z: list[int] = []  # top-level windows, topmost first
        for win in (notepad(), terminal(), console(), editor(), paint(), keepass()):
            self.add(win, top=False)
        self.foreground = NOTEPAD.handle
        self.ancestors: frozenset[int] = frozenset({7001, 7002})  # the agent's parent chain
        self.trees: dict[int, FakeElement] = {}
        self.unresponsive_controls: set[int] = set()  # control hwnds whose WM_GETTEXT hangs
        self.clock = FakeClock()
        self.automation = FakeAutomation(self)
        # Process table for the real ancestor-chain code: pid -> (parent pid, exe, creation time).
        # Empty unless a test sets it (see shell_launched_host()).
        self.processes: dict[int, tuple[int, str, int]] = {}
        self.shell_window = 0  # GetShellWindow(): the desktop window of the shell (explorer.exe)
        # Recordings.
        self.events: list[tuple[Any, ...]] = []
        self.cursor: tuple[int, int] = (960, 540)
        self.set_foreground: list[int] = []
        self.blocking: list[str] = []  # window-manager calls that would block on a hung window
        self.calls: list[str] = []
        self.unexpected: list[str] = []

    # ---- world editing ---------------------------------------------------------------------
    def add(self, win: Win, top: bool = True) -> Win:
        self.wins[win.handle] = win
        if win.parent == 0:
            if top:
                self.z.insert(0, win.handle)
            else:
                self.z.append(win.handle)
        return win

    def remove(self, handle: int) -> None:
        for child in [h for h, w in self.wins.items() if w.parent == handle]:
            self.remove(child)
        self.wins.pop(handle, None)
        if handle in self.z:
            self.z.remove(handle)
        if self.foreground == handle:
            self.foreground = self.z[0] if self.z else 0

    def canonical(self, handle: int) -> int:
        """The handle Windows reports for the window that ``handle`` names, 0 for none.

        Like Windows (measured on Windows 11): only the low 32 bits count, and 0xFFFF in their
        high word is a wildcard that matches the window with the same low word.
        """
        h = int(handle or 0)
        if h in self.wins:
            return h
        low = h & 0xFFFFFFFF
        if low in self.wins:
            return low
        if low >> 16 == 0xFFFF:
            return next((c for c in self.wins if c & 0xFFFF == low & 0xFFFF), 0)
        return 0

    def wildcard(self, handle: int) -> bool:
        """``handle`` names a window only through the 0xFFFF wildcard."""
        h = int(handle or 0)
        return h not in self.wins and (h & 0xFFFFFFFF) >> 16 == 0xFFFF

    def win(self, handle: int) -> Win | None:
        return self.wins.get(self.canonical(handle))

    def tid(self, handle: int) -> int:
        win = self.win(handle)
        return win.pid + 50_000 if win else 0

    def root(self, handle: int) -> int:
        win = self.win(handle)
        while win is not None and win.parent:
            parent = self.win(win.parent)
            if parent is None:
                break
            win = parent
        return win.handle if win else 0

    def root_owner(self, handle: int) -> int:
        current = self.root(handle)
        for _ in range(16):
            win = self.win(current)
            if win is None or not win.owner or self.win(win.owner) is None:
                break
            current = self.root(win.owner)
        return current

    def hung_thread(self, tid: int) -> bool:
        return any(w.hung and self.tid(w.handle) == tid for w in self.wins.values())

    def is_hung(self, handle: int) -> bool:
        root = self.win(self.root(handle))
        return bool(root and root.hung)

    def window_from_point(self, x: int, y: int) -> int:
        def inside(win: Win) -> bool:
            left, top, right, bottom = win.rect
            return win.visible and not win.minimized and left <= x < right and top <= y < bottom

        for handle in self.z:
            win = self.wins[handle]
            if not inside(win):
                continue
            current = handle
            while True:
                kids = [w for w in self.wins.values() if w.parent == current and inside(w)]
                if not kids:
                    return current
                current = kids[0].handle
        return 0

    # ---- input._api (fake SendInput layer) --------------------------------------------------
    def apply(self, event: Any) -> tuple[Any, ...]:
        if event.type == 1:  # INPUT_KEYBOARD
            ki = event.u.ki
            up = bool(ki.dwFlags & _KEYEVENTF_KEYUP)
            kind = "char" if ki.dwFlags & _KEYEVENTF_UNICODE else "key"
            return (kind, int(ki.wScan or ki.wVk), up)
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
        for i in range(int(count)):
            self.events.append(self.apply(array[i]))
        return int(count)

    def get_cursor_pos(self, ref: Any) -> int:
        point = ref._obj
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

    # ---- screen ----------------------------------------------------------------------------
    def capture(self, monitor: int | None = None, *args: Any, **kwargs: Any) -> Any:
        return b"\x89PNG\r\n\x1a\n", CoordMap(monitor=MONITOR, image_width=1920, image_height=1080)

    # ---- observations ----------------------------------------------------------------------
    def buttons(self) -> list[int]:
        return [e[1] for e in self.events if e[0] == "button"]

    def pressed(self, flag: int) -> bool:
        return any(f & flag for f in self.buttons())


class _FakeInput(ctypes.Structure):
    _fields_ = [("type", wintypes.DWORD), ("pad", ctypes.c_byte * 40)]


class _FakeGuiThreadInfo(ctypes.Structure):
    _fields_ = [
        ("cbSize", wintypes.DWORD),
        ("flags", wintypes.DWORD),
        ("hwndActive", wintypes.HWND),
        ("hwndFocus", wintypes.HWND),
        ("pad", ctypes.c_byte * 64),
    ]


class FakeWin32(uia._Win32):
    """The fake user32 behind ``uia``: raw entry points only; uia's own helpers run on top."""

    def __init__(self, desk: FakeDesktop) -> None:  # no super().__init__: binds no real DLLs
        self.desk = desk
        self.w = wintypes
        self.WNDENUMPROC = lambda callback: callback
        self.DwmGetWindowAttribute = None
        self.INPUT = _FakeInput
        self.GUITHREADINFO = _FakeGuiThreadInfo

    def __getattr__(self, name: str) -> Any:
        if name.startswith("__"):
            raise AttributeError(name)
        self.__dict__["desk"].unexpected.append(f"uia Win32 API {name} (extend the fake)")
        raise AttributeError(name)

    # ---- helpers that would open real processes ----------------------------------------------
    def process_name(self, pid: int) -> str:
        return next((w.process for w in self.desk.wins.values() if w.pid == pid), "")

    def snapshot(self) -> dict[int, tuple[int, str]]:
        return {pid: (parent, exe) for pid, (parent, exe, _) in self.desk.processes.items()}

    def creation_time(self, pid: int) -> int | None:
        entry = self.desk.processes.get(int(pid))
        return entry[2] if entry else None

    # ---- the Windows shell -------------------------------------------------------------------
    def GetShellWindow(self) -> int:  # noqa: N802
        return self.desk.shell_window

    def GetDesktopWindow(self) -> int:  # noqa: N802
        return 65552

    def FindWindowW(self, cls: Any, title: Any) -> int:  # noqa: N802
        wanted = str(cls or "")
        return next((w.handle for w in self.desk.wins.values() if w.class_name == wanted), 0)

    def system_directory(self) -> str:
        return r"C:\Windows\System32"

    # ---- blocking-on-hung bookkeeping --------------------------------------------------------
    def _would_block(self, name: str, hwnd: int) -> bool:
        if self.desk.is_hung(hwnd):
            self.desk.blocking.append(f"{name}({hwnd})")
            return True
        return False

    # ---- raw user32 entry points -------------------------------------------------------------
    def GetForegroundWindow(self) -> int:  # noqa: N802 - Win32 names
        return self.desk.foreground

    def EnumWindows(self, callback: Callable[[int, int], Any], lparam: int) -> int:  # noqa: N802
        for handle in list(self.desk.z):
            if not callback(handle, lparam):
                break
        return 1

    def GetWindowTextLengthW(self, hwnd: int) -> int:  # noqa: N802
        win = self.desk.win(hwnd)
        return len(win.title) if win else 0

    def GetWindowTextW(self, hwnd: int, buf: Any, size: int) -> int:  # noqa: N802
        win = self.desk.win(hwnd)
        text = win.title[: max(0, int(size) - 1)] if win else ""
        buf.value = text
        return len(text)

    def GetClassNameW(self, hwnd: int, buf: Any, size: int) -> int:  # noqa: N802
        win = self.desk.win(hwnd)
        text = win.class_name[: max(0, int(size) - 1)] if win else ""
        buf.value = text
        return len(text)

    def GetWindowThreadProcessId(self, hwnd: int, ref: Any) -> int:  # noqa: N802
        # Windows fails this call for a wildcard handle (that IsWindow and GetAncestor accept).
        win = None if self.desk.wildcard(hwnd) else self.desk.win(hwnd)
        if ref is not None:
            ref._obj.value = win.pid if win else 0
        return self.desk.tid(hwnd) if win else 0

    def IsWindow(self, hwnd: int) -> int:  # noqa: N802
        return int(self.desk.win(hwnd) is not None)

    def IsWindowVisible(self, hwnd: int) -> int:  # noqa: N802
        win = self.desk.win(hwnd)
        while win is not None:
            if not win.visible:
                return 0
            if not win.parent:
                return 1
            win = self.desk.win(win.parent)
        return 0

    def IsWindowEnabled(self, hwnd: int) -> int:  # noqa: N802
        return int(self.desk.win(hwnd) is not None)

    def IsIconic(self, hwnd: int) -> int:  # noqa: N802
        win = self.desk.win(hwnd)
        return int(bool(win and win.minimized))

    def IsHungAppWindow(self, hwnd: int) -> int:  # noqa: N802
        return int(self.desk.is_hung(hwnd))

    def GetWindowRect(self, hwnd: int, ref: Any) -> int:  # noqa: N802
        win = self.desk.win(hwnd)
        if win is None:
            return 0
        r = ref._obj
        r.left, r.top, r.right, r.bottom = win.rect
        return 1

    def GetAncestor(self, hwnd: int, flag: int) -> int:  # noqa: N802
        win = self.desk.win(hwnd)
        if win is None:
            return 0
        if flag == _GA_PARENT:  # top-level windows: the desktop window; the desktop: none
            if win.parent:
                return win.parent
            return 0 if win.handle == DESKTOP_HANDLE else DESKTOP_HANDLE
        if flag == _GA_ROOT:
            return self.desk.root(hwnd)
        if flag == _GA_ROOTOWNER:
            return self.desk.root_owner(hwnd)
        return 0

    def GetParent(self, hwnd: int) -> int:  # noqa: N802
        win = self.desk.win(hwnd)
        if win is None:
            return 0
        return win.parent or win.owner

    def _children(self, parent: int) -> list[int]:
        if parent == DESKTOP_HANDLE:
            return list(self.desk.z)
        return [h for h, w in self.desk.wins.items() if w.parent == parent]

    def GetWindow(self, hwnd: int, cmd: int) -> int:  # noqa: N802
        win = self.desk.win(hwnd)
        if win is None:
            return 0
        if cmd == _GW_OWNER:
            return win.owner
        if cmd == _GW_CHILD:
            kids = self._children(win.handle)
            return kids[0] if kids else 0
        if cmd in (_GW_HWNDNEXT, _GW_HWNDPREV):
            siblings = self._children(win.parent or DESKTOP_HANDLE)
            if win.handle not in siblings:
                return 0
            i = siblings.index(win.handle) + (1 if cmd == _GW_HWNDNEXT else -1)
            return siblings[i] if 0 <= i < len(siblings) else 0
        return 0

    def GetLastActivePopup(self, hwnd: int) -> int:  # noqa: N802
        return int(hwnd)

    def WindowFromPoint(self, point: Any) -> int:  # noqa: N802
        return self.desk.window_from_point(int(point.x), int(point.y))

    def FindWindowExW(self, parent: Any, after: Any, cls: Any, title: Any) -> int:  # noqa: N802
        return 0

    def GetWindowLongPtrW(self, hwnd: int, index: int) -> int:  # noqa: N802
        win = self.desk.win(hwnd)
        if win is None:
            return 0
        if index == _GWL_STYLE:
            style = _WS_VISIBLE if win.visible else 0
            return style | (_WS_CHILD if win.parent else _WS_CAPTION)
        if index == _GWL_EXSTYLE:
            return _WS_EX_TOOLWINDOW if win.toolwindow else 0
        return 0

    GetWindowLongW = GetWindowLongPtrW

    def GetSystemMetrics(self, index: int) -> int:  # noqa: N802
        return self.desk.get_system_metrics(index)

    def GetCurrentThreadId(self) -> int:  # noqa: N802
        return 999

    def GetGUIThreadInfo(self, tid: int, ref: Any) -> int:  # noqa: N802
        return 0

    def SendMessageTimeoutW(  # noqa: N802
        self, hwnd: int, msg: int, wparam: Any, lparam: Any, flags: int, timeout: int, ref: Any
    ) -> int:
        self.desk.calls.append(f"SendMessageTimeoutW({hwnd}, {msg:#x})")
        if int(hwnd) in self.desk.unresponsive_controls or self.desk.is_hung(hwnd):
            self.desk.clock.advance(int(timeout) / 1000)  # it waited its timeout, no answer
            return 0
        return 1

    def SendMessageW(self, hwnd: int, msg: int, wparam: Any, lparam: Any) -> int:  # noqa: N802
        self._would_block("SendMessageW", hwnd)
        return 0

    def PostMessageW(self, hwnd: int, msg: int, wparam: Any, lparam: Any) -> int:  # noqa: N802
        return 1

    # ---- window-manager actions (synchronous ones block on a hung window) ----------------------
    def _bring_forward(self, hwnd: int) -> None:
        root = self.desk.root(hwnd)
        self.desk.foreground = root
        if root in self.desk.z:
            self.desk.z.remove(root)
            self.desk.z.insert(0, root)

    def SetForegroundWindow(self, hwnd: int) -> int:  # noqa: N802
        self.desk.set_foreground.append(int(hwnd))
        if self._would_block("SetForegroundWindow", hwnd) or self.desk.win(hwnd) is None:
            return 0  # a frozen window never takes the foreground
        self._bring_forward(hwnd)
        return 1

    def BringWindowToTop(self, hwnd: int) -> int:  # noqa: N802
        self.desk.set_foreground.append(int(hwnd))
        if self._would_block("BringWindowToTop", hwnd) or self.desk.win(hwnd) is None:
            return 0
        self._bring_forward(hwnd)
        return 1

    def SwitchToThisWindow(self, hwnd: int, alt_tab: Any) -> None:  # noqa: N802
        self.desk.set_foreground.append(int(hwnd))
        if not self._would_block("SwitchToThisWindow", hwnd) and self.desk.win(hwnd):
            self._bring_forward(hwnd)

    def SetActiveWindow(self, hwnd: int) -> int:  # noqa: N802
        self._would_block("SetActiveWindow", hwnd)
        return 0

    def SetFocus(self, hwnd: int) -> int:  # noqa: N802
        self._would_block("SetFocus", hwnd)
        return 0

    def SetWindowPos(self, hwnd: int, *args: Any) -> int:  # noqa: N802
        self._would_block("SetWindowPos", hwnd)
        return 1

    def _show(self, hwnd: int, cmd: int) -> None:
        win = self.desk.win(hwnd)
        if win is None:
            return
        if cmd == _SW_RESTORE:
            win.minimized = False
        elif cmd == _SW_MINIMIZE:
            win.minimized = True
        elif cmd == _SW_HIDE:
            win.visible = False

    def ShowWindow(self, hwnd: int, cmd: int) -> int:  # noqa: N802
        if not self._would_block("ShowWindow", hwnd):
            self._show(hwnd, int(cmd))
        return 1

    def ShowWindowAsync(self, hwnd: int, cmd: int) -> int:  # noqa: N802 - never blocks
        self._show(hwnd, int(cmd))
        return 1

    def AttachThreadInput(self, me: int, other: int, attach: Any) -> int:  # noqa: N802
        for tid in (int(me), int(other)):
            if attach and self.desk.hung_thread(tid):
                self.desk.blocking.append(f"AttachThreadInput({me}, {other})")
        return 1

    def AllowSetForegroundWindow(self, pid: int) -> int:  # noqa: N802
        return 1

    def LockSetForegroundWindow(self, code: int) -> int:  # noqa: N802
        return 1

    def SendInput(self, count: int, ref: Any, size: int) -> int:  # noqa: N802
        self.desk.calls.append("uia.SendInput")
        return int(count)


# ---- UI Automation -------------------------------------------------------------------------


class FakeChildren:
    def __init__(self, items: Sequence[FakeElement], filler: FakeElement | None, extra: int):
        self.items = list(items)
        self.filler = filler
        self.Length = len(self.items) + (extra if filler is not None else 0)

    def GetElement(self, i: int) -> FakeElement:  # noqa: N802 - COM name
        if i < len(self.items):
            return self.items[i]
        assert self.filler is not None
        return self.filler


class FakeElement:
    def __init__(
        self,
        desk: FakeDesktop,
        role: str,
        name: str = "",
        rect: tuple[int, int, int, int] = (0, 0, 0, 0),
        children: Sequence[FakeElement] = (),
        *,
        native_hwnd: int = 0,
        delay: float = 0.0,
        unresponsive: bool = False,
        filler: FakeElement | None = None,
        extra: int = 0,
    ) -> None:
        self.desk = desk
        self.CachedControlType = ROLE_IDS[role]
        self.CachedName = name
        left, top, right, bottom = rect
        self.CachedBoundingRectangle = types.SimpleNamespace(
            left=left, top=top, right=right, bottom=bottom
        )
        self.CachedIsOffscreen = False
        self.CachedIsPassword = False
        self.CachedIsEnabled = True
        self.CachedHelpText = ""
        self.CachedAutomationId = ""
        self.native_hwnd = native_hwnd
        self.delay = delay
        self.unresponsive = unresponsive
        self.children = FakeChildren(children, filler, extra)
        self.automation: FakeAutomation | None = None

    def GetCachedPropertyValue(self, prop: int) -> Any:  # noqa: N802
        return {
            _P_CONTROL_TYPE: self.CachedControlType,
            _P_NAME: self.CachedName,
            _P_IS_ENABLED: True,
            _P_IS_PASSWORD: False,
            _P_IS_OFFSCREEN: False,
            _P_NATIVE_HWND: self.native_hwnd or None,
        }.get(prop)

    def GetCachedChildren(self) -> FakeChildren:  # noqa: N802
        return self.children

    def BuildUpdatedCache(self, request: Any) -> FakeElement:  # noqa: N802
        automation = self.desk.automation
        automation.calls += 1
        if self.unresponsive:  # the provider never answers: the call waits out its timeout
            self.desk.clock.advance(automation.TransactionTimeout / 1000)
            raise FakeComError(_UIA_E_TIMEOUT - (1 << 32), "UIA call timed out")
        self.desk.clock.advance(self.delay)
        return self


class FakeAutomation:
    def __init__(self, desk: FakeDesktop) -> None:
        self.desk = desk
        self.TransactionTimeout = 1000
        self.ConnectionTimeout = 1000
        self.calls = 0

    def ElementFromHandleBuildCache(self, hwnd: int, request: Any) -> FakeElement:  # noqa: N802
        self.calls += 1
        tree = self.desk.trees.get(self.desk.canonical(hwnd) or int(hwnd))  # aliases too
        if tree is None:
            raise FakeComError(_E_FAIL - (1 << 32), "no provider")
        self.desk.clock.advance(tree.delay)
        return tree

    def GetFocusedElement(self) -> Any:  # noqa: N802
        return types.SimpleNamespace(CurrentIsPassword=False)


def _fake_context(automation: FakeAutomation) -> Any:
    """A real ``uia._Context`` (so its real ``set_timeout`` runs) around the fake automation."""
    ctx = object.__new__(uia._Context)
    ctx.automation = automation
    ctx.timeouts = True
    ctx._timeout_ms = 1000
    ctx.request = types.SimpleNamespace()
    return ctx


def install_fake_clock(monkeypatch: pytest.MonkeyPatch, desk: FakeDesktop) -> FakeClock:
    """uia reads time through its ``time`` module attribute; give it the fake clock."""
    fake = types.SimpleNamespace(
        **{k: getattr(time, k) for k in dir(time) if not k.startswith("_")}
    )
    fake.monotonic = desk.clock.monotonic
    fake.perf_counter = desk.clock.monotonic
    fake.sleep = desk.clock.sleep
    monkeypatch.setattr(uia, "time", fake)
    return desk.clock


# --------------------------------------------------------------------------------------------
# Fixtures
# --------------------------------------------------------------------------------------------

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


def _refuse(attempts: list[str], name: str, *args: Any, **kwargs: Any) -> Any:
    attempts.append(name)
    raise AssertionError(f"unit test reached the real {name}")


@pytest.fixture(autouse=True)
def _no_real_input(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Defense in depth: fail if anything reaches the real user32 input/foreground APIs."""
    attempts: list[str] = []
    user32 = ctypes.windll.user32  # type: ignore[attr-defined]
    for name in (
        "SendInput",
        "SetCursorPos",
        "mouse_event",
        "keybd_event",
        "SetForegroundWindow",
        "BringWindowToTop",
        "AttachThreadInput",
        "BlockInput",
    ):
        monkeypatch.setattr(user32, name, functools.partial(_refuse, attempts, name))
    monkeypatch.setattr(inp, "_User32", functools.partial(_refuse, attempts, "input._User32"))
    yield
    assert attempts == [], f"real Windows input APIs were called: {attempts}"


@pytest.fixture(autouse=True)
def desk(monkeypatch: pytest.MonkeyPatch) -> Iterator[FakeDesktop]:
    fake = FakeDesktop()
    api = FakeWin32(fake)
    context = _fake_context(fake.automation)
    monkeypatch.setattr(inp, "_api", lambda: fake)
    for name in _INPUT_DELAYS:
        monkeypatch.setattr(inp, name, 0, raising=False)
    monkeypatch.setattr(server_mod, "_SETTLE_SECONDS", 0, raising=False)
    monkeypatch.setattr(screen, "list_monitors", lambda: [MONITOR])
    monkeypatch.setattr(screen, "capture", fake.capture)
    monkeypatch.setattr(uia, "_win", lambda: api)
    monkeypatch.setattr(uia, "_context", lambda: context)
    monkeypatch.setattr(uia, "ancestor_pids", lambda: fake.ancestors)
    monkeypatch.setattr(uia, "_chromium_woken", set())
    yield fake
    assert fake.unexpected == [], fake.unexpected


# --------------------------------------------------------------------------------------------
# In-memory MCP client
# --------------------------------------------------------------------------------------------


@dataclasses.dataclass
class Reply:
    result: mcp_types.CallToolResult
    seconds: float = 0.0

    @property
    def is_error(self) -> bool:
        return bool(self.result.isError)

    @property
    def text(self) -> str:
        return "\n".join(
            c.text for c in self.result.content if isinstance(c, mcp_types.TextContent)
        )

    @property
    def lines(self) -> list[str]:
        return self.text.strip().splitlines()


@dataclasses.dataclass
class Client:
    portal: BlockingPortal
    session: ClientSession

    def call(self, name: str, **arguments: Any) -> Reply:
        start = time.monotonic()
        result = self.portal.call(self.session.call_tool, name, arguments)
        return Reply(result, time.monotonic() - start)


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
                    read_timeout_seconds=timedelta(seconds=SESSION_GUARD_S),
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


def within(seconds: float, body: Callable[[], Any]) -> Any:
    """Run ``body`` in its own thread; fail the test if it does not finish in ``seconds``."""
    box: dict[str, Any] = {}

    def target() -> None:
        try:
            box["value"] = body()
        except BaseException as exc:  # handed to the test thread
            box["error"] = exc

    thread = threading.Thread(target=target, daemon=True)
    thread.start()
    thread.join(seconds)
    assert not thread.is_alive(), f"the tool call did not finish within {seconds} s"
    if "error" in box:
        raise box["error"]
    return box.get("value")


def assert_ok(reply: Reply) -> None:
    assert not reply.is_error, reply.text
    assert re.search(r"\bok\b", reply.text), reply.text


def assert_refused(reply: Reply, roots: Sequence[str]) -> None:
    assert reply.is_error, f"expected a refusal, got: {reply.text!r}"
    assert mentions(reply.text, roots), f"none of {roots} in {reply.text!r}"


def own_window(desk: FakeDesktop) -> Win:
    """EDITOR becomes the agent's own window: its process is one of the server's ancestors."""
    desk.ancestors = frozenset({7001, EDITOR.pid})
    return EDITOR


# ============================================================================================
# a. focus on a hung window
# ============================================================================================


@pytest.mark.parametrize("minimized", [False, True], ids=["visible", "minimized"])
def test_focus_on_hung_window_is_a_quick_error_without_blocking_calls(
    desk: FakeDesktop, minimized: bool
) -> None:
    hung = desk.wins[PAINT.handle]
    hung.hung = True
    hung.minimized = minimized

    def session() -> tuple[Reply, Reply, Reply]:
        with connect() as client:
            refused = client.call("focus", window=PAINT.handle)
            listing = client.call("windows")  # the server still answers ...
            focused = client.call("focus", window=EDITOR.handle)  # ... and still acts
        return refused, listing, focused

    refused, listing, focused = within(SESSION_GUARD_S, session)
    assert_refused(refused, HUNG_ROOTS)
    assert refused.seconds < FOCUS_QUICK_S, refused.seconds
    # Calls that wait for a frozen window (sync show, bring to front, attach to its thread)
    # must not have been made at all.
    assert desk.blocking == []
    assert PAINT.handle not in desk.set_foreground
    assert desk.events == []
    assert not listing.is_error, listing.text
    assert str(PAINT.handle) in listing.text
    assert_ok(focused)
    assert desk.foreground == EDITOR.handle


@pytest.mark.parametrize("minimized", [False, True], ids=["visible", "minimized"])
def test_focus_on_responsive_window_still_works(desk: FakeDesktop, minimized: bool) -> None:
    desk.wins[PAINT.handle].minimized = minimized

    def session() -> Reply:
        with connect() as client:
            return client.call("focus", window=PAINT.handle)

    reply = within(SESSION_GUARD_S, session)
    assert_ok(reply)
    assert PAINT.title in reply.text
    assert desk.foreground == PAINT.handle
    assert desk.wins[PAINT.handle].minimized is False
    assert desk.blocking == []


# ============================================================================================
# b. right/middle click and drag over a terminal or the agent's own window
# ============================================================================================

TERMINALS = [
    pytest.param(TERMINAL, id="windows-terminal"),
    pytest.param(CONSOLE, id="console"),
]


def _with_input_site_child(desk: FakeDesktop) -> None:
    """Windows Terminal's client area is a child window: WindowFromPoint returns that child."""
    left, top, right, bottom = TERMINAL.rect
    desk.add(
        Win(
            2100, "", TERMINAL.process, TERMINAL.pid, (left + 1, top + 40, right - 1, bottom - 1),
            "Windows.UI.Input.InputSite.WindowClass", parent=TERMINAL.handle,
        )
    )  # fmt: skip


def _click(desk: FakeDesktop, point: tuple[int, int], button: str) -> Reply:
    with connect() as client:
        client.call("screenshot")  # identity mapping: image pixels == screen pixels
        return client.call("click", x=point[0], y=point[1], button=button)


@pytest.mark.parametrize("button", ["right", "middle"])
@pytest.mark.parametrize("target", TERMINALS)
def test_right_and_middle_click_on_terminal_are_refused(
    desk: FakeDesktop, button: str, target: Win
) -> None:
    reply = _click(desk, target.center, button)
    assert_refused(reply, TERMINAL_ROOTS)
    assert desk.events == []  # not even a pointer move reached the fake mouse


@pytest.mark.parametrize("button", ["right", "middle"])
def test_right_and_middle_click_on_terminal_child_window_are_refused(
    desk: FakeDesktop, button: str
) -> None:
    _with_input_site_child(desk)
    reply = _click(desk, TERMINAL.center, button)
    assert_refused(reply, TERMINAL_ROOTS)
    assert desk.events == []


@pytest.mark.parametrize("button", ["right", "middle"])
def test_right_and_middle_click_on_own_window_are_refused(desk: FakeDesktop, button: str) -> None:
    own = own_window(desk)
    reply = _click(desk, own.center, button)
    assert_refused(reply, OWN_WINDOW_ROOTS)
    assert desk.events == []


@pytest.mark.parametrize("target", [*TERMINALS, pytest.param(EDITOR, id="own-window")])
def test_left_click_on_terminal_or_own_window_still_reaches_the_mouse(
    desk: FakeDesktop, target: Win
) -> None:
    own_window(desk)
    reply = _click(desk, target.center, "left")
    assert_ok(reply)
    assert desk.pressed(_MOUSEEVENTF_LEFTDOWN) and desk.pressed(_MOUSEEVENTF_LEFTUP)
    assert desk.cursor == target.center


@pytest.mark.parametrize(
    ("button", "down", "up"),
    [
        ("right", _MOUSEEVENTF_RIGHTDOWN, _MOUSEEVENTF_RIGHTUP),
        ("middle", _MOUSEEVENTF_MIDDLEDOWN, _MOUSEEVENTF_MIDDLEUP),
    ],
)
def test_right_and_middle_click_on_ordinary_app_reach_the_mouse(
    desk: FakeDesktop, button: str, down: int, up: int
) -> None:
    own_window(desk)  # the agent's own window exists elsewhere; Notepad is not it
    reply = _click(desk, NOTEPAD.center, button)
    assert_ok(reply)
    assert desk.pressed(down) and desk.pressed(up)
    assert desk.cursor == NOTEPAD.center


def _drag(start: tuple[int, int], end: tuple[int, int]) -> Reply:
    with connect() as client:
        client.call("screenshot")
        return client.call("drag", x0=start[0], y0=start[1], x1=end[0], y1=end[1])


@pytest.mark.parametrize("target", TERMINALS)
@pytest.mark.parametrize("end_on_target", [False, True], ids=["start-on-it", "end-on-it"])
def test_drag_touching_a_terminal_is_refused(
    desk: FakeDesktop, target: Win, end_on_target: bool
) -> None:
    ordinary = (300, 300)  # inside Notepad
    start, end = (ordinary, target.center) if end_on_target else (target.center, ordinary)
    reply = _drag(start, end)
    assert_refused(reply, TERMINAL_ROOTS)
    assert desk.events == []


@pytest.mark.parametrize("end_on_target", [False, True], ids=["start-on-it", "end-on-it"])
def test_drag_touching_the_own_window_is_refused(desk: FakeDesktop, end_on_target: bool) -> None:
    own = own_window(desk)
    ordinary = (300, 300)
    start, end = (ordinary, own.center) if end_on_target else (own.center, ordinary)
    reply = _drag(start, end)
    assert_refused(reply, OWN_WINDOW_ROOTS)
    assert desk.events == []


def test_drag_inside_an_ordinary_app_reaches_the_mouse(desk: FakeDesktop) -> None:
    own_window(desk)
    reply = _drag((300, 300), (700, 800))
    assert_ok(reply)
    assert desk.pressed(_MOUSEEVENTF_LEFTDOWN) and desk.pressed(_MOUSEEVENTF_LEFTUP)
    assert desk.cursor == (700, 800)


# ============================================================================================
# c. blocklist through root and root-owner windows
# ============================================================================================

BLOCK_KEEPASS = Config(blocked_processes=("keepass.exe",))


def _focus(handle: int, cfg: Config = BLOCK_KEEPASS) -> Reply:
    def session() -> Reply:
        with connect(cfg) as client:
            return client.call("focus", window=handle)

    return within(SESSION_GUARD_S, session)


def test_focus_child_handle_of_blocked_app_is_refused(desk: FakeDesktop) -> None:
    # A child control of KeePass: not in the window list, but its root window is KeePass.
    desk.add(Win(2001, "", KEEPASS.process, KEEPASS.pid, (1150, 850, 1400, 880), "Edit",
                 parent=KEEPASS.handle))  # fmt: skip
    reply = _focus(2001)
    assert_refused(reply, BLOCKED_ROOTS)
    assert desk.set_foreground == []
    assert desk.foreground == NOTEPAD.handle


def test_focus_window_owned_by_blocked_app_is_refused(desk: FakeDesktop) -> None:
    # An untitled top-level window of another process, owned by KeePass: its root is itself
    # (not blocked), its root owner is KeePass (blocked).
    desk.add(Win(2002, "", "dialoghost.exe", 4020, (1150, 850, 1400, 950), "#32770",
                 owner=KEEPASS.handle))  # fmt: skip
    reply = _focus(2002)
    assert_refused(reply, BLOCKED_ROOTS)
    assert desk.set_foreground == []
    assert desk.foreground == NOTEPAD.handle


def test_focus_unlisted_handle_of_allowed_app_still_works(desk: FakeDesktop) -> None:
    desk.add(Win(2003, "", PAINT.process, PAINT.pid, (1540, 560, 1880, 780), "Canvas",
                 parent=PAINT.handle))  # fmt: skip
    reply = _focus(2003)
    assert_ok(reply)
    assert desk.foreground == PAINT.handle


def test_focus_listed_window_of_blocked_app_is_still_refused(desk: FakeDesktop) -> None:
    reply = _focus(KEEPASS.handle)
    assert_refused(reply, BLOCKED_ROOTS)
    assert desk.set_foreground == []


POPUP_RECT = (300, 300, 500, 400)  # over Notepad
POPUP_POINT = (400, 350)


@pytest.mark.parametrize("tool", ["click", "move"])
def test_pointer_over_blocked_root_owned_by_allowed_app_is_refused(
    desk: FakeDesktop, tool: str
) -> None:
    # A KeePass popup owned by Notepad: root = the popup (KeePass), root owner = Notepad.
    desk.add(Win(3001, "Auto-Type", KEEPASS.process, KEEPASS.pid, POPUP_RECT, "#32770",
                 owner=NOTEPAD.handle))  # fmt: skip
    with connect(BLOCK_KEEPASS) as client:
        client.call("screenshot")
        reply = client.call(tool, x=POPUP_POINT[0], y=POPUP_POINT[1])
    assert_refused(reply, BLOCKED_ROOTS)
    assert desk.events == []


@pytest.mark.parametrize("tool", ["click", "move"])
def test_pointer_over_window_owned_by_blocked_app_is_refused(desk: FakeDesktop, tool: str) -> None:
    # Root = a helper process window (not blocked), root owner = KeePass (blocked).
    desk.add(Win(3002, "Open", "dialoghost.exe", 4020, POPUP_RECT, "#32770",
                 owner=KEEPASS.handle))  # fmt: skip
    with connect(BLOCK_KEEPASS) as client:
        client.call("screenshot")
        reply = client.call(tool, x=POPUP_POINT[0], y=POPUP_POINT[1])
    assert_refused(reply, BLOCKED_ROOTS)
    assert desk.events == []


def test_pointer_over_child_control_of_blocked_app_is_refused(desk: FakeDesktop) -> None:
    desk.add(Win(3003, "", KEEPASS.process, KEEPASS.pid, (1150, 850, 1400, 900), "Button",
                 parent=KEEPASS.handle))  # fmt: skip
    with connect(BLOCK_KEEPASS) as client:
        client.call("screenshot")
        reply = client.call("click", x=1200, y=870)
    assert_refused(reply, BLOCKED_ROOTS)
    assert desk.events == []


def test_pointer_over_allowed_popup_of_allowed_app_still_works(desk: FakeDesktop) -> None:
    desk.add(Win(3004, "Find", NOTEPAD.process, NOTEPAD.pid, POPUP_RECT, "#32770",
                 owner=NOTEPAD.handle))  # fmt: skip
    with connect(BLOCK_KEEPASS) as client:
        client.call("screenshot")
        reply = client.call("click", x=POPUP_POINT[0], y=POPUP_POINT[1])
    assert_ok(reply)
    assert desk.pressed(_MOUSEEVENTF_LEFTDOWN)


# ============================================================================================
# d. element ids from a window that changed since the elements call
# ============================================================================================

SAVE_RECT = (420, 285, 480, 315)  # center (450, 300)
SAVE_CENTER = (450, 300)


def notepad_tree(desk: FakeDesktop) -> None:
    win = desk.wins[NOTEPAD.handle]
    desk.trees[NOTEPAD.handle] = FakeElement(
        desk,
        "window",
        win.title,
        win.rect,
        [
            FakeElement(desk, "button", "Save", SAVE_RECT),
            FakeElement(desk, "button", "Open", (520, 285, 580, 315)),
            FakeElement(desk, "edit", "File name", (600, 585, 900, 615)),
        ],
    )


def _element_id(listing: Reply, role: str, name: str) -> int:
    match = re.search(rf'\[(\d+)\] {role} "{re.escape(name)}"', listing.text)
    assert match, listing.text
    return int(match.group(1))


def _close(desk: FakeDesktop) -> None:
    desk.remove(NOTEPAD.handle)


def _move_window(desk: FakeDesktop) -> None:
    win = desk.wins[NOTEPAD.handle]
    left, top, right, bottom = win.rect
    win.rect = (left + 40, top + 30, right + 40, bottom + 30)  # Save's old center: still Notepad


def _resize_window(desk: FakeDesktop) -> None:
    win = desk.wins[NOTEPAD.handle]
    left, top, right, bottom = win.rect
    win.rect = (left, top, right - 200, bottom - 150)  # Save's old center: still Notepad


def _minimize_window(desk: FakeDesktop) -> None:
    desk.wins[NOTEPAD.handle].minimized = True


def _cover_point(desk: FakeDesktop) -> None:
    # A window of ANOTHER process (pid 4010, not Notepad's 4001) now sits on the target point.
    desk.add(Win(1010, "New message", "olk.exe", 4010, (400, 250, 800, 450), "Toast"))


def _cover_point_with_foreign_dropdown(desk: FakeDesktop) -> None:
    # Even a dropdown-shaped window counts when it belongs to another process.
    desk.add(Win(1014, "", "olk.exe", 4010, (400, 250, 800, 450), "ComboLBox"))


CHANGES = [
    pytest.param(_close, id="window-closed"),
    pytest.param(_minimize_window, id="window-minimized"),
    pytest.param(_move_window, id="window-moved"),
    pytest.param(_resize_window, id="window-resized"),
    pytest.param(_cover_point, id="other-process-window-on-top"),
    pytest.param(_cover_point_with_foreign_dropdown, id="other-process-dropdown-on-top"),
]


@pytest.mark.parametrize("change", CHANGES)
def test_click_element_from_changed_window_is_refused_as_stale(
    desk: FakeDesktop, change: Callable[[FakeDesktop], None]
) -> None:
    notepad_tree(desk)
    with connect() as client:
        listing = client.call("elements")
        save = _element_id(listing, "button", "Save")
        change(desk)
        reply = client.call("click", element=save)
    assert reply.is_error, f"expected a refusal, got: {reply.text!r}"
    assert "elements" in reply.text.lower(), reply.text
    assert mentions(reply.text, STALE_ROOTS), reply.text
    assert desk.events == []


def test_click_element_from_unchanged_window_still_clicks_its_center(desk: FakeDesktop) -> None:
    notepad_tree(desk)
    with connect() as client:
        listing = client.call("elements")
        save = _element_id(listing, "button", "Save")
        reply = client.call("click", element=save)
    assert_ok(reply)
    assert desk.cursor == SAVE_CENTER
    assert desk.pressed(_MOUSEEVENTF_LEFTDOWN) and desk.pressed(_MOUSEEVENTF_LEFTUP)


def test_click_element_after_unrelated_window_changes_still_clicks(desk: FakeDesktop) -> None:
    # Another window moving or opening elsewhere does not make Notepad's ids stale.
    notepad_tree(desk)
    with connect() as client:
        listing = client.call("elements")
        save = _element_id(listing, "button", "Save")
        paint_win = desk.wins[PAINT.handle]
        paint_win.rect = (1500, 500, 1880, 780)
        desk.add(Win(1011, "Calculator", "calc.exe", 4011, (1500, 820, 1800, 1000), "Calc"))
        reply = client.call("click", element=save)
    assert_ok(reply)
    assert desk.cursor == SAVE_CENTER


SAME_PROCESS_POPUPS = [
    pytest.param("ComboLBox", id="combobox-dropdown"),
    pytest.param("#32768", id="menu"),
    pytest.param("tooltips_class32", id="tooltip"),
]


@pytest.mark.parametrize("popup_class", SAME_PROCESS_POPUPS)
def test_click_element_under_popup_of_the_same_process_still_clicks(
    desk: FakeDesktop, popup_class: str
) -> None:
    # Classic dropdown lists, menus and tooltips are separate unowned top-level windows of the
    # app's own process: one at the element's point does not make the id stale.
    notepad_tree(desk)
    with connect() as client:
        listing = client.call("elements")
        save = _element_id(listing, "button", "Save")
        desk.add(Win(1012, "", NOTEPAD.process, NOTEPAD.pid, (400, 250, 800, 450), popup_class))
        reply = client.call("click", element=save)
    assert_ok(reply)
    assert desk.cursor == SAVE_CENTER
    assert desk.pressed(_MOUSEEVENTF_LEFTDOWN) and desk.pressed(_MOUSEEVENTF_LEFTUP)


def test_right_click_element_under_same_process_popup_of_a_terminal_is_refused(
    desk: FakeDesktop,
) -> None:
    # The terminal rule is independent of the stale-id rule: a same-process popup over a
    # terminal's element does not make a right click there acceptable.
    tab_rect = (1150, 10, 1250, 40)
    desk.trees[TERMINAL.handle] = FakeElement(
        desk, "window", TERMINAL.title, TERMINAL.rect,
        [FakeElement(desk, "button", "Tab 1", tab_rect)],
    )  # fmt: skip
    with connect() as client:
        listing = client.call("elements", window=TERMINAL.handle)
        tab = _element_id(listing, "button", "Tab 1")
        desk.add(Win(1013, "", TERMINAL.process, TERMINAL.pid, (1140, 0, 1300, 100), "ComboLBox"))
        reply = client.call("click", element=tab, button="right")
    assert_refused(reply, TERMINAL_ROOTS)
    assert desk.events == []


# ============================================================================================
# e. elements says when its scan was cut short
# ============================================================================================


def _buttons(desk: FakeDesktop, count: int, top: int = 120) -> list[FakeElement]:
    return [
        FakeElement(desk, "button", f"Button {i + 1}", (120, top + 30 * i, 220, top + 25 + 30 * i))
        for i in range(count)
    ]


def _tree(desk: FakeDesktop, children: Sequence[FakeElement], **kwargs: Any) -> None:
    win = desk.wins[NOTEPAD.handle]
    desk.trees[NOTEPAD.handle] = FakeElement(
        desk, "window", win.title, win.rect, children, **kwargs
    )


def _element_lines(reply: Reply) -> list[str]:
    return [line for line in reply.lines if re.match(r"\[\d+\] ", line)]


def test_elements_cut_by_size_cap_says_so(desk: FakeDesktop) -> None:
    # Two buttons, then far more nodes than any size cap allows (separators: never listed).
    separator = FakeElement(desk, "separator", "", (120, 900, 900, 902))
    _tree(desk, _buttons(desk, 2), filler=separator, extra=60_000)
    with connect() as client:
        reply = client.call("elements")
    assert not reply.is_error, reply.text
    assert len(_element_lines(reply)) == 2  # far below the limit of 80 ...
    assert mentions(reply.text, CUT_ROOTS), reply.text  # ... yet the listing is incomplete


def test_elements_cut_by_time_budget_says_so(
    desk: FakeDesktop, monkeypatch: pytest.MonkeyPatch
) -> None:
    clock = install_fake_clock(monkeypatch, desk)
    # Ten slow (but answering) panes, each holding one button: the budget runs out part-way.
    panes = [
        FakeElement(
            desk, "pane", "", (110, 110 + 80 * i, 990, 180 + 80 * i),
            [FakeElement(desk, "button", f"Item {i + 1}", (120, 120 + 80 * i, 220, 150 + 80 * i))],
            delay=0.4,
        )
        for i in range(10)
    ]  # fmt: skip
    _tree(desk, panes)
    with connect() as client:
        start = clock.now
        reply = client.call("elements")
        spent = clock.now - start
    assert not reply.is_error, reply.text
    found = len(_element_lines(reply))
    assert 0 < found < 10, reply.text  # the scenario really stopped part-way
    assert spent < 0.4 * 10, spent
    assert mentions(reply.text, CUT_ROOTS), reply.text


def test_elements_exactly_at_limit_and_complete_is_not_called_cut(desk: FakeDesktop) -> None:
    _tree(desk, _buttons(desk, 3))
    with connect(Config(max_elements=3)) as client:
        reply = client.call("elements")
    assert not reply.is_error, reply.text
    assert len(_element_lines(reply)) == 3
    assert len(reply.lines) == 1 + 3, reply.lines  # header + the elements, no note
    assert not mentions(reply.text, CUT_ROOTS), reply.text


def test_elements_below_limit_and_complete_is_not_called_cut(desk: FakeDesktop) -> None:
    _tree(desk, _buttons(desk, 2))
    with connect(Config(max_elements=3)) as client:
        reply = client.call("elements")
    assert len(reply.lines) == 1 + 2, reply.lines
    assert not mentions(reply.text, CUT_ROOTS), reply.text


def test_elements_over_limit_keeps_the_truncation_note(desk: FakeDesktop) -> None:
    _tree(desk, _buttons(desk, 5))
    with connect(Config(max_elements=3)) as client:
        reply = client.call("elements")
    assert not reply.is_error, reply.text
    assert len(_element_lines(reply)) == 3
    notes = [line for line in reply.lines[1:] if not re.match(r"\[\d+\] ", line)]
    assert notes, reply.lines
    assert any("truncated" in n.lower() and "3" in n for n in notes), notes


# ============================================================================================
# g. the scan stays within its time budget even when controls do not answer
# ============================================================================================


def test_elements_scan_with_unresponsive_controls_stays_within_budget(
    desk: FakeDesktop, monkeypatch: pytest.MonkeyPatch
) -> None:
    clock = install_fake_clock(monkeypatch, desk)
    # 40 Win32 labels whose text query (WM_GETTEXT) times out, then three providers that never
    # answer their UIA call. Each one alone is bounded; together they must not add up.
    labels = []
    for i in range(40):
        hwnd = 5000 + i
        desk.unresponsive_controls.add(hwnd)
        labels.append(
            FakeElement(
                desk, "text", f"Label {i + 1}", (120, 110 + 20 * i, 400, 128 + 20 * i),
                native_hwnd=hwnd,
            )
        )  # fmt: skip
    stuck = [
        FakeElement(desk, "pane", "", (500, 110 + 100 * i, 990, 200 + 100 * i), unresponsive=True)
        for i in range(3)
    ]
    _tree(desk, [*labels, *stuck])
    with connect() as client:
        start = clock.now
        client.call("elements")
        spent = clock.now - start
    assert spent <= SCAN_PROMISE_S, f"the element scan took {spent:.2f} s of (fake) time"


# ============================================================================================
# f. --max-size upper bound 2576
# ============================================================================================


def test_max_size_2576_is_accepted_from_cli_and_env() -> None:
    assert load_config(["--max-size", "2576"], {}).max_size == 2576
    assert load_config([], {"CUW_MAX_SIZE": "2576"}).max_size == 2576


@pytest.mark.parametrize("value", ["2577", "4096"])
def test_max_size_above_2576_is_invalid_from_cli(value: str) -> None:
    with pytest.raises(ValueError, match="max-size"):
        load_config(["--max-size", value], {})


@pytest.mark.parametrize("value", ["2577", "4096"])
def test_max_size_above_2576_is_invalid_from_env(value: str) -> None:
    with pytest.raises(ValueError, match="CUW_MAX_SIZE"):
        load_config([], {"CUW_MAX_SIZE": value})


# ============================================================================================
# The Windows shell is not the agent's own window
# ============================================================================================

EXPLORER_PID = 4050
SHELL_DESKTOP = Win(6001, "Program Manager", "explorer.exe", EXPLORER_PID, (0, 0, 1920, 1080),
                    "Progman")  # fmt: skip
SHELL_TASKBAR = Win(6002, "", "explorer.exe", EXPLORER_PID, (0, 1040, 1920, 1080),
                    "Shell_TrayWnd")  # fmt: skip
FILE_EXPLORER = Win(6003, "Downloads - File Explorer", "explorer.exe", EXPLORER_PID,
                    (200, 200, 600, 500), "CabinetWClass")  # fmt: skip
SHELL_POINTS = [
    pytest.param(FILE_EXPLORER.handle, (400, 350), id="file-explorer"),
    pytest.param(SHELL_DESKTOP.handle, (1050, 50), id="desktop"),
    pytest.param(SHELL_TASKBAR.handle, (50, 1060), id="taskbar"),
]


def shell_launched_host(desk: FakeDesktop, monkeypatch: pytest.MonkeyPatch) -> None:
    """The agent runs in an editor that was started from Explorer.

    Process chain: this server -> node.exe (the agent) -> code.exe (EDITOR, the host) ->
    explorer.exe (the shell, owner of the desktop window). The real ancestor-chain code runs over
    this fake process table and the fake GetShellWindow, instead of a canned pid set.
    """
    desk.processes = {
        os.getpid(): (7001, "python.exe", 400),
        7001: (EDITOR.pid, "node.exe", 300),
        EDITOR.pid: (EXPLORER_PID, "code.exe", 200),
        EXPLORER_PID: (900, "explorer.exe", 100),  # 900 (userinit) already exited
    }
    desk.add(dataclasses.replace(SHELL_DESKTOP), top=False)
    desk.add(dataclasses.replace(SHELL_TASKBAR))
    desk.add(dataclasses.replace(FILE_EXPLORER))
    desk.shell_window = SHELL_DESKTOP.handle
    monkeypatch.setattr(uia, "ancestor_pids", _REAL_ANCESTOR_PIDS)
    monkeypatch.setattr(uia, "_ancestor_pids", None, raising=False)


@pytest.mark.parametrize(("handle", "point"), SHELL_POINTS)
def test_right_click_on_shell_window_is_not_refused_as_own_window(
    desk: FakeDesktop, monkeypatch: pytest.MonkeyPatch, handle: int, point: tuple[int, int]
) -> None:
    shell_launched_host(desk, monkeypatch)
    assert desk.window_from_point(*point) == handle  # the scenario: the shell is under the point
    reply = _click(desk, point, "right")
    assert_ok(reply)
    assert desk.pressed(_MOUSEEVENTF_RIGHTDOWN) and desk.pressed(_MOUSEEVENTF_RIGHTUP)


def test_drag_on_file_explorer_is_not_refused_as_own_window(
    desk: FakeDesktop, monkeypatch: pytest.MonkeyPatch
) -> None:
    shell_launched_host(desk, monkeypatch)
    reply = _drag((300, 300), (500, 450))
    assert_ok(reply)
    assert desk.pressed(_MOUSEEVENTF_LEFTDOWN) and desk.pressed(_MOUSEEVENTF_LEFTUP)


def test_right_click_on_the_real_host_is_still_refused_when_launched_from_shell(
    desk: FakeDesktop, monkeypatch: pytest.MonkeyPatch
) -> None:
    shell_launched_host(desk, monkeypatch)
    reply = _click(desk, EDITOR.center, "right")
    assert_refused(reply, OWN_WINDOW_ROOTS)
    assert desk.events == []


def _typed(desk: FakeDesktop) -> str:
    units = [e[1] for e in desk.events if e[0] == "char" and not e[2]]
    return b"".join(u.to_bytes(2, "little") for u in units).decode("utf-16-le")


def test_type_text_into_file_explorer_is_not_refused_as_own_window(
    desk: FakeDesktop, monkeypatch: pytest.MonkeyPatch
) -> None:
    shell_launched_host(desk, monkeypatch)
    desk.foreground = FILE_EXPLORER.handle
    with connect() as client:
        reply = client.call("type_text", text="abc")
    assert_ok(reply)
    assert _typed(desk) == "abc"


def test_type_text_into_the_real_host_is_still_refused_when_launched_from_shell(
    desk: FakeDesktop, monkeypatch: pytest.MonkeyPatch
) -> None:
    shell_launched_host(desk, monkeypatch)
    desk.foreground = EDITOR.handle
    with connect() as client:
        reply = client.call("type_text", text="abc")
    assert_refused(reply, OWN_WINDOW_ROOTS)
    assert desk.events == []


# ============================================================================================
# d (revised). Same-process exception covers only unlisted helper popups, not main windows
# ============================================================================================


def _listed_handles(client: Client) -> set[int]:
    reply = client.call("windows")
    assert not reply.is_error, reply.text
    return {int(m) for m in re.findall(r"^(\d+) \|", reply.text, flags=re.MULTILINE)}


def _app_with_element(
    desk: FakeDesktop, win: Win, name: str, rect: tuple[int, int, int, int]
) -> None:
    desk.add(win)
    desk.foreground = win.handle
    desk.trees[win.handle] = FakeElement(
        desk, "window", win.title, win.rect, [FakeElement(desk, "button", name, rect)]
    )


EXPLORER_A = Win(8001, "Downloads - File Explorer", "explorer.exe", 500, (150, 150, 700, 600),
                 "CabinetWClass")  # fmt: skip
EXPLORER_B = Win(8002, "Documents - File Explorer", "explorer.exe", 500, (180, 180, 650, 550),
                 "CabinetWClass")  # fmt: skip
BROWSER_A = Win(8011, "Inbox - Google Chrome", "chrome.exe", 510, (150, 150, 700, 600),
                "Chrome_WidgetWin_1")  # fmt: skip
BROWSER_B = Win(8012, "News - Google Chrome", "chrome.exe", 510, (180, 180, 650, 550),
                "Chrome_WidgetWin_1")  # fmt: skip
ITEM_RECT = (200, 200, 300, 230)  # center (250, 215): inside A and inside B


@pytest.mark.parametrize("clicks", [1, 2])
@pytest.mark.parametrize(
    ("first", "second"),
    [
        pytest.param(EXPLORER_A, EXPLORER_B, id="two-file-explorers"),
        pytest.param(BROWSER_A, BROWSER_B, id="two-browser-windows"),
    ],
)
def test_click_element_under_listed_main_window_of_same_process_is_stale(
    desk: FakeDesktop, monkeypatch: pytest.MonkeyPatch, first: Win, second: Win, clicks: int
) -> None:
    install_fake_clock(monkeypatch, desk)  # Chromium's wake-up pause costs no real time
    _app_with_element(desk, dataclasses.replace(first), "report.pdf", ITEM_RECT)
    with connect() as client:
        listing = client.call("elements")
        item = _element_id(listing, "button", "report.pdf")
        desk.add(dataclasses.replace(second))  # same pid, titled, a main window on the point
        desk.foreground = second.handle
        listed = _listed_handles(client)
        reply = client.call("click", element=item, clicks=clicks)
    assert {first.handle, second.handle} <= listed  # both are main windows in the list
    assert first.pid == second.pid
    assert reply.is_error, f"expected a refusal, got: {reply.text!r}"
    assert "elements" in reply.text.lower(), reply.text
    assert mentions(reply.text, STALE_ROOTS), reply.text
    assert desk.events == []


@pytest.mark.parametrize("popup_class", SAME_PROCESS_POPUPS)
def test_same_process_helper_popups_are_not_in_the_window_list(
    desk: FakeDesktop, popup_class: str
) -> None:
    # Guards the premise of test_click_element_under_popup_of_the_same_process_still_clicks.
    desk.add(Win(1012, "", NOTEPAD.process, NOTEPAD.pid, (400, 250, 800, 450), popup_class))
    with connect() as client:
        listed = _listed_handles(client)
    assert 1012 not in listed
    assert NOTEPAD.handle in listed


RECYCLE_BIN_RECT = (20, 20, 90, 90)  # center (55, 55)


def _desktop_with_icon(desk: FakeDesktop) -> None:
    desk.add(dataclasses.replace(SHELL_DESKTOP), top=False)
    desk.trees[SHELL_DESKTOP.handle] = FakeElement(
        desk, "window", SHELL_DESKTOP.title, SHELL_DESKTOP.rect,
        [FakeElement(desk, "button", "Recycle Bin", RECYCLE_BIN_RECT)],
    )  # fmt: skip


def test_click_desktop_icon_under_unlisted_shell_helper_window_still_clicks(
    desk: FakeDesktop,
) -> None:
    _desktop_with_icon(desk)
    with connect() as client:
        listing = client.call("elements", window=SHELL_DESKTOP.handle)
        icon = _element_id(listing, "button", "Recycle Bin")
        # An untitled top-level window of the shell process (the WorkerW / DefView host).
        desk.add(Win(6010, "", "explorer.exe", EXPLORER_PID, (0, 0, 120, 120), "WorkerW"))
        listed = _listed_handles(client)
        reply = client.call("click", element=icon, clicks=2)
    assert 6010 not in listed
    assert_ok(reply)
    assert desk.cursor == (55, 55)
    assert desk.pressed(_MOUSEEVENTF_LEFTDOWN)


def test_click_desktop_icon_under_listed_file_explorer_is_stale(desk: FakeDesktop) -> None:
    _desktop_with_icon(desk)
    with connect() as client:
        listing = client.call("elements", window=SHELL_DESKTOP.handle)
        icon = _element_id(listing, "button", "Recycle Bin")
        desk.add(Win(6011, "This PC - File Explorer", "explorer.exe", EXPLORER_PID,
                     (0, 0, 400, 300), "CabinetWClass"))  # fmt: skip
        listed = _listed_handles(client)
        reply = client.call("click", element=icon, clicks=2)
    assert 6011 in listed
    assert reply.is_error, f"expected a refusal, got: {reply.text!r}"
    assert "elements" in reply.text.lower(), reply.text
    assert mentions(reply.text, STALE_ROOTS), reply.text
    assert desk.events == []


# ============================================================================================
# h. with a blocklist, an element scan of ANY window shows nothing of a blocked app
# ============================================================================================

DESKTOP_HANDLE = 65552  # FakeWin32.GetDesktopWindow()
SECRET_TEXTS = ("master password", "unlock", "passwords.kdbx", "vault")
EMBEDDED_RECT = (500, 500, 900, 600)  # inside Notepad
TASKBAR = Win(1020, "", "explorer.exe", 4030, (0, 1040, 1920, 1080), "Shell_TrayWnd")
LONG_KEEPASS_TITLE = "Passwords.kdbx - " + "Vault " * 15 + "- KeePass"  # longer than a name


def _keepass_controls(desk: FakeDesktop, rect: tuple[int, int, int, int]) -> list[FakeElement]:
    left, top, _, _ = rect
    return [
        FakeElement(desk, "edit", "Master password", (left + 20, top + 20, left + 300, top + 45)),
        FakeElement(desk, "button", "Unlock", (left + 320, top + 20, left + 390, top + 45)),
    ]


def _desktop_tree(desk: FakeDesktop) -> int:
    """The desktop window (GetDesktopWindow, a csrss.exe window): in UI Automation its children
    are all top-level windows, KeePass included. Not in the z-order: EnumWindows skips it."""
    desk.wins[DESKTOP_HANDLE] = Win(
        DESKTOP_HANDLE, "", "csrss.exe", 600, (0, 0, 1920, 1080), "#32769"
    )
    notepad_win, keepass_win = desk.wins[NOTEPAD.handle], desk.wins[KEEPASS.handle]
    desk.trees[DESKTOP_HANDLE] = FakeElement(
        desk, "pane", "Desktop 1", (0, 0, 1920, 1080),
        [
            FakeElement(desk, "window", notepad_win.title, notepad_win.rect,
                        [FakeElement(desk, "button", "Save", SAVE_RECT)],
                        native_hwnd=NOTEPAD.handle),
            FakeElement(desk, "window", keepass_win.title, keepass_win.rect,
                        _keepass_controls(desk, keepass_win.rect), native_hwnd=KEEPASS.handle),
        ],
    )  # fmt: skip
    return DESKTOP_HANDLE


def _notepad_with_embedded_keepass(desk: FakeDesktop) -> int:
    """A KeePass window reparented into Notepad (a child window of another process)."""
    desk.add(Win(2201, "", KEEPASS.process, KEEPASS.pid, EMBEDDED_RECT, "WindowsForms10.Window",
                 parent=NOTEPAD.handle))  # fmt: skip
    win = desk.wins[NOTEPAD.handle]
    desk.trees[NOTEPAD.handle] = FakeElement(
        desk, "window", win.title, win.rect,
        [
            FakeElement(desk, "button", "Save", SAVE_RECT),
            FakeElement(desk, "pane", "", EMBEDDED_RECT,
                        _keepass_controls(desk, EMBEDDED_RECT), native_hwnd=2201),
        ],
    )  # fmt: skip
    return NOTEPAD.handle


def _taskbar(desk: FakeDesktop, keepass_title: str = KEEPASS.title) -> int:
    """The taskbar (an explorer.exe window): its buttons repeat the window titles."""
    desk.wins[KEEPASS.handle].title = keepass_title
    desk.add(dataclasses.replace(TASKBAR))
    desk.trees[TASKBAR.handle] = FakeElement(
        desk, "pane", "Taskbar", TASKBAR.rect,
        [
            FakeElement(desk, "button", f"{NOTEPAD.title} - 1 running window",
                        (100, 1042, 300, 1078)),
            FakeElement(desk, "button", f"{keepass_title} - 1 running window",
                        (310, 1042, 510, 1078)),
        ],
    )  # fmt: skip
    return TASKBAR.handle


def _elements(cfg: Config, handle: int, **arguments: Any) -> Reply:
    def session() -> Reply:
        with connect(cfg) as client:
            return client.call("elements", window=handle, **arguments)

    return within(SESSION_GUARD_S, session)


def _shows_secret(reply: Reply) -> bool:
    return mentions(reply.text, SECRET_TEXTS)


def test_elements_of_the_desktop_window_shows_nothing_of_a_blocked_app(desk: FakeDesktop) -> None:
    # The desktop window passes the handle check (csrss.exe is not blocked), but its tree is
    # every top-level window: the scan must not reach KeePass through it.
    reply = _elements(BLOCK_KEEPASS, _desktop_tree(desk))
    assert not _shows_secret(reply), reply.text
    assert_refused(reply, ("blocked",))


def test_scan_skips_blocked_top_level_windows_even_where_the_desktop_is_not_recognized(
    desk: FakeDesktop, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Second line of defense: even if the desktop check missed (another handle with the same
    # tree), the scan itself skips the windows of blocked apps and still lists the others.
    handle = _desktop_tree(desk)
    monkeypatch.setattr(uia, "_is_desktop", lambda api, hwnd: False, raising=False)
    found = uia.list_elements(handle, hidden=lambda process: process == "keepass.exe")
    names = [e.name.lower() for e in found]
    assert "save" in names
    assert not mentions(" ".join(names), SECRET_TEXTS), names


def test_elements_skip_a_blocked_app_window_embedded_in_another_app(desk: FakeDesktop) -> None:
    reply = _elements(BLOCK_KEEPASS, _notepad_with_embedded_keepass(desk))
    assert not reply.is_error, reply.text
    assert '"Save"' in reply.text
    assert not _shows_secret(reply), reply.text


@pytest.mark.parametrize(
    "keepass_title", [KEEPASS.title, LONG_KEEPASS_TITLE], ids=["title", "cut-off-title"]
)
def test_elements_hide_a_blocked_app_title_repeated_by_the_taskbar(
    desk: FakeDesktop, keepass_title: str
) -> None:
    handle = _taskbar(desk, keepass_title)
    reply = _elements(BLOCK_KEEPASS, handle)
    assert not reply.is_error, reply.text
    assert f'"{NOTEPAD.title} - 1 running window"' in reply.text
    assert not _shows_secret(reply), reply.text
    assert reply.text.count(uia.HIDDEN_TEXT) == 1, reply.text
    # A query cannot be used to guess the hidden title: it matches nothing.
    probe = _elements(BLOCK_KEEPASS, handle, query="kdbx")
    assert not probe.is_error, probe.text
    assert _element_lines(probe) == [], probe.text


SCENARIOS = [
    pytest.param(_desktop_tree, id="desktop-window"),
    pytest.param(_notepad_with_embedded_keepass, id="embedded-window"),
    pytest.param(_taskbar, id="taskbar"),
]


@pytest.mark.parametrize("scenario", SCENARIOS)
def test_without_a_blocklist_the_scan_is_unchanged(
    desk: FakeDesktop, monkeypatch: pytest.MonkeyPatch, scenario: Callable[[FakeDesktop], int]
) -> None:
    def no_hider(*args: Any, **kwargs: Any) -> Any:
        raise AssertionError("the blocklist filter ran without a blocklist")

    monkeypatch.setattr(uia, "_Hider", no_hider, raising=False)
    reply = _elements(Config(), scenario(desk))
    assert not reply.is_error, reply.text
    assert _shows_secret(reply), reply.text  # nothing is hidden or refused without a blocklist
    assert "blocked app" not in reply.text


# Other numbers that Windows accepts for one window (measured on Windows 11 with IsWindow,
# GetAncestor and UI Automation's ElementFromHandle): only the low 32 bits count, and 0xFFFF in
# their high word is a wildcard for the window with the same low word. GetWindowThreadProcessId
# fails for the wildcard forms, so the window's process is unknown.
SPELLINGS = {
    "upper-bits": lambda h: h + 2**32,
    "upper-bits-all-set": lambda h: h | 0xFFFFFFFF00000000,
    "wildcard": lambda h: (h & 0xFFFF) | 0xFFFF0000,
    "wildcard-sign-extended": lambda h: (h & 0xFFFF) | 0xFFFFFFFFFFFF0000,
}
spellings = pytest.mark.parametrize("spell", list(SPELLINGS.values()), ids=list(SPELLINGS))
EMBEDDED_KEEPASS = 2201  # _notepad_with_embedded_keepass()


def _embedded_keepass_readable_by_handle(desk: FakeDesktop) -> int:
    """Notepad with the embedded KeePass window, which UI Automation also reads by its handle."""
    _notepad_with_embedded_keepass(desk)
    desk.trees[EMBEDDED_KEEPASS] = FakeElement(
        desk, "pane", "", EMBEDDED_RECT, _keepass_controls(desk, EMBEDDED_RECT)
    )
    return EMBEDDED_KEEPASS


@spellings
def test_elements_refuse_the_desktop_window_under_every_number_windows_accepts(
    desk: FakeDesktop, spell: Callable[[int], int]
) -> None:
    alias = spell(_desktop_tree(desk))
    assert desk.canonical(alias) == DESKTOP_HANDLE  # the fake resolves it like Windows
    reply = _elements(BLOCK_KEEPASS, alias)
    assert reply.is_error, f"expected a refusal, got: {reply.text!r}"
    assert not _shows_secret(reply), reply.text
    assert desk.automation.calls == 0  # nothing of the desktop's tree was read
    with pytest.raises(RuntimeError, match="desktop window"):
        uia.list_elements(alias, hidden=lambda process: process == "keepass.exe")


@spellings
def test_elements_refuse_a_blocked_window_under_every_number_windows_accepts(
    desk: FakeDesktop, spell: Callable[[int], int]
) -> None:
    # The embedded KeePass window sits in Notepad: its root and root owner are not blocked, so
    # only its own process (which Windows does not tell for a wildcard number) shows it is KeePass.
    alias = spell(_embedded_keepass_readable_by_handle(desk))
    assert desk.canonical(alias) == EMBEDDED_KEEPASS
    reply = _elements(BLOCK_KEEPASS, alias)
    assert reply.is_error, f"expected a refusal, got: {reply.text!r}"
    assert not _shows_secret(reply), reply.text
    with pytest.raises(ValueError, match="windows lists it"):
        uia.list_elements(alias, hidden=lambda process: process == "keepass.exe")


@spellings
@pytest.mark.parametrize("target", [KEEPASS.handle, EMBEDDED_KEEPASS], ids=["window", "embedded"])
def test_focus_refuses_a_blocked_window_under_every_number_windows_accepts(
    desk: FakeDesktop, spell: Callable[[int], int], target: int
) -> None:
    _notepad_with_embedded_keepass(desk)
    desk.foreground = PAINT.handle
    with connect(BLOCK_KEEPASS) as client:
        reply = client.call("focus", window=spell(target))
    assert reply.is_error, f"expected a refusal, got: {reply.text!r}"
    assert desk.set_foreground == []
    assert desk.foreground == PAINT.handle


def test_handles_as_windows_reports_them_pass_the_spelling_check(desk: FakeDesktop) -> None:
    _notepad_with_embedded_keepass(desk)
    desk.add(Win(2202, "", NOTEPAD.process, NOTEPAD.pid, (100, 900, 300, 950), "Edit",
                 parent=NOTEPAD.handle))  # fmt: skip
    _desktop_tree(desk)
    api = uia._win()
    # top-level, first child, a later child, the desktop window
    for handle in (NOTEPAD.handle, KEEPASS.handle, EMBEDDED_KEEPASS, 2202, DESKTOP_HANDLE):
        uia._check_reported(api, handle)
        for spell in SPELLINGS.values():
            with pytest.raises(ValueError, match="windows lists it"):
                uia._check_reported(api, spell(handle))


@spellings
def test_without_a_blocklist_every_number_windows_accepts_works_as_before(
    desk: FakeDesktop, monkeypatch: pytest.MonkeyPatch, spell: Callable[[int], int]
) -> None:
    def not_without_a_blocklist(*args: Any, **kwargs: Any) -> Any:
        raise AssertionError("a blocklist check ran without a blocklist")

    for name in ("_Hider", "_check_reported", "_is_desktop"):
        monkeypatch.setattr(uia, name, not_without_a_blocklist, raising=False)
    desktop = _desktop_tree(desk)
    canonical = _elements(Config(), desktop)
    reply = _elements(Config(), spell(desktop))
    assert not reply.is_error, reply.text
    assert _element_lines(reply) == _element_lines(canonical)
    assert _shows_secret(reply), reply.text


def _keepass_owned_dialog_in_front(desk: FakeDesktop) -> None:
    """A dialog of another process, owned by KeePass, is the foreground window."""
    desk.add(Win(2301, "Open Database - Passwords.kdbx", "dialoghost.exe", 4020,
                 (600, 400, 1000, 600), "#32770", owner=KEEPASS.handle))  # fmt: skip
    desk.foreground = 2301


def test_result_lines_hide_the_title_of_a_foreground_dialog_owned_by_a_blocked_app(
    desk: FakeDesktop,
) -> None:
    _keepass_owned_dialog_in_front(desk)
    with connect(BLOCK_KEEPASS) as client:
        reply = client.call("wait", seconds=0.01)
    assert not reply.is_error, reply.text
    assert "passwords.kdbx" not in reply.text.lower(), reply.text
    assert "title hidden: blocked app" in reply.text


def test_keyboard_input_to_a_foreground_dialog_owned_by_a_blocked_app_is_refused(
    desk: FakeDesktop,
) -> None:
    _keepass_owned_dialog_in_front(desk)
    with connect(BLOCK_KEEPASS) as client:
        reply = client.call("key", keys="enter")
    assert_refused(reply, BLOCKED_ROOTS)
    assert desk.events == []


def test_without_a_blocklist_a_foreground_owned_dialog_is_unchanged(desk: FakeDesktop) -> None:
    _keepass_owned_dialog_in_front(desk)
    with connect() as client:
        reply = client.call("key", keys="enter")
    assert_ok(reply)
    assert '"Open Database - Passwords.kdbx"' in reply.text
    assert desk.events  # the key reached the (fake) keyboard
