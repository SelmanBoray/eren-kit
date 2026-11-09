"""Shared pytest fixtures.

The ``test_form`` fixture is intentionally independent of the code under test: it uses plain
ctypes/user32 calls only.
"""

from __future__ import annotations

import subprocess
import sys
import time
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

import pytest

FORM_SCRIPT = Path(__file__).parent / "fixtures" / "test_form.ps1"
FORM_TITLE = "CUW Test Form"
FORM_TIMEOUT = 15.0


@dataclass(frozen=True)
class TestForm:
    __test__ = False  # not a pytest test class

    hwnd: int
    pid: int
    title: str


def _find_window(pid: int, title: str) -> int | None:
    """Return the hwnd of a visible top-level window with this exact title owned by pid."""
    import ctypes
    from ctypes import wintypes

    user32 = ctypes.windll.user32  # type: ignore[attr-defined]
    found: list[int] = []
    proto = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

    def callback(hwnd: int, _lparam: int) -> bool:
        if not user32.IsWindowVisible(hwnd):
            return True
        owner = wintypes.DWORD(0)
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(owner))
        if owner.value != pid:
            return True
        length = user32.GetWindowTextLengthW(hwnd)
        buf = ctypes.create_unicode_buffer(length + 1)
        user32.GetWindowTextW(hwnd, buf, length + 1)
        if buf.value == title:
            found.append(int(hwnd))
            return False
        return True

    user32.EnumWindows(proto(callback), 0)
    return found[0] if found else None


@pytest.fixture
def test_form() -> Iterator[TestForm]:
    """Launch the WinForms test window; yield its hwnd/pid/title; kill it on teardown."""
    if sys.platform != "win32":
        pytest.skip("Windows only")
    proc = subprocess.Popen(
        [
            "powershell.exe",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-STA",
            "-File",
            str(FORM_SCRIPT),
        ],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    try:
        deadline = time.monotonic() + FORM_TIMEOUT
        hwnd: int | None = None
        while time.monotonic() < deadline:
            hwnd = _find_window(proc.pid, FORM_TITLE)
            if hwnd is not None or proc.poll() is not None:
                break
            time.sleep(0.1)
        if hwnd is None:
            hwnd = _find_window(proc.pid, FORM_TITLE)
        if hwnd is None:
            subprocess.run(
                ["taskkill", "/F", "/T", "/PID", str(proc.pid)], capture_output=True, check=False
            )
            _, err = proc.communicate(timeout=10)
            pytest.fail(
                f"Window {FORM_TITLE!r} did not appear within {FORM_TIMEOUT:.0f}s "
                f"(exit code {proc.returncode}). stderr:\n{err.decode(errors='replace')}"
            )
        yield TestForm(hwnd=hwnd, pid=proc.pid, title=FORM_TITLE)
    finally:
        if proc.poll() is None:
            subprocess.run(
                ["taskkill", "/F", "/T", "/PID", str(proc.pid)], capture_output=True, check=False
            )
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
        for stream in (proc.stdout, proc.stderr):
            if stream:
                stream.close()
