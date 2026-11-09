"""Tests for computer_use_windows.screen (pure helpers + read-only Windows capture)."""

from __future__ import annotations

import io
import sys

import pytest
from PIL import Image

from computer_use_windows import screen
from computer_use_windows.screen import CoordMap, MonitorInfo

windows_only = pytest.mark.skipif(sys.platform != "win32", reason="Windows only")


# ---------------------------------------------------------------- fit_size


def test_fit_size_landscape() -> None:
    assert screen.fit_size(1920, 1080, 1280) == (1280, 720)


def test_fit_size_portrait() -> None:
    w, h = screen.fit_size(1080, 1920, 1280)
    assert (w, h) == (720, 1280)


def test_fit_size_never_upscales() -> None:
    assert screen.fit_size(800, 600, 1280) == (800, 600)


def test_fit_size_exact_max() -> None:
    assert screen.fit_size(1280, 720, 1280) == (1280, 720)


def test_fit_size_extreme_aspect_min_side_one() -> None:
    w, h = screen.fit_size(10000, 2, 1280)
    assert w <= 1280
    assert w >= 1 and h >= 1
    w, h = screen.fit_size(2, 10000, 1280)
    assert h <= 1280
    assert w >= 1 and h >= 1


# ------------------------------------------------------ estimate_image_tokens


def test_estimate_tokens_720p() -> None:
    assert screen.estimate_image_tokens(1280, 720) == 1196


def test_estimate_tokens_1080p() -> None:
    assert screen.estimate_image_tokens(1920, 1080) == 2691


def test_estimate_tokens_ceil() -> None:
    assert screen.estimate_image_tokens(28, 28) == 1
    assert screen.estimate_image_tokens(29, 28) == 2
    assert screen.estimate_image_tokens(1, 1) == 1
    assert screen.estimate_image_tokens(1280, 1024) == 1702


# ------------------------------------------------------ fit_size with token cap


def _check_fit(w: int, h: int, max_size: int, max_tokens: int) -> tuple[int, int]:
    ow, oh = screen.fit_size(w, h, max_size, max_tokens)
    assert 1 <= ow <= w and 1 <= oh <= h
    assert max(ow, oh) <= max_size
    assert screen.estimate_image_tokens(ow, oh) <= max_tokens
    assert abs(ow / oh - w / h) <= max(1 / oh, 1 / ow) * (w / h + 1)
    return ow, oh


def test_fit_size_token_cap_default_1280x1024() -> None:
    ow, oh = _check_fit(1280, 1024, 1280, 1568)
    assert (ow, oh) != (1280, 1024)
    assert ow < 1280 and oh < 1024
    # largest within ~1 px: growing either side by 2 px must break a cap
    assert screen.estimate_image_tokens(ow + 2, round((ow + 2) * 1024 / 1280)) > 1568


def test_fit_size_1080p_at_1280() -> None:
    assert screen.fit_size(1920, 1080, 1280) == (1280, 720)


def test_fit_size_square_unchanged() -> None:
    assert screen.estimate_image_tokens(1000, 1000) == 1296
    assert screen.fit_size(1000, 1000, 1280) == (1000, 1000)


def test_fit_size_high_res_tier() -> None:
    assert screen.fit_size(1920, 1080, 2576, 4784) == (1920, 1080)


def test_fit_size_token_cap_binds_before_size_cap() -> None:
    ow, oh = _check_fit(3840, 2160, 4000, 1568)
    assert max(ow, oh) < 4000


@pytest.mark.parametrize(
    ("w", "h", "ms", "mt"),
    [
        (1920, 1080, 1280, 1568),
        (1080, 1920, 1280, 1568),
        (5120, 1440, 2576, 4784),
        (300, 200, 1280, 1568),
        (10000, 3, 1280, 1568),
    ],
)
def test_fit_size_both_caps(w: int, h: int, ms: int, mt: int) -> None:
    ow, oh = screen.fit_size(w, h, ms, mt)
    assert 1 <= ow <= w and 1 <= oh <= h
    assert max(ow, oh) <= ms
    assert screen.estimate_image_tokens(ow, oh) <= mt


# ---------------------------------------------------------------- CoordMap

PRIMARY = MonitorInfo(index=1, left=0, top=0, width=1920, height=1080, primary=True)
LEFT = MonitorInfo(index=2, left=-1920, top=-100, width=1920, height=1080, primary=False)


def test_scale() -> None:
    assert CoordMap(PRIMARY, 1280, 720).scale == pytest.approx(1.5)
    assert CoordMap(PRIMARY, 1920, 1080).scale == pytest.approx(1.0)


def test_to_screen_primary() -> None:
    cmap = CoordMap(PRIMARY, 1280, 720)
    assert cmap.to_screen(0, 0) == (0, 0)
    x, y = cmap.to_screen(640, 360)
    assert abs(x - 960) <= 1 and abs(y - 540) <= 1


def test_to_screen_negative_origin() -> None:
    cmap = CoordMap(LEFT, 1280, 720)
    x, y = cmap.to_screen(0, 0)
    assert (x, y) == (-1920, -100)
    x, y = cmap.to_screen(640, 360)
    assert abs(x - (-960)) <= 1 and abs(y - 440) <= 1
    assert x < 0


