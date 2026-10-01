# Point — Spatial AI Context Layer

Press a shortcut → select anything on screen → ask → get an answer or an action.

No more screenshot, crop, upload, explain. Point lets you draw over any region of any app (images, video, PDFs, remote desktops, sites that block text selection) and hands exactly that region to the AI as context.

<!-- Replace with a 20–30s recording of point → ask → answer -->
![Demo](docs/demo.gif)

## Download

**Windows:** grab the latest `.exe` (NSIS) or `.msi` installer from [Releases](../../releases/latest).

## What it does

- **Snip overlay (desktop):** Alt+Shift+S anywhere → screen freezes → drag, ask, answer in place
- **Select:** region, freehand, point, multi-region, and cross-screen selection
- **Understand:** OCR, layout and table extraction, context-aware explanations
- **Act:** explain, summarize, translate, copy as a clean format, create a GitHub issue
- **Real-Time Lens:** action picker, drag/doodle selection, compare

## Stack

| Part | Tech |
|---|---|
| Desktop shell | Tauri (Rust) — `desktop/` |
| UI | React — `frontend/` |
| Backend | Python (FastAPI), Docker — `backend/` |
| Browser extension | `extension/` |
| CI | GitHub Actions builds signed Windows installers on `spatial-v*` tags |

## Run locally

- **How to use it, and what's built:** [GUIDE.md](GUIDE.md)
- **Command reference:** [COMMANDS.md](COMMANDS.md)

## Full product spec

See [docs/SPEC.md](docs/SPEC.md).
