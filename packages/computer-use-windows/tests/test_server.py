"""Unit tests for the MCP server, driven through the MCP SDK's in-memory client session.

Every Windows-touching function in ``screen``, ``input`` and ``uia`` is replaced by a fake, so
nothing here captures the screen, moves the mouse, sends keystrokes or opens a window. As an extra
guard, the user32 input/foreground APIs are replaced by functions that fail the test if called.
The ``safety`` checks stay real but are wrapped by spies that record the order they ran in.
"""

from __future__ import annotations

import base64
import dataclasses
import functools
import io
import json
import math
import re
import sys
import time
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import pytest
from anyio.from_thread import BlockingPortal, start_blocking_portal
from mcp_client import Session, open_session
from PIL import Image

from computer_use_windows import __version__, instructions, safety, screen, uia
from computer_use_windows import input as inp
from computer_use_windows import server as server_mod
from computer_use_windows.config import Config
from computer_use_windows.screen import CoordMap, MonitorInfo
from computer_use_windows.uia import Element, WindowInfo

FIXTURES = Path(__file__).parent / "fixtures"

TOOL_NAMES = frozenset(
    {
        "screenshot",
        "zoom",
        "elements",
        "windows",
        "focus",
        "click",
        "type_text",
        "key",
        "scroll",
        "drag",
        "move",
        "wait",
    }
)

# Two 1920x1080 monitors; a 1280 px long-edge cap gives 1280x720 images, i.e. scale 1.5.
MON1 = MonitorInfo(index=1, left=0, top=0, width=1920, height=1080, primary=True)
MON2 = MonitorInfo(index=2, left=-1920, top=-300, width=1920, height=1080, primary=False)

NOTEPAD = WindowInfo(
    handle=1001, title="Untitled - Notepad", process="notepad.exe", pid=4001,
    left=100, top=100, right=1100, bottom=1000, foreground=False, minimized=False,
    class_name="Notepad",
)  # fmt: skip
MAIL = WindowInfo(
    handle=1002, title="Inbox - Mail", process="olk.exe", pid=4002,
    left=-32000, top=-32000, right=-31840, bottom=-31972, foreground=False, minimized=True,
    class_name="WinUIDesktopWin32WindowClass",
)  # fmt: skip
KEEPASS = WindowInfo(
    handle=1003, title="Passwords.kdbx - KeePass", process="keepass.exe", pid=4003,
    left=1200, top=600, right=1800, bottom=1000, foreground=False, minimized=False,
    class_name="WindowsForms10.Window.8.app.0.33c0d9d",
)  # fmt: skip
TERMINAL = WindowInfo(
    handle=1004, title="Windows PowerShell", process="windowsterminal.exe", pid=4004,
    left=-1800, top=-250, right=-200, bottom=700, foreground=False, minimized=False,
    class_name="CASCADIA_HOSTING_WINDOW_CLASS",
)  # fmt: skip
# Not in the default window list; individual tests add them.
CONSOLE = WindowInfo(
    handle=1005, title="Command Prompt", process="cmd.exe", pid=4005,
    left=200, top=200, right=900, bottom=700, foreground=False, minimized=False,
    class_name="ConsoleWindowClass",
)  # fmt: skip
SHELL_FORM = WindowInfo(  # a WinForms window owned by powershell.exe is NOT a terminal
    handle=1006, title="CUW Test Form", process="powershell.exe", pid=4006,
    left=100, top=100, right=600, bottom=450, foreground=False, minimized=False,
    class_name="WindowsForms10.Window.8.app.0.2bf8098_r6_ad1",
)  # fmt: skip
EDITOR = WindowInfo(  # e.g. the editor whose integrated terminal runs the agent
    handle=1007, title="main.py - project - Visual Studio Code", process="code.exe", pid=4007,
    left=0, top=0, right=1920, bottom=1040, foreground=False, minimized=False,
    class_name="Chrome_WidgetWin_1",
)  # fmt: skip

# Screen-space rects. Centers: Save (450,300), File name (750,600), Delete (1050,900) on monitor 1
# (image (300,200), (500,400), (700,600) at scale 1.5); Status (-960,-90) on monitor 2 only.
ELEMENTS = (
    Element(id=1, role="button", name="Save", left=420, top=285, right=480, bottom=315,
            enabled=True, value=None),
    Element(id=2, role="edit", name="File name", left=600, top=585, right=900, bottom=615,
            enabled=True, value="report.txt"),
    Element(id=3, role="button", name="Delete", left=1020, top=885, right=1080, bottom=915,
            enabled=False, value=None),
    Element(id=4, role="text", name="Status", left=-1000, top=-100, right=-920, bottom=-80,
            enabled=True, value=None),
)  # fmt: skip

KEEPASS_IMAGE_POINT = (1000, 500)  # -> screen (1500, 750) on monitor 1, inside KEEPASS

SAFETY_CHECKS = (
    "check_failsafe",
    "check_blocked",
    "check_keyboard_target",
    "check_password_field",
)

REQUIRED = object()
_INT = frozenset({"integer"})
_INT_OR_NULL = frozenset({"integer", "null"})
_STR = frozenset({"string"})
_STR_OR_NULL = frozenset({"string", "null"})

# tool -> {param: (JSON types that must be accepted, default or REQUIRED)}
EXPECTED_PARAMS: dict[str, dict[str, tuple[frozenset[str], object]]] = {
    "screenshot": {"monitor": (_INT_OR_NULL, None)},
    "zoom": {"x0": (_INT, REQUIRED), "y0": (_INT, REQUIRED), "x1": (_INT, REQUIRED),
             "y1": (_INT, REQUIRED)},
    "elements": {"query": (_STR_OR_NULL, None), "window": (_INT_OR_NULL, None)},
    "windows": {},
    "focus": {"window": (_INT, REQUIRED)},
    "click": {"x": (_INT_OR_NULL, None), "y": (_INT_OR_NULL, None),
              "element": (_INT_OR_NULL, None), "button": (_STR, "left"), "clicks": (_INT, 1),
              "modifiers": (frozenset({"array", "null"}), None)},
    "type_text": {"text": (_STR, REQUIRED)},
    "key": {"keys": (_STR, REQUIRED), "repeat": (_INT, 1)},
    "scroll": {"direction": (_STR, REQUIRED), "amount": (_INT, 3), "x": (_INT_OR_NULL, None),
               "y": (_INT_OR_NULL, None)},
    "drag": {"x0": (_INT, REQUIRED), "y0": (_INT, REQUIRED), "x1": (_INT, REQUIRED),
             "y1": (_INT, REQUIRED)},
    "move": {"x": (_INT, REQUIRED), "y": (_INT, REQUIRED)},
    "wait": {"seconds": (frozenset({"number"}), REQUIRED)},
}  # fmt: skip


# --------------------------------------------------------------------------------------------
# Fakes
# --------------------------------------------------------------------------------------------


@functools.cache
def encode_image(width: int, height: int, image_format: str = "png", quality: int = 80) -> bytes:
    """Real (tiny-content) image bytes, so the server passes along something decodable."""
    buf = io.BytesIO()
    pil_format = "PNG" if image_format == "png" else "JPEG"
    Image.new("RGB", (width, height), (30, 90, 160)).save(buf, format=pil_format, quality=quality)
    return buf.getvalue()


def image_tokens(width: int, height: int) -> int:
    return math.ceil(width / 28) * math.ceil(height / 28)


def fit(width: int, height: int, max_size: int, max_tokens: int = 1568) -> tuple[int, int]:
    """Largest size with the same aspect, long edge <= max_size and tokens <= max_tokens."""
    long_edge = min(max(width, height), max_size)
    while True:
        factor = long_edge / max(width, height)
        size = max(1, round(width * factor)), max(1, round(height * factor))
        if image_tokens(*size) <= max_tokens or long_edge <= 1:
            return size
        long_edge -= 1


