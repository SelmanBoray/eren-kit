# computer-use-windows

**English** | [Türkçe](README.tr.md)

[![CI](https://github.com/SelmanBoray/eren-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/SelmanBoray/eren-kit/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Python 3.11+](https://img.shields.io/badge/python-3.11%2B-blue.svg)](pyproject.toml)
[![Platform: Windows 10 | 11](https://img.shields.io/badge/platform-Windows%2010%20%7C%2011-0078D6.svg)](#limitations)

**Computer use for terminal AI agents on Windows.** This is an MCP server that lets Claude Code, or any
stdio MCP client, see the screen, read UI Automation elements and use the mouse and keyboard. It
is designed to spend as few tokens as possible.

Claude Code's built-in computer use
[is not available in the CLI on Windows](https://code.claude.com/docs/en/computer-use). The docs
point Windows users to the Desktop app instead. This server brings computer use to the agent in your
terminal, and it follows two rules:

- **Terminal first.** The agent does in its shell everything a shell can do. These tools are only
  for GUI-only work: native dialogs, apps without a CLI or API, and visual checks.
- **Token frugal.** Text comes before pixels. The agent reads element lists instead of screenshots.
  Screenshots are downscaled (about 1.2k tokens instead of up to about 4.8k), `zoom` gives detail on
  demand, and action tools never return images.

This package lives in the [eren-kit monorepo](../../README.md). From the repository root:

```powershell
.\install.ps1 -Components computer-use
```

Manual install is described in [Quick start](#quick-start).

## What the agent sees

Here is an illustrative exchange. Element names depend on the app.

```text
$ Start-Process ms-settings:display          # the agent's own shell, not this server
> elements(query="night light")
window: "Settings" (systemsettings.exe) — 2 elements
[1] text "Night light"
[2] button "Night light"
> click(element=2)
ok | foreground: "Settings" (systemsettings.exe)
```

That task needed no image, only a few lines of text. When the agent does need to look:

```text
> screenshot()
[image 1280x720]
monitor 1/2 1280x720 (scale 1.50) ~1196 tokens | foreground: "Settings" (systemsettings.exe)
```

## Features

- **12 tools:** `screenshot`, `zoom`, `elements`, `windows`, `focus`, `click`, `type_text`, `key`,
  `scroll`, `drag`, `move`, `wait`.
- **Reads the UI as text.** `elements` uses Windows UI Automation to list a window's buttons,
  fields, menu items and text. Each entry has an id the agent can click, so no image is needed.
  On one test PC, repeat calls took about 42 ms for Notepad (27 elements), about 114 ms for Explorer
  (73) and about 108 ms for a Chrome page (194). Treat these as indicative only.
- **Screenshots sized for the model.** Every image is capped by long edge (1280 px by default) and
  by a token budget (1,568 by default). Images always fit the model's limits, so the API never
  resizes them and Claude's coordinates stay exact. Images come as PNG or JPEG, and each screenshot
  reports its size, scale and token estimate.
- **`zoom` for small text.** It crops a region of the screen at native resolution, so the agent
  never needs a full-resolution screenshot.
- **Short action results.** `click`, `type_text`, `key`, `scroll`, `drag`, `move`, `focus` and
  `wait` return one line of text that names the foreground window. They never return an image.
- **Accurate coordinates.** `x,y` are pixels in the screenshot the agent saw, and the server maps
  them to physical screen pixels. The server is per-monitor DPI aware and supports multiple monitors,
  including monitors at negative coordinates.
- **Typing that works in any language.** Unicode typing doesn't depend on the keyboard layout
  (Turkish `ğüşıöçİ`, emoji, any script). Shortcuts (`ctrl+s`) and key sequences
  (`tab tab enter`) are supported too.
- **Guard rails.** The server won't type into password fields or terminals. It has an optional app
  blocklist and a failsafe: move the mouse into a screen corner to stop the agent.
- **Local only.** No network access and no telemetry. It has four runtime dependencies (`mcp`, `mss`,
  `Pillow`, `comtypes`), and input goes through Win32 `SendInput` via `ctypes`.

## Quick start

### Recommended: the monorepo installer

From the root of the [eren-kit repository](../../README.md), run:

```powershell
.\install.ps1 -Components computer-use
```

It creates `packages/computer-use-windows/.venv`, installs this package and registers the MCP server
as `computer-use-windows`.

### Manual install (venv)

```powershell
cd packages\computer-use-windows
python -m venv .venv
.venv\Scripts\python -m pip install -e .
claude mcp add computer-use-windows -s user -- "$PWD\.venv\Scripts\computer-use-windows.exe"
```

Check it with `.venv\Scripts\computer-use-windows.exe --version`. Options such as `--block` go
after the executable path.

### Alternative: uvx without cloning

The rest of this section installs the server straight from GitHub with uv, with no local checkout.

### Requirements

- Windows 10 or 11
- [uv](https://docs.astral.sh/uv/). If you don't have Python 3.11+, uv can download it for you.
- Git, which uv uses to fetch this repository from GitHub
- An MCP client. Claude Code is the primary target; any client that runs stdio MCP servers
  (Codex CLI, Gemini CLI, Cursor, …) can work. `screenshot` and `zoom` need a model that accepts
  images.

### 1. Install uv

```powershell
winget install --id=astral-sh.uv -e
```

You can also use the official installer:
`powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"`. Afterwards,
open a new terminal so that `uvx` is on your `PATH`.

### 2. Check that it runs (optional)

```powershell
uvx --from git+https://github.com/SelmanBoray/eren-kit#subdirectory=packages/computer-use-windows computer-use-windows --version
```

This prints `computer-use-windows 0.1.0`. It also downloads the dependencies ahead of time, so your
MCP client's first start is fast.

### 3. Add it to Claude Code

```powershell
claude mcp add computer-use-windows -s user -- uvx --from git+https://github.com/SelmanBoray/eren-kit#subdirectory=packages/computer-use-windows computer-use-windows
```

`-s user` makes the server available in every project. Start a new Claude Code session and run
`/mcp`; `computer-use-windows` should show as connected. Some things to try:

- "Open Settings and turn on Night light."
- "Start my app from `bin\Debug`, fill in the signup form and tell me whether the Save button
  enables."
- "Open Paint and draw a red rectangle."

### Passing options

Everything after the second `computer-use-windows` (the command name) goes to the server:

```powershell
claude mcp add computer-use-windows -s user -- uvx --from git+https://github.com/SelmanBoray/eren-kit#subdirectory=packages/computer-use-windows computer-use-windows --block keepass.exe --max-size 1024
```

To change options later, run `claude mcp remove computer-use-windows -s user` and add the server again.

### Other MCP clients

Most clients that use JSON config files accept a block like this. Drop the `--block` arguments and
`env` if you don't need them:

```json
{
  "mcpServers": {
    "computer-use-windows": {
      "command": "uvx",
      "args": [
        "--from",
        "git+https://github.com/SelmanBoray/eren-kit#subdirectory=packages/computer-use-windows",
        "computer-use-windows",
        "--block",
        "keepass.exe"
      ],
      "env": { "CUW_MAX_SIZE": "1024" }
    }
  }
}
```

Codex CLI uses TOML in `~/.codex/config.toml`:

```toml
[mcp_servers.computer-use-windows]
command = "uvx"
args = ["--from", "git+https://github.com/SelmanBoray/eren-kit#subdirectory=packages/computer-use-windows", "computer-use-windows"]
```

### Updating and removing

`uvx` caches what it installs. To get the latest commit, run this once:

```powershell
uvx --refresh --from git+https://github.com/SelmanBoray/eren-kit#subdirectory=packages/computer-use-windows computer-use-windows --version
```

To remove the server from Claude Code, run `claude mcp remove computer-use-windows -s user`.

## How "terminal first" works

Several mechanisms keep the agent in its shell and keep image use rare:

1. **Server instructions.** Clients like Claude Code add an MCP server's instructions to the
   agent's context in every session, so these are kept under 900 characters. They tell the agent
   that the tools are a last resort for GUI-only work. Everything else stays in the shell: opening
   apps, files and URLs (`Start-Process`), file operations, the clipboard
   (`Get-Clipboard`/`Set-Clipboard`), processes, and settings that have a CLI. For web pages, the
   agent should prefer a browser automation tool if one is available. The instructions also set a
   cheapest-first order: `windows`/`focus`, then `elements`, then `screenshot` only if elements fall
   short, then `zoom` for details. The full text is in
   [`instructions.py`](src/computer_use_windows/instructions.py).
2. **No shortcut tools.** The server has no shell, file, registry or process-launch tools, so the
   agent can't use GUI automation for work its shell does better.
3. **No keyboard input into terminals.** The agent's own terminal or editor is usually the
   foreground window. Typing there would inject text into the agent itself. So `type_text` and
   `key` are refused while the foreground window is one of these:
   - **The agent's own host:** the terminal or editor the agent runs in, for example VS Code when
     the agent runs in its integrated terminal. The server finds it by walking its own parent
     process chain.
   - **A console window,** detected by window class (`ConsoleWindowClass`,
     `CASCADIA_HOSTING_WINDOW_CLASS`, `PseudoConsoleWindow`, `mintty`, `VirtualConsoleClass`).
   - **A dedicated terminal app:** `windowsterminal.exe`, `openconsole.exe`, `wezterm-gui.exe`,
     `alacritty.exe`, `mintty.exe`, `kitty.exe`, `hyper.exe`, `tabby.exe`, `conemu.exe`,
     `conemu64.exe`.

   A GUI window shown by a script, such as a WinForms dialog from PowerShell, is not treated as a
   terminal. The error tells the agent to use its shell or to `focus` the target window first.
   `--allow-terminal-input` turns this guard off.
4. **No automatic screenshots.** Actions return one line naming the foreground window. The agent
   checks results with `elements` and takes a screenshot only when text isn't enough.

## Tools

`x,y` are pixels in the **last screenshot**, and `element` is an id from the **last `elements`
call**. If the agent passes `x,y` before taking any screenshot, it gets an error telling it to take
one first, or to use element ids.

| Tool | Parameters | What it does |
|---|---|---|
| `screenshot` | `monitor?` | Captures a monitor, downscaled to the size cap. Returns the image plus one line: monitor, size, scale, token estimate, foreground window. |
| `zoom` | `x0, y0, x1, y1` | Captures a region of the last screenshot fresh at native resolution, for small text. Coordinates stay in screenshot space. |
| `elements` | `query?, window?` | Lists the UI Automation elements of the foreground or a given window as text: id, role, name, value, center. Never shows password values. |
| `windows` | none | Lists visible top-level windows: handle, process, title, `[foreground]`/`[minimized]`. |
| `focus` | `window` | Restores a window by handle if minimized and brings it to the front. |
| `click` | `x, y` or `element`; `button, clicks, modifiers?` | Left, right or middle click, 1–3 clicks, optionally holding `ctrl`/`alt`/`shift`/`win`. |
| `type_text` | `text` | Types Unicode text, independent of the keyboard layout (`\n` = Enter, `\t` = Tab). |
| `key` | `keys, repeat` | Presses keys and shortcuts: `ctrl+s`, `alt+f4`, `tab tab enter`. Repeats 1–100 times. |
| `scroll` | `direction, amount, x?, y?` | Turns the wheel up, down, left or right by 1–50 notches, at a point or at the cursor. |
| `drag` | `x0, y0, x1, y1` | Holds the left button down from one point to another (sliders, selections, moving items). |
| `move` | `x, y` | Moves the pointer without clicking, for hover menus and tooltips. |
| `wait` | `seconds` | Pauses up to 10 s so the UI can settle. |

## Token cost

Images are the main cost of computer use. Claude counts an image as
`⌈width / 28⌉ × ⌈height / 28⌉` visual tokens. Each model also has a size limit: Claude 4.7 and
later allow 2,576 px on the long edge and 4,784 tokens; other models allow 1,568 px and 1,568 tokens
([Anthropic vision docs](https://platform.claude.com/docs/en/build-with-claude/vision)). The API
downsizes a larger image, and Claude then answers in the coordinates of the smaller image, so clicks
would land in the wrong place.

To avoid that, the server shrinks every `screenshot` and `zoom` image until it fits both
`--max-size` (long edge, 1280 px by default) and `--max-image-tokens` (1,568 by default). The
defaults fit every Claude model. The `~N tokens` in each result line uses the same formula.

| What the agent gets | Settings | Image sent | ≈ tokens |
|---|---|---|---|
| `screenshot` of a 1920×1080, 2560×1440 or 3840×2160 monitor | defaults | 1280×720 | 1,196 |
| `screenshot` of a 1920×1200 monitor | defaults | 1280×800 | 1,334 |
| `screenshot` of a 1280×1024 monitor | defaults (the token budget applies) | 1225×980 | 1,540 |
| `screenshot` of a 1920×1080 monitor | `--max-size 1024` | 1024×576 | 777 |
| `screenshot` of a 2560×1440 monitor, Claude 4.7+ only | `--max-size 2576 --max-image-tokens 4784` | 2560×1440 | 4,784 |
| `zoom` that returns a 600×400 crop | defaults | 600×400 | 330 |
| `elements`, `windows`, every action | | text only | no image tokens |

For comparison, on Claude 4.7+ a full 1920×1080 image costs 2,691 tokens and a full 2560×1440 image
4,784. A default screenshot therefore costs about 56% less than a full 1080p screen and about 75%
less than a full 1440p screen.

**Sharper screenshots.** If you use a Claude 4.7+ model, you can raise `--max-size` up to 2576 and
`--max-image-tokens` up to 4784. Screenshots get sharper, and each one costs more. With other
models, keep `--max-size` at 1568 or below and the token budget at its default.

Some notes on these numbers:

- Text still costs ordinary text tokens. A long `elements` list can add up, so the list is capped
  (`--max-elements`, 80 by default) and `query` narrows it.
- `--format jpeg` shrinks the payload but not the token count. Tokens depend only on pixel size.
- Other model providers count image tokens differently.

## Configuration

Each option can be set with a command-line flag or an environment variable. Precedence is CLI, then
environment, then defaults. A `--block` given on the command line replaces `CUW_BLOCK` entirely.
Invalid values are rejected with an error that names the flag or variable.

| Flag | Environment variable | Default | Meaning |
|---|---|---|---|
| `--max-size N` | `CUW_MAX_SIZE` | `1280` | Long-edge cap for `screenshot` and `zoom` images, 256–4096 px. The server never upscales. |
| `--max-image-tokens N` | `CUW_MAX_IMAGE_TOKENS` | `1568` | Token budget per `screenshot`/`zoom` image, 100–4784. Images are shrunk until they fit, so the API never resizes them (see [Token cost](#token-cost)). |
| `--format png\|jpeg` | `CUW_FORMAT` | `png` | Image format |
| `--jpeg-quality N` | `CUW_JPEG_QUALITY` | `80` | JPEG quality, 1–95 |
| `--monitor N` | `CUW_MONITOR` | primary | Default monitor for `screenshot` (1-based) |
| `--max-elements N` | `CUW_MAX_ELEMENTS` | `80` | Maximum lines returned by `elements`, 1–500 |
| `--block NAME` | `CUW_BLOCK` | none | Processes the agent must not send input to. The flag can repeat and also accepts commas (`--block keepass.exe,1password`); the variable takes a comma-separated list. Matching ignores case, and `.exe` is optional. |
| `--no-failsafe` | `CUW_FAILSAFE` | on | Turns off the screen-corner failsafe. `0`/`false`/`no`/`off` disables it. |
| `--allow-terminal-input` | `CUW_ALLOW_TERMINAL_INPUT` | off | Allows `type_text`/`key` while a terminal is in front. `1`/`true`/`yes`/`on` enables it. |
| `--version` | | | Prints the version and exits |

## Safety and privacy

**What the server does:**

- **No network, no telemetry.** The server opens no network connections. Screenshots and text go
  only to your MCP client over stdio. Your client then sends them to your model provider, like the
  rest of your session.
- **Password fields.** `type_text` is refused when the focused element reports itself as a password
  field (UI Automation `IsPassword`). `elements` never shows a password field's value. The agent is
  told to ask you to type it yourself.
- **Terminals.** Keyboard input is refused into terminal windows and into the terminal or editor
  the agent runs in (see [How "terminal first" works](#how-terminal-first-works)).
- **Blocklist.** `--block keepass.exe` refuses input to that app. For pointer actions the server
  checks the window under the target point, for `type_text`/`key` the foreground window, and for
  `focus` the target window. The agent is told to ask you to do that step yourself.
- **Failsafe.** Move your mouse into any corner of any monitor. Every action is then refused, and the
  agent is told to stop and ask you. Actions work again once you move the mouse away. The agent can't
  move the mouse out of the corner itself, because `move` is refused too. A corner the agent moved
  the pointer to doesn't count.

**What it can't protect you from:**

- The tools control your **real** mouse and keyboard. Don't use the PC while the agent works, and
  watch what it does.
- Anything on screen becomes model input, including text written to manipulate the agent (prompt
  injection). Close or minimize sensitive windows. The blocklist stops input, but those windows still
  show up in screenshots.

**Tip for Claude Code:** Claude Code asks before each MCP tool call unless you allow the tool. A
middle ground is to auto-allow only the read-only tools in `settings.json` and keep prompts for
anything that clicks or types:

```json
{
  "permissions": {
    "allow": [
      "mcp__computer-use-windows__screenshot",
      "mcp__computer-use-windows__zoom",
      "mcp__computer-use-windows__elements",
      "mcp__computer-use-windows__windows"
    ]
  }
}
```

## Limitations

- **Windows only.** On other systems the server prints a message and exits with code 2. It was
  developed on Windows 11; reports from Windows 10 are welcome.
- **Apps running as administrator.** A non-elevated process can't send input to an elevated window
  (User Interface Privilege Isolation). Running your terminal as administrator works around this,
  but then the agent also runs with admin rights.
- **Lock screen and UAC prompts.** While the workstation is locked or a UAC prompt (secure desktop)
  is showing, screen capture fails with an access-denied error, and input can't reach the screen
  either. The error tells the agent to ask you to unlock or dismiss the prompt, then retry.
- **DRM-protected content** (some video players and streaming apps) may appear black in
  screenshots.
- **Some games** ignore injected input, and many expose no UI Automation elements.
- **`elements` depends on the app.** Standard Windows controls are described well. Some apps expose
  few elements or none, and then the agent falls back to `screenshot`. This happens with
  custom-drawn UIs, canvases and some Electron apps (for example Discord, and sometimes the Claude
  desktop app). See [Troubleshooting](#troubleshooting) for a tip. On very large trees, `elements`
  stops after about 2 seconds and returns what it found, so use `query` to narrow it.
- **Password detection** relies on the app marking the field as a password field. A field that
  doesn't report this won't be detected.
- **The terminal guard can't recognize every terminal.** It catches the agent's own host, console
  windows and the listed terminal apps. A terminal embedded in some other app is not detected, for
  example the integrated terminal of an editor the agent does not run in.
- **Coordinates go stale.** Coordinates refer to the last screenshot, and element ids to the last
  `elements` call. If the screen changes, the agent should look again.

## Troubleshooting

- **`uvx` is not recognized.** Open a new terminal after installing uv.
- **The server doesn't connect on first start.** The first run downloads dependencies. Run
  [step 2](#2-check-that-it-runs-optional) once, then restart your client.
- **"The foreground window is a terminal" or "…the terminal or editor running you".** This is
  expected: the agent should `focus` the target window first. If you really want keyboard input in
  a terminal, start the server with `--allow-terminal-input`.
- **"The user moved the mouse to a screen corner".** Your mouse is in a screen corner (the
  failsafe). Move it away.
- **Clicks land in the wrong place.** The screen changed since the last screenshot. Ask the agent to
  take a new one or use element ids.
- **`elements` finds nothing in an Electron or Chromium app.** Some of these apps expose no UI
  Automation tree by default, so the agent has to use screenshots. Many of them expose a full tree
  when started with the `--force-renderer-accessibility` command-line switch. It is worth trying,
  but it isn't guaranteed to work for every app.

## Development

```powershell
git clone https://github.com/SelmanBoray/eren-kit
cd eren-kit\packages\computer-use-windows
python -m venv .venv
.venv\Scripts\python -m pip install -e ".[dev]"
.venv\Scripts\python -m pytest                   # unit tests: never move the mouse or press keys
.venv\Scripts\python -m pytest -m integration    # opens a test window and takes over mouse and keyboard
.venv\Scripts\python -m ruff check .
```

Unit tests may take read-only screenshots and read the UI Automation tree of existing windows.
Integration tests open a small WinForms window (`CUW Test Form`) and drive it with your real mouse
and keyboard. Don't touch either until the tests finish.

To try your local checkout in Claude Code:

```powershell
claude mcp add cuw-dev -- C:\path\to\computer-use-windows\.venv\Scripts\python.exe -m computer_use_windows
```

Layout of `src/computer_use_windows/`:

| Module | Role |
|---|---|
| `server.py` | MCP server, the 12 tools, safety checks before every action |
| `config.py` | CLI flags and environment variables |
| `screen.py` | DPI awareness, monitors, capture, downscaling, coordinate mapping |
| `input.py` | Mouse and keyboard via `SendInput` |
| `uia.py` | Windows, UI Automation elements, the server's parent process chain |
| `safety.py` | Failsafe, blocklist, terminal and password guards |
| `instructions.py` | Server instructions and tool descriptions shown to the agent |

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) and the repository's [root CONTRIBUTING.md](../../CONTRIBUTING.md).

If this saves you a trip out of the terminal, a star helps other people find it.

## License

[MIT](LICENSE) © 2026 SelmanBoray

Not affiliated with or endorsed by Anthropic.
