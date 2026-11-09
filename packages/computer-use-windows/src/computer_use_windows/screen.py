"""Screen geometry and capture: DPI awareness, monitors, screenshots, image <-> screen mapping.

Coordinate spaces:

- screen space: absolute PHYSICAL pixels on the Windows virtual desktop (negative for monitors
  left of / above the primary). Valid once :func:`ensure_dpi_awareness` has run; every function
  here that touches the screen calls it first, so the order of calls never matters.
- image space: pixel coordinates inside an image returned by :func:`capture`. A :class:`CoordMap`
  converts between the two.

Design notes:

- No side effects at import. ``ctypes.WinDLL``, ``mss`` and Pillow are only touched inside
  functions, so the pure helpers (:func:`fit_size`, :func:`estimate_image_tokens`,
  :class:`CoordMap`) work on any OS.
- Thread safety: every capture opens its own ``mss.MSS`` instance in the calling thread and closes
  it before returning (GDI DCs and the DIB section are released on close). Nothing GDI-related is
  cached between calls, so worker threads that come and go cannot leak handles.
- DPI: the process is made Per-Monitor-V2 aware through our own ``user32`` handle. ``mss`` calls
  ``shcore.SetProcessDpiAwareness(2)`` in every constructor; once our call has set the awareness,
  that call fails with E_ACCESSDENIED and changes nothing, so both agree on physical pixels.
"""

from __future__ import annotations

import ctypes
import functools
import io
import logging
import math
import sys
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from fractions import Fraction
from types import SimpleNamespace
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from PIL.Image import Image

__all__ = [
    "CoordMap",
    "MonitorInfo",
    "capture",
    "capture_region",
    "ensure_dpi_awareness",
    "estimate_image_tokens",
    "fit_size",
    "list_monitors",
]

log = logging.getLogger(__name__)

# --- Win32 constants -------------------------------------------------------------------------
_DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE = -3
_DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = -4
_PROCESS_PER_MONITOR_DPI_AWARE = 2
_ERROR_ACCESS_DENIED = 5
_E_ACCESSDENIED = -2147024891  # HRESULT 0x80070005 as a signed 32-bit value
_S_OK = 0
_AWARENESS_NAMES = {0: "unaware", 1: "system", 2: "per-monitor"}

# --- image constants -------------------------------------------------------------------------
# Anthropic vision cost: one visual token per started 28x28 px tile. Images above 1568 tokens
# (standard models) are downscaled by the API, and the model then answers in the DOWNSCALED
# image's coordinates, so every image we send must stay under the token cap.
_TOKEN_TILE_PX = 28
_DEFAULT_MAX_TOKENS = 1568
_FORMATS = {"png": "png", "jpeg": "jpeg", "jpg": "jpeg"}
_PNG_COMPRESS_LEVEL = 6
_HALF = Fraction(1, 2)
_CAPTURE_HINT = (
    "the desktop may be locked or a secure screen (UAC prompt, lock screen) is showing; "
    "ask the user to unlock or dismiss it, then retry"
)


# =============================================================================================
# Data types
# =============================================================================================


@dataclass(frozen=True)
class MonitorInfo:
    """One monitor in screen space (physical pixels). ``index`` is 1-based, in mss order."""

    index: int
    left: int
    top: int
    width: int
    height: int
    primary: bool


