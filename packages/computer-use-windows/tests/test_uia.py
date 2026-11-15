"""Tests for computer_use_windows.uia (read-only unit tests + marked integration tests)."""

from __future__ import annotations

import subprocess
import sys
import time

import pytest

pytestmark = pytest.mark.skipif(sys.platform != "win32", reason="Windows only")

if sys.platform == "win32":
    from computer_use_windows import input as inp
    from computer_use_windows import uia


# --------------------------------------------------------------------------- unit


def test_import_has_no_side_effects() -> None:
    proc = subprocess.run(
        [sys.executable, "-c", "import computer_use_windows.uia"],
        check=False,
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert proc.returncode == 0, proc.stderr
    assert proc.stdout == ""


def test_list_windows_shape() -> None:
    wins = uia.list_windows()
    assert isinstance(wins, list)
    for w in wins:
        assert isinstance(w, uia.WindowInfo)
        assert w.title.strip() != ""
        assert isinstance(w.handle, int)
        assert w.process == w.process.lower()
        assert isinstance(w.class_name, str)
        assert w.class_name != ""
    assert sum(1 for w in wins if w.foreground) <= 1


def test_foreground_window_type() -> None:
    fg = uia.foreground_window()
    assert fg is None or isinstance(fg, uia.WindowInfo)


def test_window_at_foreground_center() -> None:
    fg = uia.foreground_window()
    if fg is None or fg.minimized:
        assert uia.window_at(0, 0) is None or isinstance(uia.window_at(0, 0), uia.WindowInfo)
        return
    cx = (fg.left + fg.right) // 2
    cy = (fg.top + fg.bottom) // 2
    found = uia.window_at(cx, cy)
    assert found is not None
    assert isinstance(found, uia.WindowInfo)


def test_ancestor_pids() -> None:
    import os

    pids = uia.ancestor_pids()
    assert isinstance(pids, frozenset)
    assert all(isinstance(p, int) for p in pids)
    assert os.getpid() not in pids
    assert uia.ancestor_pids() is pids  # cached
    # a pytest run always has a parent process
    assert len(pids) >= 1


@pytest.mark.parametrize("handle", [0, 0x7FFFFFF0])
def test_focus_window_invalid_handle(handle: int) -> None:
    with pytest.raises(ValueError):
        uia.focus_window(handle)


def test_element_center() -> None:
    el = uia.Element(
        id=1,
        role="button",
        name="x",
        left=10,
        top=20,
        right=50,
        bottom=60,
        enabled=True,
        value=None,
    )
    assert el.center == (30, 40)
    odd = uia.Element(
        id=2,
        role="button",
        name="y",
        left=-100,
        top=-50,
        right=-50,
        bottom=-10,
        enabled=False,
        value=None,
    )
    assert odd.center == (-75, -30)


# The wrapper module comtypes generates for UIAutomationCore (UIAutomationClient 1.0).
_UIA_WRAPPER = "_944DE083_8FB8_45CF_BCB7_C477ACB2F897_0_1_0"
_STDOLE_WRAPPER = "_00020430_0000_0000_C000_000000000046_0_2_0"  # a dependency it pulls in

_LOAD_UIA = """
import sys
from computer_use_windows import uia
module = uia._load_uia_module()
assert hasattr(module, "IUIAutomation"), module
print(sorted(name for name in sys.modules if name.startswith("comtypes.gen._944DE083")))
"""


def test_uia_wrapper_never_runs_files_from_the_temp_dir(tmp_path) -> None:
    """comtypes looks for an already generated wrapper before building one in memory. A module
    planted in the temp dir (also in the fixed folder older versions used) must not run.

    Loads the type library only: no input, no window, no screen capture.
    """
    import os

    temp = tmp_path / "temp"
    marker = tmp_path / "planted-module-ran"
    planted = f"import pathlib\npathlib.Path({str(marker)!r}).write_text('ran')\n"
    for folder in (temp, temp / "computer-use-windows" / "comtypes-gen"):
        folder.mkdir(parents=True, exist_ok=True)
        for name in (_UIA_WRAPPER, "UIAutomationClient", _STDOLE_WRAPPER, "stdole"):
            (folder / f"{name}.py").write_text(planted, encoding="utf-8")
    before = sorted(p.relative_to(temp) for p in temp.rglob("*"))
    env = {**os.environ, "TEMP": str(temp), "TMP": str(temp), "TMPDIR": str(temp)}
    proc = subprocess.run(
        [sys.executable, "-c", _LOAD_UIA],
        cwd=tmp_path,
        env=env,
        check=False,
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert not marker.exists(), "a module planted in the temp dir ran in the server process"
    assert proc.returncode == 0, proc.stderr
    # the planted name is the one comtypes looks up, so the test would catch an import
    assert f"comtypes.gen.{_UIA_WRAPPER}" in proc.stdout
    # and nothing was written there either (no generated files, no __pycache__)
    assert sorted(p.relative_to(temp) for p in temp.rglob("*")) == before


# ------------------------------------------------------------------- integration


def _find(elements: list, role: str, name: str):
    for el in elements:
        if el.role == role and el.name == name:
            return el
    return None


def _form_elements(form) -> list:
    return uia.list_elements(form.hwnd)


def _click(el) -> None:
    x, y = el.center
    inp.click(x, y)
    time.sleep(0.3)


@pytest.mark.integration
def test_form_in_list_windows(test_form) -> None:
    matches = [w for w in uia.list_windows() if w.title == "CUW Test Form"]
    assert matches
    assert matches[0].process == "powershell.exe"
    assert matches[0].class_name != ""
    assert matches[0].pid == test_form.pid


@pytest.mark.integration
def test_list_elements_contents(test_form) -> None:
    els = _form_elements(test_form)
    assert _find(els, "edit", "Input") is not None
    secret = _find(els, "edit", "Secret")
    assert secret is not None
    assert secret.value is None
    assert _find(els, "button", "Submit") is not None
    assert _find(els, "checkbox", "Agree") is not None
    result = [e for e in els if "waiting" in (e.name, e.value or "")]
    assert result


@pytest.mark.integration
def test_element_ids_and_order(test_form) -> None:
    els = _form_elements(test_form)
    assert [e.id for e in els] == list(range(1, len(els) + 1))
    keys = [(e.top, e.left) for e in els]
    assert keys == sorted(keys)


@pytest.mark.integration
def test_query_and_limit(test_form) -> None:
    sub = uia.list_elements(test_form.hwnd, query="sub")
    assert [e.name for e in sub] == ["Submit"]
    assert len(uia.list_elements(test_form.hwnd, limit=2)) == 2


@pytest.mark.integration
def test_list_elements_is_fast(test_form) -> None:
    start = time.monotonic()
    uia.list_elements(test_form.hwnd)
    assert time.monotonic() - start < 2.0


@pytest.mark.integration
def test_focus_window(test_form) -> None:
    uia.focus_window(test_form.hwnd)
    time.sleep(0.3)
    fg = uia.foreground_window()
    assert fg is not None
    assert fg.handle == test_form.hwnd


@pytest.mark.integration
def test_password_detection(test_form) -> None:
    uia.focus_window(test_form.hwnd)
    els = _form_elements(test_form)
    secret = _find(els, "edit", "Secret")
    plain = _find(els, "edit", "Input")
    assert secret is not None and plain is not None
    _click(secret)
    assert uia.focused_element_is_password() is True
    _click(plain)
    assert uia.focused_element_is_password() is False


@pytest.mark.integration
def test_type_and_submit(test_form) -> None:
    uia.focus_window(test_form.hwnd)
    els = _form_elements(test_form)
    plain = _find(els, "edit", "Input")
    submit = _find(els, "button", "Submit")
    assert plain is not None and submit is not None
    _click(plain)
    inp.type_text("merhaba")
    time.sleep(0.3)
    _click(submit)
    deadline = time.monotonic() + 3.0
    texts: list[str] = []
    while time.monotonic() < deadline:
        texts = [e.value or e.name for e in _form_elements(test_form)]
        if any(t == "got:merhaba" for t in texts):
            break
        time.sleep(0.3)
    assert "got:merhaba" in texts
