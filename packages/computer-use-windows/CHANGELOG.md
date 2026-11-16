# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security

- `type_text` re-checks the password-field / terminal / blocked-app rules after its first
  character, after every Tab/Enter and every 50 characters, and re-checks the new window when the
  foreground window changes (stopping after an Enter).
- `key` refuses character-producing chords while a password field has the focus and checks before
  every chord.
- An undeterminable password state (UI Automation timeout) now refuses typing instead of allowing it.
- The emergency stop is checked throughout long input.
- Right/middle clicks and drags onto a terminal or the agent's own window are refused.
- Blocked-app checks look at the root and root-owner window, also for handles that are not in the
  window list.
- Keyboard input is refused while there is no foreground window.
- The UI Automation wrapper is no longer looked up on disk. A `.py` file placed in the fixed
  `%TEMP%\computer-use-windows\comtypes-gen` folder (or in the temp dir) used to run in the server
  on the first `elements` call. The folder is no longer created; an old one can be deleted.
- The blocklist now covers reading too: `elements` is refused for a blocked app's windows (and,
  with a blocklist, when there is no foreground window), and `windows` and result lines show
  `(title hidden: blocked app)` instead of its window titles. Screenshots are still not filtered.
- With a blocklist, `elements` no longer reads a blocked app through another window: the desktop
  window (whose tree holds every top-level window) is refused, windows of blocked apps inside the
  listed tree (top-level or embedded) are skipped, and element texts that contain the title of a
  blocked app's window (taskbar buttons, Alt-Tab, Task Manager) read `(text hidden: blocked app)`,
  also for `query`. The title match is textual: a shortened or reworded title is not caught.
- With a blocklist, `focus` and `elements` accept a window handle only in the form Windows reports
  it. Windows reads only the low 32 bits of a handle and treats `0xFFFF` in their high word as a
  wildcard, so another number for the desktop window got past the desktop refusal, and a wildcard
  number for a blocked app's window embedded in another app got past the blocklist (Windows does
  not tell that number's process). A window whose process Windows does not tell is no longer read
  inside a listing. Without a blocklist nothing changes.

### Changed

- Minimum supported Python is now 3.11 (Pillow 13 requires Python 3.11+).
- `key` is limited to 200 key presses per call.
- `--max-size` upper limit is 2576 (was 4096).
- `elements` reports an incomplete scan.
- Launchers such as Explorer no longer count as the agent's own window.
- Works with the MCP Python SDK 2.x as well as 1.x: the dependency is now `mcp>=1.30.0,<3`
  (was `<2`). A new install gets 2.x; an existing venv keeps its 1.x. Tool names, descriptions,
  input schemas, server instructions and reply content are the same on both (2.x may order JSON
  keys differently and omits the empty `capabilities.experimental` of 1.x) (`serverInfo.version` stays
  the package version; tool errors keep their message, which 2.x would otherwise replace with
  "Error executing tool <name>").

### Fixed

- `focus` no longer blocks the server on a window that is not responding.
- `click(element=…)` no longer clicks a stale position after the window closed, moved or was
  covered by another main window.
- Exactly `limit` elements are no longer reported as truncated.
- Reading labels from an unresponsive app no longer exceeds the scan time budget.

## [0.1.0] - Unreleased

### Added

- Initial release: an MCP server (stdio transport) that gives terminal coding agents
  (Claude Code, Codex CLI, Gemini CLI, and others) computer use on Windows 10/11.
  Requires Python 3.11+.
- Twelve tools, grouped by purpose:
  - Seeing: `screenshot`, `zoom`, `elements`, `windows`.
  - Acting with the mouse: `click` (left/right/middle, multi-click, modifier keys), `scroll`,
    `drag`, `move`.
  - Acting with the keyboard: `type_text` (layout-independent Unicode, including Turkish
    characters and emoji) and `key` (chords such as `ctrl+s`, sequences, repeat).
  - Window and timing control: `focus`, `wait`.
- Token savers:
  - Screenshots are downscaled to a 1280 px long edge by default, and each reply reports the
    estimated token cost.
  - `zoom` returns detail from a region of the live screen at native resolution without a
    full-resolution screenshot.
  - `elements` lists UI Automation elements as cheap text, with optional query filtering and a
    result cap, as an alternative to screenshots.
  - Action tools never attach screenshots; they return one short text line.
  - Images are capped by both a long edge and a visual-token budget
    (`--max-image-tokens` / `CUW_MAX_IMAGE_TOKENS`, default 1568, safe for every Claude model),
    so the API never re-scales them and click coordinates stay exact. Token counts use
    `ceil(w/28) * ceil(h/28)`.
- Terminal-first server instructions: the agent is told to do everything it can from its own
  shell and to use these tools only for GUI-only work. The server itself has no shell, file,
  registry, or process-launch tools.
- Multi-monitor support and per-monitor DPI awareness, with coordinate mapping between
  screenshot space and the Windows virtual desktop.
- Safety features:
  - No telemetry and no network access.
  - Refuses to type into password fields.
  - Refuses keyboard input when the foreground window is the agent's own host (its terminal or
    editor, detected via the parent process chain), a console window (by window class), or a
    dedicated terminal app, so the agent cannot type into itself. `--allow-terminal-input`
    lifts this.
  - Optional process blocklist for applications the agent must not touch.
  - Corner failsafe: moving the mouse into a screen corner makes actions refuse until the agent
    asks the user.
- Configuration through CLI flags (`--max-size`, `--format`, `--jpeg-quality`, `--monitor`,
  `--max-image-tokens`, `--max-elements`, `--block`, `--no-failsafe`, `--allow-terminal-input`, `--version`) and
  matching `CUW_*` environment variables, with CLI flags taking precedence over environment
  variables, and environment variables over defaults.
- Evaluation harness (`evals/`) measuring terminal-first behavior and GUI token cost.
- PNG and JPEG screenshot output formats.
- `computer-use-windows` console script.

[Unreleased]: https://github.com/SelmanBoray/eren-kit/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/SelmanBoray/eren-kit/releases/tag/v0.1.0