class FakeDesktop:
    """Stands in for the screen, the mouse/keyboard and UI Automation."""

    def __init__(self) -> None:
        self.monitors: list[MonitorInfo] = [MON1, MON2]
        self.windows: list[WindowInfo] = [NOTEPAD, MAIL, KEEPASS, TERMINAL]
        self.foreground: int = NOTEPAD.handle
        self.cursor: tuple[int, int] = (960, 540)
        self.password_focused = False
        self.ancestors: frozenset[int] = frozenset({7001, 7002})  # the agent's parent chain
        self.elements: list[Element] = list(ELEMENTS)
        self.elements_error: Exception | None = None  # raised by list_elements when set
        # Recordings.
        self.inputs: list[tuple[str, dict[str, Any]]] = []
        self.focused: list[int] = []
        self.captures: list[dict[str, Any]] = []
        self.regions: list[dict[str, Any]] = []
        self.element_queries: list[dict[str, Any]] = []
        self.window_at_calls: list[tuple[int, int]] = []
        self.checks: list[tuple[str, bool]] = []  # (check name, raised)
        self.last_cmap: CoordMap | None = None

    # ---- screen ----------------------------------------------------------------------------
    def list_monitors(self) -> list[MonitorInfo]:
        return list(self.monitors)

    def capture(
        self,
        monitor: int | None = None,
        max_size: int = 1280,
        image_format: str = "png",
        jpeg_quality: int = 80,
        max_tokens: int = 1568,
    ) -> tuple[bytes, CoordMap]:
        self.captures.append(
            {
                "monitor": monitor,
                "max_size": max_size,
                "image_format": image_format,
                "jpeg_quality": jpeg_quality,
                "max_tokens": max_tokens,
            }
        )
        if monitor is None:
            mon = next(m for m in self.monitors if m.primary)
        else:
            matches = [m for m in self.monitors if m.index == monitor]
            if not matches:
                valid = ", ".join(str(m.index) for m in self.monitors)
                raise ValueError(f"Unknown monitor {monitor}; valid monitors: {valid}")
            mon = matches[0]
        width, height = fit(mon.width, mon.height, max_size, max_tokens)
        cmap = CoordMap(monitor=mon, image_width=width, image_height=height)
        self.last_cmap = cmap
        return encode_image(width, height, image_format, jpeg_quality), cmap

    def capture_region(
        self,
        cmap: CoordMap,
        x0: int,
        y0: int,
        x1: int,
        y1: int,
        max_size: int,
        image_format: str = "png",
        jpeg_quality: int = 80,
        max_tokens: int = 1568,
    ) -> tuple[bytes, int, int]:
        self.regions.append(
            {
                "cmap": cmap,
                "x0": x0,
                "y0": y0,
                "x1": x1,
                "y1": y1,
                "max_size": max_size,
                "image_format": image_format,
                "jpeg_quality": jpeg_quality,
                "max_tokens": max_tokens,
            }
        )
        left, right = max(min(x0, x1), 0), min(max(x0, x1), cmap.image_width)
        top, bottom = max(min(y0, y1), 0), min(max(y0, y1), cmap.image_height)
        if right <= left or bottom <= top:
            raise ValueError("Region is empty or outside the last screenshot.")
        width = round((right - left) * cmap.scale)
        height = round((bottom - top) * cmap.scale)
        width, height = fit(width, height, max_size, max_tokens)
        return encode_image(width, height, image_format, jpeg_quality), width, height

    # ---- input -----------------------------------------------------------------------------
    def cursor_position(self) -> tuple[int, int]:
        return self.cursor

    def move(self, x: int, y: int) -> None:
        self.inputs.append(("move", {"x": x, "y": y}))
        self.cursor = (x, y)

    def click(
        self, x: int, y: int, button: str = "left", count: int = 1, modifiers: Any = ()
    ) -> None:
        mods = list(modifiers)  # a Sequence[str] per the contract; None would fail here too
        self.inputs.append(
            ("click", {"x": x, "y": y, "button": button, "count": count, "modifiers": mods})
        )
        self.cursor = (x, y)

    def scroll(self, x: int, y: int, direction: str, amount: int = 3) -> None:
        self.inputs.append(("scroll", {"x": x, "y": y, "direction": direction, "amount": amount}))
        self.cursor = (x, y)

    def drag(self, x0: int, y0: int, x1: int, y1: int, button: str = "left") -> None:
        self.inputs.append(("drag", {"x0": x0, "y0": y0, "x1": x1, "y1": y1, "button": button}))
        self.cursor = (x1, y1)

    def press_keys(self, spec: str, repeat: int = 1) -> None:
        self.inputs.append(("press_keys", {"spec": spec, "repeat": repeat}))

    def type_text(self, text: str) -> None:
        if not text:
            raise ValueError("text is empty")
        self.inputs.append(("type_text", {"text": text}))

    # ---- uia -------------------------------------------------------------------------------
    def list_windows(self) -> list[WindowInfo]:
        ordered = sorted(self.windows, key=lambda w: w.handle != self.foreground)
        return [dataclasses.replace(w, foreground=w.handle == self.foreground) for w in ordered]

    def foreground_window(self) -> WindowInfo | None:
        return next((w for w in self.list_windows() if w.foreground), None)

    def window_at(self, x: int, y: int) -> WindowInfo | None:
        self.window_at_calls.append((x, y))
        for w in self.list_windows():
            if not w.minimized and w.left <= x < w.right and w.top <= y < w.bottom:
                return w
        return None

    def focus_window(self, handle: int) -> WindowInfo:
        if handle not in {w.handle for w in self.windows}:
            raise ValueError(f"No window with handle {handle}; call windows to list them.")
        self.focused.append(handle)
        self.foreground = handle
        self.windows = [
            dataclasses.replace(w, minimized=False) if w.handle == handle else w
            for w in self.windows
        ]
        found = self.foreground_window()
        assert found is not None
        return found

    def list_elements(
        self,
        handle: int | None = None,
        query: str | None = None,
        limit: int = 80,
        hidden: Any = None,
    ) -> list[Element]:
        self.element_queries.append(
            {"handle": handle, "query": query, "limit": limit, "hidden": hidden}
        )
        if self.elements_error is not None:
            raise self.elements_error
        needle = (query or "").lower()
        found = [e for e in self.elements if needle in e.name.lower() or needle in e.role.lower()]
        return [dataclasses.replace(e, id=i) for i, e in enumerate(found[:limit], start=1)]

    def focused_element_is_password(self) -> bool:
        return self.password_focused

    def ancestor_pids(self) -> frozenset[int]:
        return self.ancestors

    # ---- helpers ---------------------------------------------------------------------------
    def window(self, handle: int) -> WindowInfo:
        return next(w for w in self.windows if w.handle == handle)

    def to_screen(self, x: int, y: int) -> tuple[int, int]:
        assert self.last_cmap is not None, "no screenshot was taken"
        return self.last_cmap.to_screen(x, y)

    def raised(self) -> list[str]:
        return [name for name, raised in self.checks if raised]

    def check_order(self) -> list[str]:
        seen: list[str] = []
        for name, _ in self.checks:
            if name not in seen:
                seen.append(name)
        return seen


def _spy(desk: FakeDesktop, name: str, original: Any) -> Any:
    def wrapper(*args: Any, **kwargs: Any) -> Any:
        try:
            result = original(*args, **kwargs)
        except safety.SafetyError:
            desk.checks.append((name, True))
            raise
        desk.checks.append((name, False))
        return result

    return wrapper


def _refuse_real_call(attempts: list[str], name: str, *args: Any, **kwargs: Any) -> Any:
    attempts.append(name)
    raise AssertionError(f"unit test reached the real user32.{name}")


