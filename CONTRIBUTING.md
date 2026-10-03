# Contributing to Point

Thanks for helping out! Point is a Windows-first app made of four parts. You can work on any one
of them without touching the others:

| Part | Folder | Stack |
|---|---|---|
| Backend | `backend/` | Python, FastAPI |
| Web workspace + snip overlay UI | `frontend/` | React (Create React App + craco) |
| Desktop shell | `desktop/src-tauri/` | Rust, Tauri 2 |
| Chrome extension | `extension/` | Manifest V3, plain JS |

## Setup

Follow [COMMANDS.md](COMMANDS.md) for the full local setup. In short:

```powershell
cd backend;  python -m venv .venv; .\.venv\Scripts\pip install -r requirements.txt; copy .env.example .env
cd ..\frontend; yarn install; copy .env.example .env
```

Add at least one AI provider key to `backend\.env` (or in the app's Settings page). MongoDB and
SearXNG are optional: without them the backend uses SQLite and DuckDuckGo.

The desktop shell needs Rust and the Visual Studio C++ Build Tools. Build it from **PowerShell**,
not Git Bash (Git Bash's `link` command hides the MSVC linker).

## Running the tests

```powershell
# Backend: start the backend on :8001 first, then
cd backend
$env:REACT_APP_BACKEND_URL = "http://localhost:8001"
.\.venv\Scripts\python.exe -m pytest tests -m "not integration"

# Frontend
cd frontend
yarn test --watchAll=false

# Desktop shell (type-check)
cd desktop\src-tauri
cargo check
```

Tests marked `integration` call real AI providers and need API quota; they're skipped by the
command above.

## Pull requests

- Keep each PR focused on one change, and describe what it does and how you tested it.
- Add or update tests for behaviour changes.
- Match the style of the surrounding code.
- Never commit API keys or `.env` files. `.env.example` files hold variable names only.
- UI changes: include a screenshot or short clip.

## Releases (maintainers)

Pushing a `spatial-v*` tag builds the Windows installers in GitHub Actions
(`.github/workflows/windows-installers.yml`) and attaches them to a GitHub Release. The build
freezes the backend with PyInstaller, bundles Tesseract, and smoke-tests the bundled backend
before packaging.

## Reporting bugs and security issues

Open a GitHub issue for bugs and feature requests. For security vulnerabilities, follow
[SECURITY.md](SECURITY.md) instead. Please don't open a public issue for those.
