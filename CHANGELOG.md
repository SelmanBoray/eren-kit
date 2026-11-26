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
- `bellek`: brain backup commands `python -m bellek.beyin yedekle [--dizin D] [--sakla N]`,
  `yedekler` and `geri-yukle <yedek> [--evet]`. Backups are online-consistent copies made with SQLite
  `backup()`; the newest 14 are kept. Restore only runs while the service is stopped, and the old
  database is moved aside, not deleted. Local backups are not encrypted.
- `bellek`: `bellek doktor` gains brain checks: `beyin_db` (integrity, schema version), `beyin_fts`
  (full-text index consistency), `beyin_yetim` (nodes without a parent), `beyin_gelen` (pending
  suggestions older than 14 days), `beyin_kuyruk` (offline queue entries older than 24 hours) and
  `hook_gunluk` (hook errors in the last 7 days). The database is opened read-only and leaves no
  side files.
- `bellek`: `ice-al --uzerine-yaz` flag (with the protection behavior described under Fixed).
- Installer: install doctor `scripts/installer/doktor.py` (`.\install.ps1 -Doctor [-Json]`,
  `./install.sh --doctor [--json]`). It checks, read-only, hook registrations (duplicates, old
  location, missing events, script path), whether skill copies match the repo, MCP registrations,
  the brain service and its task. `--no-network` starts no external process and makes no network
  request; exit code 0/1/2. It also runs once at the end of a real install.
- Installer: `-KeepExisting` / `--keep-existing` to deliberately keep an old hook registration.
- Repo: privacy scanner `scripts/gizlilik_tara.py`: looks in tracked files for personal paths,
  e-mail addresses, token-like strings and large binary files. The allow list is
  `.github/gizlilik-izinli.txt`; extra forbidden words come from the `GIZLILIK_YASAK` environment
  variable.
- `apps/phone` (server): list and remove paired devices: `eslestir --liste`,
  `eslestir --kaldir <kimlik>`. A removed device's credentials are rejected on every connection
  path, its open connections close within 2 seconds, and past data is kept.
- `apps/phone` (server): a WebSocket ping every 30 seconds on each connection; a connection that
  does not answer is closed within 60 seconds at the latest.
- `apps/phone` (app): connection watchdog: when a send has no reply yet and the line is silent for
  20 seconds, the connection is dropped and re-established.
- `bellek`: the brain service now takes a local backup by itself once a day while it is running (a
  missed backup is taken on the next check); new read-only command `python -m bellek.beyin
  yedek-durum`, and the installer's doctor gains a `beyin:yedek` check that warns when there is no
  backup, the latest one is older than 48 hours, or the last automatic attempt failed.

### Changed

- Docs: the root README opens with a before/after overview and the security-relevant facts;
  `SECURITY.md` now describes the threat model and the known limits; `CONTRIBUTING.md` explains the
  privacy job's `GIZLILIK_YASAK` secret. The components diagram shows the doc gate.
- `opus-orkestra`: new "Agent ömrü" rule. A fresh agent per phase with a short handoff note instead of
  keeping one agent alive with `SendMessage` (at most two follow-ups, small fixes only); no `name` on
  agents, because with `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` a named agent becomes a teammate whose
  progress messages wake the main session; agents send no progress messages, one final report only.
  Measured in a real session: one agent kept alive over 18 messages grew to 439k tokens of context and
  36M cache-read tokens (~86% of all subagent cache reads).
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
- `apps/phone` 0.6.0 (2026-11-13):
  - Spoken replies: when a message was sent by voice (dictation button or the voice shortcut), the assistant's reply is read aloud with Android's built-in text-to-speech (`tr-TR`). Replies to typed messages and history are not read. While it reads, the chat screen shows a "Sesli okunuyor / Sustur" row above the input bar; a new message, the dictation or shortcut recognizer opening, and "Sustur" stop it. No new permission or dependency. The service names the message that started a turn (`kaynak_msg_id` in `assistant_activity`), and the phone reads a reply only when that message is one this device sent by voice in this run; synthetic (service) turns are never read. Limits, all in the not-reading direction: it needs the new service (nothing is read against an old one); a turn that starts and ends entirely while the connection is down is not read; after a service restart a message left in the queue from the previous run starts a turn without a source and is not read.
  - Live activity: while a turn runs, the service tells the phone what the assistant is doing, and the phone shows "thinking", "running a command · 42 s", "starting a job" and the like instead of "typing" (top bar, stream bubble label, and the dots bubble before any text arrives). New downstream frame `assistant_activity`; `SOHBET_SURUMU` is unchanged: the frame is sent only to an authenticated `/sohbet` connection opened with `?yetenek=etkinlik1`, so an old APK receives the same bytes as before and the new APK works against an old service as before. Only a fixed category is sent (no tool name, input or output); the state is kept in memory only, never written to disk or the log. A new `assistant_activity_end` frame (same capability, live only) tells the phone the visible turn closed, whatever the reason (including closes that write no end event: empty result, chat clear/delete, process death, service shutdown).
