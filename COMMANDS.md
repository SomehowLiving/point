# Running Point locally — command reference

> For how to use Point (desktop snip overlay, extension, workspace) and a list of what's built, see [GUIDE.md](GUIDE.md).

Everything Point needs runs on your own machine: MongoDB and SearXNG in Docker, the backend and
frontend natively (so PowerShell/Windows-only pieces like Tesseract and Tauri native capture work
correctly), and the Chrome extension loaded unpacked. No cloud dependency, no Emergent.

**Known conflict on this machine:** port 3000 is currently used by an unrelated project. The
Chrome extension's content script is hardcoded to `http://localhost:3000/*` (see
`extension/manifest.json`), so the frontend **must** run on port 3000 for the extension's
capture-to-dashboard handoff to work. Free up port 3000 before starting the frontend, or the
extension flow (though not the plain web app) will break.

---

## 1. One-time setup (skip anything already done)

```powershell
# Backend: Python virtualenv + dependencies
cd backend
python -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt

# Frontend: Node dependencies
cd ..\frontend
yarn install

# Tesseract OCR (Windows binary, required for the primary OCR engine)
winget install --id UB-Mannheim.TesseractOCR
```

Then fill in `backend\.env` (already done on this machine) — see `backend\.env` for the exact
keys expected: `MONGO_URL`, `DB_NAME`, `CORS_ORIGINS`, one or more of
`OPENAI_API_KEY`/`GEMINI_API_KEY`/`OPENROUTER_API_KEY`/`GROQ_API_KEY` (only providers with a key
set are usable — the UI lets you pick per request), `TESSERACT_CMD`, `SEARXNG_URL`, and
optionally `NOTION_API_KEY` / `GITHUB_PAT_TOKEN` for the send-to-Notion / create-GitHub-issue
integrations.

---

## 2. Start the local services (every session)

Open **four terminals** (or run each in the background) — order matters a little: Mongo and
SearXNG before the backend.

### Terminal 1 — MongoDB (Docker)

```powershell
docker start point-mongo
# First time only, if the container doesn't exist yet:
# docker run -d --name point-mongo -p 27017:27017 mongo:7
```

### Terminal 2 — SearXNG (Docker, powers the real "Search" action)

```powershell
docker start point-searxng
# First time only, if the container doesn't exist yet:
# docker run -d --name point-searxng -p 8888:8080 `
#   -v "C:\Users\nidhi\dev\point\backend\searxng:/etc/searxng" `
#   -e BASE_URL=http://localhost:8888/ `
#   searxng/searxng:latest
```

### Terminal 3 — Backend (FastAPI, port 8001)

```powershell
cd backend
.\.venv\Scripts\python.exe -m uvicorn server:app --host 0.0.0.0 --port 8001 --reload
```

Confirm it's up: `curl http://localhost:8001/api/` should return `{"message":"..."}`  with
HTTP 200.

### Terminal 4 — Frontend (React dev server, port 3000)

```powershell
cd frontend
yarn start
```

Opens at **http://localhost:3000/capture**. Leave this running — it hot-reloads on save.

---

## 3. Load the Chrome extension

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. **Load unpacked** → select the `extension\` folder
4. Pin the extension so its icon is visible (optional, but the keyboard shortcuts work either way)

**Keyboard shortcuts** (work on any webpage once the extension is loaded):

| Shortcut | Action |
|---|---|
| `Alt+Shift+S` | Capture the visible viewport |
| `Alt+Shift+F` | Capture the full scrolling page |
| `Alt+Shift+L` | Toggle Real-Time Lens (click anything for an instant AI answer, no tab switch) |

Extension settings (dashboard URL, backend URL, Lens model) are at the extension's own **Details
→ Extension options**, or right-click the toolbar icon → Options.

---

## 4. Try it

- **Basic capture**: on any webpage, press `Alt+Shift+S` → a new tab opens at
  `localhost:3000/capture` with the screenshot loaded. Draw a region (or point, or lasso), pick
  an action (Ask/Explain/Copy/Search/Translate/Rewrite/Transform/Summarize/Extract/Compare), type
  an instruction, hit the arrow button.
- **Cross-screen reasoning**: after a capture loads, click **+ Add source** in the strip above
  the canvas to bring in a second screenshot (e.g. a terminal window via "Active display", or any
  image file) and ask something that spans both.
- **Real-Time Lens**: `Alt+Shift+L` on any page, then click anything — get an instant grounded
  answer in a floating panel, no tab switch.
- **Send to Notion / Create GitHub issue**: after an AI answer appears, use the buttons next to
  "Copy result" (needs `NOTION_API_KEY` / `GITHUB_PAT_TOKEN` set in `backend\.env`).
- **History**: `localhost:3000/history` — every non-private analysis is saved there.

---

## 5. Run the test suites

```powershell
# Backend (from backend\, with the venv and REACT_APP_BACKEND_URL set)
cd backend
$env:REACT_APP_BACKEND_URL = "http://localhost:8001"
.\.venv\Scripts\python.exe -m pytest tests\ -q
# Live-provider tests are marked `integration` and self-skip if a provider has no quota
# left, rather than failing — run them explicitly with: pytest tests\ -m integration

# Frontend (from frontend\)
cd ..\frontend
yarn test --watchAll=false
yarn build   # production build sanity check
```

---

## 6. Stopping everything

```powershell
docker stop point-mongo point-searxng
# Ctrl+C in the backend and frontend terminals
```

---

## 7. Troubleshooting

- **Extension opens a tab but nothing loads**: frontend isn't running on port 3000, or something
  else is using port 3000 — the extension's content script only matches that exact origin.
- **"AI service is not configured" (503)**: no API key set in `backend\.env` for the selected
  model's provider.
- **Search action returns nothing**: SearXNG container isn't running — `docker start point-searxng`.
- **OCR returns empty text**: check `TESSERACT_CMD` in `backend\.env` points to a real
  `tesseract.exe`, and that the Tesseract install actually completed.
- **Send to Notion / Create GitHub issue returns 503**: missing `NOTION_API_KEY` /
  `GITHUB_PAT_TOKEN` in `backend\.env`.
- **Create GitHub issue returns 403**: the token exists but lacks permission — for a
  fine-grained PAT, check both "Repository access" (must include the target repo) and
  "Permissions → Issues: Read and write".
