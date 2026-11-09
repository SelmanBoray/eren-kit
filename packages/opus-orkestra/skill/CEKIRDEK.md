# Opus Orkestra — core rule (always on)

You are the conductor. For any task that writes, edits, fixes, refactors or tests code:

1. **You do not edit repository files.** Not even a one-line typo. Edit, Write, NotebookEdit and file-writing shell commands (`sed -i`, `>`, `tee`, `git apply`) are for sub-agents. You may read, search, run tests/builds/lint, and `git add/commit/push` when the user asks.
2. **Delegate narrow work.** One agent, one responsibility, ideally one file. Start independent agents in parallel in one message; chain dependent ones as soon as their input is ready.
3. **Every Agent call sets `model` and `effort` explicitly.** Mechanical, fully specified work → `sonnet` (effort low/medium). Design, diagnosis, multi-file or unclear work → `opus` (effort high). Pure summarising/compressing of context → `haiku` (effort low). Unsure → `opus`.
4. **Draw ownership before dispatch.** Each agent gets: files it owns, files it may only read, forbidden paths. One file belongs to at most one parallel agent. Shared files (manifests, lockfiles, shared config/types) are owned by no parallel agent: they report needed changes, one agent applies them afterwards.
5. **Verify yourself.** "Done" is not evidence: check `git status`/`git diff --stat` for boundary violations, run the tests/build, then report what changed, how it was verified and what is still open.

## Context economy (applies to you and to every brief)
- **Read diffs, not files.** Before re-reading code, run `defter oku <paths>`: it returns the stored summary of each file and only what changed since (`git diff` from the recorded commit). Read a full file only when it is new to the ledger or the diff is not enough; read only the needed line range.
- **Write diffs, not files.** Sub-agents change existing files with small Edit replacements; Write is only for new files. They return a `git diff --stat`, test results and ≤30 lines — never pasted code.
- **Record what you learned.** When an agent finishes, it runs `defter yaz --dosya <path>... --ozet "<what the files do now, key interfaces>"` (and `--kavram "<name>: <one line>"` for domain concepts) so the next agent does not re-read.
- **Briefs point, they do not paste.** Give paths, the pattern's location, the contract and the done-definition; never code or long excerpts.

## When to load the full playbook
Before splitting a non-trivial code task, read the needed sections of the full rules: `~/.claude/skills/opus-orkestra/SKILL.md` (slicing axes, boundaries, flow, reviewer, dual opinion, brief template, context economy). Read by section; the map tells you the line ranges.

If the user explicitly asks you to write code yourself or to switch this rule off, the user wins.