@dataclass(frozen=True)
class CoordMap:
    """Maps between the image space of one screenshot and screen space.

    The image is the whole ``monitor`` resized to ``image_width`` x ``image_height`` (independent
    scale per axis, exactly as the resize did it). An image pixel maps to the physical pixel
    nearest to the centre of its footprint; a screen pixel maps to the image pixel whose footprint
    contains its centre. For downscaled images (scale >= 1) the round trip
    ``to_image(*to_screen(x, y)) == (x, y)`` is exact for integer pixels.
    """

    monitor: MonitorInfo
    image_width: int
    image_height: int

    def __post_init__(self) -> None:
        if self.image_width < 1 or self.image_height < 1:
            raise ValueError(
                f"image size must be at least 1x1, got {self.image_width}x{self.image_height}"
            )
        if self.monitor.width < 1 or self.monitor.height < 1:
            raise ValueError(
                f"monitor size must be at least 1x1, got {self.monitor.width}x{self.monitor.height}"
            )

    @property
    def scale(self) -> float:
        """Physical pixels per image pixel (horizontal): ``monitor.width / image_width``."""
        return self.monitor.width / self.image_width

    def to_screen(self, x: float, y: float) -> tuple[int, int]:
        """Image space -> screen space. ValueError if (x, y) is outside the image."""
        w, h = self.image_width, self.image_height
        if not (0 <= x < w and 0 <= y < h):
            raise ValueError(
                f"point ({x:g}, {y:g}) is outside the screenshot (x 0..{w - 1}, y 0..{h - 1}); "
                "use coordinates from the last screenshot"
            )
        m = self.monitor
        return (
            m.left + _image_to_screen_pixel(x, m.width, w),
            m.top + _image_to_screen_pixel(y, m.height, h),
        )

    def to_image(self, x: int, y: int) -> tuple[int, int] | None:
        """Screen space -> image space, or None if the point is not on this monitor."""
        m = self.monitor
        dx, dy = x - m.left, y - m.top
        if not (0 <= dx < m.width and 0 <= dy < m.height):
            return None
        return (
            _screen_to_image_pixel(dx, m.width, self.image_width),
            _screen_to_image_pixel(dy, m.height, self.image_height),
        )


def _image_to_screen_pixel(value: float, screen_len: int, image_len: int) -> int:
    # Centre of image pixel `value` in continuous screen units, then the physical pixel whose
    # centre is nearest (ties go to the lower pixel, which keeps integer scales exact: 2x -> 2x).
    centre = (Fraction(value) + _HALF) * screen_len / image_len
    return min(screen_len - 1, max(0, math.ceil(centre - 1)))


def _screen_to_image_pixel(delta: float, screen_len: int, image_len: int) -> int:
    # Centre of physical pixel `delta` in continuous image units -> the image pixel containing it.
    centre = (Fraction(delta) + _HALF) * image_len / screen_len
    return min(image_len - 1, max(0, math.floor(centre)))


# =============================================================================================
# Pure helpers
# =============================================================================================


def fit_size(
    width: int, height: int, max_size: int, max_tokens: int = _DEFAULT_MAX_TOKENS
) -> tuple[int, int]:
    """Largest aspect-preserving size with long edge <= ``max_size`` and
    ``estimate_image_tokens <= max_tokens``; never upscales; each side >= 1."""
    if width < 1 or height < 1:
        raise ValueError(f"width and height must be >= 1, got {width}x{height}")
    if max_size < 1:
        raise ValueError(f"max_size must be >= 1, got {max_size}")
    if max_tokens < 1:
        raise ValueError(f"max_tokens must be >= 1, got {max_tokens}")

    def size_for(long_edge: int) -> tuple[int, int]:
        # long_edge == max(width, height) gives back exactly (width, height).
        if width >= height:
            return long_edge, max(1, _round_div(height * long_edge, width))
        return max(1, _round_div(width * long_edge, height)), long_edge

    long_edge = min(max(width, height), max_size)
    if estimate_image_tokens(*size_for(long_edge)) <= max_tokens:
        return size_for(long_edge)
    # Token count never decreases as the long edge grows, so binary-search the largest edge
    # that fits. Edge 1 is always (1, 1) = 1 token <= max_tokens.
    lo, hi = 1, long_edge - 1
    while lo < hi:
        mid = (lo + hi + 1) // 2
        if estimate_image_tokens(*size_for(mid)) <= max_tokens:
            lo = mid
        else:
            hi = mid - 1
    return size_for(lo)