@pytest.fixture(autouse=True)
def _no_real_input(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Defense in depth: fail if anything reaches the real user32 input/foreground APIs."""
    attempts: list[str] = []
    if sys.platform == "win32":
        import ctypes

        user32 = ctypes.windll.user32  # type: ignore[attr-defined]
        for name in (
            "SendInput",
            "SetCursorPos",
            "mouse_event",
            "keybd_event",
            "SetForegroundWindow",
            "BlockInput",
        ):
            monkeypatch.setattr(user32, name, functools.partial(_refuse_real_call, attempts, name))
    yield
    assert attempts == [], f"real Windows input APIs were called: {attempts}"


@pytest.fixture(autouse=True)
def desk(monkeypatch: pytest.MonkeyPatch) -> FakeDesktop:
    fake = FakeDesktop()
    for name in ("list_monitors", "capture", "capture_region"):
        monkeypatch.setattr(screen, name, getattr(fake, name))
    monkeypatch.setattr(screen, "ensure_dpi_awareness", lambda: None)
    for name in ("cursor_position", "move", "click", "scroll", "drag", "press_keys", "type_text"):
        monkeypatch.setattr(inp, name, getattr(fake, name))
    for name in (
        "list_windows",
        "foreground_window",
        "window_at",
        "focus_window",
        "list_elements",
        "focused_element_is_password",
        "ancestor_pids",
    ):
        monkeypatch.setattr(uia, name, getattr(fake, name))
    for name in SAFETY_CHECKS:
        monkeypatch.setattr(safety, name, _spy(fake, name, getattr(safety, name)))
    return fake


# --------------------------------------------------------------------------------------------
# In-memory MCP client
# --------------------------------------------------------------------------------------------


@dataclasses.dataclass
class Reply:
    result: dict[str, Any]  # CallToolResult, wire form (mcp_client)

    @property
    def content(self) -> list[dict[str, Any]]:
        return self.result["content"]

    @property
    def is_error(self) -> bool:
        return bool(self.result.get("isError"))

    @property
    def texts(self) -> list[str]:
        return [c["text"] for c in self.content if c["type"] == "text"]

    @property
    def images(self) -> list[dict[str, Any]]:
        return [c for c in self.content if c["type"] == "image"]

    @property
    def text(self) -> str:
        return "\n".join(self.texts)

    @property
    def lines(self) -> list[str]:
        return self.text.strip().splitlines()


@dataclasses.dataclass
class Client:
    portal: BlockingPortal
    session: Session

    @property
    def init(self) -> dict[str, Any]:
        """The InitializeResult's "instructions" and "serverInfo", as a client receives them."""
        return self.session.init

    def call(self, name: str, **arguments: Any) -> Reply:
        return Reply(self.portal.call(self.session.call_tool, name, arguments))

    def tools(self) -> list[dict[str, Any]]:
        return self.portal.call(self.session.list_tools)


@contextmanager
def connect(config: Config | None = None) -> Iterator[Client]:
    mcp_server = server_mod.build_server(config if config is not None else Config())
    with (
        start_blocking_portal() as portal,
        portal.wrap_async_context_manager(open_session(mcp_server, 20)) as session,
    ):
        yield Client(portal, session)


def assert_ok_line(reply: Reply) -> str:
    """An action reply: no error, no image, exactly one short line containing 'ok'."""
    assert not reply.is_error, reply.text
    assert reply.images == []
    assert len(reply.content) == 1, reply.content
    line = reply.texts[0].strip()
    assert "\n" not in line, line
    assert re.search(r"\bok\b", line), line
    return line


def assert_error(reply: Reply, *needles: str) -> str:
    assert reply.is_error, f"expected a tool error, got: {reply.text!r}"
    text = reply.text.lower()
    for needle in needles:
        assert needle.lower() in text, f"{needle!r} not in error {reply.text!r}"
    return text


def merged_text_inputs(desk: FakeDesktop) -> list[tuple[str, dict[str, Any]]]:
    """``desk.inputs`` with consecutive type_text calls joined into one.

    The server may type a text in several pieces (it re-checks safety between them); what
    matters is the text that reached the keyboard, not how many calls carried it.
    """
    merged: list[tuple[str, dict[str, Any]]] = []
    for name, args in desk.inputs:
        if name == "type_text" and merged and merged[-1][0] == "type_text":
            merged[-1] = ("type_text", {"text": merged[-1][1]["text"] + args["text"]})
        else:
            merged.append((name, dict(args)))
    return merged


def shot_line(index: int, count: int, width: int, height: int, window: WindowInfo) -> str:
    """The contract's screenshot line for a 1920 px wide monitor captured at width x height."""
    scale = 1920 / width
    tokens = image_tokens(width, height)
    return (
        f"monitor {index}/{count} {width}x{height} (scale {scale:.2f}) ~{tokens} tokens"
        f' | foreground: "{window.title}" ({window.process})'
    )


def element_line(element: Element, cmap: CoordMap | None) -> str:
    line = f'[{element.id}] {element.role} "{element.name}"'
    if element.value:
        line += f' = "{element.value}"'
    if not element.enabled:
        line += " (disabled)"
    if cmap is not None:
        point = cmap.to_image(*element.center)
        if point is not None:
            line += f" @{point[0]},{point[1]}"
    return line


# --------------------------------------------------------------------------------------------
# Registration: names, descriptions, instructions, parameter schemas
# --------------------------------------------------------------------------------------------


def test_tool_names_descriptions_and_server_instructions() -> None:
    with connect() as client:
        tools = client.tools()
        init = client.init
    assert sorted(t["name"] for t in tools) == sorted(TOOL_NAMES)
    for tool in tools:
        assert tool["description"] == instructions.TOOL_DESCRIPTIONS[tool["name"]], tool["name"]
    assert init["instructions"] == instructions.SERVER_INSTRUCTIONS
    assert init["serverInfo"]["name"] == "computer-use-windows"


def test_instruction_texts_respect_contract_limits() -> None:
    assert set(instructions.TOOL_DESCRIPTIONS) == TOOL_NAMES
    assert 0 < len(instructions.SERVER_INSTRUCTIONS) <= 900
    for name, text in instructions.TOOL_DESCRIPTIONS.items():
        assert 0 < len(text) <= 450, name


def _json_types(prop: dict[str, Any]) -> set[str]:
    found: set[str] = set()
    kind = prop.get("type")
    if isinstance(kind, str):
        found.add(kind)
    elif isinstance(kind, list):
        found.update(kind)
    for sub in prop.get("anyOf", []) + prop.get("oneOf", []):
        found |= _json_types(sub)
    return found


@pytest.mark.parametrize("tool_name", sorted(EXPECTED_PARAMS))
def test_tool_parameters_match_contract(tool_name: str) -> None:
    with connect() as client:
        tools = {t["name"]: t for t in client.tools()}
    schema = tools[tool_name]["inputSchema"]
    props: dict[str, Any] = schema.get("properties", {})
    expected = EXPECTED_PARAMS[tool_name]
    assert set(props) == set(expected)
    required = {p for p, (_, default) in expected.items() if default is REQUIRED}
    assert set(schema.get("required", [])) == required
    for param, (json_types, default) in expected.items():
        assert json_types <= _json_types(props[param]), (param, props[param])
        if default is not REQUIRED:
            assert "default" in props[param], param
            assert props[param]["default"] == default, param


def test_tool_list_is_exactly_the_contract() -> None:
    """tools/list as a client receives it: the same content with mcp 1.x and 2.x.

    tool_schemas.json is the list as mcp 1.30 sent it (input schemas, annotations); a new SDK
    must not add, drop or change a field, since all of it is in the agent's context.
    (Decoded JSON is compared, so key order on the wire may differ between SDK versions.)
    """
    snapshot = json.loads((FIXTURES / "tool_schemas.json").read_text(encoding="utf-8"))
    with connect() as client:
        tools = client.tools()
    assert {t["name"]: t for t in tools} == {
        name: {"name": name, "description": instructions.TOOL_DESCRIPTIONS[name], **fields}
        for name, fields in snapshot.items()
    }


def test_server_info_reports_the_package_version() -> None:
    with connect() as client:
        info = client.init["serverInfo"]
    assert info == {"name": "computer-use-windows", "version": __version__}


@pytest.mark.parametrize(
    ("error", "message"),
    [
        (safety.SafetyError("refused: a blocked app"), "refused: a blocked app"),
        (ValueError("seconds must be > 0"), "seconds must be > 0"),
        (RuntimeError("the window did not answer"), "the window did not answer"),
        (KeyError("boom"), "wait failed: KeyError: 'boom'"),  # unexpected: one line, no traceback
    ],
)
def test_tool_errors_reach_the_agent_with_their_message(
    monkeypatch: pytest.MonkeyPatch, error: Exception, message: str
) -> None:
    def wait(self: Any, seconds: float) -> str:
        raise error

    monkeypatch.setattr(server_mod._Session, "wait", wait)
    with connect() as client:
        reply = client.call("wait", seconds=1)
    assert reply.result == {
        "content": [{"type": "text", "text": f"Error executing tool wait: {message}"}],
        "isError": True,
    }


# --------------------------------------------------------------------------------------------
# screenshot
# --------------------------------------------------------------------------------------------


def test_screenshot_returns_image_and_status_line(desk: FakeDesktop) -> None:
    with connect() as client:
        reply = client.call("screenshot")
    assert not reply.is_error, reply.text
    assert len(reply.content) == 2
    assert len(reply.images) == 1 and len(reply.texts) == 1
    image = reply.images[0]
    assert image["mimeType"] == "image/png"
    assert base64.b64decode(image["data"]) == encode_image(1280, 720, "png", 80)
    assert reply.texts[0].strip() == (
        'monitor 1/2 1280x720 (scale 1.50) ~1196 tokens | foreground: "Untitled - Notepad"'
        " (notepad.exe)"
    )
    assert shot_line(1, 2, 1280, 720, NOTEPAD) == reply.texts[0].strip()
    [capture] = desk.captures
    assert capture["monitor"] in (None, 1)
    assert capture["max_size"] == 1280
    assert capture["image_format"] == "png"
    assert capture["max_tokens"] == 1568
    assert desk.inputs == []


def test_screenshot_monitor_argument(desk: FakeDesktop) -> None:
    with connect() as client:
        reply = client.call("screenshot", monitor=2)
    assert not reply.is_error, reply.text
    assert reply.texts[0].strip() == shot_line(2, 2, 1280, 720, NOTEPAD)
    assert [c["monitor"] for c in desk.captures] == [2]


def test_screenshot_defaults_to_config_monitor(desk: FakeDesktop) -> None:
    with connect(Config(monitor=2)) as client:
        reply = client.call("screenshot")
    assert not reply.is_error, reply.text
    assert [c["monitor"] for c in desk.captures] == [2]
    assert reply.texts[0].strip().startswith("monitor 2/2 ")


def test_screenshot_argument_overrides_config_monitor(desk: FakeDesktop) -> None:
    with connect(Config(monitor=2)) as client:
        reply = client.call("screenshot", monitor=1)
    assert not reply.is_error, reply.text
    assert [c["monitor"] for c in desk.captures] == [1]


def test_screenshot_defaults_to_primary_monitor(desk: FakeDesktop) -> None:
    desk.monitors = [
        dataclasses.replace(MON1, primary=False),
        dataclasses.replace(MON2, primary=True),
    ]
    with connect() as client:
        reply = client.call("screenshot")
    assert not reply.is_error, reply.text
    assert [c["monitor"] for c in desk.captures] in ([None], [2])
    assert reply.texts[0].strip().startswith("monitor 2/2 1280x720 ")


def test_screenshot_uses_config_size_and_format(desk: FakeDesktop) -> None:
    config = Config(max_size=640, image_format="jpeg", jpeg_quality=50)
    with connect(config) as client:
        reply = client.call("screenshot")
    assert not reply.is_error, reply.text
    [capture] = desk.captures
    assert capture["max_size"] == 640
    assert capture["image_format"] == "jpeg"
    assert capture["jpeg_quality"] == 50
    assert reply.images[0]["mimeType"] == "image/jpeg"
    assert base64.b64decode(reply.images[0]["data"]) == encode_image(640, 360, "jpeg", 50)
    assert reply.texts[0].strip() == (
        'monitor 1/2 640x360 (scale 3.00) ~299 tokens | foreground: "Untitled - Notepad"'
        " (notepad.exe)"
    )


def test_screenshot_passes_token_cap_and_reports_new_token_formula(desk: FakeDesktop) -> None:
    with connect(Config(max_image_tokens=1000)) as client:
        reply = client.call("screenshot")
    assert not reply.is_error, reply.text
    [capture] = desk.captures
    assert capture["max_tokens"] == 1000
    cmap = desk.last_cmap
    assert cmap is not None
    width, height = cmap.image_width, cmap.image_height
    assert width < 1280 and image_tokens(width, height) <= 1000
    assert reply.texts[0].strip() == shot_line(1, 2, width, height, NOTEPAD)


def test_screenshot_unknown_monitor_is_an_error(desk: FakeDesktop) -> None:
    with connect() as client:
        reply = client.call("screenshot", monitor=7)
    assert_error(reply)


# --------------------------------------------------------------------------------------------
# Image coordinates -> screen coordinates
# --------------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("tool", "args"),
    [
        ("click", {"x": 10, "y": 10}),
        ("move", {"x": 10, "y": 10}),
        ("drag", {"x0": 10, "y0": 10, "x1": 20, "y1": 20}),
        ("scroll", {"direction": "down", "x": 10, "y": 10}),
        ("zoom", {"x0": 10, "y0": 10, "x1": 20, "y1": 20}),
    ],
)
def test_image_coordinates_before_screenshot_are_refused(
    desk: FakeDesktop, tool: str, args: dict[str, Any]
) -> None:
    with connect() as client:
        client.call("elements")  # element ids do not give a coordinate mapping
        reply = client.call(tool, **args)
    assert_error(reply, "screenshot")
    assert desk.inputs == []
    assert desk.regions == []