@pytest.mark.parametrize("monitor", [PRIMARY, LEFT])
def test_round_trip(monitor: MonitorInfo) -> None:
    cmap = CoordMap(monitor, 1280, 720)
    for ix, iy in [(0, 0), (1, 1), (100, 200), (640, 360), (1279, 719)]:
        sx, sy = cmap.to_screen(ix, iy)
        back = cmap.to_image(sx, sy)
        assert back is not None
        assert abs(back[0] - ix) <= 1 and abs(back[1] - iy) <= 1


@pytest.mark.parametrize("pt", [(-1, 0), (0, -1), (1280, 0), (0, 720), (5000, 5000)])
def test_to_screen_out_of_bounds(pt: tuple[int, int]) -> None:
    with pytest.raises(ValueError):
        CoordMap(PRIMARY, 1280, 720).to_screen(*pt)


def test_to_image_other_monitor_is_none() -> None:
    assert CoordMap(PRIMARY, 1280, 720).to_image(-500, 500) is None
    assert CoordMap(LEFT, 1280, 720).to_image(500, 500) is None
    assert CoordMap(PRIMARY, 1280, 720).to_image(1920, 0) is None
    assert CoordMap(PRIMARY, 1280, 720).to_image(0, 1080) is None


# ------------------------------------------------------- Windows read-only


@windows_only
def test_ensure_dpi_awareness_twice() -> None:
    screen.ensure_dpi_awareness()
    screen.ensure_dpi_awareness()


@windows_only
def test_list_monitors() -> None:
    screen.ensure_dpi_awareness()
    mons = screen.list_monitors()
    assert mons
    assert [m.index for m in mons] == list(range(1, len(mons) + 1))
    assert sum(1 for m in mons if m.primary) == 1
    assert all(m.width > 0 and m.height > 0 for m in mons)


@windows_only
def test_capture_default_png() -> None:
    screen.ensure_dpi_awareness()
    data, cmap = screen.capture(None, 1280)
    img = Image.open(io.BytesIO(data))
    assert img.format == "PNG"
    assert img.size == (cmap.image_width, cmap.image_height)
    assert max(img.size) <= 1280
    assert cmap.monitor.primary


@windows_only
def test_capture_jpeg() -> None:
    screen.ensure_dpi_awareness()
    data, cmap = screen.capture(None, 800, "jpeg", 70)
    img = Image.open(io.BytesIO(data))
    assert img.format == "JPEG"
    assert img.size == (cmap.image_width, cmap.image_height)
    assert max(img.size) <= 800


@windows_only
def test_capture_invalid_monitor() -> None:
    screen.ensure_dpi_awareness()
    with pytest.raises(ValueError):
        screen.capture(999, 1280)


@windows_only
def test_capture_region_native_resolution() -> None:
    screen.ensure_dpi_awareness()
    _, cmap = screen.capture(None, 1280)
    data, w, h = screen.capture_region(cmap, 0, 0, 100, 50, 1280)
    img = Image.open(io.BytesIO(data))
    assert img.size == (w, h)
    assert abs(w - round(100 * cmap.scale)) <= 3
    assert abs(h - round(50 * cmap.scale)) <= 3


@windows_only
def test_capture_region_corners_any_order() -> None:
    screen.ensure_dpi_awareness()
    _, cmap = screen.capture(None, 1280)
    _, w1, h1 = screen.capture_region(cmap, 0, 0, 100, 50, 1280)
    _, w2, h2 = screen.capture_region(cmap, 100, 50, 0, 0, 1280)
    assert (w1, h1) == (w2, h2)


@windows_only
def test_capture_region_fully_outside() -> None:
    screen.ensure_dpi_awareness()
    _, cmap = screen.capture(None, 1280)
    with pytest.raises(ValueError):
        screen.capture_region(cmap, cmap.image_width + 10, 0, cmap.image_width + 60, 50, 1280)


@windows_only
def test_capture_respects_max_tokens() -> None:
    screen.ensure_dpi_awareness()
    data, cmap = screen.capture(None, 2576, "png", 80, 600)
    img = Image.open(io.BytesIO(data))
    assert img.size == (cmap.image_width, cmap.image_height)
    assert screen.estimate_image_tokens(*img.size) <= 600


@windows_only
def test_capture_default_token_cap() -> None:
    screen.ensure_dpi_awareness()
    data, _ = screen.capture(None, 2576)
    assert screen.estimate_image_tokens(*Image.open(io.BytesIO(data)).size) <= 1568


@windows_only
def test_capture_region_respects_max_tokens() -> None:
    screen.ensure_dpi_awareness()
    _, cmap = screen.capture(None, 1280)
    data, w, h = screen.capture_region(
        cmap, 0, 0, cmap.image_width, cmap.image_height, 4000, "png", 80, 500
    )
    assert Image.open(io.BytesIO(data)).size == (w, h)
    assert screen.estimate_image_tokens(w, h) <= 500
