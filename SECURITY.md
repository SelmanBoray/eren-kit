# Security Policy

## Reporting a vulnerability

Please report security issues privately using GitHub private vulnerability
reporting: open the **Security** tab of
<https://github.com/SelmanBoray/eren-kit> and choose **Report a vulnerability**.
Do not open a public issue for a security problem.

eren-kit is alpha software maintained by one person. Fixes land on `main`;
there are no maintained release branches. Reports are answered on a best-effort
basis.

## What eren-kit assumes

- **One user, one machine.** The tools run as you, on your own Windows (or
  macOS) account. Another program running as you can already read your data;
  eren-kit does not try to defend against it.
- **You trust your model provider.** Everything Claude reads through these
  tools (brain entries, screenshots, screen text) is sent to your model
  provider with the rest of the session.
- **The model can be misled.** Anything Claude reads (a web page, a document,
  text on screen) may try to steer it. The limits below are mostly about what a
  misled model can do with these tools.

## What it does to protect you

- The brain service listens on `127.0.0.1` only. It checks the `Host` and
  `Origin` headers and a per-install token on its API, so other websites open
  in your browser cannot read or write it.
- The `beyin` MCP server and the brain service are registered with
  `python -I`, so no code is loaded from the folder Claude Code was opened in.
  The installation doctor flags Python MCP registrations that could load such
  code, and a repository folder that other accounts can write to.
- The installer needs no administrator rights, backs up what it changes and
  shows every change with `-DryRun` first.
- `beyin_yaz` rejects text that looks like a secret; the brain export respects
  private and secret branches.
- computer-use-windows refuses to type into password fields and terminals,
  honours an app blocklist and stops when you move the mouse into a screen
  corner.
- The Opus Orkestra ledger (`defter`) does not record files outside the
  repository, inside `.git` or ignored by git (such as `.env`), and does not
  run external commands from the repository's git configuration.
- A privacy scanner checks every tracked file in CI for personal paths, e-mail
  addresses, token-shaped strings and large binaries.

## Known limits

These are open on purpose or still waiting for a design decision. Plan around
them.

- **The brain is written by the model.** Claude can add facts to the brain
  and decide inbox items through MCP without asking you. A model misled by a
  web page or document it read could leave a note that later sessions read as
  your rule (prompt injection that carries over to later sessions).
  Mitigation: review new entries in the brain web UI (`beyin ac`), and don't
  connect the `beyin` MCP server in sessions that read untrusted content.
- **computer-use-windows can act outside Claude Code's permission rules.**
  Through Win+R, the Start menu or any file dialog it can start programs,
  which Claude Code's Bash allow/deny rules and sandbox don't cover. Its
  blocklist is empty until you set it (the installer doesn't ask), and it
  stops input and element reading, not screenshots; a title another app
  shortens or rewords can still show, and through the Windows shell the
  agent can still bring forward, minimize or close a blocked app. Keep
  approving its `click`, `type_text` and `key` calls one by one, set a
  blocklist (see the package README's
  [Recommended setup](packages/computer-use-windows/README.md#recommended-setup)),
  and don't connect it in sessions where those rules are your security
  boundary.
- **Handoff notes are plain text.** Automatic notes quote short excerpts of a
  session's first and last prompt and are written to your vault folder. If
  that folder syncs to a cloud service, this text leaves your machine.
- **Installer backups are plain text.** `<ClaudeHome>\backups\eren-kit\`
  holds copies of `settings.json` and MCP registrations, including `env`
  values that may contain tokens. `-Uninstall` does not delete them. Delete
  the folder when you no longer need it and keep it out of dotfiles
  repositories.
- **The Opus Orkestra ledger can leave with a mirror push.** Ledger content is
  kept under `refs/orkestra/defter`. A plain `git push` does not send it, but
  `git push --mirror`, a `refs/*` refspec and `git clone --mirror` do,
  including recorded working-tree content that was never committed.
- **Phone service (experimental).** On a Windows machine with several user
  accounts, another local account can claim the service's fixed named-pipe
  names first and keep the service from starting. The part of the service
  that runs before authentication is reachable from your whole tailnet;
  restrict it with tailnet ACLs. Details (Turkish):
  [apps/phone/docs/GUVENLIK.md](apps/phone/docs/GUVENLIK.md).

## Personal data and secrets

Notes, the brain database and personal config (`bellek.toml`, `vault/`,
`eval/data/`, `*.sqlite3*`) stay on your machine and must never be committed.
Tokens, keys, `.env` files and personal information must never be committed
either. If you find any in the repository, report it as above.
