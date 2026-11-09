# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- `bellek`: map-first doc gate (`packages/bellek/src/bellek/kapi/`), a Claude Code PreToolUse hook.
  On an agent's first touch of a Markdown file of 16 KB or more it denies the read and returns a
  heading map (line ranges and sizes), so the agent reads only the section it needs. Targeted reads
  (80 lines or fewer) and second attempts pass. Fail-open, with a measurement log; disable with
  `BELLEK_KAPI=kapali`.
- Installer: new `kapi` component (in the default set). `settings_hooks.py` now supports group-level
  `matcher` and per-handler `if` filters, and `-ReplaceExisting` also removes out-of-repo copies of
  the gate hook.

## [0.1.0] - 2026-11-09

### Added

- First time the components come together in one monorepo:
  - `bellek`: brain memory MCP server, web UI, handoff hooks and evals.
  - `computer-use-windows`: MCP server for Windows desktop control.
  - `opus-orkestra`: orchestration skill and SessionStart hook.
  - `apps/phone`: experimental phone app (protocol and server).
- Root installer, shared CI, and repository documentation.
