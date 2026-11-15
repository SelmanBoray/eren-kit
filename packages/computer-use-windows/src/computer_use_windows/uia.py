"""Windows: top-level window enumeration/focus (user32 via ctypes) and UI Automation element lists.

The element list is the token saver of this server: instead of a screenshot (~1200 tokens) an agent
reads a compact text list of the controls of the foreground window and clicks them by id.

Design notes
- Importing this module has no side effects and works on any OS; Windows APIs (ctypes.windll,
  comtypes) are bound lazily on first use.
- comtypes is imported lazily. Its UIAutomationCore wrapper is generated in memory once per process
  (~0.1 s); nothing is written to site-packages or %APPDATA% and nothing is printed to stdout.
- COM is initialised per calling thread (MTA when possible) and every thread gets its own
  IUIAutomation object, so all functions may be called from any thread.
- Element traversal fetches one level of children per cross-process call (cache request with
  TreeScope_Children on the control view), skips subtrees that are off-screen or outside the
  window, and stops at a time budget, so huge trees (browsers, Explorer) stay fast.
"""

from __future__ import annotations

import contextlib
import ctypes
import logging
import math
import os
import sys
import tempfile
import threading
import time
import types
from collections import deque
from dataclasses import dataclass, field, replace
from typing import Any

log = logging.getLogger(__name__)

__all__ = [
    "Element",
    "ElementList",
    "WindowInfo",
    "ancestor_pids",
    "focus_window",
    "focused_element_is_password",
    "foreground_window",
    "list_elements",
    "list_windows",
    "window_at",
    "window_family",
]


# --------------------------------------------------------------------------- public data types


@dataclass(frozen=True)
class WindowInfo:
    """A top-level window. Coordinates are screen space (physical pixels)."""

    handle: int
    title: str
    process: str  # exe name, lowercase ("notepad.exe"); "" if unknown
    pid: int
    left: int
    top: int
    right: int
    bottom: int
    foreground: bool
    minimized: bool
    class_name: str  # Win32 window class of the top-level window
    # Other windows this one stands for, which safety checks must look at too: its root owner
    # when that is a different window (list_windows, window_at, window_family), and for
    # window_at also the child window under the point when it belongs to another process.
    related: tuple[WindowInfo, ...] = ()


@dataclass(frozen=True)
class Element:
    """A UI Automation element of a window. Coordinates are screen space (physical pixels)."""

    id: int
    role: str
    name: str
    left: int
    top: int
    right: int
    bottom: int
    enabled: bool
    value: str | None
    # Root window (GA_ROOT) the element was found in: the listed window or one of its popups
    # (menus, dropdowns). 0 = unknown.
    window: int = 0

    @property
    def center(self) -> tuple[int, int]:
        return ((self.left + self.right) // 2, (self.top + self.bottom) // 2)


class ElementList(list[Element]):
    """The result of list_elements: a plain list of elements plus how the scan ended.

    ``incomplete``: why the scan stopped before the whole window was seen ("time budget",
    "timeout", "size cap", "error"), or "" when it saw everything it looked for. ``total``: how
    many elements matched before ``limit`` was applied.
    """

    incomplete: str = ""
    total: int = 0


# --------------------------------------------------------------------------- constants

# Elements listing: time budget for the whole traversal (the ~2 s promise includes a margin for
# the last in-flight UIA call, whose timeout is clamped to the remaining budget).
_BUDGET_S = 1.4
_CALL_TIMEOUT_MS = 1000  # upper bound for a single cross-process UIA call
_MAX_NODES = 25_000  # hard cap on visited elements
_MAX_CANDIDATES = 2_000  # hard cap on collected (listable) elements
_NAME_MAX = 100
_VALUE_MAX = 80
_CHROMIUM_WAKE_S = 0.35  # Chromium builds its web tree lazily after the first UIA query
# Win32 label texts (WM_GETTEXT) are read inside the time budget: each read waits at most this
# long, all reads of one listing together at most _LABEL_BUDGET_S, and after one read that
# timed out (a busy app) no more are tried.
_LABEL_TIMEOUT_MS = 100
_LABEL_BUDGET_S = 0.25

# UIA control type ids 50000.. → role names (control type name without "Control", lowercase).
_ROLE_NAMES: dict[int, str] = {
    50000 + i: name
    for i, name in enumerate(
        (
            "button", "calendar", "checkbox", "combobox", "edit", "hyperlink", "image",
            "listitem", "list", "menu", "menubar", "menuitem", "progressbar", "radiobutton",
            "scrollbar", "slider", "spinner", "statusbar", "tab", "tabitem", "text", "toolbar",
            "tooltip", "tree", "treeitem", "custom", "group", "thumb", "datagrid", "dataitem",
            "document", "splitbutton", "window", "pane", "header", "headeritem", "table",
            "titlebar", "separator", "semanticzoom", "appbar",
        )
    )
}  # fmt: skip

# Listed even without a name (inputs an agent fills or reads).
_ROLES_ALWAYS = frozenset(
    {"edit", "combobox", "document", "checkbox", "radiobutton", "slider", "spinner", "progressbar"}
)
# Listed when they have a name (or a fallback name / value).
_ROLES_IF_NAMED = frozenset(
    {
        "button", "splitbutton", "hyperlink", "menuitem", "listitem", "treeitem", "tabitem",
        "dataitem", "headeritem", "custom",
    }
)  # fmt: skip
# Readable content: listed when named, unless it repeats the name of the enclosing control.
_ROLES_CONTENT = frozenset({"text", "image", "tooltip"})
# Never descended into: leaves, or controls whose descendants only repeat them.
_ROLES_NO_DESCEND = frozenset(
    {
        "text", "image", "edit", "button", "hyperlink", "checkbox", "radiobutton", "progressbar",
        "slider", "scrollbar", "thumb", "separator",
    }
)  # fmt: skip
# Controls whose text children merely repeat their name (such children are not listed).
_ROLES_LABEL_OWNERS = _ROLES_IF_NAMED | {"checkbox", "radiobutton"}
_ROLES_LISTABLE = _ROLES_ALWAYS | _ROLES_IF_NAMED | _ROLES_CONTENT
# Unnamed controls of these roles may fall back to their AutomationId as name.
_ROLES_ID_FALLBACK = frozenset(
    {
        "button", "splitbutton", "hyperlink", "menuitem", "tabitem", "edit", "combobox",
        "checkbox", "radiobutton", "slider", "spinner",
    }
)  # fmt: skip
# Item containers that are dropped when a descendant control carries the same name
# (web lists/grids: listitem "Code" > hyperlink "Code").
_ROLES_REDUNDANT_CONTAINERS = frozenset({"listitem", "dataitem", "custom"})
# Never listed nor descended into.
_ROLES_SKIP = frozenset({"scrollbar", "thumb", "separator"})
# Containers that clip their children (used to clip reported rects to the visible part).
_ROLES_CLIP = frozenset({"document", "list", "tree", "datagrid", "table", "pane", "window"})
# Roles whose Value pattern value is shown.
_ROLES_VALUE = frozenset({"edit", "combobox", "document", "spinner", "dataitem"})
_ROLES_RANGE = frozenset({"slider", "progressbar", "spinner"})
_ROLES_TOGGLE_ALWAYS = frozenset({"checkbox", "listitem", "treeitem", "dataitem"})
_ROLES_SELECTABLE = frozenset({"tabitem", "listitem", "treeitem", "dataitem"})

# UIA property ids (UIAutomationClient.h).
_P_BOUNDING_RECT = 30001
_P_CONTROL_TYPE = 30003
_P_NAME = 30005
_P_IS_ENABLED = 30010
_P_AUTOMATION_ID = 30011
_P_HELP_TEXT = 30013
_P_IS_PASSWORD = 30019
_P_NATIVE_HWND = 30020
_P_IS_OFFSCREEN = 30022
_P_IS_RANGE_VALUE_AVAILABLE = 30033
_P_IS_SELECTION_ITEM_AVAILABLE = 30036
_P_IS_TOGGLE_AVAILABLE = 30041
_P_IS_VALUE_AVAILABLE = 30043
_P_VALUE = 30045
_P_RANGE_VALUE = 30047
_P_SELECTION_ITEM_IS_SELECTED = 30079
_P_TOGGLE_STATE = 30086
_CACHED_PROPERTIES = (
    _P_CONTROL_TYPE, _P_NAME, _P_BOUNDING_RECT, _P_IS_ENABLED, _P_IS_OFFSCREEN, _P_IS_PASSWORD,
    _P_HELP_TEXT, _P_AUTOMATION_ID, _P_NATIVE_HWND, _P_IS_VALUE_AVAILABLE, _P_VALUE,
    _P_IS_RANGE_VALUE_AVAILABLE, _P_RANGE_VALUE, _P_IS_TOGGLE_AVAILABLE, _P_TOGGLE_STATE,
    _P_IS_SELECTION_ITEM_AVAILABLE, _P_SELECTION_ITEM_IS_SELECTED,
)  # fmt: skip

_TREESCOPE_CHILDREN = 2
_ELEMENT_MODE_FULL = 1
_UIA_E_TIMEOUT = 0x80131505
_COINIT_MULTITHREADED = 0

# Characters that only add noise to names/values (bidi marks, zero-width chars, BOM).
_INVISIBLE = dict.fromkeys(
    [*range(0x200B, 0x2010), *range(0x202A, 0x202F), *range(0x2066, 0x206A), 0xFEFF]
)

# Win32 constants.
_GWL_STYLE = -16
_GWL_EXSTYLE = -20
_WS_POPUP = 0x80000000
_WS_CAPTION = 0x00C00000
_WS_EX_TOOLWINDOW = 0x00000080
_WS_EX_APPWINDOW = 0x00040000
_WS_EX_TRANSPARENT = 0x00000020
_ES_PASSWORD = 0x0020
_GA_ROOT = 2
_GA_ROOTOWNER = 3
_GW_OWNER = 4
_SW_RESTORE = 9
_HWND_TOP = 0
_SWP_NOSIZE = 0x0001
_SWP_NOMOVE = 0x0002
_SWP_ASYNCWINDOWPOS = 0x4000
_RESTORE_WAIT_S = 0.5  # how long focus waits for an asynchronous restore of a minimized window
_DWMWA_EXTENDED_FRAME_BOUNDS = 9
_DWMWA_CLOAKED = 14
_PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
_TH32CS_SNAPPROCESS = 0x00000002
_INPUT_MOUSE = 0
_WM_GETTEXT = 0x000D
_SMTO_ABORTIFHUNG = 0x0002

Rect = tuple[int, int, int, int]


# --------------------------------------------------------------------------- small pure helpers


def _clean(text: Any, limit: int) -> str:
    """Normalize a UIA string: drop invisible marks, collapse whitespace, truncate with '…'."""
    if not isinstance(text, str) or not text:
        return ""
    text = " ".join(text.translate(_INVISIBLE).split())
    if len(text) > limit:
        text = text[: limit - 1].rstrip() + "…"
    return text


def _fallback_name(role: str, help_text: Any, automation_id: Any) -> str:
    """Name for an unnamed control: its help text (tooltip), else a word-like AutomationId."""
    name = _clean(help_text, _NAME_MAX)
    if name or role not in _ROLES_ID_FALLBACK:
        return name
    aid = _clean(automation_id, _NAME_MAX)
    if (
        2 <= len(aid) <= 40
        and any(c.isalpha() for c in aid)
        and not aid[-1].isdigit()  # generated ids: "folder-row-3", "button1", "1001"
        and "{" not in aid
    ):
        hexish = sum(c in "0123456789abcdefABCDEF-" for c in aid)
        if hexish < len(aid) * 0.9:  # skip GUID-like ids
            return aid
    return ""


def _format_number(value: Any) -> str | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if isinstance(value, float):
        if not math.isfinite(value):
            return None
        if value.is_integer():
            return str(int(value))
        return f"{value:.2f}".rstrip("0").rstrip(".")
    return str(value)


def _nonempty(r: Rect) -> bool:
    return r[2] > r[0] and r[3] > r[1]


def _intersect(a: Rect, b: Rect) -> Rect:
    return (max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3]))