@pytest.mark.parametrize("monitor", [1, 2])
def test_click_converts_image_coordinates_through_coordmap(desk: FakeDesktop, monitor: int) -> None:
    with connect() as client:
        client.call("screenshot", monitor=monitor)
        reply = client.call("click", x=100, y=100)
    assert_ok_line(reply)
    mon = desk.monitors[monitor - 1]
    sx, sy = desk.to_screen(100, 100)
    # scale 1.5 plus the monitor origin (allow either pixel-rounding convention)
    assert abs(sx - (mon.left + 150)) <= 1 and abs(sy - (mon.top + 150)) <= 1
    assert desk.inputs == [
        ("click", {"x": sx, "y": sy, "button": "left", "count": 1, "modifiers": []})
    ]
    _, sent = desk.inputs[0]
    assert type(sent["x"]) is int and type(sent["y"]) is int


def test_click_passes_button_count_and_modifiers(desk: FakeDesktop) -> None:
    with connect() as client:
        client.call("screenshot")
        reply = client.call(
            "click", x=200, y=300, button="right", clicks=2, modifiers=["ctrl", "shift"]
        )
    assert_ok_line(reply)
    sx, sy = desk.to_screen(200, 300)
    assert desk.inputs == [
        ("click", {"x": sx, "y": sy, "button": "right", "count": 2, "modifiers": ["ctrl", "shift"]})
    ]


def test_move_converts_image_coordinates(desk: FakeDesktop) -> None:
    with connect() as client:
        client.call("screenshot")
        reply = client.call("move", x=100, y=100)
    assert_ok_line(reply)
    sx, sy = desk.to_screen(100, 100)
    assert desk.inputs == [("move", {"x": sx, "y": sy})]


def test_drag_converts_both_endpoints(desk: FakeDesktop) -> None:
    with connect() as client:
        client.call("screenshot")
        reply = client.call("drag", x0=100, y0=100, x1=200, y1=300)
    assert_ok_line(reply)
    (sx0, sy0), (sx1, sy1) = desk.to_screen(100, 100), desk.to_screen(200, 300)
    assert abs(sx1 - 300) <= 1 and abs(sy1 - 450) <= 1
    assert desk.inputs == [("drag", {"x0": sx0, "y0": sy0, "x1": sx1, "y1": sy1, "button": "left"})]


def test_scroll_converts_image_coordinates(desk: FakeDesktop) -> None:
    with connect() as client:
        client.call("screenshot")
        reply = client.call("scroll", direction="down", amount=5, x=100, y=100)
    assert_ok_line(reply)
    sx, sy = desk.to_screen(100, 100)
    assert desk.inputs == [("scroll", {"x": sx, "y": sy, "direction": "down", "amount": 5})]