- Installer: a hook registration of the same component at an old location is now replaced by the new
  one by default (after a backup); `-ReplaceExisting` is still accepted for compatibility but is no
  longer needed. The handoff hook runs with `python -I -S`. The gate hook is also registered on
  `SessionStart` with the `compact` matcher. Orchestra hook commands end with `|| true`.
- `bellek`: the brain service serves static files with a content `ETag` and
  `Cache-Control: no-cache`; a matching `If-None-Match` gets a 304 (first load 356 KB, later loads
  download no body).
- `bellek` (handoff): faster session transcript scan (Stop path on a 20 MB transcript about 92 ms to
  56 ms; spaced JSON format 168 ms to 55 ms); faster hook start (the handoff directory lookup is
  cached); automatic notes older than 28 days are deleted at `SessionStart`; a note is not rewritten
  when its content is unchanged.
- `apps/phone` (server): polling of running jobs no longer grows with the job count (5 concurrent
  jobs: 156 external process queries per minute to 6); jobs started in this lifetime are noticed as
  finished through the exit event.
- `apps/phone` (app): in a bulk catch-up `last_seq` is written once, not per event; the unread count
  no longer scans the whole history.
- `computer-use-windows`: `key` allows at most 200 presses per call; the `--max-size` upper bound is
  2576 (the API's long-edge limit); `elements` reports when its scan was cut short.
- `bellek` tests are isolated from user data through a shared `tests/conftest.py`.
- `opus-orkestra` (ledger): `defter oku` without a path first prints the latest compressed project
  summary; `defter temizle --tut N` keeps the last N cards, the latest summary and each file's or
  concept's latest record, so `oku` and `kavram` output does not change; `defter ozetle` feeds the
  previous summary into the new one; content pruned from git is reported explicitly.
- `opus-orkestra` (hook): when the installed `SKILL.md` is stale against the repo copy, the hook uses
  the repo copy and warns with the refresh command.
- `opus-orkestra` (core rule): new rule 6 on agent lifetime.
- `opus-orkestra` (model tiers): Mythos is now reserved for work that is very hard and needs new,
  inventive ideas; ordinary hard work (design, diagnosis, refactor, cross-component) goes to Opus at
  high effort, ties between Opus and Mythos resolve to Opus, the reviewer is always Opus and the
  dual-opinion pair is Opus + Fable.

### Removed

- `BEKLEYEN-DALLAR.md`, an internal note about branches waiting for review (they are merged).

### Fixed

- `bellek`: the brain MCP bridge no longer routes reads to the read-only fallback for 15 seconds
  after a single slow request while the service is up; it probes the service health first, and the
  fallback prefix now says "servis yanıt vermedi" instead of "servis kapalı" when the port is
  listening but no answer came.
- `bellek`: when the brain service rejected a request with a body early, it closed the connection
  without reading the body; on Windows the client saw a connection error instead of the response
  (the flaky `WinError 10053` in CI). It now sends the response and reads the remaining bytes, bounded
  (2 s / 4 MB). The body of a GET with a body is no longer parsed as the next request.
- Installer: the gate hook was registered twice in `settings.json` (the old-location entry was not
  removed and a new one was added next to it; entries with doubled backslashes and `-m` form were
  never recognized). Hook recognition now parses the command, and duplicate groups collapse to one.
  The write no longer overwrites an intervening change and retries on a locked file on Windows.
- Installer: removing the phone component did not delete the scheduled task; `install.sh --dry-run`
  left `__pycache__` in the repo.
- `bellek`: re-running `ice-al` overwrote nodes the user had edited later with the seed value; a node
  changed by a non-seed source is now kept and reported in the `korunan` list. The import starts with
  `BEGIN IMMEDIATE` (fixes the whole import being rolled back during concurrent writes).
- `bellek`: the secret node title lookup failed with an ASCII-folded query ("sifre kasasi" did not
  match "Şifre kasası"); `gez` and the export tried to create a root in a database without one; the
  fact date was shown by UTC day.
- `bellek` (handoff): on a large transcript the second scan phase never ran when the first phase took
  long; request counting in spaced JSON format fell back to a full parse with no time limit; a user
  typing `/devir` hit the whitespace guard.
- `bellek` (gate): the map was not shown again after context compaction (compact); when the
  measurement log was rotated, two concurrent processes could overwrite the history.
- `bellek` (web): in the inbox, the title of a suggestion with a hidden parent could not be corrected
  and approved; the title limit did not match the server (200 vs 120); a retried decision gave an
  "already decided" error; the confirmation cancelled itself after 5 seconds; focus was not moved
  inside when the panel opened.
- `computer-use-windows`: `focus` on an unresponsive (hung) window locked up the server;
  `click(element=...)` clicked the wrong place after the window moved or closed; "truncated" was
  reported by mistake when there were exactly `limit` elements.
- `apps/phone` (server): child processes were orphaned when starting a job failed; a device command
  sent to a closed socket waited until the end of the final delivery timeout.
- `apps/phone` (app): a plan decision flipped back to "waiting for approval" in the window between
  its reply and its event; an event appended after a half-written log line was corrupted.
- `opus-orkestra` (ledger): concurrent `defter yaz` / `temizle` / `ozetle --yerel` could lose cards
  or interleave lines. Writes now take an OS file lock (`msvcrt` on Windows, `flock` elsewhere); a
  lock held too long fails with a clear error after `DEFTER_KILIT_SURE` seconds (default 30), and a
  dead holder's lock is released by the OS. A half-written line no longer corrupts the next card;
  unreadable lines are counted in `defter durum`. Recorded content is kept safe from `git gc` by a
  single ref, `refs/orkestra/defter`, pointing to a tree (not shown by branches, tags, `git status`
  or `git log --all`, not pushed by default); content dropped by `temizle` is released. `defter oku`
  no longer leaves loose objects in the repo.
- Installer and doctor no longer print secrets from an existing MCP registration (remote URL
  credentials/path/query, headers, env values, user-added arguments, a password embedded in
  `command`, non-string `command`/`type` values); remote servers are shown as
  `scheme://host[:port]/…` and an unusual or ambiguous URL or program path as a fixed placeholder,
  identically on Windows and macOS; program paths with letters from any writing system (Cyrillic,
  Greek, CJK, Arabic, ...) and `'`, `,`, `&`, `#` are shown. Text taken from a registration or another
  tool's output can no longer reach the terminal as control characters, ANSI escapes or extra lines.
  A registration that Claude Code rejects (boundary measured against `claude` 2.1.325, e.g.
  `"env": {"PORT": 8080}`, `"type": 5`, `"alwaysLoad": "true"`, `oauth.callbackPort: "8080"`) is now
  left untouched by both install and uninstall, with a clear message, instead of being lost (Windows)
  or silently rewritten (macOS); an existing but empty or non-object registration (`{}`, `5`) counts
  as invalid, not as missing, on every platform; uninstall no longer suggests deleting an invalid
  registration that points to another program. Uninstall now backs up a registration before removing
  it, like install does, so a value Claude Code starts rejecting in a later version is never lost.
  Fields Claude Code ignores for the server's type no longer stop the installer; the doctor reports
  only what Claude Code rejects. On Windows, whether a registration's keys can be read (`Path`/`PATH`,
  an empty key; `ı`/`I` are fine) is decided by the running PowerShell itself, a `__type` key (dropped
  by Windows PowerShell 5.1) stops the installer with a clear message, and a command containing
  control characters on Windows PowerShell 5.1 no longer stops the installer with a raw error.

