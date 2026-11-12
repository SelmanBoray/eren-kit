"""MCP server (stdio): wires config, screen, input, uia, safety and instructions into 12 tools.

Threading: every tool body runs in an anyio worker thread, one at a time (a lock), so the event
loop never blocks (a 10 s ``wait`` or a 2 s UIA walk does not stall the protocol) and actions never
interleave. uia.py initializes COM per calling thread and screen.py opens mss per call, so it does
not matter which worker thread runs a call. ``focus`` is additionally bounded in time
(``_FOCUS_TIMEOUT``), so a window that stops responding cannot hold the lock.

Errors: SafetyError / ValueError / RuntimeError from the sibling modules propagate unchanged;
FastMCP turns them into tool errors carrying their message (no traceback). Anything else is logged
with its traceback on stderr and re-raised as a RuntimeError with a one-line message.

Sibling modules are imported as modules and called via attribute access at call time, so tests can
monkeypatch e.g. ``computer_use_windows.input.click``.
"""

from __future__ import annotations

import logging
import sys
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import TypeVar

from anyio import to_thread
from mcp.server.fastmcp import FastMCP, Image
from mcp.types import ToolAnnotations

from . import __version__, config, instructions, safety, screen, uia
from . import input as inp
from .config import Config

log = logging.getLogger(__name__)

SERVER_NAME = "computer-use-windows"

_T = TypeVar("_T")

# Let the system process injected input before reading the foreground window for the result line.
_SETTLE_SECONDS = 0.05
# After a pointer action, a cursor read back within this many px of the target counts as "set by
# the server" (guards against a pixel of drift); farther away means the user moved it meanwhile.
_SETTLE_TOLERANCE = 2
_WAIT_MAX_SECONDS = 10.0
# The password check could not tell (UI Automation timed out or failed): a busy target often
# answers a moment later, so it is asked once more after this pause before typing is refused.
# Worst case for a refusal: two UIA calls of at most 1 s each plus this pause.
_PASSWORD_RETRY_DELAY = 0.1
# focus gives up after this long. uia.focus_window refuses hung windows and only uses calls that
# do not wait for the target; this bound also covers a window that hangs in the middle of it, so
# a hung app can never hold the server's lock (and with it every later tool call).
_FOCUS_TIMEOUT = 2.0
# No foreground window (an activation in progress): asked again this many times, this far apart,
# before keyboard input is refused (worst case ~150 ms).
_FOREGROUND_RETRIES = 3
_FOREGROUND_RETRY_DELAY = 0.05

# Why an elements scan stopped early (uia.ElementList.incomplete), as told to the agent.
_INCOMPLETE_REASONS = {
    "time budget": "the time limit was reached",
    "timeout": "the app did not answer in time",
    "size cap": "the window has too many elements",
    "error": "UI Automation could not read part of the window",
}

_NO_SCREENSHOT = (
    "No screenshot yet: x,y are pixels in the last screenshot. Call screenshot first, "
    "or use element ids from elements (click(element=id))."
)
_NO_SCREENSHOT_ZOOM = (
    "No screenshot yet: zoom regions are pixels in the last screenshot. Call screenshot first."
)

_LINE_BREAKS = str.maketrans({"\r": " ", "\n": " ", "\t": " ", "\v": " ", "\f": " "})


def _one_line(text: str) -> str:
    """Keep UI text on one output line."""
    return text.translate(_LINE_BREAKS)


def _describe(window: uia.WindowInfo | None) -> str:
    if window is None:
        return "foreground: none"
    return f'foreground: "{_one_line(window.title)}" ({window.process or "?"})'


def _handle(window: uia.WindowInfo | None) -> int | None:
    return window.handle if window is not None else None


def _rect(window: uia.WindowInfo) -> tuple[int, int, int, int]:
    return (window.left, window.top, window.right, window.bottom)


