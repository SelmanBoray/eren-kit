# Security Policy

## Reporting a vulnerability

Please report security issues privately using GitHub private vulnerability
reporting: open the **Security** tab of
<https://github.com/SelmanBoray/eren-kit> and choose **Report a vulnerability**.
Do not open a public issue for a security problem.

## Scope and things to know

- **computer-use-windows controls the real mouse and keyboard.** Anything an
  MCP client asks it to do happens on your actual desktop. Emergency stop:
  move the mouse to a screen corner. Never type passwords or payment details
  through it.
- **Brain (bellek) data is local.** Notes, indexes and the personal config
  (`bellek.toml`, `vault/`, `eval/data/`, `*.sqlite3*`) stay on your machine
  and must never be committed to the repository.
- **No personal data or secrets in commits.** Tokens, keys, `.env` files and
  personal information must never be committed. If you find any in the
  repository, report it as above.