### Security

- `bellek`: the brain export (Markdown and JSONL) ignored privacy inherited from a parent node:
  summaries and facts of nodes under a secret or private branch appeared in the dump. For deep chains
  (more than 64 levels) the privacy computation now fails closed.
- `bellek`: `ice-al` checks text fields in the seed for secrets (the same check as the normal write
  path); error records carry no content excerpts.
- `computer-use-windows`: `type_text` refreshes the password field, terminal and blocked-app checks
  after every Tab/Enter and stops when the foreground window changes; `key` rejects chords that
  produce characters in a password field; typing is refused when the password check cannot be made;
  the emergency stop holds during long input; right/middle click and drag on a terminal are
  rejected; the blocked-app check looks at the root and root-owner window.
- `apps/phone` (server): device removal (above) makes it possible to revoke the access of a lost or
  stolen phone.
- Installer: the install doctor runs a program it reads from `settings.json` only when its name is
  explicitly a Python interpreter.
- Installer: the `beyin` MCP server and the brain service task are registered with `python -I`
  (Windows and macOS), so no code is loaded from the session's working directory (before, opening
  Claude Code in a folder containing a `bellek` package ran that code). Re-installing replaces the
  old registration and keeps MCP arguments and `env` values you added (for example a
  computer-use `--block` list) unchanged: the registration goes to `claude mcp add-json` as one
  escaped JSON argument, started through .NET `Process`, so Windows PowerShell 5.1 no longer drops
  the double quotes in a value and an `&` in a value is no longer run as a command through
  `claude.cmd`. A registration that cannot be carried over exactly is not carried, and the installer
  says so without printing values; the install output shows carried arguments only as a count and
  `env` values only by name. The macOS dry run no longer suggests a manual command for a
  registration with carried values. The doctor flags unsafe MCP registrations (a Python `-m`/`-c` launch
  without `-I`/`-P`, a relative script path; a long Python option that takes a value, such as
  `--check-hash-based-pycs always`, is not flagged by mistake) and a repository folder other
  accounts can write to, and looks up programs only in absolute `PATH` folders. The install summary says that backups are
  plain text and are not deleted on uninstall. Existing installs: run
  `.\install.ps1 -Components beyin` once.