def _family(window: uia.WindowInfo | None) -> list[uia.WindowInfo]:
    """A window and the related windows it stands for (root owner, embedded child)."""
    if window is None:
        return []
    return [window, *getattr(window, "related", ())]


class _CallTimeout(Exception):
    """A call run by _run_with_timeout did not finish in time."""


def _run_with_timeout(fn: Callable[..., _T], args: tuple[object, ...], seconds: float) -> _T:
    """Run ``fn(*args)`` in a daemon thread; raise _CallTimeout if it is not done in time.

    The thread is abandoned on timeout (Python cannot stop it); it holds no lock of the server.
    """
    outcome: dict[str, object] = {}

    def run() -> None:
        try:
            outcome["value"] = fn(*args)
        except BaseException as exc:  # handed to the caller
            outcome["error"] = exc

    worker = threading.Thread(target=run, name="computer-use-windows-call", daemon=True)
    worker.start()
    worker.join(seconds)
    if worker.is_alive():
        raise _CallTimeout
    if "error" in outcome:
        raise outcome["error"]  # type: ignore[misc]
    return outcome["value"]  # type: ignore[return-value]


@dataclass(frozen=True)
class _Listing:
    """The window the last elements call listed, to detect element ids that went stale."""

    handle: int
    rect: tuple[int, int, int, int] | None  # None: not in the window list, so not tracked
    pid: int = 0  # its process; 0 = unknown


def _partial(exc: Exception, done: str) -> Exception:
    """The error for input stopped part-way: says how much was already sent, keeps the reason."""
    if isinstance(exc, safety.SafetyError):
        return safety.SafetyError(f"{done}; the rest was not sent. {exc}")
    if isinstance(exc, (ValueError, RuntimeError)):
        return RuntimeError(f"{done}; the rest was not sent. {exc}")
    return RuntimeError(f"{done}; the rest was not sent. {type(exc).__name__}: {exc}")


