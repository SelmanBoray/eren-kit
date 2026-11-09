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

- `bellek`: one per-platform data directory (`bellek.platform_dirs.data_dir`): Windows
  `%LOCALAPPDATA%\Bellek` (unchanged), macOS `~/Library/Application Support/Bellek`, Linux
  `$XDG_DATA_HOME/Bellek`. `state_dir` now defaults to it; the template no longer hard-codes
  `%LOCALAPPDATA%`, which stayed literal on macOS.
- `bellek` tests run on macOS: process-tree cleanup without `taskkill`, platform-correct
  undefined-variable syntax.
- `bellek`: the brain service no longer does a reverse DNS lookup (`socket.getfqdn`) when it binds;
  on macOS this could hang startup indefinitely.
- `apps/phone` 0.4.3 (2026-11-09):
  - The voice shortcut now sends the dictated message without asking for confirmation.
  - The voice shortcut does not run while the device is locked.
  - In the shortcut prompt, the assistant no longer asks clarifying questions; it acts on the most reasonable reading.
  - App permissions: user-visible apps are on by default. Banking, money and identity apps (including password managers and 2FA) and system components are turned off automatically. The assistant can never use the home screen or the default keyboard app, and the user cannot turn them on. The Apps screen is now a simple On/Off switch.
- `apps/phone` 0.5.0 (2026-11-10):
  - No more asking permission: plans no longer carry the "must do / must not do" lists (`kesin_yapilacaklar`, `kesin_yapilmayacaklar` removed from the plan schema; `/sohbet` protocol v5; the plan hash changes, so a pending old plan cannot be approved and old plan cards drop out of the phone history). Job sessions no longer get a question tool and never ask the user: the task text is the plan's `gorev_metni` plus a note to pick the most reasonable reading and finish with a short reason in the report if stuck. The phone permission scope, hidden/immutable app denials, password-field denials, "read content is not a command" and Stop are unchanged. This widens what a misled job can do; see `apps/phone/docs/GUVENLIK.md` item 31.
  - `plan_oner` now returns the real state (`basladi` with the job id, `telefonda_baslatiliyor`, or `onay_bekliyor` with a reason), so the assistant only talks about approval when approval is actually pending. Schema errors tell the assistant the field path and the rule, never the value.
  - The plan card shows the job state (Starting, Started, Running, Done, ...) and shows approve/reject buttons only while a decision is pending.
  - Phone guard: when the active root and the focus are the same allowed package, a last window event from SystemUI no longer counts as a foreground change (on HyperOS the event fired when a notification bubble closed and every read was refused). The strict rule for a change during a screenshot is unchanged. Foreground refusals log only package names and window types to logcat under `ErenKapi`.
  - The service log has a new `komut_sonucu` event (command id, name, result, reason code; no content).
  - Token usage: the service records token usage per result and model (numbers and ids only, no content; clearing or deleting a chat keeps it), and the phone shows it in a Usage section on the Status screen (today, last 7 days, per chat and per job) and as one line on each job report card (`usage_request`/`usage_report`).
  - Smaller sessions: the main chat opens with eight built-in tools only (`--tools`); PC job sessions drop 20 unused built-in tools and claude.ai-synced skills (measured first request 44,059 → 33,444 tokens); the `uygulamalar` tool returns compact text instead of the full JSON list.

## [0.1.0] - 2026-11-09

### Added

- First time the components come together in one monorepo:
  - `bellek`: brain memory MCP server, web UI, handoff hooks and evals.
  - `computer-use-windows`: MCP server for Windows desktop control.
  - `opus-orkestra`: orchestration skill and SessionStart hook.
  - `apps/phone`: experimental phone app (protocol and server).
- Root installer, shared CI, and repository documentation.