- `computer-use-windows`: `comtypes` no longer loads generated modules from a fixed folder under the
  shared `%TEMP%`. The app blocklist now also covers `elements` (refused for a blocked app's
  windows) and `windows` (titles hidden). With a blocklist, `elements` no longer reads a blocked app
  through another window: the desktop window is refused, the blocked app's windows inside a listed
  tree (top-level or embedded) are skipped, and element texts that contain the title of a blocked
  app's window (taskbar buttons, Alt-Tab, Task Manager) are hidden; the match is textual, so a
  shortened or reworded title is not caught. `focus` and `elements` accept a window handle only in
  the form Windows reports it (other numbers Windows accepts for the same window, such as a wildcard
  high word, got past the checks), and a window whose process Windows does not tell is not read
  inside a listing. Without a blocklist nothing changes. The README states what the blocklist does
  not cover (screenshots; closing, minimizing or ending the app through the Windows shell), that it
  is empty by default, and that GUI actions can start programs outside Claude Code's Bash
  permission rules.
- `opus-orkestra` (ledger): `defter yaz` refuses files outside the repository, inside `.git` and
  untracked files git ignores (such as `.env`); `defter temizle` drops such older records. `oku` and
  `yaz` no longer run external commands from the repository's git configuration (external diff,
  textconv, filter drivers, fsmonitor, reference-transaction hook). `git` and `ollama` are resolved
  only from absolute `PATH` folders. Tracked files inside a submodule or nested repository are
  recorded again (each is checked against its own repository's rules); `temizle` does not delete a
  record git could not evaluate (its content is not kept either) and `durum` lists such records
  separately. A path git cannot evaluate no longer makes the ledger slow: an inner repository git
  cannot work in at all costs a fixed number of git processes (4-5 at 100 and 1000 paths) instead of
  two per path.
- CI: every GitHub Action is pinned to a full commit SHA, `actions/checkout` no longer persists
  credentials, and Dependabot (`.github/dependabot.yml`) proposes weekly updates for npm, pip and
  GitHub Actions. When the `GIZLILIK_YASAK` secret is empty, the privacy job warns on pull requests
  and fails on pushes to `main`.
- `apps/phone` (app): a release build can no longer be signed with the public debug key; it needs a
  user-specific keystore (`EREN_KIT_RELEASE_STORE_FILE`, `..._STORE_PASSWORD`, `..._KEY_ALIAS`,
  `..._KEY_PASSWORD`) and stops with a clear error otherwise. Debug builds are unchanged. An
  `android/` folder generated before this change never got the signing plugin (Expo skips prebuild
  when the folder exists): the release path now stops and asks for
  `npx expo prebuild -p android --clean`, other commands warn once. The app README describes that
  step and how to undo the old voice-key shortcut changes by hand.
- `apps/phone` (app): full-permission, accessibility and setup texts now say what really happens
  (ordinary apps are on by default; banking and money apps are switched off by a guess from their
  name and package, which does not catch every app). Full permission is switched off before a new
  pairing is saved, so a new pairing does not inherit it. The voice-key shortcut is added next to an
  existing accessibility shortcut instead of replacing it, and the system's first-use confirmation
  is no longer suppressed.
- `bellek`: on Linux and macOS new data folders are created `0700` and files `0600`, and group/other
  permissions are removed from an existing install (Windows unchanged). The secret filter now also
  masks `e-mail:password` pairs, `PGPASSWORD`, `mysql -p`, `glpat-` tokens, PEM headers, `curl -u`,
  Basic auth and similar. The filter runs in linear time (the URL, `e-mail:password`, PIN and TC
  rules took quadratic time on long input; every rule now stays under 1 s on 200 KB). Values that
  start with a flag word but go on (`password=None-of-...`) are masked; a context rule no longer
  swallows the keyword and leaves the value in the clear; a password in a URL with a long scheme
  name is masked; the `mysql`/`sshpass`/`curl` rules walk
  the command line word by word (options and positional arguments such as `mysqldump mydb -uroot -pX`
  or `curl host -u a:X`, quoted commands, `\`-continued lines) and stop at a shell separator or
  another command name, so `ls -pla` or `find -perm` on the same line is not masked; a card
  number is looked for in every window of a digit run, and a decimal fraction (`0.4111...`) is not
  taken for a card. Outside text that reaches hook
  output (the handoff index, the doc gate's heading map) is stripped of control and invisible
  characters and capped in length, and the map says that headings are data, not instructions.
  `/api/gelen/<id>` goes through the same filter as the web UI, and the brain service accepts at
  most 64 concurrent connections.
- `apps/phone` (server): the data folder must be open only to the user, SYSTEM and Administrators;
  the service does not start with an unsafe folder and logs the reason and the fix. `kur.ts`
  narrows its own `eren-kit` folder; `--izin-duzelt` fixes another one. `--izin-duzelt` fixes the
  folder the service will really use (the persistent `EREN_KIT_DATA_DIR`, user scope first, then
  machine scope, not the current shell's value), prints that folder first and the result after
  narrowing, and warns when the shell's value differs. Permissions are read through .NET, so the
  check also works when started from PowerShell 7. The check expands account abbreviations in the
  folder's security descriptor (for example `LA` for the built-in Administrator) to the user's own
  SID, so the service starts under the built-in Administrator account (including the GitHub Windows
  runner). Before authentication a frame is
  capped at 16 KiB, an address may hold at most 16 connections, an unresponsive peer is dropped after
  3 seconds, and browser requests (with an `Origin` header) are rejected. Pairing: 5 wrong codes
  close the pairing window for that address only; 20 wrong codes in total delete the window.

## [0.1.0] - 2026-11-09

### Added

- First time the components come together in one monorepo:
  - `bellek`: brain memory MCP server, web UI, handoff hooks and evals.
  - `computer-use-windows`: MCP server for Windows desktop control.
  - `opus-orkestra`: orchestration skill and SessionStart hook.
  - `apps/phone`: experimental phone app (protocol and server).
- Root installer, shared CI, and repository documentation.