class _Session:
    """Server state and the synchronous body of every tool (run in a worker thread)."""

    def __init__(self, cfg: Config) -> None:
        self.cfg = cfg
        self.cmap: screen.CoordMap | None = None  # last screenshot's mapping
        self.by_id: dict[int, uia.Element] = {}  # last elements call, by id
        self.listing: _Listing | None = None  # the window that call listed
        self.last_set: tuple[int, int] | None = None  # last cursor position the server set

    # ------------------------------------------------------------------ helpers

    def _foreground(self) -> str:
        """Foreground part of a result line; never fails (the action already happened)."""
        try:
            return _describe(uia.foreground_window())
        except Exception:  # informational only
            log.debug("foreground_window failed", exc_info=True)
            return "foreground: unknown"

    def _ok(self, settle: bool = True) -> str:
        if settle:
            time.sleep(_SETTLE_SECONDS)
        return f"ok | {self._foreground()}"

    def _to_screen(self, x: int, y: int) -> tuple[int, int]:
        if self.cmap is None:
            raise ValueError(_NO_SCREENSHOT)
        return self.cmap.to_screen(x, y)

    def _target(
        self, x: int | None, y: int | None, element: int | None
    ) -> tuple[tuple[int, int], uia.Element | None]:
        """The screen point to act on, and the element it came from (None for x,y)."""
        if element is not None:
            if x is not None or y is not None:
                raise ValueError("Give either x and y, or element, not both.")
            found = self.by_id.get(element)
            if found is None:
                raise ValueError(
                    f"Unknown element id {element}: ids come from the last elements call. "
                    "Call elements again."
                )
            return found.center, found
        if x is None or y is None:
            raise ValueError(
                "Give both x and y (pixels in the last screenshot), or element "
                "(an id from elements)."
            )
        return self._to_screen(x, y), None

    def _check_element_fresh(self, element: uia.Element, here: uia.WindowInfo | None) -> None:
        """Refuse an element id whose window closed, moved or was covered since it was listed.

        ``here``: the window now under the element's center (``uia.window_at``). Changes inside
        a window that keep its rectangle (scrolling, a re-laid-out page) are not detected.
        """

        def stale(reason: str) -> ValueError:
            return ValueError(
                f"Element {element.id} is stale: {reason}, so nothing was clicked. The element "
                "list is out of date; call elements again."
            )

        listing = self.listing
        listed = uia.list_windows()
        if listing is not None and listing.rect is not None:
            now = next((w for w in listed if w.handle == listing.handle), None)
            if now is None:
                raise stale("its window was closed or hidden since it was listed")
            if now.minimized:
                raise stale("its window was minimized since it was listed")
            if _rect(now) != listing.rect:
                raise stale("its window was moved or resized since it was listed")
        # The window now at the point must be the element's window, or a helper popup of the
        # same process: a top-level window that the window list does not show (a Win32 combo
        # box list, a menu, a tooltip, an untitled or tool window, the desktop's WorkerW). A
        # listed main window on top is stale even from the same process (two Explorer, browser
        # or Word windows share one process).
        expected = element.window or (listing.handle if listing is not None else 0)
        pid = listing.pid if listing is not None else 0
        helper_popup = (
            here is not None
            and pid != 0
            and here.pid == pid
            and here.handle not in {w.handle for w in listed}
        )
        if expected and (here is None or (here.handle != expected and not helper_popup)):
            raise stale(
                "another window is on top of it now (if its window is in the background, focus "
                "it first)"
            )

    def _check_pointer(
        self,
        *points: tuple[int, int],
        paste_action: str = "",
        element: uia.Element | None = None,
    ) -> None:
        """Safety for mouse actions: failsafe, then the window under every target point.

        Every process owning the point (root window, root owner, embedded child) is checked
        against the blocklist. ``paste_action`` (e.g. "A right click"): the action can insert
        text, so terminals and the agent's own host are refused too, with the keyboard guard's
        terminal test. ``element``: the first point is that element's center; its id must still
        be fresh.
        """
        self._check_failsafe()
        for i, (px, py) in enumerate(points):
            window = uia.window_at(px, py)
            if element is not None and i == 0:
                self._check_element_fresh(element, window)
            family = _family(window)
            for w in family:
                safety.check_blocked(w.process, self.cfg.blocked_processes)
            if paste_action and family:
                own = uia.ancestor_pids()
                for w in family:
                    safety.check_pointer_target(
                        w.process,
                        paste_action,
                        self.cfg.allow_terminal_input,
                        window_class=w.class_name,
                        is_own_host=w.pid in own,
                    )

    def _corners(self) -> list[tuple[int, int]] | None:
        """Failsafe corners of all monitors, or None when the failsafe is off.

        Multi-step actions read them once and reuse them for every re-check.
        """
        if not self.cfg.failsafe:
            return None
        monitors = screen.list_monitors()
        return safety.monitor_corners([(m.left, m.top, m.width, m.height) for m in monitors])

    def _check_failsafe(
        self,
        corners: list[tuple[int, int]] | None = None,
        exempt: tuple[int, int] | None = None,
    ) -> None:
        """Refuse when the user parked the cursor in a screen corner.

        A corner the agent itself put the cursor on is exempt only while the cursor has not been
        seen anywhere else since (``safety.failsafe_exemption``). ``exempt``: the point where an
        action in progress (scroll, drag) just put the pointer.
        """
        if not self.cfg.failsafe:
            return
        if corners is None:
            corners = self._corners() or []
        cursor = inp.cursor_position()
        self.last_set = safety.failsafe_exemption(cursor, self.last_set)
        allowed = exempt if exempt is not None else self.last_set
        safety.check_failsafe(cursor, corners, allowed, enabled=True)

    def _failsafe_interrupt(self) -> inp.InterruptCheck | None:
        """The check ``inp`` runs between the steps of a scroll or drag (failsafe only)."""
        corners = self._corners()
        if corners is None:
            return None

        def check(expected: tuple[int, int] | None) -> None:
            self._check_failsafe(corners, exempt=expected)

        return check

    def _password_state(self) -> bool | None:
        """Is the focused element a password field? None: still unknown after one retry."""
        for attempt in range(2):
            if attempt:
                time.sleep(_PASSWORD_RETRY_DELAY)
            try:
                state = uia.focused_element_is_password()
            except Exception:  # an unexpected failure is "unknown" too: fail closed
                log.debug("password check raised", exc_info=True)
                state = None
            if state is not None:
                return bool(state)
        return None

    def _check_keyboard(
        self, typing: bool, corners: list[tuple[int, int]] | None = None
    ) -> uia.WindowInfo:
        """Safety for keyboard actions: failsafe, blocklist, terminal, password (typing only).

        The keyboard target is the foreground window: refused when it is a terminal (process or
        window class) or the agent's own host (its pid is one of our parent processes). Typing is
        also refused when the focused element is a password field or that cannot be determined.
        Returns the foreground window that passed.
        """
        self._check_failsafe(corners)
        window = self._keyboard_target()
        process = window.process
        safety.check_blocked(process, self.cfg.blocked_processes)
        safety.check_keyboard_target(
            process,
            self.cfg.allow_terminal_input,
            window_class=window.class_name,
            is_own_host=window.pid in uia.ancestor_pids(),
        )
        if typing:
            safety.check_password_field(self._password_state())
        return window

    def _keyboard_target(self) -> uia.WindowInfo:
        """The foreground window keyboard input would go to; refuses when there is none.

        During an activation change (alt+tab, a dialog closing after Enter) Windows briefly has
        no foreground window, and keys sent then go to whichever window is activated next, which
        no check has seen. So it is asked again a few times (at most ~_FOREGROUND_RETRIES x
        _FOREGROUND_RETRY_DELAY) and the input is refused if it stays unknown.
        """
        for attempt in range(_FOREGROUND_RETRIES + 1):
            if attempt:
                time.sleep(_FOREGROUND_RETRY_DELAY)
            window = uia.foreground_window()
            if window is not None:
                return window
        raise safety.SafetyError(
            "There is no foreground window right now (Windows is switching windows), so keyboard "
            "input was refused: it would go to a window nobody checked. Wait a moment, check "
            "with windows, focus the target and retry."
        )

    def _recheck_typing(
        self,
        typed_piece: str,
        window: uia.WindowInfo | None,
        corners: list[tuple[int, int]] | None,
        first: bool = False,
    ) -> uia.WindowInfo | None:
        """Checks between two pieces of a type_text call (see ``inp.type_text_segments``).

        Every keyboard check runs again at every piece boundary, the password field included:
        the focus can move without Tab/Enter (a letter working as a mnemonic, Space on a button,
        auto-advancing code fields, scripts). Cost: one UI Automation query per piece, i.e. per
        Tab/Enter, after the short first piece and per ``inp.TYPE_BATCH_CHARS`` characters.
        After Tab/Enter and after the first piece the check waits for the focus to settle first.
        A different foreground window does not stop the text by itself: the rest goes on if the
        new window passes every check. Only after Enter does a change stop it (see below).
        """
        settle = inp.focus_settle_after_text(typed_piece, first=first)
        time.sleep(settle if settle > 0 else inp.TYPE_BATCH_PAUSE)
        current = self._check_keyboard(typing=True, corners=corners)
        # A new foreground window that passed every check above may take the rest (the Start
        # menu hands typing over to Search, a suggestion box opens). Except right after Enter:
        # it may have launched a program whose window is not up yet (Win+R "cmd" Enter); what
        # is in front now is not where the rest would end up, so the text stops there.
        if typed_piece.endswith(("\r", "\n")) and _handle(current) != _handle(window):
            raise safety.SafetyError(
                f"The foreground window changed after Enter (now {_describe(current)}), so the "
                "rest of the text was not typed: Enter may have started a program whose window "
                "is not up yet. Check the screen, then type the rest "
                "with a new type_text call if it is still wanted."
            )
        return current

    def _moved_to(self, point: tuple[int, int]) -> None:
        """Remember where the server put the cursor (failsafe ignores that position)."""
        try:
            actual = tuple(inp.cursor_position())
        except Exception:  # fall back to the requested point
            actual = point
        close = max(abs(actual[0] - point[0]), abs(actual[1] - point[1])) <= _SETTLE_TOLERANCE
        self.last_set = (int(actual[0]), int(actual[1])) if close else point

    # ------------------------------------------------------------------ read-only tools

    def screenshot(self, monitor: int | None) -> tuple[bytes, str]:
        cfg = self.cfg
        index = monitor if monitor is not None else cfg.monitor
        data, cmap = screen.capture(
            index,
            cfg.max_size,
            image_format=cfg.image_format,
            jpeg_quality=cfg.jpeg_quality,
            max_tokens=cfg.max_image_tokens,
        )
        self.cmap = cmap
        count = len(screen.list_monitors())
        tokens = screen.estimate_image_tokens(cmap.image_width, cmap.image_height)
        text = (
            f"monitor {cmap.monitor.index}/{count} {cmap.image_width}x{cmap.image_height} "
            f"(scale {cmap.scale:.2f}) ~{tokens} tokens | {self._foreground()}"
        )
        return data, text

    def zoom(self, x0: int, y0: int, x1: int, y1: int) -> tuple[bytes, str]:
        if self.cmap is None:
            raise ValueError(_NO_SCREENSHOT_ZOOM)
        cfg = self.cfg
        data, width, height = screen.capture_region(
            self.cmap,
            x0,
            y0,
            x1,
            y1,
            cfg.max_size,
            image_format=cfg.image_format,
            jpeg_quality=cfg.jpeg_quality,
            max_tokens=cfg.max_image_tokens,
        )
        tokens = screen.estimate_image_tokens(width, height)
        text = (
            f"zoom {width}x{height} of ({x0},{y0})-({x1},{y1}) ~{tokens} tokens; "
            "click coordinates stay in screenshot space"
        )
        return data, text

    def elements(self, query: str | None, window: int | None) -> str:
        limit = self.cfg.max_elements
        listed = uia.list_windows()
        if window is None:
            info = uia.foreground_window()
        else:
            info = next((w for w in listed if w.handle == window), None)
        # The foreground window is passed by handle, so the listing and the stale-id check below
        # refer to the same window even if the foreground changes meanwhile.
        target = window if window is not None else (info.handle if info else None)
        # One more than the cap: tells "exactly the cap" apart from "more than the cap".
        result = uia.list_elements(target, query or None, limit + 1)
        found = list(result)[:limit]
        more = len(result) > limit
        incomplete = getattr(result, "incomplete", "")
        self.by_id = {e.id: e for e in found}
        handle = target if target is not None else 0
        snapshot = next((w for w in listed if w.handle == handle), None)
        known = snapshot or (info if info is not None and info.handle == handle else None)
        self.listing = (
            _Listing(handle, _rect(snapshot) if snapshot else None, known.pid if known else 0)
            if handle
            else None
        )

        title = _one_line(info.title) if info else "?"
        process = (info.process or "?") if info else "?"
        lines = [f'window: "{title}" ({process}) — {len(found)} elements']
        cmap = self.cmap
        for e in found:
            line = f'[{e.id}] {e.role} "{_one_line(e.name)}"'
            if e.value:
                line += f' = "{_one_line(e.value)}"'
            if not e.enabled:
                line += " (disabled)"
            if cmap is not None:
                point = cmap.to_image(*e.center)
                if point is not None:
                    line += f" @{point[0]},{point[1]}"
            lines.append(line)
        if incomplete:
            reason = _INCOMPLETE_REASONS.get(incomplete, incomplete)
            lines.append(
                f"… incomplete: the scan stopped early ({reason}), so elements may be missing. "
                "Narrow it with query or a smaller window (e.g. a dialog's handle), or use "
                "screenshot."
            )
        elif not found:  # Electron apps, canvases, games: nothing exposed through UIA
            lines.append("no accessible elements; use screenshot")
        if more:
            lines.append(f"… truncated at {limit}; use query to narrow")
        return "\n".join(lines)

    def windows(self) -> str:
        lines = []
        for w in uia.list_windows():
            line = f'{w.handle} | {w.process or "?"} | "{_one_line(w.title)}"'
            if w.foreground:
                line += " [foreground]"
            if w.minimized:
                line += " [minimized]"
            lines.append(line)
        return "\n".join(lines) if lines else "no visible windows"

    # ------------------------------------------------------------------ action tools

    def focus(self, window: int) -> str:
        """Bring a window forward; refused for blocked apps, bounded in time for hung ones.

        The blocklist is checked against the window, its root window and its root owner, also
        for a handle that is not in the window list (a child or an owned window): focusing it
        brings its root forward.
        """
        self._check_failsafe()
        blocked = self.cfg.blocked_processes
        if blocked:
            target = next((w for w in uia.list_windows() if w.handle == window), None)
            family = _family(target) if target is not None else uia.window_family(window)
            for w in family:
                safety.check_blocked(w.process, blocked)
        try:
            info = _run_with_timeout(uia.focus_window, (window,), _FOCUS_TIMEOUT)
        except _CallTimeout:
            log.warning("focus %s did not finish within %.1f s", window, _FOCUS_TIMEOUT)
            raise RuntimeError(
                f"focus did not finish within {_FOCUS_TIMEOUT:g} s: the window is probably not "
                "responding. Wait a few seconds and check with windows; if it stays "
                "unresponsive, ask the user."
            ) from None
        log.info("focus %s", window)
        return f"ok | {_describe(info)}"

    def click(
        self,
        x: int | None,
        y: int | None,
        element: int | None,
        button: str,
        clicks: int,
        modifiers: list[str] | None,
    ) -> str:
        (sx, sy), found = self._target(x, y, element)
        name = button.strip().lower() if isinstance(button, str) else button
        # Right/middle clicks paste in many terminals; an unknown button is checked as well
        # (fail closed) and then rejected by inp.click.
        paste = "" if name == "left" else f"A {name} click"
        self._check_pointer((sx, sy), paste_action=paste, element=found)
        mods = modifiers if modifiers is not None else ()
        inp.click(sx, sy, button=button, count=clicks, modifiers=mods)
        self._moved_to((sx, sy))
        log.info("click %s x%s at %s,%s", button, clicks, sx, sy)
        return self._ok()

    def type_text(self, text: str) -> str:
        """Type ``text`` piece by piece, re-checking where the keyboard target may have changed.

        Pieces end after every Tab/Enter and every ``inp.TYPE_BATCH_CHARS`` characters; text
        without Tab/Enter that fits in one piece is a single ``inp.type_text`` call, as before.
        """
        pieces = inp.type_text_segments(text)  # validates before any check or input
        corners = self._corners()
        window = self._check_keyboard(typing=True, corners=corners)
        typed = 0
        for i, piece in enumerate(pieces):
            try:
                if i:
                    window = self._recheck_typing(pieces[i - 1], window, corners, first=i == 1)
                inp.type_text(piece)
            except Exception as exc:
                if not typed:
                    raise
                done = f"Stopped after typing {typed} of {len(text)} characters"
                raise _partial(exc, done) from exc
            typed += len(piece)
        log.info("type_text (%d chars, %d pieces)", len(text), len(pieces))
        return self._ok()

    def key(self, keys: str, repeat: int) -> str:
        """Press the chords one at a time, re-checking the keyboard target before each one.

        A chord can move the focus (tab, enter, shortcuts) or open a window, so every press is
        checked against the then-current foreground window; chords that type a character are also
        refused in a password field. Unlike type_text, a change of the foreground window between
        chords is not an error by itself: switching windows is a normal use of key ("alt+tab
        enter"), and the next chord is fully checked against the new window before it is sent
        (no foreground window at all is refused).
        """
        steps = inp.plan_keys(keys, repeat)  # validates (incl. MAX_KEY_EVENTS) before any input
        corners = self._corners()
        for i, (chord, vks) in enumerate(steps):
            try:
                if i:
                    time.sleep(max(inp.KEY_GAP, inp.focus_settle_after_chord(steps[i - 1][1])))
                self._check_keyboard(typing=inp.chord_types_text(vks), corners=corners)
                inp.press_keys(chord, repeat=1)
            except Exception as exc:
                if not i:
                    raise
                raise _partial(exc, f"Stopped after {i} of {len(steps)} key presses") from exc
        log.info("key %r x%s", keys, repeat)
        return self._ok()

    def scroll(self, direction: str, amount: int, x: int | None, y: int | None) -> str:
        if (x is None) != (y is None):
            raise ValueError(
                "Give both x and y, or neither (scroll at the current mouse position)."
            )
        if x is not None and y is not None:
            point = self._to_screen(x, y)
        else:
            cx, cy = inp.cursor_position()
            point = (int(cx), int(cy))
        self._check_pointer(point)
        try:
            with inp.interrupt_check(self._failsafe_interrupt()):
                inp.scroll(point[0], point[1], direction, amount=amount)
        except safety.SafetyError as exc:
            raise safety.SafetyError(f"Scrolling was stopped part-way. {exc}") from exc
        self._moved_to(point)
        log.info("scroll %s %s at %s,%s", direction, amount, *point)
        return self._ok()

    def drag(self, x0: int, y0: int, x1: int, y1: int) -> str:
        start = self._to_screen(x0, y0)
        end = self._to_screen(x1, y1)
        # A drag can carry selected text or files into the drop window, or select and drag text
        # out of a terminal: both ends are refused on terminals and on the agent's own host.
        self._check_pointer(start, end, paste_action="A drag")
        try:
            with inp.interrupt_check(self._failsafe_interrupt()):
                inp.drag(start[0], start[1], end[0], end[1])
        except safety.SafetyError as exc:
            raise safety.SafetyError(
                f"The drag was stopped part-way and the mouse button was released. {exc}"
            ) from exc
        self._moved_to(end)
        log.info("drag %s,%s -> %s,%s", *start, *end)
        return self._ok()

    def move(self, x: int, y: int) -> str:
        point = self._to_screen(x, y)
        self._check_pointer(point)
        inp.move(point[0], point[1])
        self._moved_to(point)
        log.info("move %s,%s", *point)
        return self._ok()

    def wait(self, seconds: float) -> str:
        if not 0 < seconds <= _WAIT_MAX_SECONDS:
            raise ValueError(f"seconds must be > 0 and <= {_WAIT_MAX_SECONDS:g}, got {seconds}.")
        self._check_failsafe()
        time.sleep(seconds)
        return self._ok(settle=False)


