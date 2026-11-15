# Contributing

Thanks for your interest in eren-kit. This is a Windows-first monorepo.

## Repository layout

- `packages/bellek` - Python package `bellek`: brain memory MCP server, web UI, handoff and doc gate hooks, evals.
- `packages/computer-use-windows` - Python MCP server for Windows desktop control.
- `packages/opus-orkestra` - skill (`skill/SKILL.md`), SessionStart hook and tests (plain Python).
- `apps/phone` - experimental phone app and server (npm workspaces, TypeScript, Node >= 24).
- `install.ps1`, `install.sh` - installers (Windows, macOS) at the repository root; their modules and tests live in `scripts/installer`.

## Running tests

Use a virtual environment per Python package.

```powershell
# bellek (Python >= 3.12)
cd packages/bellek
python -m pip install -e ".[dev]"
python -m pytest

# computer-use-windows (Python >= 3.11)
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
cd app
node --test "test/**/*.test.ts"
cd ..
node --disable-warning=ExperimentalWarning --test "kurulum/test/**/*.test.ts"

# phone Kotlin core
cd apps/phone/app/modules/eren-device/cekirdek
./gradlew test

# installer scripts (repository root; the four tests in test_install_macos.py pass only on macOS)
python -m pytest -q scripts/installer/tests

# privacy scanner (repository root)
python -m pytest -q scripts/tests
python scripts/gizlilik_tara.py
```

The phone server tests include one that fails while the live phone service is
running (named pipe clash). On a machine with the service running, add
`--test-skip-pattern="ikinci süreçte false"` to `npm test -w server`.

Run `python scripts/gizlilik_tara.py` before opening a pull request. If it
reports a finding, fix it or add a narrow, justified line to
`.github/gizlilik-izinli.txt`.

The scanner's forbidden-word rule (personal names) reads its list from the
`GIZLILIK_YASAK` environment variable, which CI fills from a repository secret.
When the secret is empty, the `gizlilik` job warns on pull requests and fails
on pushes to `main`. Pull requests from forks never receive the secret, so
before merging one a maintainer runs the full scan locally with
`GIZLILIK_YASAK` set.

After changes to the installer scripts, a quick check is
`python scripts/installer/doktor.py --claude-home <temporary directory> --no-network`.

## Commits

- Keep commits small and focused; one logical change each.
- Write clear, imperative commit messages.
- Pull the latest remote commits before you continue working.
- Open a pull request against `main`; CI must pass. GitHub Actions in the
  workflows are pinned to full commit SHAs; Dependabot proposes updates.

## Personal data and secrets

Never commit personal data, notes, vault contents, databases, tokens, keys or
`.env` files. Local config such as `packages/bellek/bellek.toml` is git-ignored;
use the `*.example.*` files for documentation.

## Assistant name

Do not hard-code an assistant name in new code, docs or tests. Read it from the
`EREN_KIT_ASSISTANT_NAME` environment variable (with a neutral default).

## Security

Report vulnerabilities privately, see [SECURITY.md](SECURITY.md).