def test_scroll_without_point_uses_cursor_and_needs_no_screenshot(desk: FakeDesktop) -> None:
    with connect() as client:
        reply = client.call("scroll", direction="up")
    assert_ok_line(reply)
    assert desk.inputs == [("scroll", {"x": 960, "y": 540, "direction": "up", "amount": 3})]


def test_click_outside_last_screenshot_is_an_error(desk: FakeDesktop) -> None:
    with connect() as client:
        client.call("screenshot")
        reply = client.call("click", x=1280, y=100)  # image is 1280 wide: valid x is 0..1279
    assert_error(reply)
    assert desk.inputs == []


# --------------------------------------------------------------------------------------------
# click argument rules and element targets
# --------------------------------------------------------------------------------------------


def test_click_element_uses_element_center_in_screen_space(desk: FakeDesktop) -> None:
    with connect() as client:
        client.call("elements")
        reply = client.call("click", element=2)  # no screenshot needed for element targets
    assert_ok_line(reply)
    assert desk.inputs == [
        ("click", {"x": 750, "y": 600, "button": "left", "count": 1, "modifiers": []})
    ]


@pytest.mark.parametrize(
    "args",
    [
        {"x": 100, "y": 100, "element": 1},
        {},
        {"x": 100},
        {"y": 100},
        {"x": 100, "element": 1},
    ],
    ids=["both", "neither", "x-only", "y-only", "x-and-element"],
)
def test_click_needs_exactly_one_of_point_or_element(
    desk: FakeDesktop, args: dict[str, Any]
) -> None:
    with connect() as client:
        client.call("screenshot")
        client.call("elements")
        reply = client.call("click", **args)
    assert_error(reply)
    assert desk.inputs == []


def test_click_unknown_element_id_is_an_error(desk: FakeDesktop) -> None:
    with connect() as client:
        client.call("elements")
        reply = client.call("click", element=99)
    assert_error(reply)
    assert desk.inputs == []


def test_click_element_before_any_elements_call_is_an_error(desk: FakeDesktop) -> None:
    with connect() as client:
        client.call("screenshot")
        reply = client.call("click", element=1)
    assert_error(reply)
    assert desk.inputs == []


def test_element_ids_come_from_the_latest_elements_call(desk: FakeDesktop) -> None:
    with connect() as client:
        client.call("elements")  # [1] Save ... [4] Status
        listing = client.call("elements", query="file")  # [1] File name
        stale = client.call("click", element=2)
        fresh = client.call("click", element=1)
    assert listing.lines[1:] == ['[1] edit "File name" = "report.txt"']
    assert_error(stale)
    assert_ok_line(fresh)
    assert desk.inputs == [
        ("click", {"x": 750, "y": 600, "button": "left", "count": 1, "modifiers": []})
    ]


# --------------------------------------------------------------------------------------------
# elements / windows listings
# --------------------------------------------------------------------------------------------


def test_elements_listing_without_screenshot_has_no_positions(desk: FakeDesktop) -> None:
    with connect() as client:
        reply = client.call("elements")
    assert not reply.is_error, reply.text
    assert reply.images == []
    assert reply.lines == [
        'window: "Untitled - Notepad" (notepad.exe) — 4 elements',
        '[1] button "Save"',
        '[2] edit "File name" = "report.txt"',
        '[3] button "Delete" (disabled)',
        '[4] text "Status"',
    ]
    [query] = desk.element_queries
    assert query["handle"] in (None, NOTEPAD.handle)
    assert query["query"] is None


def test_elements_show_image_positions_only_on_screenshot_monitor(desk: FakeDesktop) -> None:
    with connect() as client:
        client.call("screenshot")
        reply = client.call("elements")
    cmap = desk.last_cmap
    assert reply.lines == [
        'window: "Untitled - Notepad" (notepad.exe) — 4 elements',
        *(element_line(e, cmap) for e in ELEMENTS),
    ]
    assert [line.count("@") for line in reply.lines[1:]] == [1, 1, 1, 0]
    # The fake mapping is scale 1.5 from the origin: centers land on exact image pixels.
    assert reply.lines[1].endswith('"Save" @300,200')
    assert reply.lines[2].endswith('"report.txt" @500,400')
    assert reply.lines[3].endswith("(disabled) @700,600")


def test_elements_positions_follow_the_last_screenshot_monitor(desk: FakeDesktop) -> None:
    with connect() as client:
        client.call("screenshot", monitor=2)
        reply = client.call("elements")
    cmap = desk.last_cmap
    assert reply.lines[1:] == [element_line(e, cmap) for e in ELEMENTS]
    assert [line.count("@") for line in reply.lines[1:]] == [0, 0, 0, 1]
    assert reply.lines[4] == '[4] text "Status" @640,140'


def test_elements_truncation_footer_when_limit_is_hit(desk: FakeDesktop) -> None:
    with connect(Config(max_elements=3)) as client:
        reply = client.call("elements")
    assert reply.lines == [
        'window: "Untitled - Notepad" (notepad.exe) — 3 elements',
        '[1] button "Save"',
        '[2] edit "File name" = "report.txt"',
        '[3] button "Delete" (disabled)',
        "… truncated at 3; use query to narrow",
    ]


def test_elements_no_footer_below_limit(desk: FakeDesktop) -> None:
    with connect() as client:
        reply = client.call("elements")
    assert "truncated" not in reply.text
    assert len(reply.lines) == 1 + len(ELEMENTS)


def test_elements_empty_listing_says_so(desk: FakeDesktop) -> None:
    desk.elements = []
    with connect() as client:
        reply = client.call("elements")
    assert not reply.is_error, reply.text
    assert reply.lines == [
        'window: "Untitled - Notepad" (notepad.exe) — 0 elements',
        "no accessible elements; use screenshot",
    ]


def test_elements_runtime_error_is_reported_without_traceback(desk: FakeDesktop) -> None:
    desk.elements_error = RuntimeError("window is minimized; call focus first")
    with connect() as client:
        reply = client.call("elements")
    assert_error(reply, "window is minimized; call focus first")
    assert "traceback" not in reply.text.lower()


def test_elements_passes_query_and_window(desk: FakeDesktop) -> None:
    with connect() as client:
        reply = client.call("elements", query="save", window=MAIL.handle)
    assert not reply.is_error, reply.text
    assert reply.lines[0].startswith('window: "Inbox - Mail" (olk.exe) — 1 element')
    assert reply.lines[1:] == ['[1] button "Save"']
    [query] = desk.element_queries
    assert query["handle"] == MAIL.handle
    assert query["query"] == "save"
    assert query["hidden"] is None  # no blocklist: the scan checks nothing extra


def test_windows_lists_one_line_per_window_with_flags(desk: FakeDesktop) -> None:
    with connect() as client:
        reply = client.call("windows")
    assert not reply.is_error, reply.text
    assert reply.images == []
    assert reply.lines == [
        '1001 | notepad.exe | "Untitled - Notepad" [foreground]',
        '1002 | olk.exe | "Inbox - Mail" [minimized]',
        '1003 | keepass.exe | "Passwords.kdbx - KeePass"',
        '1004 | windowsterminal.exe | "Windows PowerShell"',
    ]


# --------------------------------------------------------------------------------------------
# Text from other programs that UTF-8 cannot carry
# --------------------------------------------------------------------------------------------

# An unpaired UTF-16 surrogate: any app can put one in a window title or a UI Automation text.
# The SDK's stdio writer cannot encode it (tests/test_stdio.py shows the real transport); the
# in-memory client below does not encode at all, so these tests check that every reply text is
# valid UTF-8 and how the unit is shown (U+FFFD).
LONE = "\ud800"


def assert_utf8(reply: Reply) -> None:
    for text in reply.texts:
        text.encode("utf-8")  # strict, like the stdio transport