def _guarded(fn: Callable[..., _T], args: tuple[object, ...]) -> _T:
    """Run a tool body; keep expected errors as they are, flatten unexpected ones to one line."""
    name = getattr(fn, "__name__", "tool")
    try:
        return fn(*args)
    except (safety.SafetyError, ValueError, RuntimeError) as exc:
        log.info("%s: %s", name, exc)
        raise
    except Exception as exc:
        log.exception("%s failed unexpectedly", name)
        raise RuntimeError(f"{name} failed: {type(exc).__name__}: {exc}") from exc


def build_server(config: Config) -> FastMCP:
    """Create the FastMCP server with the 12 tools; state lives in this server instance."""
    session = _Session(config)
    lock = threading.Lock()
    image_format = config.image_format

    async def call(fn: Callable[..., _T], *args: object) -> _T:
        def locked() -> _T:
            with lock:
                return _guarded(fn, args)

        return await to_thread.run_sync(locked)

    server = FastMCP(SERVER_NAME, instructions=instructions.SERVER_INSTRUCTIONS)
    lowlevel = getattr(server, "_mcp_server", None)
    if lowlevel is not None and hasattr(lowlevel, "version"):
        lowlevel.version = __version__  # serverInfo.version; FastMCP would report the SDK's

    desc = instructions.TOOL_DESCRIPTIONS
    read_only = ToolAnnotations(readOnlyHint=True)
    acts = ToolAnnotations(readOnlyHint=False)

    def register(fn: Callable[..., object], annotations: ToolAnnotations) -> None:
        server.add_tool(
            fn,
            name=fn.__name__,
            description=desc[fn.__name__],
            annotations=annotations,
            structured_output=False,
        )

    async def screenshot(monitor: int | None = None) -> list[Image | str]:
        data, text = await call(session.screenshot, monitor)
        return [Image(data=data, format=image_format), text]

    async def zoom(x0: int, y0: int, x1: int, y1: int) -> list[Image | str]:
        data, text = await call(session.zoom, x0, y0, x1, y1)
        return [Image(data=data, format=image_format), text]

    async def elements(query: str | None = None, window: int | None = None) -> str:
        return await call(session.elements, query, window)

    async def windows() -> str:
        return await call(session.windows)

    async def focus(window: int) -> str:
        return await call(session.focus, window)

    async def click(
        x: int | None = None,
        y: int | None = None,
        element: int | None = None,
        button: str = "left",
        clicks: int = 1,
        modifiers: list[str] | None = None,
    ) -> str:
        return await call(session.click, x, y, element, button, clicks, modifiers)

    async def type_text(text: str) -> str:
        return await call(session.type_text, text)

    async def key(keys: str, repeat: int = 1) -> str:
        return await call(session.key, keys, repeat)

    async def scroll(
        direction: str, amount: int = 3, x: int | None = None, y: int | None = None
    ) -> str:
        return await call(session.scroll, direction, amount, x, y)

    async def drag(x0: int, y0: int, x1: int, y1: int) -> str:
        return await call(session.drag, x0, y0, x1, y1)

    async def move(x: int, y: int) -> str:
        return await call(session.move, x, y)

    async def wait(seconds: float) -> str:
        return await call(session.wait, seconds)

    for fn in (screenshot, zoom, elements, windows):
        register(fn, read_only)
    for fn in (focus, click, type_text, key, scroll, drag, move):
        register(fn, acts)
    register(wait, read_only)
    return server


def _configure_logging() -> None:
    """Log to stderr only: stdout carries the MCP protocol.

    Runs before FastMCP is created, so FastMCP's own basicConfig call becomes a no-op. A root
    logger that is already configured (e.g. by a test runner) is left alone.
    """
    logging.basicConfig(
        level=logging.INFO,
        stream=sys.stderr,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    logging.getLogger("mcp").setLevel(logging.WARNING)  # per-request INFO noise


def main(argv: list[str] | None = None) -> None:
    """Console entry point: ``computer-use-windows [options]`` (stdio MCP server)."""
    if sys.platform != "win32":
        sys.stderr.write(
            f"computer-use-windows only runs on Windows 10/11 (this is {sys.platform}).\n"
        )
        raise SystemExit(2)
    _configure_logging()
    try:
        cfg = config.load_config(argv)
    except ValueError as exc:
        sys.stderr.write(f"computer-use-windows: {exc}\n")
        raise SystemExit(2) from None
    screen.ensure_dpi_awareness()
    server = build_server(cfg)
    log.info("computer-use-windows %s starting (stdio); %s", __version__, cfg)
    try:
        server.run(transport="stdio")
    except KeyboardInterrupt:
        pass
