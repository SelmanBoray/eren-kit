"""The server over real stdio (its own process), with every desktop read faked.

The in-memory client of test_server.py hands Python objects across; only the stdio transport
encodes replies to UTF-8, so this is where text UTF-8 cannot carry would stop a reply. The child
process fakes uia.list_windows / foreground_window / list_elements and runs with --no-failsafe:
no window, cursor or input API of the real desktop is touched.
"""

from __future__ import annotations

import json
import os
import queue
import subprocess
import sys
import threading
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

SRC = Path(__file__).resolve().parents[1] / "src"
REPLY_TIMEOUT = 20.0  # a reply that has not come by then never will: the test fails, not hangs

# Run in the child. \ud800 stays an escape here and becomes an unpaired surrogate in the child.
CHILD = r"""
from computer_use_windows import server, uia

TITLE = "Bad \ud800 title"
WINDOW = uia.WindowInfo(
    handle=4242, title=TITLE, process="fake.exe", pid=1, left=0, top=0, right=10, bottom=10,
    foreground=True, minimized=False, class_name="Fake",
)


def unreadable(*args, **kwargs):
    raise RuntimeError(f'Window 4242 ("{TITLE}") cannot be read.')


uia.list_windows = lambda: [WINDOW]
uia.foreground_window = lambda: WINDOW
uia.list_elements = unreadable
server.main(["--no-failsafe"])
"""

pytestmark = pytest.mark.skipif(sys.platform != "win32", reason="the server runs on Windows only")


class StdioServer:
    def __init__(self, script: Path) -> None:
        env = dict(os.environ)
        env["PYTHONPATH"] = os.pathsep.join(filter(None, [str(SRC), env.get("PYTHONPATH")]))
        for name in [k for k in env if k.startswith("CUW_")]:
            del env[name]  # the user's blocklist etc. must not change the replies
        self.proc = subprocess.Popen(
            [sys.executable, str(script)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=env,
        )
        self.lines: queue.Queue[bytes] = queue.Queue()
        self.stderr: list[bytes] = []
        threading.Thread(target=self._read, daemon=True).start()
        threading.Thread(target=lambda: self.stderr.extend(self.proc.stderr), daemon=True).start()
        self.next_id = 1

    def _read(self) -> None:
        for raw in self.proc.stdout:
            self.lines.put(raw)
        self.lines.put(b"")  # EOF

    def send(self, message: dict[str, Any]) -> None:
        self.proc.stdin.write(json.dumps(message).encode() + b"\n")
        self.proc.stdin.flush()

    def request(self, method: str, params: dict[str, Any]) -> dict[str, Any]:
        """Send a request and return its reply; fail (not hang) when none comes in time."""
        rid = self.next_id
        self.next_id += 1
        self.send({"jsonrpc": "2.0", "id": rid, "method": method, "params": params})
        while True:
            try:
                raw = self.lines.get(timeout=REPLY_TIMEOUT)
            except queue.Empty:
                pytest.fail(f"no reply to {method} {params} within {REPLY_TIMEOUT:g} s")
            if not raw:
                log = b"".join(self.stderr).decode("utf-8", "replace")[-3000:]
                pytest.fail(f"the server closed stdout before replying to {method}:\n{log}")
            message = json.loads(raw.decode("utf-8"))  # strict: the wire must be valid UTF-8
            if message.get("id") == rid:
                return message

    def call(self, name: str, **arguments: Any) -> dict[str, Any]:
        reply = self.request("tools/call", {"name": name, "arguments": arguments})
        assert "result" in reply, reply
        return reply["result"]

    def close(self) -> None:
        try:
            self.proc.stdin.close()
            self.proc.wait(timeout=10)
        except (OSError, subprocess.TimeoutExpired):
            self.proc.kill()
            self.proc.wait(timeout=10)


@pytest.fixture
def stdio_server(tmp_path: Path) -> Iterator[StdioServer]:
    script = tmp_path / "child.py"
    script.write_text(CHILD, encoding="utf-8")
    server = StdioServer(script)
    try:
        server.request(
            "initialize",
            {
                "protocolVersion": "2025-06-18",
                "capabilities": {},
                "clientInfo": {"name": "test-stdio", "version": "0"},
            },
        )
        server.send({"jsonrpc": "2.0", "method": "notifications/initialized"})
        yield server
    finally:
        server.close()


def texts(result: dict[str, Any]) -> list[str]:
    return [c["text"] for c in result["content"] if c["type"] == "text"]


def test_unpaired_surrogate_from_a_window_title_does_not_stop_the_server(
    stdio_server: StdioServer,
) -> None:
    listed = stdio_server.call("windows")
    assert not listed.get("isError"), listed
    assert texts(listed) == ['4242 | fake.exe | "Bad \ufffd title" [foreground]']

    # An error message with that title, then another tool: the same process still answers.
    failed = stdio_server.call("elements")
    assert failed.get("isError") is True, failed
    message = 'Window 4242 ("Bad \ufffd title") cannot be read.'
    assert texts(failed) == [f"Error executing tool elements: {message}"]
    waited = stdio_server.call("wait", seconds=0.01)
    assert not waited.get("isError"), waited
    assert texts(waited) == ['ok | foreground: "Bad \ufffd title" (fake.exe)']