def _check_handle(handle: Any) -> int:
    if isinstance(handle, bool) or not isinstance(handle, int) or handle <= 0:
        raise ValueError(f"Invalid window handle {handle!r}; use a handle from the windows tool.")
    return handle


# --------------------------------------------------------------------------- Win32 (ctypes)


class _Win32:
    """ctypes bindings for user32/kernel32/dwmapi, created lazily on first use (Windows only)."""

    def __init__(self) -> None:
        from ctypes import wintypes as w

        self.w = w
        u = ctypes.WinDLL("user32", use_last_error=True)  # type: ignore[attr-defined]
        k = ctypes.WinDLL("kernel32", use_last_error=True)  # type: ignore[attr-defined]
        self.WNDENUMPROC = ctypes.WINFUNCTYPE(w.BOOL, w.HWND, w.LPARAM)  # type: ignore[attr-defined]

        def fn(dll: Any, name: str, restype: Any, *argtypes: Any) -> Any:
            f = getattr(dll, name)
            f.restype = restype
            f.argtypes = list(argtypes)
            return f

        H = w.HWND
        self.EnumWindows = fn(u, "EnumWindows", w.BOOL, self.WNDENUMPROC, w.LPARAM)
        self.GetWindowTextLengthW = fn(u, "GetWindowTextLengthW", ctypes.c_int, H)
        self.GetWindowTextW = fn(u, "GetWindowTextW", ctypes.c_int, H, w.LPWSTR, ctypes.c_int)
        self.GetClassNameW = fn(u, "GetClassNameW", ctypes.c_int, H, w.LPWSTR, ctypes.c_int)
        self.GetWindowThreadProcessId = fn(
            u, "GetWindowThreadProcessId", w.DWORD, H, ctypes.POINTER(w.DWORD)
        )
        self.IsWindow = fn(u, "IsWindow", w.BOOL, H)
        self.IsWindowVisible = fn(u, "IsWindowVisible", w.BOOL, H)
        self.IsIconic = fn(u, "IsIconic", w.BOOL, H)
        self.GetForegroundWindow = fn(u, "GetForegroundWindow", H)
        self.GetShellWindow = fn(u, "GetShellWindow", H)
        self.SetForegroundWindow = fn(u, "SetForegroundWindow", w.BOOL, H)
        # Only calls that never wait for the target window's thread are used on windows of other
        # processes: a hung app would otherwise block the server (ShowWindow, BringWindowToTop
        # and SendMessage all wait for it).
        self.ShowWindowAsync = fn(u, "ShowWindowAsync", w.BOOL, H, ctypes.c_int)
        self.SetWindowPos = fn(
            u, "SetWindowPos", w.BOOL, H, H, ctypes.c_int, ctypes.c_int, ctypes.c_int,
            ctypes.c_int, w.UINT,
        )  # fmt: skip
        self.IsHungAppWindow = fn(u, "IsHungAppWindow", w.BOOL, H)
        self.GetWindowRect = fn(u, "GetWindowRect", w.BOOL, H, ctypes.POINTER(w.RECT))
        self.GetAncestor = fn(u, "GetAncestor", H, H, w.UINT)
        self.GetWindow = fn(u, "GetWindow", H, H, w.UINT)
        self.WindowFromPoint = fn(u, "WindowFromPoint", H, w.POINT)
        self.FindWindowExW = fn(u, "FindWindowExW", H, H, H, w.LPCWSTR, w.LPCWSTR)
        self.AttachThreadInput = fn(u, "AttachThreadInput", w.BOOL, w.DWORD, w.DWORD, w.BOOL)
        self.GetSystemMetrics = fn(u, "GetSystemMetrics", ctypes.c_int, ctypes.c_int)
        self.SendMessageTimeoutW = fn(
            u, "SendMessageTimeoutW", w.LPARAM, H, w.UINT, w.WPARAM, w.LPARAM, w.UINT, w.UINT,
            ctypes.POINTER(ctypes.c_size_t),
        )  # fmt: skip
        long_ptr = getattr(u, "GetWindowLongPtrW", None) or u.GetWindowLongW
        long_ptr.restype = ctypes.c_ssize_t
        long_ptr.argtypes = [H, ctypes.c_int]
        self.GetWindowLongPtrW = long_ptr

        class GUITHREADINFO(ctypes.Structure):
            _fields_ = [
                ("cbSize", w.DWORD), ("flags", w.DWORD), ("hwndActive", H), ("hwndFocus", H),
                ("hwndCapture", H), ("hwndMenuOwner", H), ("hwndMoveSize", H),
                ("hwndCaret", H), ("rcCaret", w.RECT),
            ]  # fmt: skip

        self.GUITHREADINFO = GUITHREADINFO
        self.GetGUIThreadInfo = fn(
            u, "GetGUIThreadInfo", w.BOOL, w.DWORD, ctypes.POINTER(GUITHREADINFO)
        )

        class MOUSEINPUT(ctypes.Structure):
            _fields_ = [
                ("dx", w.LONG), ("dy", w.LONG), ("mouseData", w.DWORD), ("dwFlags", w.DWORD),
                ("time", w.DWORD), ("dwExtraInfo", ctypes.c_size_t),
            ]  # fmt: skip

        class KEYBDINPUT(ctypes.Structure):
            _fields_ = [
                ("wVk", w.WORD), ("wScan", w.WORD), ("dwFlags", w.DWORD), ("time", w.DWORD),
                ("dwExtraInfo", ctypes.c_size_t),
            ]  # fmt: skip

        class HARDWAREINPUT(ctypes.Structure):
            _fields_ = [("uMsg", w.DWORD), ("wParamL", w.WORD), ("wParamH", w.WORD)]

        class _INPUTUNION(ctypes.Union):
            _fields_ = [("mi", MOUSEINPUT), ("ki", KEYBDINPUT), ("hi", HARDWAREINPUT)]

        class INPUT(ctypes.Structure):
            _fields_ = [("type", w.DWORD), ("u", _INPUTUNION)]

        self.INPUT = INPUT
        self.SendInput = fn(u, "SendInput", w.UINT, w.UINT, ctypes.POINTER(INPUT), ctypes.c_int)

        self.GetCurrentThreadId = fn(k, "GetCurrentThreadId", w.DWORD)
        self.OpenProcess = fn(k, "OpenProcess", w.HANDLE, w.DWORD, w.BOOL, w.DWORD)
        self.CloseHandle = fn(k, "CloseHandle", w.BOOL, w.HANDLE)
        self.QueryFullProcessImageNameW = fn(
            k, "QueryFullProcessImageNameW", w.BOOL, w.HANDLE, w.DWORD, w.LPWSTR,
            ctypes.POINTER(w.DWORD),
        )  # fmt: skip
        self.GetProcessTimes = fn(
            k, "GetProcessTimes", w.BOOL, w.HANDLE, *([ctypes.POINTER(w.FILETIME)] * 4)
        )
        self.GetSystemDirectoryW = fn(k, "GetSystemDirectoryW", w.UINT, w.LPWSTR, w.UINT)

        class PROCESSENTRY32W(ctypes.Structure):
            _fields_ = [
                ("dwSize", w.DWORD), ("cntUsage", w.DWORD), ("th32ProcessID", w.DWORD),
                ("th32DefaultHeapID", ctypes.c_size_t), ("th32ModuleID", w.DWORD),
                ("cntThreads", w.DWORD), ("th32ParentProcessID", w.DWORD),
                ("pcPriClassBase", w.LONG), ("dwFlags", w.DWORD),
                ("szExeFile", w.WCHAR * 260),
            ]  # fmt: skip

        self.PROCESSENTRY32W = PROCESSENTRY32W
        self.CreateToolhelp32Snapshot = fn(
            k, "CreateToolhelp32Snapshot", w.HANDLE, w.DWORD, w.DWORD
        )
        self.Process32FirstW = fn(
            k, "Process32FirstW", w.BOOL, w.HANDLE, ctypes.POINTER(PROCESSENTRY32W)
        )
        self.Process32NextW = fn(
            k, "Process32NextW", w.BOOL, w.HANDLE, ctypes.POINTER(PROCESSENTRY32W)
        )

        self.DwmGetWindowAttribute: Any = None
        try:
            dwm = ctypes.WinDLL("dwmapi")  # type: ignore[attr-defined]
            self.DwmGetWindowAttribute = fn(
                dwm, "DwmGetWindowAttribute", ctypes.c_long, H, w.DWORD, ctypes.c_void_p, w.DWORD
            )
        except OSError:
            log.debug("dwmapi unavailable; using GetWindowRect and no cloak detection")

    # ---- helpers -----------------------------------------------------------------------

    def foreground(self) -> int:
        return self.GetForegroundWindow() or 0

    def title(self, hwnd: int) -> str:
        n = self.GetWindowTextLengthW(hwnd)
        if n <= 0:
            return ""
        buf = ctypes.create_unicode_buffer(n + 1)
        self.GetWindowTextW(hwnd, buf, n + 1)
        return buf.value

    def class_name(self, hwnd: int) -> str:
        buf = ctypes.create_unicode_buffer(256)
        self.GetClassNameW(hwnd, buf, 256)
        return buf.value

    def control_text(self, hwnd: int, timeout_ms: int = _LABEL_TIMEOUT_MS) -> str:
        """Text of a (possibly foreign) control via WM_GETTEXT; waits at most ``timeout_ms``."""
        buf = ctypes.create_unicode_buffer(1024)
        result = ctypes.c_size_t(0)
        ok = self.SendMessageTimeoutW(
            hwnd, _WM_GETTEXT, 1024, ctypes.addressof(buf), _SMTO_ABORTIFHUNG,
            max(1, int(timeout_ms)), ctypes.byref(result),
        )  # fmt: skip
        return buf.value if ok else ""

    def is_hung(self, hwnd: int) -> bool:
        try:
            return bool(self.IsHungAppWindow(hwnd))
        except Exception:  # never fatal: the asynchronous calls below do not wait anyway
            return False

    def pid_tid(self, hwnd: int) -> tuple[int, int]:
        pid = self.w.DWORD(0)
        tid = self.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        return int(pid.value), int(tid)

    def style(self, hwnd: int) -> int:
        return int(self.GetWindowLongPtrW(hwnd, _GWL_STYLE)) & 0xFFFFFFFF

    def exstyle(self, hwnd: int) -> int:
        return int(self.GetWindowLongPtrW(hwnd, _GWL_EXSTYLE)) & 0xFFFFFFFF

    def is_cloaked(self, hwnd: int) -> bool:
        if self.DwmGetWindowAttribute is None:
            return False
        value = ctypes.c_int(0)
        hr = self.DwmGetWindowAttribute(
            hwnd, _DWMWA_CLOAKED, ctypes.byref(value), ctypes.sizeof(value)
        )
        return hr == 0 and value.value != 0

    def window_rect(self, hwnd: int) -> Rect:
        r = self.w.RECT()
        if not self.GetWindowRect(hwnd, ctypes.byref(r)):
            return (0, 0, 0, 0)
        return (r.left, r.top, r.right, r.bottom)

    def frame_rect(self, hwnd: int) -> Rect:
        """Visible window bounds (without the invisible resize borders of Windows 10/11)."""
        if self.DwmGetWindowAttribute is not None and not self.IsIconic(hwnd):
            r = self.w.RECT()
            hr = self.DwmGetWindowAttribute(
                hwnd, _DWMWA_EXTENDED_FRAME_BOUNDS, ctypes.byref(r), ctypes.sizeof(r)
            )
            if hr == 0 and r.right > r.left and r.bottom > r.top:
                return (r.left, r.top, r.right, r.bottom)
        return self.window_rect(hwnd)

    def virtual_screen(self) -> Rect:
        x, y = self.GetSystemMetrics(76), self.GetSystemMetrics(77)
        return (x, y, x + self.GetSystemMetrics(78), y + self.GetSystemMetrics(79))

    def enum_windows(self) -> list[int]:
        """Top-level windows in z-order (topmost first)."""
        handles: list[int] = []

        def callback(hwnd: int, _lparam: int) -> bool:
            if hwnd:
                handles.append(int(hwnd))
            return True

        self.EnumWindows(self.WNDENUMPROC(callback), 0)
        return handles

    def owner_chain_contains(self, hwnd: int, target: int) -> bool:
        current = hwnd
        for _ in range(16):
            current = self.GetWindow(current, _GW_OWNER) or 0
            if not current:
                return False
            if current == target:
                return True
        return False

    def process_name(self, pid: int) -> str:
        if pid <= 0:
            return ""
        handle = self.OpenProcess(_PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
        if handle:
            try:
                buf = ctypes.create_unicode_buffer(1024)
                size = self.w.DWORD(1024)
                if self.QueryFullProcessImageNameW(handle, 0, buf, ctypes.byref(size)):
                    return os.path.basename(buf.value).lower()
            finally:
                self.CloseHandle(handle)
        # Protected/elevated/other-user processes: the process snapshot still has the exe name.
        return self.snapshot().get(pid, (0, ""))[1]

    def snapshot(self) -> dict[int, tuple[int, str]]:
        """pid → (parent pid, lowercase exe name) for all processes (Toolhelp snapshot)."""
        result: dict[int, tuple[int, str]] = {}
        snap = self.CreateToolhelp32Snapshot(_TH32CS_SNAPPROCESS, 0)
        if not snap or snap == self.w.HANDLE(-1).value:
            return result
        try:
            entry = self.PROCESSENTRY32W()
            entry.dwSize = ctypes.sizeof(entry)
            ok = self.Process32FirstW(snap, ctypes.byref(entry))
            while ok:
                result[int(entry.th32ProcessID)] = (
                    int(entry.th32ParentProcessID),
                    entry.szExeFile.lower(),
                )
                ok = self.Process32NextW(snap, ctypes.byref(entry))
        finally:
            self.CloseHandle(snap)
        return result

    def creation_time(self, pid: int) -> int | None:
        handle = self.OpenProcess(_PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
        if not handle:
            return None
        try:
            times = [self.w.FILETIME() for _ in range(4)]
            if not self.GetProcessTimes(handle, *(ctypes.byref(t) for t in times)):
                return None
            return (times[0].dwHighDateTime << 32) | times[0].dwLowDateTime
        finally:
            self.CloseHandle(handle)

    def system_directory(self) -> str:
        buf = ctypes.create_unicode_buffer(520)
        n = self.GetSystemDirectoryW(buf, 520)
        return (
            buf.value
            if 0 < n < 520
            else os.path.join(os.environ.get("SystemRoot", r"C:\Windows"), "System32")
        )


_win_lock = threading.Lock()
_win_api: _Win32 | None = None


def _win() -> _Win32:
    global _win_api
    if _win_api is None:
        with _win_lock:
            if _win_api is None:
                if sys.platform != "win32":
                    raise RuntimeError("computer-use-windows works on Windows only.")
                _win_api = _Win32()
    return _win_api


# --------------------------------------------------------------------------- windows


def _window_info(api: _Win32, hwnd: int, fg: int) -> WindowInfo:
    pid, _ = api.pid_tid(hwnd)
    process = api.process_name(pid)
    if process == "applicationframehost.exe":
        # UWP apps: the frame belongs to ApplicationFrameHost; the app is in a child CoreWindow.
        core = api.FindWindowExW(hwnd, None, "Windows.UI.Core.CoreWindow", None) or 0
        if core:
            core_pid, _ = api.pid_tid(core)
            if core_pid and core_pid != pid:
                pid, process = core_pid, api.process_name(core_pid) or process
    left, top, right, bottom = api.frame_rect(hwnd)
    return WindowInfo(
        handle=hwnd,
        title=api.title(hwnd),
        process=process,
        pid=pid,
        left=left,
        top=top,
        right=right,
        bottom=bottom,
        foreground=hwnd == fg,
        minimized=bool(api.IsIconic(hwnd)),
        class_name=api.class_name(hwnd),
    )


def _listable(api: _Win32, hwnd: int) -> bool:
    if not api.IsWindowVisible(hwnd) or not api.title(hwnd).strip():
        return False
    ex = api.exstyle(hwnd)
    if ex & _WS_EX_TOOLWINDOW and not ex & _WS_EX_APPWINDOW:
        return False  # floating palettes, overlays, helper windows
    if api.is_cloaked(hwnd):
        return False  # other virtual desktops, suspended UWP frames
    return bool(api.IsIconic(hwnd)) or _nonempty(api.window_rect(hwnd))


def _with_related(api: _Win32, info: WindowInfo, others: list[int], fg: int) -> WindowInfo:
    """``info`` with the windows in ``others`` (deduplicated, not ``info`` itself) as related."""
    seen = {info.handle}
    related: list[WindowInfo] = []
    for h in others:
        if h and h not in seen:
            seen.add(h)
            related.append(_window_info(api, h, fg))
    if not related:
        return info
    return replace(info, related=tuple(related))


def _root_owner(api: _Win32, hwnd: int) -> int:
    return int(api.GetAncestor(hwnd, _GA_ROOTOWNER) or 0)


def list_windows() -> list[WindowInfo]:
    """Visible, titled top-level windows in z-order, the foreground window first.

    An owned window (a dialog, a tool window) carries its root owner in ``related``.
    """
    api = _win()
    fg = api.foreground()
    handles = [h for h in api.enum_windows() if _listable(api, h)]
    if fg in handles:
        handles.remove(fg)
        handles.insert(0, fg)
    elif fg and api.IsWindowVisible(fg) and api.title(fg).strip():
        handles.insert(0, fg)  # e.g. shell flyouts that EnumWindows does not report
    return [
        _with_related(api, _window_info(api, h, fg), [_root_owner(api, h)], fg) for h in handles
    ]


def foreground_window() -> WindowInfo | None:
    api = _win()
    fg = api.foreground()
    return _window_info(api, fg, fg) if fg else None


def window_at(x: int, y: int) -> WindowInfo | None:
    """Top-level window under a screen point (its root, GA_ROOT), or None.

    ``related`` holds the root owner when it is another window (the main window of a dialog or
    popup) and the child window under the point when it belongs to another process (an embedded
    window), so safety checks can look at every process that owns the point.
    """
    api = _win()
    hwnd = int(api.WindowFromPoint(api.w.POINT(int(x), int(y))) or 0)
    if not hwnd:
        return None
    fg = api.foreground()
    root = int(api.GetAncestor(hwnd, _GA_ROOT) or hwnd)
    info = _window_info(api, root, fg)
    others = [_root_owner(api, hwnd)]
    if hwnd != root and api.pid_tid(hwnd)[0] not in (info.pid, api.pid_tid(root)[0]):
        others.append(hwnd)
    return _with_related(api, info, others, fg)


def window_family(handle: int) -> list[WindowInfo]:
    """The window ``handle`` (any window, also a child or an unlisted one), its root window and
    its root owner: every window whose process a ``focus`` of this handle would bring forward.

    Raises ValueError for an invalid handle.
    """
    api = _win()
    hwnd = _check_handle(handle)
    if not api.IsWindow(hwnd):
        raise ValueError(f"No window with handle {hwnd}; call windows to list current windows.")
    fg = api.foreground()
    family: list[WindowInfo] = []
    seen: set[int] = set()
    for h in (hwnd, int(api.GetAncestor(hwnd, _GA_ROOT) or 0), _root_owner(api, hwnd)):
        if h and h not in seen:
            seen.add(h)
            family.append(_window_info(api, h, fg))
    return family


def _in_foreground(api: _Win32, root: int) -> int:
    """The foreground window if it is `root` or a window owned by it (e.g. its dialog), else 0."""
    fg = api.foreground()
    if fg and (fg == root or api.owner_chain_contains(fg, root)):
        return fg
    return 0


def _wait_foreground(api: _Win32, root: int, timeout: float) -> int:
    deadline = time.monotonic() + timeout
    while True:
        fg = _in_foreground(api, root)
        if fg or time.monotonic() >= deadline:
            return fg
        time.sleep(0.02)


def _hung_error(root: int, title: str) -> RuntimeError:
    return RuntimeError(
        f'Window {root} ("{title}") is not responding, so it was not focused. Wait a few seconds '
        "and retry; if it stays unresponsive, ask the user."
    )


def focus_window(handle: int) -> WindowInfo:
    """Restore (if minimized) and bring a window to the foreground despite the foreground lock.

    Never waits for the target's thread: a window that is not responding is refused up front,
    and restore/raise requests are posted asynchronously, so an app that hangs meanwhile cannot
    block the caller.
    """
    api = _win()
    hwnd = _check_handle(handle)
    if not api.IsWindow(hwnd):
        raise ValueError(f"No window with handle {hwnd}; call windows to list current windows.")
    root = api.GetAncestor(hwnd, _GA_ROOT) or hwnd
    title = api.title(root)
    if not api.IsWindowVisible(root):
        raise RuntimeError(
            f'Window {root} ("{title}") is hidden and cannot be focused; pick another window.'
        )
    if api.is_hung(root):
        raise _hung_error(root, title)
    if api.IsIconic(root):
        api.ShowWindowAsync(root, _SW_RESTORE)
        deadline = time.monotonic() + _RESTORE_WAIT_S
        while api.IsIconic(root) and time.monotonic() < deadline:
            time.sleep(0.02)
        if api.IsIconic(root) and api.is_hung(root):
            raise _hung_error(root, title)

    fg = _in_foreground(api, root)
    if not fg:
        api.SetForegroundWindow(root)
        fg = _wait_foreground(api, root, 0.15)
        log.debug("focus %s: SetForegroundWindow -> %s", root, bool(fg))
    if not fg:
        # Foreground lock: a process may take the foreground right after it generated input.
        # An empty mouse input (no movement, no buttons) satisfies that rule without side effects.
        empty = api.INPUT(type=_INPUT_MOUSE)
        api.SendInput(1, ctypes.byref(empty), ctypes.sizeof(empty))
        api.SetForegroundWindow(root)
        fg = _wait_foreground(api, root, 0.25)
        log.debug("focus %s: empty input + SetForegroundWindow -> %s", root, bool(fg))
    if not fg:
        # Last resort: share input state with the foreground and target threads (never with a
        # hung one: attaching to it would stall this thread's input processing too).
        if api.is_hung(root):
            raise _hung_error(root, title)
        me = api.GetCurrentThreadId()
        old_fg = api.foreground()
        threads = {api.pid_tid(root)[1]}
        if old_fg and not api.is_hung(old_fg):
            threads.add(api.pid_tid(old_fg)[1])
        attached = [t for t in threads if t and t != me and api.AttachThreadInput(me, t, True)]
        try:
            # BringWindowToTop, but posted to the window's thread instead of waiting for it.
            flags = _SWP_NOMOVE | _SWP_NOSIZE | _SWP_ASYNCWINDOWPOS
            api.SetWindowPos(root, _HWND_TOP, 0, 0, 0, 0, flags)
            api.SetForegroundWindow(root)
        finally:
            for t in attached:
                api.AttachThreadInput(me, t, False)
        fg = _wait_foreground(api, root, 0.4)
        log.debug("focus %s: AttachThreadInput -> %s", root, bool(fg))
    if not fg:
        raise RuntimeError(
            f'Could not bring window {root} ("{title}") to the foreground: Windows blocked the '
            "focus change. Ask the user to click that window (or its taskbar button), then retry."
        )
    return _window_info(api, fg, fg)


# Processes that start programs without hosting them: never "the agent's own host" even when
# they are in its parent chain. explorer.exe also covers a separate folder-window process.
# Terminals, shells (cmd, powershell, bash) and editors stay in the chain.
_LAUNCHER_PROCESSES = frozenset(
    {
        "explorer.exe", "svchost.exe", "services.exe", "wininit.exe", "winlogon.exe",
        "userinit.exe", "sihost.exe", "runtimebroker.exe", "taskhostw.exe", "dllhost.exe",
        "smss.exe", "csrss.exe", "lsass.exe", "startmenuexperiencehost.exe",
        "shellexperiencehost.exe", "searchhost.exe",
    }
)  # fmt: skip

_ancestor_lock = threading.Lock()
_ancestor_pids: frozenset[int] | None = None


def ancestor_pids() -> frozenset[int]:
    """PIDs of this process's parent chain (excluding itself and launchers such as the Windows
    shell); computed once and cached."""
    global _ancestor_pids
    if _ancestor_pids is not None:
        return _ancestor_pids
    with _ancestor_lock:
        if _ancestor_pids is None:
            _ancestor_pids = _compute_ancestor_pids()
    return _ancestor_pids


def _shell_pid(api: _Win32) -> int:
    """PID of the process that owns the Windows shell (desktop) window, 0 if unknown."""
    try:
        shell = api.GetShellWindow() or 0
        return api.pid_tid(shell)[0] if shell else 0
    except Exception:  # best effort
        log.debug("GetShellWindow failed", exc_info=True)
        return 0


def _compute_ancestor_pids() -> frozenset[int]:
    if sys.platform != "win32":
        return frozenset()
    try:
        api = _win()
        table = api.snapshot()
    except Exception:  # best effort, never fatal
        log.debug("process snapshot failed", exc_info=True)
        return frozenset()
    chain = _ancestor_chain(api, table)
    # Launchers are not the agent's host: the Windows shell (Explorer: desktop, taskbar, File
    # Explorer windows) and system/session processes that start programs. Counting them would
    # make their windows "the agent's own" and refuse ordinary input there.
    shell = _shell_pid(api)
    return frozenset(
        p for p in chain if p != shell and table.get(p, (0, ""))[1] not in _LAUNCHER_PROCESSES
    )


def _ancestor_chain(api: _Win32, table: dict[int, tuple[int, str]]) -> list[int]:
    """This process's parents, nearest first, stopping where a PID was reused."""
    me = os.getpid()
    chain: list[int] = []
    child, child_time = me, api.creation_time(me)
    seen = {me}
    while True:
        parent = table.get(child, (0, ""))[0]
        if parent in (0, 4) or parent in seen or parent not in table:
            break
        parent_time = api.creation_time(parent)
        if child_time is not None and parent_time is not None and parent_time > child_time:
            break  # the real parent exited and its PID was reused by a newer process
        chain.append(parent)
        seen.add(parent)
        child, child_time = parent, parent_time
    return chain


# --------------------------------------------------------------------------- COM / UI Automation

_uia_lock = threading.Lock()
_uia_module: Any = None
_tls = threading.local()
_chromium_woken: set[int] = set()


class _NoImportDir:
    """A package ``__path__`` entry that names a directory but is never searched for modules.

    The import system's path finder only searches ``str`` entries and skips anything else, while
    ``os`` functions accept this object as a path (``__fspath__``). So comtypes can check the
    directory and name in-memory modules after it, and no file in it is ever imported.
    """

    def __init__(self, path: str) -> None:
        self._path = path

    def __fspath__(self) -> str:
        return self._path

    def __repr__(self) -> str:
        return f"_NoImportDir({self._path!r})"


def _load_uia_module() -> Any:
    """Import comtypes and build the UIAutomationClient wrapper in memory (once per process)."""
    if sys.platform != "win32":
        raise RuntimeError("UI Automation is available on Windows only.")
    if "comtypes" not in sys.modules and not hasattr(sys, "coinit_flags"):
        # comtypes calls CoInitializeEx on import; UIA clients should live in the MTA.
        sys.coinit_flags = _COINIT_MULTITHREADED  # type: ignore[attr-defined]
    import comtypes

    if "comtypes.client" not in sys.modules and "comtypes.gen" not in sys.modules:
        # comtypes.gen becomes a memory package, so importing comtypes.client writes nothing to
        # site-packages or %APPDATA%. comtypes needs a writable directory as its path (it checks
        # one on import and names in-memory modules after it), but GetModule first tries to
        # *import* an existing wrapper from that path: a .py planted there would run in this
        # process. The path entry is therefore a _NoImportDir, which the import system skips.
        gen = types.ModuleType("comtypes.gen")
        gen.__path__ = [_NoImportDir(tempfile.gettempdir())]  # type: ignore[attr-defined]
        sys.modules["comtypes.gen"] = gen
        comtypes.gen = gen  # type: ignore[attr-defined]
    import comtypes.client

    path = os.path.join(_win().system_directory(), "UIAutomationCore.dll")
    if not os.path.exists(path):
        path = "UIAutomationCore.dll"
    # Generate wrappers in memory and write no files, also for any later GetModule call.
    comtypes.client.gen_dir = None
    with contextlib.redirect_stdout(sys.stderr):  # stdout carries the MCP protocol
        return comtypes.client.GetModule(path)


def _uia() -> Any:
    global _uia_module
    if _uia_module is None:
        with _uia_lock:
            if _uia_module is None:
                try:
                    _uia_module = _load_uia_module()
                except RuntimeError:
                    raise
                except Exception as exc:
                    raise RuntimeError(f"UI Automation is unavailable: {exc}") from exc
    return _uia_module


class _Context:
    """Per-thread UI Automation objects."""

    def __init__(self) -> None:
        uia = _uia()
        import comtypes

        if not getattr(_tls, "com_ready", False):
            try:
                comtypes.CoInitializeEx(_COINIT_MULTITHREADED)
            except Exception:  # RPC_E_CHANGED_MODE: thread already in an STA; that works too
                log.debug("COM already initialised on this thread with another apartment")
            _tls.com_ready = True
        clsctx = comtypes.CLSCTX_INPROC_SERVER
        self.timeouts = False
        try:
            self.automation = comtypes.CoCreateInstance(
                uia.CUIAutomation8._reg_clsid_, interface=uia.IUIAutomation2, clsctx=clsctx
            )
            self.automation.ConnectionTimeout = _CALL_TIMEOUT_MS
            self.automation.TransactionTimeout = _CALL_TIMEOUT_MS
            self.timeouts = True
        except Exception:  # Windows 7: no CUIAutomation8
            self.automation = comtypes.CoCreateInstance(
                uia.CUIAutomation._reg_clsid_, interface=uia.IUIAutomation, clsctx=clsctx
            )
        self._timeout_ms = _CALL_TIMEOUT_MS
        request = self.automation.CreateCacheRequest()
        for prop in _CACHED_PROPERTIES:
            request.AddProperty(prop)
        request.TreeScope = _TREESCOPE_CHILDREN
        request.TreeFilter = self.automation.ControlViewCondition
        request.AutomationElementMode = _ELEMENT_MODE_FULL
        self.request = request

    def set_timeout(self, ms: int) -> None:
        """Clamp the next cross-process call to `ms` (IUIAutomation2 only)."""
        ms = max(100, min(_CALL_TIMEOUT_MS, ms))
        if self.timeouts and abs(ms - self._timeout_ms) >= 50:
            try:
                self.automation.TransactionTimeout = ms
                self._timeout_ms = ms
            except Exception:
                self.timeouts = False


def _context() -> _Context:
    ctx = getattr(_tls, "ctx", None)
    if ctx is None:
        ctx = _Context()
        _tls.ctx = ctx
    return ctx


def _is_timeout(exc: BaseException) -> bool:
    hresult = getattr(exc, "hresult", None)
    if hresult is None and exc.args and isinstance(exc.args[0], int):
        hresult = exc.args[0]
    return isinstance(hresult, int) and (hresult & 0xFFFFFFFF) == _UIA_E_TIMEOUT


@dataclass
class _Candidate:
    role: str
    name: str
    rect: Rect
    enabled: bool
    value: str | None
    cells: list[str] = field(default_factory=list)  # folded cell texts of a list item
    redundant: bool = False  # a descendant control repeats this item; list that one instead
    window: int = 0  # root window the element was found in

    def final_value(self) -> str | None:
        if not self.cells:
            return self.value
        return _clean(
            " | ".join([self.value, *self.cells] if self.value else self.cells), _VALUE_MAX
        )


@dataclass
class _WalkState:
    deadline: float
    nodes: int = 0
    calls: int = 0
    doc_children: int = 0
    stopped: str = ""  # why the walk ended early: "time budget", "timeout", "size cap"
    failed: bool = False  # a window could not be read at all (UI Automation error)
    label_s: float = 0.0  # time spent reading Win32 label texts
    labels_off: bool = False  # a label read timed out: the app is busy, read no more


def _label_text(api: _Win32, hwnd: int, state: _WalkState | None) -> str:
    """WM_GETTEXT of a Win32 label, within the listing's time budget (see _LABEL_TIMEOUT_MS)."""
    if state is None:
        return api.control_text(hwnd)
    if state.labels_off:
        return ""
    started = time.monotonic()
    timeout_ms = min(
        _LABEL_TIMEOUT_MS,
        int((state.deadline - started) * 1000),
        int((_LABEL_BUDGET_S - state.label_s) * 1000),
    )
    if timeout_ms <= 0:
        state.labels_off = True
        return ""
    text = api.control_text(hwnd, timeout_ms)
    spent = time.monotonic() - started
    state.label_s += spent
    if not text and spent * 1000 >= timeout_ms * 0.8:
        state.labels_off = True  # timed out (or as good as): the app is not answering quickly
    return text


def _cached(el: Any, prop: int) -> Any:
    try:
        return el.GetCachedPropertyValue(prop)
    except Exception:
        return None


def _element_value(
    api: _Win32, el: Any, role: str, name: str, state: _WalkState | None = None
) -> str | None:
    if role in _ROLES_VALUE and _cached(el, _P_IS_VALUE_AVAILABLE):
        value = _cached(el, _P_VALUE)
        if isinstance(value, str):
            return _clean(value, _VALUE_MAX)
    if role in _ROLES_RANGE and _cached(el, _P_IS_RANGE_VALUE_AVAILABLE):
        number = _format_number(_cached(el, _P_RANGE_VALUE))
        if number is not None:
            return number
    if _cached(el, _P_IS_TOGGLE_AVAILABLE):
        state = _cached(el, _P_TOGGLE_STATE)
        if role in _ROLES_TOGGLE_ALWAYS and state in (0, 1, 2):
            return ("off", "on", "mixed")[state]
        if state == 1:
            return "on"
    if _cached(el, _P_IS_SELECTION_ITEM_AVAILABLE):
        selected = bool(_cached(el, _P_SELECTION_ITEM_IS_SELECTED))
        if role == "radiobutton":
            return "on" if selected else "off"
        if role in _ROLES_SELECTABLE and selected:
            return "selected"
    if role == "text":
        # Win32/WinForms labels with an accessible name: their visible text is the value.
        hwnd = _cached(el, _P_NATIVE_HWND)
        if isinstance(hwnd, int) and hwnd:
            text = _clean(_label_text(api, hwnd, state), _VALUE_MAX)
            if text and text != name:
                return text
    return None


def _cell_text(el: Any, role: str) -> str:
    if role == "edit" and not el.CachedIsPassword and _cached(el, _P_IS_VALUE_AVAILABLE):
        value = _clean(_cached(el, _P_VALUE), _VALUE_MAX)
        if value:
            return value
    return _clean(el.CachedName, _VALUE_MAX) if role == "text" else ""


def _squash(name: str) -> str:
    return "".join(name.casefold().split())


def _make_candidate(
    api: _Win32,
    el: Any,
    role: str,
    rect: Rect,
    enclosing: _Candidate | None,
    state: _WalkState | None = None,
) -> _Candidate | None:
    if role not in _ROLES_LISTABLE:
        return None
    name = _clean(el.CachedName, _NAME_MAX)
    if role in _ROLES_CONTENT:
        if not name or (enclosing and _squash(name) in _squash(enclosing.name)):
            return None
    password = bool(el.CachedIsPassword)
    value = None if password else _element_value(api, el, role, name, state)
    if not name and (role in _ROLES_IF_NAMED or role in _ROLES_ALWAYS):
        name = _fallback_name(role, el.CachedHelpText, el.CachedAutomationId)
    if role in _ROLES_IF_NAMED and not name and not value:
        return None
    return _Candidate(role, name, rect, bool(el.CachedIsEnabled), value)


def _walk(ctx: _Context, api: _Win32, hwnd: int, state: _WalkState, out: list[_Candidate]) -> None:
    """Breadth-first walk of one window's control view, collecting listable elements."""
    win_clip = _intersect(api.frame_rect(hwnd), api.virtual_screen())
    if not _nonempty(win_clip):
        return
    win_root = int(api.GetAncestor(hwnd, _GA_ROOT) or hwnd)
    ctx.set_timeout(int((state.deadline - time.monotonic()) * 1000) + 100)
    try:
        root = ctx.automation.ElementFromHandleBuildCache(hwnd, ctx.request)
    except Exception as exc:
        # A timeout ends the listing (the budget is spent); another error only skips this window
        # (e.g. a popup that closed meanwhile), but the listing is reported as incomplete.
        if _is_timeout(exc):
            state.stopped = "timeout"
        else:
            state.failed = True
        log.debug("ElementFromHandle(%s) failed: %s", hwnd, exc)
        return
    state.calls += 1
    # queue items: (element, children cached?, clip rect, nearest listed control that labels its
    # descendants, element role, list item whose cell texts are folded into its value)
    queue: deque[tuple[Any, bool, Rect, _Candidate | None, str, _Candidate | None]] = deque(
        [(root, True, win_clip, None, "window", None)]
    )
    while queue:
        node, fetched, clip, enclosing, parent_role, owner = queue.popleft()
        if not fetched:
            remaining = state.deadline - time.monotonic()
            if remaining <= 0:
                state.stopped = "time budget"
                return
            ctx.set_timeout(int(remaining * 1000) + 100)
            try:
                node = node.BuildUpdatedCache(ctx.request)
            except Exception as exc:  # element vanished, provider error
                if _is_timeout(exc):
                    state.stopped = "timeout"
                    return
                continue
            state.calls += 1
        try:
            children = node.GetCachedChildren()
            count = children.Length if children else 0
        except Exception:
            continue
        if parent_role == "document":
            state.doc_children += count
        for i in range(count):
            state.nodes += 1
            if state.nodes > _MAX_NODES or len(out) >= _MAX_CANDIDATES:
                state.stopped = "size cap"
                return
            try:
                el = children.GetElement(i)
                role = _ROLE_NAMES.get(el.CachedControlType, "custom")
                if role in _ROLES_SKIP:
                    continue
                if owner is not None and role in ("edit", "text"):
                    # Explorer-style rows: one line per item, column cells become its value.
                    cell = _cell_text(el, role)
                    if cell and cell.casefold() != owner.name.casefold():
                        owner.cells.append(cell)
                    continue
                r = el.CachedBoundingRectangle
                rect = (int(r.left), int(r.top), int(r.right), int(r.bottom))
                offscreen = bool(el.CachedIsOffscreen)
                visible = _nonempty(rect) and _nonempty(_intersect(rect, win_clip))
                child_enclosing = enclosing
                child_owner = None
                if visible and not offscreen:
                    skip = parent_role == "combobox" and role in ("edit", "button")
                    cand = None if skip else _make_candidate(api, el, role, rect, enclosing, state)
                    if cand is not None:
                        cand.window = win_root
                        shown = _intersect(rect, clip)
                        cand.rect = shown if _nonempty(shown) else _intersect(rect, win_clip)
                        out.append(cand)
                        if (
                            enclosing is not None
                            and cand.name
                            and role in _ROLES_LABEL_OWNERS
                            and enclosing.role in _ROLES_REDUNDANT_CONTAINERS
                            and _squash(cand.name) == _squash(enclosing.name)
                        ):
                            enclosing.redundant = True
                        if cand.name and role in _ROLES_LABEL_OWNERS:
                            child_enclosing = cand
                        if role == "listitem":
                            child_owner = cand
                if role in _ROLES_NO_DESCEND:
                    continue
                if not visible and (offscreen or _nonempty(rect)):
                    continue  # collapsed, scrolled away or outside the window
                child_clip = clip
                if role in _ROLES_CLIP and _nonempty(rect):
                    narrowed = _intersect(clip, rect)
                    if _nonempty(narrowed):
                        child_clip = narrowed
                queue.append((el, False, child_clip, child_enclosing, role, child_owner))
            except Exception:  # one bad element must not abort the list
                log.debug("skipping element", exc_info=True)


def _popups(api: _Win32, hwnd: int, fg: int) -> list[int]:
    """Visible popups of the window's process above it in z-order (menus, dropdowns, flyouts)."""
    pid, _ = api.pid_tid(hwnd)
    found: list[int] = []
    for h in api.enum_windows():
        if h == hwnd:
            break
        if len(found) >= 6:
            break
        if not api.IsWindowVisible(h) or api.pid_tid(h)[0] != pid or api.is_cloaked(h):
            continue
        if api.exstyle(h) & _WS_EX_TRANSPARENT or not _nonempty(api.window_rect(h)):
            continue
        cls = api.class_name(h)
        style = api.style(h)
        is_menu = cls == "#32768" and hwnd == fg
        has_caption = (style & _WS_CAPTION) == _WS_CAPTION
        is_popup = bool(style & _WS_POPUP) and not has_caption and api.owner_chain_contains(h, hwnd)
        if is_menu or is_popup:
            found.append(h)
    return found


def _resolve_target(api: _Win32, handle: int | None) -> int:
    if handle is None:
        hwnd = api.foreground()
        if not hwnd:
            raise RuntimeError("There is no foreground window; pass a window handle from windows.")
        return hwnd
    hwnd = _check_handle(handle)
    if not api.IsWindow(hwnd):
        raise ValueError(f"No window with handle {hwnd}; call windows to list current windows.")
    return hwnd


def list_elements(
    handle: int | None = None, query: str | None = None, limit: int = 80
) -> ElementList:
    """On-screen elements of a window worth acting on or reading, top-to-bottom, ids 1..n.

    The result says whether the scan was cut short (``incomplete``) and how many elements
    matched before ``limit`` (``total``).
    """
    if isinstance(limit, bool) or not isinstance(limit, int) or limit < 1:
        raise ValueError(f"limit must be a positive integer, got {limit!r}.")
    api = _win()
    hwnd = _resolve_target(api, handle)
    root = api.GetAncestor(hwnd, _GA_ROOT) or hwnd
    if api.IsIconic(root):
        raise RuntimeError("The window is minimized; call focus with its handle first.")
    needle = query.strip().casefold() if isinstance(query, str) and query.strip() else None
    ctx = _context()
    started = time.monotonic()
    state = _WalkState(deadline=started + _BUDGET_S)
    found: list[_Candidate] = []
    try:
        roots = (_popups(api, hwnd, api.foreground()) if root == hwnd else []) + [hwnd]
        for target in roots:
            if state.stopped:
                break
            _walk(ctx, api, target, state, found)
        if (
            state.doc_children == 0
            and not state.stopped
            and hwnd not in _chromium_woken
            and api.class_name(root).startswith("Chrome_WidgetWin")
            and state.deadline - time.monotonic() > _CHROMIUM_WAKE_S + 0.3
        ):
            # Chromium enables its accessibility tree on the first UIA query; look again shortly.
            _chromium_woken.add(hwnd)
            time.sleep(_CHROMIUM_WAKE_S)
            found.clear()
            state = _WalkState(
                deadline=state.deadline, label_s=state.label_s, labels_off=state.labels_off
            )
            for target in roots:
                if state.stopped:
                    break
                _walk(ctx, api, target, state, found)
    finally:
        ctx.set_timeout(_CALL_TIMEOUT_MS)
    unique: dict[tuple[str, str, Rect], _Candidate] = {}
    for cand in found:
        unique.setdefault((cand.role, cand.name, cand.rect), cand)
    items = [c for c in unique.values() if not c.redundant]
    if needle is not None:
        items = [c for c in items if needle in c.name.casefold() or needle in c.role]
    items.sort(key=lambda c: (c.rect[1], c.rect[0], c.rect[3], c.rect[2]))
    incomplete = state.stopped or ("error" if state.failed else "")
    log.debug(
        "list_elements(%s): %d listable of %d nodes, %d calls, %.0f ms (labels %.0f ms)%s",
        hwnd, len(items), state.nodes, state.calls, (time.monotonic() - started) * 1000,
        state.label_s * 1000, f", incomplete: {incomplete}" if incomplete else "",
    )  # fmt: skip
    result = ElementList(
        Element(
            id=i,
            role=c.role,
            name=c.name,
            left=c.rect[0],
            top=c.rect[1],
            right=c.rect[2],
            bottom=c.rect[3],
            enabled=c.enabled,
            value=c.final_value(),
            window=c.window,
        )
        for i, c in enumerate(items[:limit], start=1)
    )
    result.incomplete = incomplete
    result.total = len(items)
    return result


def _win32_focus_is_password(api: _Win32) -> bool | None:
    """The focused Win32 edit control of the foreground thread, if there is one.

    True: an edit control with ES_PASSWORD. False: an edit control without it (definitely not a
    password field). None: no focused window, or one that is not an edit control (browsers,
    WPF, UWP, ...), so UI Automation has to decide.
    """
    info = api.GUITHREADINFO()
    info.cbSize = ctypes.sizeof(info)
    if not api.GetGUIThreadInfo(0, ctypes.byref(info)) or not info.hwndFocus:
        return None
    hwnd = info.hwndFocus
    if "edit" not in api.class_name(hwnd).lower():
        return None
    return bool(api.style(hwnd) & _ES_PASSWORD)


def focused_element_is_password() -> bool | None:
    """Whether the element with keyboard focus is a password field: True, False, or None.

    None means "could not be determined" (UI Automation timed out or failed, or reported no
    focused element) and must be treated as a refusal by callers that type: the check fails
    closed. A plain Win32 edit control is known not to be a password field even when UI
    Automation does not answer.
    """
    if sys.platform != "win32":
        return False
    win32: bool | None = None
    try:
        win32 = _win32_focus_is_password(_win())
    except Exception:
        log.debug("Win32 password check failed", exc_info=True)
    if win32:
        return True
    try:
        ctx = _context()
        ctx.set_timeout(_CALL_TIMEOUT_MS)
        element = ctx.automation.GetFocusedElement()
        if not element:
            return win32
        return bool(element.CurrentIsPassword)
    except Exception:
        log.debug("UIA password check failed", exc_info=True)
        return win32
