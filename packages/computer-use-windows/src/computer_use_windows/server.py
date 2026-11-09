"""MCP server (stdio): wires config, screen, input, uia, safety and instructions into 12 tools.

Threading: every tool body runs in an anyio worker thread, one at a time (a lock), so the event
loop never blocks (a 10 s ``wait`` or a 2 s UIA walk does not stall the protocol) and actions never
interleave. uia.py initializes COM per calling thread and screen.py opens mss per call, so it does
not matter which worker thread runs a call.

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


class _Session:
    """Server state and the synchronous body of every tool (run in a worker thread)."""

    def __init__(self, cfg: Config) -> None:
        self.cfg = cfg
        self.cmap: screen.CoordMap | None = None  # last screenshot's mapping
        self.by_id: dict[int, uia.Element] = {}  # last elements call, by id
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

    def _target(self, x: int | None, y: int | None, element: int | None) -> tuple[int, int]:
        if element is not None:
            if x is not None or y is not None:
                raise ValueError("Give either x and y, or element, not both.")
            found = self.by_id.get(element)
            if found is None:
                raise ValueError(
                    f"Unknown element id {element}: ids come from the last elements call. "
                    "Call elements again."
                )
            return found.center
        if x is None or y is None:
            raise ValueError(
                "Give both x and y (pixels in the last screenshot), or element "
                "(an id from elements)."
            )
        return self._to_screen(x, y)

    def _check_failsafe(self) -> None:
        if not self.cfg.failsafe:
            return
        monitors = screen.list_monitors()
        corners = safety.monitor_corners([(m.left, m.top, m.width, m.height) for m in monitors])
        safety.check_failsafe(inp.cursor_position(), corners, self.last_set, enabled=True)

    def _check_pointer(self, *points: tuple[int, int]) -> None:
        """Safety for mouse actions: failsafe, then the window under every target point."""
        self._check_failsafe()
        for px, py in points:
            window = uia.window_at(px, py)
            safety.check_blocked(window.process if window else None, self.cfg.blocked_processes)

    def _check_keyboard(self, typing: bool) -> None:
        """Safety for keyboard actions: failsafe, blocklist, terminal, password (typing only).

        The keyboard target is the foreground window: refused when it is a terminal (process or
        window class) or the agent's own host (its pid is one of our parent processes).
        """
        self._check_failsafe()
        window = uia.foreground_window()
        process = window.process if window else None
        safety.check_blocked(process, self.cfg.blocked_processes)
        safety.check_keyboard_target(
            process,
            self.cfg.allow_terminal_input,
            window_class=window.class_name if window else "",
            is_own_host=window is not None and window.pid in uia.ancestor_pids(),
        )
        if typing:
            safety.check_password_field(uia.focused_element_is_password())

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
        if window is None:
            info = uia.foreground_window()
        else:
            info = next((w for w in uia.list_windows() if w.handle == window), None)
        found = uia.list_elements(window, query or None, limit)
        self.by_id = {e.id: e for e in found}

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
        if not found:  # Electron apps, canvases, games: nothing exposed through UIA
            lines.append("no accessible elements; use screenshot")
        elif len(found) >= limit:
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
        self._check_failsafe()
        target = next((w for w in uia.list_windows() if w.handle == window), None)
        safety.check_blocked(target.process if target else None, self.cfg.blocked_processes)
        info = uia.focus_window(window)
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
        sx, sy = self._target(x, y, element)
        self._check_pointer((sx, sy))
        mods = modifiers if modifiers is not None else ()
        inp.click(sx, sy, button=button, count=clicks, modifiers=mods)
        self._moved_to((sx, sy))
        log.info("click %s x%s at %s,%s", button, clicks, sx, sy)
        return self._ok()

    def type_text(self, text: str) -> str:
        self._check_keyboard(typing=True)
        inp.type_text(text)
        log.info("type_text (%d chars)", len(text))
        return self._ok()

    def key(self, keys: str, repeat: int) -> str:
        self._check_keyboard(typing=False)
        inp.press_keys(keys, repeat=repeat)
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
        inp.scroll(point[0], point[1], direction, amount=amount)
        self._moved_to(point)
        log.info("scroll %s %s at %s,%s", direction, amount, *point)
        return self._ok()

    def drag(self, x0: int, y0: int, x1: int, y1: int) -> str:
        start = self._to_screen(x0, y0)
        end = self._to_screen(x1, y1)
        self._check_pointer(start, end)
        inp.drag(start[0], start[1], end[0], end[1])
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