def _round_div(numerator: int, denominator: int) -> int:
    """numerator / denominator rounded half up, exact for non-negative integers."""
    return (2 * numerator + denominator) // (2 * denominator)


def estimate_image_tokens(width: int, height: int) -> int:
    """Vision tokens for an image: ceil(width / 28) * ceil(height / 28)."""
    if width < 0 or height < 0:
        raise ValueError(f"width and height must be >= 0, got {width}x{height}")
    return -(-width // _TOKEN_TILE_PX) * -(-height // _TOKEN_TILE_PX)


def _check_encoding(image_format: str, jpeg_quality: int) -> str:
    fmt = _FORMATS.get(str(image_format).strip().lower())
    if fmt is None:
        raise ValueError(f"image_format must be 'png' or 'jpeg', got {image_format!r}")
    if (
        isinstance(jpeg_quality, bool)
        or not isinstance(jpeg_quality, int)
        or not 1 <= jpeg_quality <= 95
    ):
        raise ValueError(f"jpeg_quality must be an integer 1..95, got {jpeg_quality!r}")
    return fmt


def _check_limits(max_size: int, max_tokens: int) -> None:
    if isinstance(max_size, bool) or not isinstance(max_size, int) or max_size < 1:
        raise ValueError(f"max_size must be a positive integer, got {max_size!r}")
    if isinstance(max_tokens, bool) or not isinstance(max_tokens, int) or max_tokens < 1:
        raise ValueError(f"max_tokens must be a positive integer, got {max_tokens!r}")


def _primary_index(monitors: list[dict[str, Any]]) -> int:
    """1-based index of the primary monitor among mss per-monitor dicts (``monitors[1:]``).

    mss >= 10.2 reports ``is_primary`` from GetMonitorInfoW (MONITORINFOF_PRIMARY). Fallback:
    Windows always places the primary monitor's top-left corner at the virtual-desktop origin.
    """
    if not monitors:
        return 0
    for i, m in enumerate(monitors, 1):
        if m.get("is_primary"):
            return i
    for i, m in enumerate(monitors, 1):
        if m["left"] == 0 and m["top"] == 0:
            return i
    for i, m in enumerate(monitors, 1):
        if m["left"] <= 0 < m["left"] + m["width"] and m["top"] <= 0 < m["top"] + m["height"]:
            return i
    return 1


def _to_monitor_infos(raw: list[dict[str, Any]]) -> list[MonitorInfo]:
    """mss ``monitors`` list (index 0 = whole virtual desktop) -> MonitorInfo list."""
    per_monitor = list(raw[1:])
    primary = _primary_index(per_monitor)
    return [
        MonitorInfo(
            index=i,
            left=int(m["left"]),
            top=int(m["top"]),
            width=int(m["width"]),
            height=int(m["height"]),
            primary=(i == primary),
        )
        for i, m in enumerate(per_monitor, 1)
    ]


def _select_monitor(monitors: list[MonitorInfo], index: int | None) -> MonitorInfo:
    if not monitors:
        raise RuntimeError(
            "no monitors found; the session may be headless or disconnected (RDP minimized)"
        )
    if index is None:
        return next((m for m in monitors if m.primary), monitors[0])
    for m in monitors:
        if m.index == index:
            return m
    valid = ", ".join(str(m.index) for m in monitors)
    primary = next((m.index for m in monitors if m.primary), monitors[0].index)
    raise ValueError(
        f"monitor {index!r} does not exist; valid monitors: {valid} (primary {primary})"
    )


def _region_to_screen(
    cmap: CoordMap, x0: float, y0: float, x1: float, y1: float
) -> tuple[int, int, int, int]:
    """Image-space rectangle (two opposite corners) -> clamped screen rect (left, top, w, h)."""
    for v in (x0, y0, x1, y1):
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
            raise ValueError(f"region coordinates must be finite numbers, got {v!r}")
    lo_x, hi_x = sorted((x0, x1))
    lo_y, hi_y = sorted((y0, y1))
    if lo_x == hi_x or lo_y == hi_y:
        raise ValueError(
            f"region ({x0:g},{y0:g})-({x1:g},{y1:g}) is empty; "
            "give two opposite corners of a rectangle"
        )
    w, h = cmap.image_width, cmap.image_height
    lo_x, hi_x = max(lo_x, 0), min(hi_x, w)
    lo_y, hi_y = max(lo_y, 0), min(hi_y, h)
    if hi_x <= lo_x or hi_y <= lo_y:
        raise ValueError(
            f"region ({x0:g},{y0:g})-({x1:g},{y1:g}) is outside the screenshot "
            f"(0,0)-({w},{h}); use coordinates from the last screenshot"
        )
    m = cmap.monitor
    sx0, sx1 = _span(lo_x, hi_x, m.width, w)
    sy0, sy1 = _span(lo_y, hi_y, m.height, h)
    return m.left + sx0, m.top + sy0, sx1 - sx0, sy1 - sy0


def _span(lo: float, hi: float, screen_len: int, image_len: int) -> tuple[int, int]:
    """Continuous image interval [lo, hi) -> physical pixel interval, at least 1 px, in bounds."""

    def edge(v: float) -> int:
        return min(screen_len, max(0, math.floor(Fraction(v) * screen_len / image_len + _HALF)))

    start, end = edge(lo), edge(hi)
    if end <= start:  # sub-pixel region: take one physical pixel
        start = min(start, screen_len - 1)
        end = start + 1
    return start, end


# =============================================================================================
# DPI awareness
# =============================================================================================

_dpi_lock = threading.Lock()
_dpi_done = False


class _Point(ctypes.Structure):
    _fields_ = [("x", ctypes.c_int32), ("y", ctypes.c_int32)]


@functools.cache
def _win32() -> SimpleNamespace:
    """Private ctypes bindings on our own WinDLL objects, so argtypes never clash with
    other modules that use ``ctypes.windll``. Windows only; missing functions are None."""
    user32 = ctypes.WinDLL("user32", use_last_error=True)  # type: ignore[attr-defined]
    try:
        shcore = ctypes.WinDLL("shcore", use_last_error=True)  # type: ignore[attr-defined]
    except OSError:  # Windows < 8.1
        shcore = None

    def proc(dll: Any, name: str, argtypes: list[Any], restype: Any) -> Any:
        fn = getattr(dll, name, None) if dll is not None else None
        if fn is not None:
            fn.argtypes = argtypes
            fn.restype = restype
        return fn

    ssize, cint, i32 = ctypes.c_ssize_t, ctypes.c_int, ctypes.c_int32
    return SimpleNamespace(
        # DPI_AWARENESS_CONTEXT is a pointer-sized pseudo handle (-4 = Per-Monitor V2).
        set_process_context=proc(user32, "SetProcessDpiAwarenessContext", [ssize], cint),
        get_thread_context=proc(user32, "GetThreadDpiAwarenessContext", [], ssize),
        contexts_equal=proc(user32, "AreDpiAwarenessContextsEqual", [ssize, ssize], cint),
        awareness_of_context=proc(user32, "GetAwarenessFromDpiAwarenessContext", [ssize], cint),
        set_process_dpi_aware=proc(user32, "SetProcessDPIAware", [], cint),
        is_process_dpi_aware=proc(user32, "IsProcessDPIAware", [], cint),
        set_process_awareness=proc(shcore, "SetProcessDpiAwareness", [cint], i32),
        get_process_awareness=proc(
            shcore, "GetProcessDpiAwareness", [ctypes.c_void_p, ctypes.POINTER(cint)], i32
        ),
    )


def ensure_dpi_awareness() -> None:
    """Make the process Per-Monitor-DPI-aware (V2; fallbacks V1, then system-aware).

    Afterwards every Win32 coordinate in the process (mss capture, GetCursorPos/SendInput,
    window rects, UIA bounding rects) is in physical pixels. Idempotent, thread-safe, never
    raises; no-op on non-Windows. Awareness can only be set once per process, so this must run
    before anything else sets it (screen functions call it themselves before using mss).
    """
    global _dpi_done
    if _dpi_done:
        return
    with _dpi_lock:
        if _dpi_done:
            return
        _dpi_done = True
        if sys.platform != "win32":
            return
        try:
            how = _apply_dpi_awareness()
            state = _dpi_awareness_name()
        except Exception:  # must never raise: a failure only costs accuracy on scaled displays
            log.warning("could not set DPI awareness", exc_info=True)
            return
        if state.startswith("per-monitor"):
            log.debug("DPI awareness: %s (%s)", state, how)
        else:
            log.warning(
                "DPI awareness is %r (%s), not per-monitor: coordinates on scaled displays "
                "may be off",
                state,
                how,
            )


def _apply_dpi_awareness() -> str:
    """Try the awareness APIs newest-first; stop when one works or awareness is already fixed."""
    api = _win32()
    if api.set_process_context is not None:  # Windows 10 1607+
        for context in (
            _DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,  # 1703+
            _DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE,
        ):
            if api.set_process_context(context):
                return f"SetProcessDpiAwarenessContext({context}) ok"
            if ctypes.get_last_error() == _ERROR_ACCESS_DENIED:
                return "already set before this call (manifest or earlier API call)"
    if api.set_process_awareness is not None:  # Windows 8.1+
        hr = api.set_process_awareness(_PROCESS_PER_MONITOR_DPI_AWARE)
        if hr == _S_OK:
            return "SetProcessDpiAwareness(2) ok"
        if hr == _E_ACCESSDENIED:
            return "already set before this call (manifest or earlier API call)"
    if api.set_process_dpi_aware is not None and not (
        api.is_process_dpi_aware is not None and api.is_process_dpi_aware()
    ):
        if api.set_process_dpi_aware():
            return "SetProcessDPIAware() ok (system-aware only)"
    return "no DPI API succeeded"


def _dpi_awareness_name() -> str:
    """Current awareness of the calling thread/process, for logs and diagnostics:
    'per-monitor-v2', 'per-monitor', 'system', 'unaware', 'unknown' or 'n/a' (not Windows)."""
    if sys.platform != "win32":
        return "n/a"
    try:
        api = _win32()
        if api.get_thread_context is not None and api.awareness_of_context is not None:
            context = api.get_thread_context()
            if api.contexts_equal is not None and api.contexts_equal(
                context, _DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2
            ):
                return "per-monitor-v2"
            return _AWARENESS_NAMES.get(api.awareness_of_context(context), "unknown")
        if api.get_process_awareness is not None:
            value = ctypes.c_int(-1)
            if api.get_process_awareness(None, ctypes.byref(value)) == _S_OK:
                return _AWARENESS_NAMES.get(value.value, "unknown")
        if api.is_process_dpi_aware is not None:
            return "system" if api.is_process_dpi_aware() else "unaware"
    except Exception:  # diagnostics only
        log.debug("could not read DPI awareness", exc_info=True)
    return "unknown"


# =============================================================================================
# Capture
# =============================================================================================


@contextmanager
def _open_screen() -> Iterator[Any]:
    """A fresh mss instance for this call and this thread, always closed afterwards."""
    ensure_dpi_awareness()
    try:
        import mss
    except ImportError as exc:  # pragma: no cover - mss is a hard dependency
        raise RuntimeError(
            "Python package 'mss' is missing; reinstall computer-use-windows"
        ) from exc
    factory = getattr(mss, "MSS", None) or mss.mss  # mss.mss() is deprecated since 10.2
    try:
        sct = factory()
    except Exception as exc:
        raise RuntimeError(f"cannot open the screen for capture ({exc}); {_CAPTURE_HINT}") from exc
    try:
        yield sct
    finally:
        sct.close()


def _read_monitors(sct: Any) -> list[MonitorInfo]:
    try:
        raw = sct.monitors
    except Exception as exc:
        raise RuntimeError(f"cannot enumerate monitors ({exc}); {_CAPTURE_HINT}") from exc
    return _to_monitor_infos(raw)


def _grab(sct: Any, left: int, top: int, width: int, height: int) -> Image:
    from PIL import Image

    try:
        shot = sct.grab({"left": left, "top": top, "width": width, "height": height})
    except Exception as exc:
        raise RuntimeError(f"screen capture failed ({exc}); {_CAPTURE_HINT}") from exc
    return Image.frombytes("RGB", tuple(shot.size), shot.raw, "raw", "BGRX")


def _downscale(img: Image, max_size: int, max_tokens: int) -> Image:
    target = fit_size(img.width, img.height, max_size, max_tokens)
    if target == img.size:
        return img
    from PIL import Image

    # Lanczos keeps small UI text crisp; reducing_gap only kicks in for large factors (4K+).
    return img.resize(target, Image.Resampling.LANCZOS, reducing_gap=3.0)


def _encode(img: Image, fmt: str, jpeg_quality: int) -> bytes:
    buf = io.BytesIO()
    if fmt == "png":
        img.save(buf, format="PNG", compress_level=_PNG_COMPRESS_LEVEL)
    else:
        # 4:4:4 chroma: subsampling smears coloured UI text (links, red errors) at small sizes.
        img.save(buf, format="JPEG", quality=jpeg_quality, subsampling=0)
    return buf.getvalue()


def list_monitors() -> list[MonitorInfo]:
    """All monitors in screen space, 1-based in mss order, exactly one marked primary."""
    with _open_screen() as sct:
        return _read_monitors(sct)


def capture(
    monitor: int | None,
    max_size: int,
    image_format: str = "png",
    jpeg_quality: int = 80,
    max_tokens: int = _DEFAULT_MAX_TOKENS,
) -> tuple[bytes, CoordMap]:
    """Screenshot one monitor (None = primary), downscaled to the largest size with long edge
    <= max_size and estimated tokens <= max_tokens (see :func:`fit_size`).

    Returns the encoded image and the CoordMap for it. Unknown monitor index -> ValueError
    listing the valid ones; capture failures -> RuntimeError.
    """
    fmt = _check_encoding(image_format, jpeg_quality)
    _check_limits(max_size, max_tokens)
    if monitor is not None and (isinstance(monitor, bool) or not isinstance(monitor, int)):
        raise ValueError(f"monitor must be an integer index (1-based) or None, got {monitor!r}")
    with _open_screen() as sct:
        info = _select_monitor(_read_monitors(sct), monitor)
        img = _grab(sct, info.left, info.top, info.width, info.height)
    img = _downscale(img, max_size, max_tokens)
    return _encode(img, fmt, jpeg_quality), CoordMap(info, img.width, img.height)


def capture_region(
    cmap: CoordMap,
    x0: int,
    y0: int,
    x1: int,
    y1: int,
    max_size: int,
    image_format: str = "png",
    jpeg_quality: int = 80,
    max_tokens: int = _DEFAULT_MAX_TOKENS,
) -> tuple[bytes, int, int]:
    """Capture a region given in IMAGE space of ``cmap`` from the live screen at native resolution.

    Corners may come in any order; a region partly outside the image is clamped to it; an
    empty or fully outside region -> ValueError. Downscaled only if the long edge exceeds
    ``max_size`` or the token estimate exceeds ``max_tokens``. Returns (encoded image, width,
    height).
    """
    fmt = _check_encoding(image_format, jpeg_quality)
    _check_limits(max_size, max_tokens)
    left, top, width, height = _region_to_screen(cmap, x0, y0, x1, y1)
    with _open_screen() as sct:
        img = _grab(sct, left, top, width, height)
    img = _downscale(img, max_size, max_tokens)
    return _encode(img, fmt, jpeg_quality), img.width, img.height
