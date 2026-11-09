# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Minimum supported Python is now 3.11 (Pillow 13 requires Python 3.11+).

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
