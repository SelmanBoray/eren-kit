# Contributing

Thanks for your interest in eren-kit. This is a Windows-first monorepo.

## Repository layout

- `packages/bellek` - Python package `bellek`: brain memory MCP server, web UI, handoff hooks, evals.
- `packages/computer-use-windows` - Python MCP server for Windows desktop control.
- `packages/opus-orkestra` - skill (`skill/SKILL.md`), SessionStart hook and tests (plain Python).
- `apps/phone` - experimental phone app and server (npm workspaces, TypeScript, Node >= 24).
- `install.ps1` - installer at the repository root.

## Running tests

Use a virtual environment per Python package.

```powershell
# bellek (Python >= 3.12)
cd packages/bellek
python -m pip install -e ".[dev]"
python -m pytest

# computer-use-windows (Python >= 3.10)
cd packages/computer-use-windows
python -m pip install -e ".[dev]"
ruff check .
ruff format --check .
python -m pytest        # integration tests (real mouse/keyboard) are opt-in: -m integration

# opus-orkestra
cd packages/opus-orkestra
python -m pip install pytest
python -m pytest tests

# phone
cd apps/phone
npm ci
npm run test:protocol
npm run typecheck:protocol
npm test -w server
npm run typecheck -w server
```

## Commits

- Keep commits small and focused; one logical change each.
- Write clear, imperative commit messages.
- Pull the latest remote commits before you continue working.
- Open a pull request against `main`; CI must pass.

## Personal data and secrets

Never commit personal data, notes, vault contents, databases, tokens, keys or
`.env` files. Local config such as `packages/bellek/bellek.toml` is git-ignored;
use the `*.example.*` files for documentation.

## Assistant name

Do not hard-code an assistant name in new code, docs or tests. Read it from the
`EREN_KIT_ASSISTANT_NAME` environment variable (with a neutral default).

## Security

Report vulnerabilities privately, see [SECURITY.md](SECURITY.md).
