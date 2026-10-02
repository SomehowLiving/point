# Point — User & Operator Guide

How to run Point on your own machine and use it day to day, plus an inventory of what has been
built. For the raw command reference see [COMMANDS.md](COMMANDS.md); for the product vision see
[docs/SPEC.md](docs/SPEC.md).

---

## 0. Just want to use it?

1. Download **`Point_x64-setup.exe`** from [Releases](../../releases/latest) and run it.
2. Open **Point** from the Start menu → **Settings** → paste an API key for at least one AI
   provider (OpenAI, Gemini, OpenRouter or Groq) → **Save keys**.
3. Press **`Alt+Shift+S`** anywhere and ask about what's on your screen.

That's it: the installer includes everything (backend, OCR, local history database). No Python,
Docker or command line needed. The rest of this guide is for running Point from source and for
the details.

---

## 1. What Point is made of

| Piece | Where | What it does | Works in |
|---|---|---|---|
| **Desktop app** (Tauri/Rust) | `desktop/` | System-wide `Alt+Shift+S` snip overlay: freeze the screen, select, ask, answer in place | Any Windows app — VS Code, PDFs, video, remote desktops |
| **Chrome extension** | `extension/` | Capture the current tab or full page into Point; Real-Time Lens for instant in-page answers | Chrome / Chromium browsers |
| **Web workspace** (React) | `frontend/` | The full capture UI: all selection tools, OCR, multi-source, history, integrations | Browser at `localhost:3000`, and inside the desktop app |
| **Backend** (FastAPI) | `backend/` | AI analysis (streaming), OCR, web search, history, Notion/GitHub integrations | Dev: port `8001`. Installed app: bundled, port `47811` |
| **MongoDB + SearXNG** (Docker) | — | Dev only. History storage and private web search. The installed app uses SQLite and DuckDuckGo instead | Local, ports `27017` / `8888` |

Everything runs locally. Your screenshots only leave the machine when they're sent to the AI
provider you pick for a request.

---

## 2. Start it

You need the four local services running before any of the clients will work. See
[COMMANDS.md §1](COMMANDS.md) for the one-time setup (Python venv, `yarn install`, Tesseract,
`backend\.env` with at least one AI provider key).

```powershell
# 1. Docker Desktop must be running, then:
docker start point-mongo point-searxng

# 2. Backend
cd backend
.\.venv\Scripts\python.exe -m uvicorn server:app --host 0.0.0.0 --port 8001

# 3. Frontend (keep it on port 3000 — the extension and the desktop dev build expect it)
cd frontend
yarn start
```

Check: `http://localhost:8001/api/` returns HTTP 200 and `http://localhost:3000/capture` loads.

### Desktop app

```powershell
cd desktop\src-tauri
cargo run
```

Run this from **PowerShell**, not Git Bash: Git Bash's own `link` command hides the MSVC linker
and the build fails. The first build takes a few minutes. It needs Rust plus **Visual Studio C++
Build Tools** (`winget install Microsoft.VisualStudio.2022.BuildTools` with the *Desktop development
with C++* workload). The debug build loads the UI from `localhost:3000`, so the frontend must be
running.

### Or install it