def test_unpaired_surrogates_in_window_texts_are_sent_as_replacement_chars(
    desk: FakeDesktop,
) -> None:
    odd = dataclasses.replace(NOTEPAD, title=f"Bad {LONE} title \udc80", process=f"odd{LONE}.exe")
    desk.windows = [odd, MAIL]
    with connect() as client:
        listed = client.call("windows")
        shot = client.call("screenshot")
        waited = client.call("wait", seconds=0.01)
    for reply in (listed, shot, waited):
        assert not reply.is_error, reply.text
        assert_utf8(reply)
    shown = '"Bad \ufffd title \ufffd" (odd\ufffd.exe)'
    assert listed.lines[0] == '1001 | odd\ufffd.exe | "Bad \ufffd title \ufffd" [foreground]'
    assert shot.texts[0].endswith(f"| foreground: {shown}")
    assert waited.text == f"ok | foreground: {shown}"


def test_unpaired_surrogates_in_element_texts_are_sent_as_replacement_chars(
    desk: FakeDesktop,
) -> None:
    desk.windows = [dataclasses.replace(NOTEPAD, title=f"Doc{LONE}")]
    desk.elements = [dataclasses.replace(ELEMENTS[1], name=f"Na{LONE}me", value="v\udfff")]
    with connect() as client:
        reply = client.call("elements")
    assert not reply.is_error, reply.text
    assert_utf8(reply)
    assert reply.lines == [
        'window: "Doc\ufffd" (notepad.exe) — 1 elements',
        '[1] edit "Na\ufffdme" = "v\ufffd"',
    ]


@pytest.mark.parametrize(
    ("error", "message"),
    [
        (safety.SafetyError(f"odd{LONE}.exe is blocked"), "odd\ufffd.exe is blocked"),
        (ValueError(f'No window "{LONE}"'), 'No window "\ufffd"'),
        (RuntimeError(f'Window 5 ("x{LONE}") is hidden'), 'Window 5 ("x\ufffd") is hidden'),
        (OSError(f"t{LONE}"), "wait failed: OSError: t\ufffd"),  # unexpected
    ],
)
def test_unpaired_surrogates_in_error_messages_are_sent_as_replacement_chars(
    monkeypatch: pytest.MonkeyPatch, error: Exception, message: str
) -> None:
    def wait(self: Any, seconds: float) -> str:
        raise error

    monkeypatch.setattr(server_mod._Session, "wait", wait)
    with connect() as client:
        reply = client.call("wait", seconds=1)
    assert_utf8(reply)
    assert reply.result == {
        "content": [{"type": "text", "text": f"Error executing tool wait: {message}"}],
        "isError": True,
    }


def test_text_utf8_can_carry_is_sent_unchanged(desk: FakeDesktop) -> None:
    """Only unpaired surrogates change: other text keeps every character (token frugality)."""
    title = "Belge çğış — 文字 😀 \ufffd \u200b é"
    desk.windows = [dataclasses.replace(NOTEPAD, title=title)]
    with connect() as client:
        reply = client.call("windows")
    assert reply.text == f'1001 | notepad.exe | "{title}" [foreground]'
    assert reply.text.encode("utf-8") == f'1001 | notepad.exe | "{title}" [foreground]'.encode()


def test_a_surrogate_pair_split_into_two_units_is_joined(desk: FakeDesktop) -> None:
    desk.windows = [dataclasses.replace(NOTEPAD, title="smile \ud83d\ude00")]
    with connect() as client:
        reply = client.call("windows")
    assert_utf8(reply)
    assert reply.text == '1001 | notepad.exe | "smile \U0001f600" [foreground]'


# --------------------------------------------------------------------------------------------
# Action replies, focus, type_text, key
# --------------------------------------------------------------------------------------------

ACTIONS: list[tuple[str, dict[str, Any]]] = [
    ("click", {"x": 100, "y": 100}),
    ("click", {"element": 1}),
    ("type_text", {"text": "hello"}),
    ("key", {"keys": "ctrl+s"}),
    ("scroll", {"direction": "down"}),
    ("scroll", {"direction": "down", "x": 100, "y": 100}),
    ("drag", {"x0": 100, "y0": 100, "x1": 200, "y1": 300}),
    ("move", {"x": 100, "y": 100}),
    ("focus", {"window": MAIL.handle}),
]
ACTION_IDS = [f"{tool}-{'-'.join(args)}" for tool, args in ACTIONS]


@pytest.mark.parametrize(
    ("tool", "args"), [*ACTIONS, ("wait", {"seconds": 0.01})], ids=[*ACTION_IDS, "wait"]
)
def test_action_tools_reply_with_one_ok_line_and_no_image(
    desk: FakeDesktop, tool: str, args: dict[str, Any]
) -> None:
    with connect() as client:
        client.call("screenshot")
        client.call("elements")
        reply = client.call(tool, **args)
    assert_ok_line(reply)


def test_type_text_sends_text(desk: FakeDesktop) -> None:
    with connect() as client:
        reply = client.call("type_text", text="Merhaba dünya ğüşıöçİ")
    assert_ok_line(reply)
    assert merged_text_inputs(desk) == [("type_text", {"text": "Merhaba dünya ğüşıöçİ"})]


def test_key_sends_spec_and_repeat(desk: FakeDesktop) -> None:
    with connect() as client:
        reply = client.call("key", keys="ctrl+s", repeat=2)
    assert_ok_line(reply)
    # The server may press the chords one call at a time (it re-checks safety between them), so
    # compare the chord sequence that reached press_keys, not the number of calls.
    assert [name for name, _ in desk.inputs] == ["press_keys"] * len(desk.inputs)
    pressed = [
        chord
        for _, args in desk.inputs
        for _ in range(args["repeat"])
        for chord in args["spec"].split()
    ]
    assert pressed == ["ctrl+s", "ctrl+s"]


def test_focus_focuses_the_window(desk: FakeDesktop) -> None:
    with connect() as client:
        reply = client.call("focus", window=MAIL.handle)
    assert_ok_line(reply)
    assert desk.focused == [MAIL.handle]
    assert desk.inputs == []


def test_focus_unknown_window_is_an_error(desk: FakeDesktop) -> None:
    with connect() as client:
        reply = client.call("focus", window=999999)
    assert_error(reply)
    assert desk.focused == []


# --------------------------------------------------------------------------------------------
# Safety: failsafe
# --------------------------------------------------------------------------------------------


@pytest.mark.parametrize(("tool", "args"), ACTIONS, ids=ACTION_IDS)
def test_failsafe_corner_refuses_every_action(
    desk: FakeDesktop, tool: str, args: dict[str, Any]
) -> None:
    with connect() as client:
        client.call("screenshot")
        client.call("elements")
        desk.cursor = (0, 0)  # the user, not the server, put the cursor there
        reply = client.call(tool, **args)
    assert_error(reply, "corner")
    assert desk.inputs == []
    assert desk.focused == []
    assert desk.raised() == ["check_failsafe"]


@pytest.mark.parametrize(
    "cursor",
    [(0, 0), (1919, 0), (0, 1079), (1919, 1079), (1, 1), (-1920, -300), (-1, 779)],
)
def test_failsafe_triggers_in_any_monitor_corner(
    desk: FakeDesktop, cursor: tuple[int, int]
) -> None:
    with connect() as client:
        client.call("screenshot")
        desk.cursor = cursor
        reply = client.call("click", x=100, y=100)
    assert_error(reply, "corner")
    assert desk.inputs == []


def test_failsafe_ignores_cursor_away_from_corners(desk: FakeDesktop) -> None:
    with connect() as client:
        client.call("screenshot")
        desk.cursor = (5, 5)  # outside the 2 px tolerance
        reply = client.call("click", x=100, y=100)
    assert_ok_line(reply)


def test_failsafe_disabled_by_config(desk: FakeDesktop) -> None:
    with connect(Config(failsafe=False)) as client:
        client.call("screenshot")
        desk.cursor = (0, 0)
        reply = client.call("click", x=100, y=100)
    assert_ok_line(reply)
    assert len(desk.inputs) == 1


