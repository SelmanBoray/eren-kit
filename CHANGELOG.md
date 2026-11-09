# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- macOS support: `install.sh` (LaunchAgent for the brain service, hooks registered with an absolute
  Python 3.11+ path, assistant name in `settings.json` `env`, dry-run and uninstall), with tests and
  macOS CI jobs. On macOS the installer points to Claude Code's built-in computer use instead of
  installing `computer-use-windows`.
- iPhone/iPad: the brain web UI ships a web manifest and home-screen icon (CSP `manifest-src 'self'`);
  `--tailscale-host` allows the tailnet host for the service (kept on re-install, `""` clears it).
  The sign-in screen accepts a pasted key or address; only in home-screen (standalone) mode is the
  key kept in `localStorage`, browser tabs stay session-only.
- `settings_hooks.py --python` to choose the hook interpreter (default stays `python`).

### Changed

- `bellek`: one per-platform data directory (`bellek.platform_dirs.data_dir`): Windows
  `%LOCALAPPDATA%\Bellek` (unchanged), macOS `~/Library/Application Support/Bellek`, Linux
  `$XDG_DATA_HOME/Bellek`. `state_dir` now defaults to it; the template no longer hard-codes
  `%LOCALAPPDATA%`, which stayed literal on macOS.
- `apps/phone` server: data paths and `claude` lookup work on macOS/Linux (`platform` dependency).
- `bellek` tests run on macOS: process-tree cleanup without `taskkill`, platform-correct
  undefined-variable syntax.

## [0.1.0] - 2026-11-09

### Added

- First time the components come together in one monorepo:
  - `bellek`: brain memory MCP server, web UI, handoff hooks and evals.
  - `computer-use-windows`: MCP server for Windows desktop control.
  - `opus-orkestra`: orchestration skill and SessionStart hook.
  - `apps/phone`: experimental phone app (protocol and server).
- Root installer, shared CI, and repository documentation.
