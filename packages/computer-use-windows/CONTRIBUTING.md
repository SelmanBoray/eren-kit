# Contributing to computer-use-windows

Thanks for helping. This is a small MCP server that gives terminal coding agents screenshots, UI Automation element lists, mouse and keyboard on Windows. See the [README](README.md) for what it does and how to install it. This file is about changing it. This package is part of the eren-kit monorepo; general contribution rules (branches, commits, pull requests) are in the [root CONTRIBUTING.md](../../CONTRIBUTING.md).

By contributing you agree that your work is released under the project's [MIT license](LICENSE).

## Dev setup (Windows 10/11, Python 3.11+)

```powershell
git clone https://github.com/SelmanBoray/eren-kit.git
cd eren-kit\packages\computer-use-windows
py -3.12 -m venv .venv          # or: uv venv
.venv\Scripts\python -m pip install -e ".[dev]"
```

Run everything through the venv's Python, for example `.venv\Scripts\python -m pytest`.

## Checks

```powershell
.venv\Scripts\python -m ruff check .
.venv\Scripts\python -m ruff format .
.venv\Scripts\python -m pytest
.venv\Scripts\python -m pytest -m integration
```

- `pytest` runs the unit tests only. They never move your mouse, send keystrokes or open windows. Read-only screen capture and read-only UI Automation queries are allowed.
- `pytest -m integration` opens a small WinForms test window ("CUW Test Form") and takes over the mouse and keyboard for a few seconds. **Do not touch the PC while it runs.** Integration tests may send input to that window only.
- Ruff settings (line length 100, Python 3.11 target) live in `pyproject.toml`.

New behavior needs a unit test. Put anything that needs real input into an `integration` test.

## Project layout

All code is in `src/computer_use_windows/`:

- `config.py` - CLI flags and `CUW_*` environment variables into a frozen `Config`.
- `screen.py` - DPI awareness, monitors, screenshots, zoom crops, and the image-to-screen coordinate map.
- `input.py` - mouse, keyboard and text injection through `SendInput` (ctypes), plus key-name parsing.
- `uia.py` - windows list, focus, and UI Automation element listing (comtypes).
- `safety.py` - failsafe corner, process blocklist, terminal and password-field refusals.
- `instructions.py` - the server instructions and tool descriptions that clients send to the model.
- `server.py` - the MCP server (`MCPServer` in mcp 2.x, `FastMCP` in mcp 1.x): registers the tools and wires the modules together.

Tests are in `tests/`; the WinForms fixture is `tests/fixtures/test_form.ps1`. `tests/mcp_client.py` is the in-memory MCP client the tool-level tests use; it returns replies in wire form, the same on mcp 1.x and 2.x. `tests/fixtures/tool_schemas.json` is the tools' input schemas and annotations as clients receive them: update it only on purpose, when a tool's parameters change.

## mcp 1.x and 2.x

The package supports `mcp>=1.30.0,<3`. A new install gets 2.x; an existing venv keeps its 1.x until it is upgraded. Both must send the same tool list, instructions and result content (key order on the wire may differ), so run the tests against both before a change to `server.py`:

```powershell
py -3.12 -m venv .venv-mcp1
.venv-mcp1\Scripts\python -m pip install -e ".[dev]" "mcp==1.30.0"
.venv-mcp1\Scripts\python -m pytest
```

The version-specific code in `server.py` is small: the import of the server class, `Image` and `ToolError`, and how `serverInfo.version` is set (a constructor argument in 2.x). Tool errors are raised as the SDK's `ToolError`: mcp 2.x replaces the text of any other exception with "Error executing tool <name>", and the agent would no longer see why a tool refused.

## Code rules

These are strict because the server runs inside other people's agent sessions.

- **Never write to stdout.** It carries the MCP protocol. No `print()`; use `logging` (configured to stderr).
- **No import-time side effects.** No DPI changes, COM init or Windows API calls when a module is imported. Modules must import on non-Windows (access `ctypes.windll` lazily inside functions) so pure logic stays testable anywhere.
- **No new runtime dependencies without an issue first.** Runtime deps are `mcp`, `mss`, `Pillow` and `comtypes`. Input uses ctypes and `SendInput`. Dev deps are `pytest` and `ruff`.
- **No telemetry, no network calls**, and no files written outside the system temp dir.
- **Error messages are written for AI agents:** short, concrete, and they say what to do next. Convention: `ValueError` for bad input, `RuntimeError` when a Windows call fails, `safety.SafetyError` for a policy refusal.
- **Keep server instructions and tool descriptions short.** They are sent to every user's model every session, so each character costs everyone tokens. Current limits: 900 characters for the instructions, 450 per tool description. Actions return one short text line and never attach images.
- Type hints everywhere, and `from __future__ import annotations` at the top of each module.
- `server.py` imports sibling modules as modules (`from . import screen, uia, safety`, `from . import input as inp`) and calls them by attribute, so tests can monkeypatch them. Don't switch to `from .input import click`.
- Keep the project terminal-first: no shell, file, registry or process-launch tools. The agent's own shell does that. These tools are for GUI-only work.

## Ideas for good first contributions

These are ideas, not promises or a roadmap; open an issue to discuss before starting anything large.

- A design discussion for a Linux backend (what would the module boundaries look like?). Discussion first, no code yet.
- More key names in `input.py`, with tests.
- Better element filtering for specific apps (browsers, Explorer, Electron apps), so `elements` returns fewer, more useful lines.
- Docs and examples for other MCP clients.
- Reproducible bug reports with a minimal test case.

## Pull request checklist

- [ ] `ruff check .` and `ruff format .` are clean.
- [ ] `pytest` passes; new behavior has tests. Integration tests were run if you touched input or UIA. If you touched `server.py`, it also passes with `mcp==1.30.0`.
- [ ] Nothing writes to stdout; no import-time side effects.
- [ ] No new runtime dependency (or an issue approved it).
- [ ] Error messages are short and tell the agent what to do.
- [ ] Any change to instructions or tool descriptions stays within the length limits and is justified in the PR.
- [ ] README or CHANGELOG updated if behavior or flags changed.
- [ ] The PR is focused: one change, with a description of what and why.

## AI-assisted contributions

Welcome. Please say so in the PR description. You must understand the change and be able to explain and defend it in review; PRs the author can't discuss will be closed.

## Reporting issues

Please include:

- Windows version (for example, Windows 11 23H2) and Python version.
- Display scaling per monitor (100%, 125%, ...), the monitor layout (how many, resolutions, which is primary, any left of or above the primary), and whether they mix scaling.
- The MCP client and version (Claude Code, Codex CLI, Gemini CLI, ...) and how you registered the server.
- What the agent asked for, what happened, and any stderr log output.
- For wrong clicks: the `screenshot` header line (monitor, size, scale) and the target app.

Do not post screenshots that contain private information.