def test_failsafe_ignores_corner_the_server_moved_to(desk: FakeDesktop) -> None:
    with connect() as client:
        client.call("screenshot")
        first = client.call("click", x=0, y=0)  # the agent itself clicks the top-left corner
        assert desk.cursor == (0, 0)
        second = client.call("click", x=100, y=100)
    assert_ok_line(first)
    assert_ok_line(second)
    assert [name for name, _ in desk.inputs] == ["click", "click"]


# --------------------------------------------------------------------------------------------
# Safety: blocked processes, terminals, password fields, and their order
# --------------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("tool", "args"),
    [
        ("click", {"x": KEEPASS_IMAGE_POINT[0], "y": KEEPASS_IMAGE_POINT[1]}),
        ("move", {"x": KEEPASS_IMAGE_POINT[0], "y": KEEPASS_IMAGE_POINT[1]}),
        ("scroll", {"direction": "down", "x": KEEPASS_IMAGE_POINT[0],
                    "y": KEEPASS_IMAGE_POINT[1]}),
    ],
)  # fmt: skip
def test_blocked_process_under_the_pointer_is_refused(
    desk: FakeDesktop, tool: str, args: dict[str, Any]
) -> None:
    with connect(Config(blocked_processes=("keepass.exe",))) as client:
        client.call("screenshot")
        reply = client.call(tool, **args)
    assert_error(reply, "keepass")
    assert desk.inputs == []
    assert desk.raised() == ["check_blocked"]
    # the window lookup used the converted SCREEN point, not the image point
    assert desk.to_screen(*KEEPASS_IMAGE_POINT) in desk.window_at_calls


def test_pointer_check_uses_window_under_point_not_foreground(desk: FakeDesktop) -> None:
    desk.foreground = KEEPASS.handle
    with connect(Config(blocked_processes=("keepass.exe",))) as client:
        client.call("screenshot")
        reply = client.call("click", x=100, y=100)  # screen (150,150) is over Notepad
    assert_ok_line(reply)
    assert len(desk.inputs) == 1


@pytest.mark.parametrize(
    ("tool", "args"), [("type_text", {"text": "secret"}), ("key", {"keys": "enter"})]
)
def test_blocked_foreground_process_refuses_keyboard_input(
    desk: FakeDesktop, tool: str, args: dict[str, Any]
) -> None:
    desk.foreground = KEEPASS.handle
    with connect(Config(blocked_processes=("KeePass",))) as client:
        reply = client.call(tool, **args)
    assert_error(reply, "keepass")
    assert desk.inputs == []
    assert desk.raised() == ["check_blocked"]


def test_focus_on_blocked_window_is_refused(desk: FakeDesktop) -> None:
    with connect(Config(blocked_processes=("keepass.exe",))) as client:
        reply = client.call("focus", window=KEEPASS.handle)
    assert_error(reply, "keepass")
    assert desk.focused == []
    assert desk.raised() == ["check_blocked"]


# A dialog of another process owned by KeePass (e.g. a file picker host): it stands for KeePass.
KEEPASS_DIALOG = dataclasses.replace(
    CONSOLE, handle=1010, title="Open Database - Passwords.kdbx", process="dialoghost.exe",
    pid=4010, class_name="#32770", related=(KEEPASS,),
)  # fmt: skip


@pytest.mark.parametrize(
    ("foreground", "window"),
    [(NOTEPAD.handle, KEEPASS.handle), (KEEPASS.handle, None), (NOTEPAD.handle, 1010)],
    ids=["by-handle", "foreground", "owned-dialog"],
)
def test_elements_of_a_blocked_app_are_refused(
    desk: FakeDesktop, foreground: int, window: int | None
) -> None:
    desk.windows = [*desk.windows, KEEPASS_DIALOG]
    desk.foreground = foreground
    with connect(Config(blocked_processes=("keepass.exe",))) as client:
        reply = client.call("elements", window=window)
    text = assert_error(reply, "keepass", "blocked")
    assert "passwords.kdbx" not in text
    assert desk.element_queries == []
    assert desk.raised() == ["check_blocked"]


def test_elements_of_other_apps_work_with_a_blocklist(desk: FakeDesktop) -> None:
    with connect(Config(blocked_processes=("keepass.exe",))) as client:
        reply = client.call("elements")
    assert not reply.is_error, reply.text
    assert reply.lines[0].startswith('window: "Untitled - Notepad" (notepad.exe)')
    assert [q["handle"] for q in desk.element_queries] == [NOTEPAD.handle]
    # The scan itself gets the blocklist too (blocked windows inside the tree, their titles).
    hidden = desk.element_queries[0]["hidden"]
    assert callable(hidden)
    assert hidden("KeePass.exe") and not hidden("notepad.exe")


def test_elements_without_foreground_window_is_refused_with_a_blocklist(
    desk: FakeDesktop,
) -> None:
    # list_elements(None) would read whichever window comes up next, unchecked
    desk.foreground = 0
    with connect(Config(blocked_processes=("keepass.exe",))) as client:
        reply = client.call("elements")
    assert_error(reply, "no foreground window", "window handle")
    assert desk.element_queries == []


def test_windows_hides_the_titles_of_blocked_apps(desk: FakeDesktop) -> None:
    desk.windows = [*desk.windows, KEEPASS_DIALOG]
    with connect(Config(blocked_processes=("keepass",))) as client:
        reply = client.call("windows")
    assert not reply.is_error, reply.text
    assert reply.lines == [
        '1001 | notepad.exe | "Untitled - Notepad" [foreground]',
        '1002 | olk.exe | "Inbox - Mail" [minimized]',
        "1003 | keepass.exe | (title hidden: blocked app)",
        '1004 | windowsterminal.exe | "Windows PowerShell"',
        "1010 | dialoghost.exe | (title hidden: blocked app)",
    ]


def test_result_lines_hide_a_blocked_foreground_title(desk: FakeDesktop) -> None:
    desk.foreground = KEEPASS.handle
    with connect(Config(blocked_processes=("keepass.exe",))) as client:
        shot = client.call("screenshot")
        click = client.call("click", x=100, y=100)  # over Notepad, allowed
    line = assert_ok_line(click)
    assert line.endswith("foreground: (title hidden: blocked app) (keepass.exe)"), line
    assert shot.texts[-1].endswith("foreground: (title hidden: blocked app) (keepass.exe)")
    assert "Passwords" not in line + shot.texts[-1]


KEYBOARD_ACTIONS = [("type_text", {"text": "dir"}), ("key", {"keys": "enter"})]


@pytest.mark.parametrize(("tool", "args"), KEYBOARD_ACTIONS)
@pytest.mark.parametrize("window", [TERMINAL, CONSOLE], ids=["windows-terminal", "console"])
def test_keyboard_input_into_terminal_is_refused(
    desk: FakeDesktop, tool: str, args: dict[str, Any], window: WindowInfo
) -> None:
    if window not in desk.windows:
        desk.windows.append(window)
    desk.foreground = window.handle
    with connect() as client:
        reply = client.call(tool, **args)
    assert_error(reply, "terminal")
    assert desk.inputs == []
    assert desk.raised() == ["check_keyboard_target"]


@pytest.mark.parametrize(("tool", "args"), KEYBOARD_ACTIONS)
def test_keyboard_input_into_the_agents_own_host_window_is_refused(
    desk: FakeDesktop, tool: str, args: dict[str, Any]
) -> None:
    # An editor is not a terminal by process or class; it is refused because it hosts the agent.
    desk.windows.append(EDITOR)
    desk.foreground = EDITOR.handle
    desk.ancestors = frozenset({7001, EDITOR.pid})
    with connect() as client:
        reply = client.call(tool, **args)
    assert_error(reply)
    assert desk.inputs == []
    assert desk.raised() == ["check_keyboard_target"]


@pytest.mark.parametrize(("tool", "args"), KEYBOARD_ACTIONS)
@pytest.mark.parametrize("window", [SHELL_FORM, EDITOR], ids=["form-owned-by-shell", "editor"])
def test_keyboard_input_into_ordinary_windows_is_allowed(
    desk: FakeDesktop, tool: str, args: dict[str, Any], window: WindowInfo
) -> None:
    # powershell.exe owning a WinForms window is not a terminal; an editor that does not host
    # the agent is just an app.
    desk.windows.append(window)
    desk.foreground = window.handle
    with connect() as client:
        reply = client.call(tool, **args)
    assert_ok_line(reply)
    assert len(merged_text_inputs(desk)) == 1