See [§0](#0-just-want-to-use-it). The installed app runs its own copy of the backend in the
background (on `127.0.0.1:47811`, so it never clashes with a dev backend on `8001`) and stops it
when you close Point. Its data lives in `%LOCALAPPDATA%\com.spatialai.contextlayer\`:
`point.db` (history) and `settings.json` (your API keys). Delete that folder to reset Point.

### Chrome extension

1. Open `chrome://extensions` and turn on **Developer mode**.
2. **Load unpacked** → select the `extension\` folder.
3. Optional: pin it. The shortcuts work either way.

Settings (dashboard URL, backend URL, Lens model) are under the extension's **Details → Extension
options**.

---

## 3. Using the desktop snip overlay

The fastest way to use Point. It works over anything on screen.

| Step | Do this |
|---|---|
| Open | Press **`Alt+Shift+S`** anywhere. The monitor under your cursor freezes and dims. |
| Select a region | **Drag** a box. Drag again to add more regions (up to 12). |
| Point at something | **Click** (without dragging) to drop a point marker. |
| Ask | The command bar appears next to your selection. Pick an action, type a question (optional), press **Enter**. |
| Read | The answer streams in place, formatted, and scrolls if it's long. |
| Copy | Click the clipboard button on the answer card. |
| Go further | **Open in Point** sends the screenshot to the full workspace (OCR, lasso, redaction, multi-source). You'll redraw the selection there. |
| Back out | **`Esc`** steps back: closes the answer → clears the selection → closes the overlay. |

Leave the question empty to use a sensible default for the action, for example *"Explain what
matters in this selection"*. The command bar sits below your selection, above it, or inside it,
wherever it fits, and always stays on screen.

---

## 4. Using the Chrome extension

| Shortcut | What happens |
|---|---|
| **`Alt+Shift+S`** | Screenshots the visible tab and opens it in the Point workspace, already loaded |
| **`Alt+Shift+F`** | Same, for the full scrolling page |
| **`Alt+Shift+L`** | Toggles **Real-Time Lens**: click anything on the page for an instant answer in a floating panel, without leaving the page |

The extension also sends page context with the screenshot (URL, title, selected text, headings,
visible text), so answers about web pages are better grounded.

> On a machine that runs both the desktop app and the extension, `Alt+Shift+S` is claimed by
> whichever registered it first. The desktop app's global shortcut usually wins. Remap the
> extension's shortcut at `chrome://extensions/shortcuts` if you want both.

---

## 5. Using the full workspace (`localhost:3000/capture`)

Load a screenshot by **Open image**, drag-and-drop, paste, the extension, or (in the desktop app)
**Active display** / **All displays**.

**Selection tools** (toolbar): Select region · Point · Lasso · Draw · Redact · Pan, plus zoom,
undo/redo (`Ctrl+Z` / `Ctrl+Shift+Z`), and region rename/reorder.

**OCR**: recovers text from the image with word boxes and confidence. Redacted areas are removed
before anything is sent anywhere.

**Multi-source**: **+ Add source** brings in a second screenshot (another window or display, or
an image file). Ask questions that span both, e.g. compare a terminal error with the code.

**Temporary mode** (toggle): the analysis isn't saved to History.

**After an answer**: copy it, **send it to Notion** (paste a page URL), or **create a GitHub issue**
(type `owner/repo`). Both are remembered after first use, and need `NOTION_API_KEY` /
`GITHUB_PAT_TOKEN` in `backend\.env`.

**History** (`/history`): every non-temporary analysis, searchable.

---

## 6. Actions and models

Available in both the snip overlay and the workspace:

| Action | Use it to |
|---|---|
| **Ask** | Ask anything about the selection |
| **Explain** | Understand what's shown and why it matters |
| **Copy** | Get the exact text out, even from images, video, or sites that block selection |
| **Search** | Search the web for what's selected (via local SearXNG), with sources |
| **Translate** | Translate the selected text |
| **Rewrite** | Rewrite the selected text |
| **Transform** | Convert content to another format, e.g. a table |
| **Summarize** | Get the short version |
| **Extract** | Pull structured data: Auto, Table, Key-value, Contacts, Tasks, or JSON |
| **Compare** | Compare multiple regions or sources |

**Models:** GPT-5.5, Gemini 3.1 Pro, OpenRouter, Groq. Only providers with a key set in
**Settings** (or `backend\.env` in dev) will work. Picking one without a key returns *"AI service
is not configured"*.

Copy, Rewrite, Translate and Transform results are shown verbatim. Everything else is rendered
as formatted text.

---

## 7. What has been built

**Desktop app (`desktop/`)**
- Global `Alt+Shift+S` snip overlay that freezes the monitor under the cursor, pixel-aligned
  (verified at 125% scaling, Per-Monitor V2 DPI aware).
- In-place region and point selection, the full command bar, a streaming answer card, Copy, and
  hand-off to the full workspace.
- Active-display and all-displays (stitched, mixed-DPI) capture in the workspace.
- Native clipboard, and a hardware-validation probe (`desktop/validate-hardware.ps1`).
- Self-contained NSIS `.exe` and `.msi` installers via `desktop/build-windows.ps1`: the backend
  is frozen with PyInstaller (`desktop/build-backend.ps1`) and ships with Tesseract, then runs as
  a hidden background process. Code-signed when a certificate is configured.

**Chrome extension (`extension/`)**
- Visible-tab and full-page capture with page-context enrichment.
- Real-Time Lens: in-page click-to-answer, with action picker, drag/doodle selection and compare.
- Options page for the dashboard URL, backend URL and Lens model.

**Web workspace (`frontend/`)**
- Region, point, lasso, freehand and redaction tools, zoom/pan, undo/redo, named and reorderable
  regions.
- OCR with word boxes, structured extraction views, and copy/export bar.
- Multi-source (cross-screen) reasoning, Temporary mode, History.
- Send to Notion and Create GitHub issue.
- Markdown-rendered answers (safe renderer, no HTML injection).

**Backend (`backend/`)**
- Streaming analysis across GPT, Gemini, OpenRouter and Groq.
- Tesseract OCR. Web search via SearXNG, falling back to DuckDuckGo when SearXNG isn't running.
- History in MongoDB (dev) or a local SQLite file (installed app).
- API keys entered in **Settings** and stored on the user's machine, overriding `backend\.env`.
- Notion and GitHub (REST API) integrations.

**Repo and release**
- GitHub Actions builds the Windows installers and attaches them to a GitHub Release on every
  `spatial-v*` tag.
- Demo recording in `docs/demo.gif` / `docs/demo.mp4`.

---

## 8. Known limitations

- **Open in Point** doesn't carry the snip selection over. You redraw it in the workspace.
- The snip overlay freezes one monitor (the one under the cursor), not all of them.
- The snip overlay doesn't have Lasso, Draw or Redact yet. Use Open in Point for those.
- Installers are **unsigned** unless a code-signing certificate is configured, so Windows
  SmartScreen shows "Windows protected your PC". Click **More info → Run anyway**. To sign, set
  the repo secrets `WINDOWS_CERT_BASE64` (the base64-encoded `.pfx`), `WINDOWS_CERT_PASSWORD` and
  `TIMESTAMP_URL`.
- Every user needs their own AI provider API key. There's no hosted Point account.
- The installer is large (the backend runtime plus Tesseract), roughly 100+ MB.
- Keys in `settings.json` are stored in plain text in the user's own profile folder, not in the
  Windows Credential Manager.

---

## 9. Troubleshooting

| Symptom | Fix |
|---|---|
| `Alt+Shift+S` does nothing | Is the desktop app running? Is another app or the extension holding the shortcut? |
| Snip shows Point's own window | Minimize the Point workspace window before snipping |
| Desktop build: `link: extra operand` | You're in Git Bash. Use PowerShell. |
| Desktop build: `link.exe not found` | Install Visual Studio C++ Build Tools |
| "AI service is not configured" (503) | Add a key for that model's provider in **Settings** (or `backend\.env` in dev) |
| Installed app: "Settings could not be loaded" | The bundled backend didn't start. Close Point fully and reopen it. If another program uses port `47811`, free that port. |
| Search returns nothing | Dev: `docker start point-searxng`. Otherwise Point falls back to DuckDuckGo, so check your internet connection. |
| OCR returns empty text | Check that `TESSERACT_CMD` in `backend\.env` points to a real `tesseract.exe` |
| Extension opens a tab but nothing loads | The frontend isn't on port 3000, or another app is using that port |
| `docker start` fails with a pipe error | Docker Desktop isn't running. Start it first. |
