# Evals

A small harness that measures two things with real `claude -p` runs instead of impressions.

1. **Terminal-first behavior.** With the computer-use-windows server installed, does the agent still do terminal-doable tasks with its shell (zero calls to our tools) and reach for the GUI tools only when the work is GUI-only? A call to a GUI tool on a task marked `gui_tools: "none"` is counted as a *terminal-first violation*.
2. **GUI token cost.** For GUI tasks, how many tokens, turns and tool calls does a task take with this server compared with [CursorTouch/Windows-MCP](https://github.com/CursorTouch/Windows-MCP)? Same tasks, same model, same harness.

No results are shipped in this repo. Run it yourself and read your own numbers.

## Warnings

- **GUI and hybrid tasks take over your real mouse and keyboard** and open a small test window (`tests/fixtures/test_form.ps1`). Do not touch the PC while they run. The runner refuses to run them without `--yes` and prints this warning first.
- Runs use **your own Claude Code login** and **count against your usage** (or cost money on an API key). Start with a small `--tasks` selection or `--kind terminal`.
- The runner sends nothing anywhere except what `claude` itself does.

## Task definitions (`tasks.json`)

```json
{
  "version": 1,
  "tasks": [
    {
      "id": "term-file",
      "kind": "terminal",
      "prompt": "Create a file named hello.txt in the current directory containing exactly: hello world",
      "setup": [],
      "expect": {
        "gui_tools": "none",
        "checks": [
          {"type": "file_contains", "path": "{workdir}/hello.txt", "text": "hello world"}
        ]
      },
      "max_turns": 15
    }
  ]
}
```

- `id`: unique slug (`[a-z0-9-]`).
- `kind`: `terminal` (shell can do it), `gui` (needs the GUI), or `hybrid` (shell to launch, GUI for the rest).
- `setup`: `[]` or `["test_form"]`; the runner launches the WinForms test form and waits for its window.
- `expect.gui_tools`: `"none"` means any GUI-tool call is a terminal-first violation; `"some"` means GUI tools are expected.
- `max_turns`: passed to `claude --max-turns`.
- **Placeholders** in `prompt` and check fields: `{workdir}` is a fresh empty temp directory per run (also the agent's cwd); `{repo}` is the repo root (absolute, forward slashes).

A task passes when **every** check passes. An empty `checks` list scores only the `gui_tools` expectation.

| Check type | Passes when |
|---|---|
| `file_contains` {path, text} | the file exists and contains `text` (UTF-8 substring) |
| `file_exists` {path} | the file exists |
| `answer_contains` {text} | the agent's final result text contains `text` (case-insensitive) |
| `form_result` {text} | after the run, the test form has an element whose UIA name or value equals `text` exactly |
| `clipboard_equals` {text} | the clipboard text equals `text` (trailing newline stripped) |

## Running

From the repo root:

```powershell
# See the exact claude command per task, run nothing
python evals/run_eval.py --server ours --dry-run

# Terminal tasks only (no mouse/keyboard takeover)
python evals/run_eval.py --server ours --kind terminal

# GUI / hybrid tasks: requires --yes, takes over mouse and keyboard
python evals/run_eval.py --server ours --kind gui --yes

# Same tasks against Windows-MCP, repeated 3 times
python evals/run_eval.py --server windows-mcp --kind gui --repeat 3 --yes
```

Options: `--server ours|windows-mcp` (required), `--model` (default `sonnet`), `--tasks id1,id2`, `--kind terminal|gui|hybrid`, `--repeat N`, `--dry-run`, `--yes`.

`--server windows-mcp` needs [uv](https://docs.astral.sh/uv/) installed. It runs Windows-MCP through `uvx` with its shell, file, registry and process tools disabled (so only GUI tools are compared) and telemetry off (`ANONYMIZED_TELEMETRY=false`). The server definitions are in `evals/servers/`.

Per task and repeat the runner creates a fresh workdir, performs setup, runs `claude -p` with `--output-format stream-json --verbose`, `--strict-mcp-config` with the chosen server file, `--max-turns`, `--no-session-persistence` and an allow-list covering the built-in shell/file tools plus every tool of the GUI server. It then cleans up (kills any test-form process, removes the workdir).

### Isolation

The runner isolates runs from your personal Claude Code customizations (hooks, global `CLAUDE.md`, plugins) as far as the CLI allows. `--bare` is not used because it requires an API key and would not work with a subscription login. The exact isolation flags used are **recorded in each results file**; check them there rather than assuming.

## Results

Each run writes `evals/results/<UTC timestamp>-<server>-<model>.json` (git-ignored) containing every per-run record plus the environment: `claude --version`, model, server, isolation flags, OS build and monitor layout. Per-run records include tool calls by name, GUI calls, screenshots, the final result text, token usage (input, output, cache creation, cache read), cost if reported, turns and duration.

A summary table is also printed to stdout:

| Column | Meaning |
|---|---|
| task | task id |
| kind | terminal / gui / hybrid |
| pass/fail | all checks passed |
| gui calls | calls to the GUI server's tools (`mcp__computer-use-windows__*` or `mcp__windows-mcp__*`) |
| screenshots | GUI calls that return a screenshot (tool names as seen in the stream) |
| turns | conversation turns |
| total tokens | input + output + cache creation + cache read |
| terminal-first violation | yes if GUI tools were used on a task with `gui_tools: "none"` |

## Caveats

- **LLM runs are noisy.** A single run says little; use `--repeat` and compare distributions, not one number.
- **Token totals include Claude Code's own system prompt** and tool definitions, so absolute numbers are inflated and not comparable across different models or Claude Code versions. Compare servers against each other on the same model and the same `claude` version, and read the difference.
- Tool definitions of each MCP server are part of the context, so a server's schema size contributes to its totals; that is a real cost of using it.