@pytest.mark.parametrize(("tool", "args"), KEYBOARD_ACTIONS)
@pytest.mark.parametrize("own_host", [False, True], ids=["terminal", "own-host"])
def test_keyboard_input_into_terminal_allowed_by_config(
    desk: FakeDesktop, tool: str, args: dict[str, Any], own_host: bool
) -> None:
    desk.foreground = TERMINAL.handle
    if own_host:
        desk.ancestors = frozenset({TERMINAL.pid})
    with connect(Config(allow_terminal_input=True)) as client:
        reply = client.call(tool, **args)
    assert_ok_line(reply)
    assert len(merged_text_inputs(desk)) == 1


def test_pointer_actions_allowed_while_terminal_is_foreground(desk: FakeDesktop) -> None:
    desk.foreground = TERMINAL.handle
    with connect() as client:
        client.call("screenshot")
        reply = client.call("click", x=100, y=100)
    assert_ok_line(reply)
    assert len(desk.inputs) == 1


def test_type_text_into_password_field_is_refused(desk: FakeDesktop) -> None:
    desk.password_focused = True
    with connect() as client:
        reply = client.call("type_text", text="hunter2")
    assert_error(reply, "password")
    assert desk.inputs == []
    assert desk.raised() == ["check_password_field"]


@pytest.mark.parametrize("keys", ["tab", "enter", "ctrl+a", "backspace"])
def test_navigation_and_shortcut_keys_into_password_field_are_allowed(
    desk: FakeDesktop, keys: str
) -> None:
    # Only navigation/editing keys and ctrl/alt/win shortcuts stay free in a password field;
    # printable chords are refused there (see test_klavye_guvenlik.py).
    desk.password_focused = True
    with connect() as client:
        reply = client.call("key", keys=keys)
    assert_ok_line(reply)
    assert desk.inputs == [("press_keys", {"spec": keys, "repeat": 1})]


def test_type_text_runs_checks_in_contract_order(desk: FakeDesktop) -> None:
    desk.password_focused = True  # makes the last check fire, so every check must have run
    with connect() as client:
        reply = client.call("type_text", text="x")
    assert reply.is_error
    assert desk.check_order() == list(SAFETY_CHECKS)
    assert desk.raised() == ["check_password_field"]


def test_key_runs_checks_in_contract_order(desk: FakeDesktop) -> None:
    with connect() as client:
        reply = client.call("key", keys="enter")
    assert_ok_line(reply)
    assert desk.check_order()[:3] == list(SAFETY_CHECKS[:3])


def test_pointer_action_runs_failsafe_then_blocked_and_no_keyboard_check(
    desk: FakeDesktop,
) -> None:
    with connect() as client:
        client.call("screenshot")
        desk.checks.clear()
        reply = client.call("click", x=100, y=100)
    assert_ok_line(reply)
    assert desk.check_order()[:2] == ["check_failsafe", "check_blocked"]
    assert "check_keyboard_target" not in desk.check_order()


def test_failsafe_wins_over_blocked_process(desk: FakeDesktop) -> None:
    desk.foreground = KEEPASS.handle
    desk.cursor = (0, 0)
    with connect(Config(blocked_processes=("keepass.exe",))) as client:
        reply = client.call("type_text", text="x")
    text = assert_error(reply, "corner")
    assert "keepass" not in text
    assert desk.raised() == ["check_failsafe"]


def test_blocked_process_wins_over_terminal_check(desk: FakeDesktop) -> None:
    desk.foreground = TERMINAL.handle
    with connect(Config(blocked_processes=("windowsterminal.exe",))) as client:
        reply = client.call("key", keys="enter")
    assert_error(reply)
    assert desk.raised() == ["check_blocked"]
    assert desk.inputs == []


def test_terminal_check_wins_over_password_check(desk: FakeDesktop) -> None:
    desk.foreground = TERMINAL.handle
    desk.password_focused = True
    with connect() as client:
        reply = client.call("type_text", text="x")
    assert_error(reply, "terminal")
    assert desk.raised() == ["check_keyboard_target"]
    assert desk.inputs == []


# --------------------------------------------------------------------------------------------
# zoom
# --------------------------------------------------------------------------------------------


def test_zoom_returns_image_and_line_and_keeps_coordinate_mapping(desk: FakeDesktop) -> None:
    with connect() as client:
        client.call("screenshot")
        shot_cmap = desk.last_cmap
        reply = client.call("zoom", x0=10, y0=20, x1=110, y1=70)
        click = client.call("click", x=100, y=100)
    assert not reply.is_error, reply.text
    assert len(reply.content) == 2
    assert len(reply.images) == 1 and len(reply.texts) == 1
    assert reply.images[0]["mimeType"] == "image/png"
    assert base64.b64decode(reply.images[0]["data"]) == encode_image(150, 75, "png", 80)
    assert reply.texts[0].strip() == (
        "zoom 150x75 of (10,20)-(110,70) ~18 tokens; click coordinates stay in screenshot space"
    )
    [region] = desk.regions
    assert region["cmap"] == shot_cmap
    assert (region["x0"], region["y0"], region["x1"], region["y1"]) == (10, 20, 110, 70)
    assert region["max_size"] == 1280
    assert region["image_format"] == "png"
    assert region["max_tokens"] == 1568
    # the mapping is still the screenshot's, not the zoomed region's
    assert_ok_line(click)
    assert shot_cmap is not None
    sx, sy = shot_cmap.to_screen(100, 100)
    assert desk.inputs == [
        ("click", {"x": sx, "y": sy, "button": "left", "count": 1, "modifiers": []})
    ]


def test_zoom_passes_config_token_cap(desk: FakeDesktop) -> None:
    with connect(Config(max_image_tokens=500)) as client:
        client.call("screenshot")
        reply = client.call("zoom", x0=0, y0=0, x1=600, y1=400)
    assert not reply.is_error, reply.text
    [region] = desk.regions
    assert region["max_tokens"] == 500
    assert desk.last_cmap is not None
    _, width, height = desk.capture_region(desk.last_cmap, 0, 0, 600, 400, 1280, max_tokens=500)
    assert image_tokens(width, height) <= 500
    assert reply.texts[0].strip() == (
        f"zoom {width}x{height} of (0,0)-(600,400) ~{image_tokens(width, height)} tokens;"
        " click coordinates stay in screenshot space"
    )


def test_zoom_outside_screenshot_is_an_error(desk: FakeDesktop) -> None:
    with connect() as client:
        client.call("screenshot")
        reply = client.call("zoom", x0=2000, y0=2000, x1=2100, y1=2100)
    assert_error(reply)


# --------------------------------------------------------------------------------------------
# wait
# --------------------------------------------------------------------------------------------


@pytest.mark.parametrize("seconds", [0, 11, -1])
def test_wait_rejects_out_of_range(
    desk: FakeDesktop, monkeypatch: pytest.MonkeyPatch, seconds: float
) -> None:
    slept: list[float] = []
    monkeypatch.setattr(time, "sleep", slept.append)
    with connect() as client:
        reply = client.call("wait", seconds=seconds)
    assert_error(reply)
    assert slept == []
    assert desk.inputs == []


def test_wait_accepts_small_value(desk: FakeDesktop, monkeypatch: pytest.MonkeyPatch) -> None:
    slept: list[float] = []
    monkeypatch.setattr(time, "sleep", slept.append)
    if hasattr(server_mod, "sleep"):
        monkeypatch.setattr(server_mod, "sleep", slept.append)
    start = time.monotonic()
    with connect() as client:
        reply = client.call("wait", seconds=0.05)
    elapsed = time.monotonic() - start
    assert_ok_line(reply)
    # either the (patched) blocking sleep was asked for 0.05 s, or an async sleep really waited
    assert sum(slept) == pytest.approx(0.05) or elapsed >= 0.045
    assert desk.inputs == []
