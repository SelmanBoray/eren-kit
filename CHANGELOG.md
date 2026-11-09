# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- `apps/phone`: the full experimental phone app is now in the repo: Expo / React Native Android app
  with the Kotlin `eren-device` module, the PC service, install scripts (`kurulum/kur.ts`) and docs.
  Talk to the main Claude Code session from the phone, one session per chat, and manage an Android
  device. Configured with `EREN_KIT_ASSISTANT_NAME`, `EREN_KIT_DATA_DIR` and
  `EREN_KIT_PHONE_TASK_NAME`; the assistant name is no longer hard-coded.
- `bellek`: map-first doc gate (`packages/bellek/src/bellek/kapi/`), a Claude Code PreToolUse hook.
  On an agent's first touch of a Markdown file of 16 KB or more it denies the read and returns a
  heading map (line ranges and sizes), so the agent reads only the section it needs. Targeted reads
  (80 lines or fewer) and second attempts pass. Fail-open, with a measurement log; disable with
  `BELLEK_KAPI=kapali`.
- Installer: new `kapi` component (in the default set). `settings_hooks.py` now supports group-level
  `matcher` and per-handler `if` filters, and `-ReplaceExisting` also removes out-of-repo copies of
  the gate hook.

### Changed

- `apps/phone` 0.4.3 (2026-11-09):
  - The voice shortcut now sends the dictated message without asking for confirmation.
  - The voice shortcut does not run while the device is locked.
  - In the shortcut prompt, the assistant no longer asks clarifying questions; it acts on the most reasonable reading.
  - App permissions: user-visible apps are on by default. Banking, money and identity apps (including password managers and 2FA) and system components are turned off automatically. The assistant can never use the home screen or keyboard apps, and the user cannot turn them on. The Apps screen is now a simple On/Off switch.

## [0.1.0] - 2026-11-09

### Added

- First time the components come together in one monorepo:
  - `bellek`: brain memory MCP server, web UI, handoff hooks and evals.
  - `computer-use-windows`: MCP server for Windows desktop control.
  - `opus-orkestra`: orchestration skill and SessionStart hook.
  - `apps/phone`: experimental phone app (protocol and server).
- Root installer, shared CI, and repository documentation.
