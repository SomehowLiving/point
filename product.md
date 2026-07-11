# Spatial AI Context Layer

## Product and Scope Reference

**Document audience:** Product, engineering, and design teams  
**Current product stage:** Functional MVP with browser, web, AI, OCR, history, export, and Windows packaging foundations  
**Last updated:** 2026-07-10

---

## 1. Product Summary

Spatial AI Context Layer lets users point to, select, draw over, redact, or capture anything visible on their screen and use it as structured context for AI.

The core interaction is:

> Press a shortcut → capture the screen → select what matters → give an instruction → receive an answer or structured output.

The product reduces the work required to move visual context into AI. Instead of taking a screenshot, cropping it, uploading it, and explaining where the model should look, users select the relevant visual area directly and continue their workflow.

### Product positioning

- A universal AI snipping tool.
- Print Screen, but for AI.
- Point at anything on screen and ask AI.
- A visual context layer between user attention, screen content, AI reasoning, and software actions.

---

## 2. Product Promise

Spatial AI should let users:

1. Capture only what they explicitly choose.
2. Point to one or more relevant screen regions.
3. Recover text and structure from visual content.
4. Ask AI questions grounded in the selected context.
5. Copy or export useful results immediately.
6. Preserve source metadata and capture history when desired.
7. Keep sensitive content private through temporary mode and pixel-level redaction.

---

## 3. Target Users

### Developers

- Capture errors, logs, dashboards, and broken interfaces.
- Compare evidence from multiple screen regions.
- Generate explanations, debugging context, structured data, and bug-report material.

### Designers

- Point to interface components and visual defects.
- Draw attention to specific areas.
- Compare interface states and prepare implementation notes.

### Support and operations teams

- Understand customer screenshots and operational dashboards.
- Recover error text and structured evidence.
- Prepare troubleshooting responses and escalation material.

### Researchers and knowledge workers

- Extract text and data from documents, websites, screenshots, and reports.
- Preserve source context.
- Summarize, translate, compare, and export visual information.

### General users

- Copy text that cannot normally be selected.
- Translate visible content.
- Understand unfamiliar interfaces or visual information.
- Convert screenshots into reusable text and data.

---

## 4. Current Platform Surface

The current product consists of four connected parts.

### 4.1 Web dashboard

The web dashboard is the primary working product interface. It provides:

- Capture workspace.
- Screenshot upload, paste, and drag-and-drop.
- Region selection and annotation.
- AI command bar and model selection.
- Deterministic OCR.
- Structured export.
- Capture history.
- Platform information.
- Privacy settings.

### 4.2 Chrome extension

The Manifest V3 Chrome extension provides browser capture and page enrichment.

It can:

- Capture the visible browser tab.
- Collect the page URL and title.
- Collect the canonical URL and page description.
- Capture selected text.
- Extract headings, visible text, links, and viewport metadata.
- Transfer the screenshot and page context into the web capture workspace.
- Record capture diagnostics in extension storage.

### 4.3 Windows desktop shell

The Tauri-based Windows shell provides the native capture boundary.

It currently includes:

- Global `Alt + Shift + S` shortcut registration.
- Active-display capture based on cursor position.
- All-monitor capture as a stitched virtual desktop.
- Window hide, capture, restore, and focus behavior.
- Display coordinates, dimensions, scale factors, and source metadata.
- Native clipboard integration.
- Per-Monitor V2 DPI awareness.
- Mixed-DPI capture diagnostics.
- NSIS and MSI package configuration.
- PFX-based code-signing automation.

### 4.4 FastAPI and MongoDB backend

The backend provides:

- Multimodal AI request routing.
- Streaming AI responses through server-sent events.
- Deterministic OCR.
- Structured exports.
- Capture persistence and history search.
- Private-mode processing without persistence.
- API validation and image normalization.

---

## 5. Current User Experience

### 5.1 Capture input

Users can currently provide screen context through:

- PNG upload.
- JPEG upload.
- WEBP upload.
- Clipboard image paste.
- Drag-and-drop.
- Chrome visible-tab capture.
- Windows active-display capture.
- Windows stitched multi-monitor capture.

Images are limited to 8 MB per request.

### 5.2 Region selection

The capture workspace supports:

- Rectangular selection.
- Multiple disconnected regions.
- Region numbering.
- Region removal.
- Normalized coordinates stored in the context bundle.

### 5.3 Annotation

Users can currently:

- Draw freehand marks.
- Add redaction strokes.
- Remove the capture and restart.

Redaction is not only visual. Redaction strokes are burned into the submitted image pixels before OCR or AI processing, preventing the model from receiving the hidden pixels.

### 5.4 AI command bar

The command bar supports:

- Free-form instructions.
- GPT-5.5 selection.
- Gemini 3.1 Pro selection.
- Streaming model output.
- Model and provider error handling.
- Canonical image conversion before provider submission.
- Explicit stream timeout and incomplete-stream errors.

### 5.5 Current AI actions

The user can choose:

- Ask.
- Copy.
- Explain.
- Search guidance.
- Translate.
- Summarize.
- Extract.
- Compare.

AI output is grounded using the screenshot, selected regions, annotations, source metadata, and deterministic OCR text when available.

---

## 6. Deterministic OCR

The platform includes a local, deterministic OCR pipeline separate from generative AI.

### Tesseract OCR

Tesseract is the primary OCR engine and currently provides:

- Extracted text.
- Line reconstruction.
- Word-level confidence scores.
- Word-level bounding boxes.
- Selected-region OCR.
- Image width and height metadata.
- Average confidence.

### PaddleOCR fallback

PaddleOCR is integrated as an isolated worker fallback.

The isolation is important because native Paddle runtime failures must not terminate the main API process. On the current ARM backend environment, Paddle can fail at the native runtime level; the worker is terminated safely and the system falls back to Tesseract.

### OCR behavior

- `auto` mode uses Tesseract first.
- PaddleOCR can be attempted when primary OCR confidence is insufficient.
- If Paddle is unavailable or crashes, Tesseract remains available.
- OCR is performed after user-applied pixel redaction.
- OCR text can be added to the AI context bundle.

---

## 7. Structured Export

OCR results can currently be copied or downloaded as:

- Plain text (`.txt`).
- Markdown (`.md`).
- JSON (`.json`).
- CSV (`.csv`).

### Export contents

Depending on the selected format, an export can contain:

- Extracted text.
- Word confidence.
- Region number.
- Bounding-box coordinates.
- Source application.
- Window title.
- Source URL.
- Capture title.

Clipboard failures are handled gracefully. If browser clipboard permission is unavailable, the interface attempts a safe fallback and shows a user-facing error instead of causing an unhandled page error.

---

## 8. Capture History

Non-temporary captures are stored in MongoDB.

Each stored capture can include:

- Capture ID.
- Creation timestamp.
- User instruction.
- Selected action.
- AI model.
- AI result.
- Deterministic OCR text.
- Selected regions.
- Annotations.
- Source application.
- Window title.
- URL.
- Browser page context.
- Display metadata.
- Screenshot thumbnail.

### History features

- Most recent captures first.
- Search by instruction.
- Search by result content.
- Search by source window title.
- Capture detail view.
- Capture deletion.
- Cache-safe refresh after new captures.

---

## 9. Privacy and Security Currently Built

### Explicit capture

The platform does not continuously record the screen. Capture begins only after an explicit user action.

### Temporary mode

When temporary mode is enabled:

- The screenshot is processed.
- AI or OCR output is returned.
- The capture is not written to MongoDB history.

### Pixel-level redaction

- Redacted pixels are replaced before OCR.
- Redacted pixels are replaced before AI submission.
- Model prompts explicitly state that redacted areas must not be inferred.

### Credential handling

- AI credentials remain on the backend.
- The frontend never receives the universal model key.
- Windows certificate paths and passwords are read from secure environment variables.
- Signing scripts do not store the certificate password in source code.

### Image validation

- Supported formats are PNG, JPEG, and WEBP.
- Base64 input is validated.
- Images are decoded and canonicalized before AI submission.
- Oversized images are rejected.

---

## 10. Chrome Extension Status

### Built

- Manifest V3 extension.
- Toolbar capture action.
- `Alt + Shift + S` browser command.
- Visible-tab screenshot capture.
- Page metadata enrichment.
- Dashboard handoff.
- Capture status diagnostics.
- Restricted-page failure behavior.

### Real-site validation completed

The unpacked extension has passed capture and enrichment tests on:

1. GitHub.
2. Wikipedia.
3. Amazon.
4. Stack Overflow.
5. Vercel.
6. Grafana Play.
7. Three.js examples.

Expected limitations remain for protected Chrome pages such as `chrome://extensions`, where browser security intentionally blocks capture or script injection.

---

## 11. Windows Desktop Status

### Native features built

- Global shortcut.
- Display-under-cursor capture.
- Stitched all-display capture.
- Negative virtual screen coordinates.
- Native pixel dimensions.
- Display scale factors.
- Active window title recovery.
- Clipboard integration.
- Frameless capture workspace.

### Mixed-DPI hardening built

- Per-Monitor V2 DPI awareness is enabled before capture initialization.
- Capture dimensions come from the actual captured bitmaps.
- Virtual desktop placement uses signed physical display coordinates.
- Capture metadata and bitmap dimensions are compared.
- Seam checks use a maximum two-physical-pixel tolerance.
- Hardware reports contain display geometry, scale factors, seam results, and a stitched PNG.

### Packaging built

- NSIS `.exe` target.
- WiX MSI target.
- Windows application icons.
- Local PowerShell build script.
- Self-hosted Windows build workflow.
- PFX-based Tauri `signCommand`.
- SHA-256 and RFC3161 timestamp configuration.
- Post-sign Authenticode verification.
- Signed package hash manifest.

### Physical validation status

The code, package configuration, and Windows target compile successfully. Physical Windows execution is still an external validation step because the current workspace does not have access to:

- The user's Windows 10 machine.
- The user's Windows 11 machine.
- The user's PFX certificate.
- The user's 100% and 150% mixed-DPI monitor topology.

The supplied scripts create the required evidence package when run on those machines.

---

## 12. Current Product Routes

### `/capture`

Primary screenshot selection, annotation, OCR, export, and AI workspace.

### `/history`

Searchable capture history and capture detail view.

### `/platforms`

Chrome extension and Windows shell status and setup information.

### `/settings`

Persistent privacy and retention preferences.

---

## 13. Current Backend API Scope

### System and model discovery

- `GET /api/`
- `GET /api/models`

### AI capture analysis

- `POST /api/captures/analyze`
- Streaming server-sent event response.

### Capture history

- `GET /api/captures`
- `GET /api/captures/{capture_id}`
- `DELETE /api/captures/{capture_id}`

### OCR

- `GET /api/ocr/status`
- `POST /api/ocr/extract`

### Structured export

- `POST /api/exports/render`

---

## 14. Current Architecture

### Frontend

- React.
- React Router.
- Shadcn UI components.
- Phosphor icons.
- Responsive desktop and mobile layouts.
- Tauri API bridge when running inside the Windows shell.

### Backend

- FastAPI.
- Pydantic request and response models.
- Server-sent events for AI streaming.
- Pillow for image decoding and normalization.
- Tesseract OCR.
- Isolated PaddleOCR worker.

### Database

- MongoDB.
- UUID string identifiers.
- MongoDB `_id` excluded from API responses.

### AI providers

- OpenAI GPT-5.5.
- Google Gemini 3.1 Pro.
- Emergent universal model key stored on the backend.

### Native Windows

- Tauri 2.
- Rust.
- XCap for monitor capture.
- Tauri global shortcut plugin.
- Tauri clipboard plugin.
- Windows Per-Monitor V2 DPI support.

### Browser extension

- Chrome Manifest V3.
- Service worker.
- `activeTab`, screenshot, scripting, tabs, and storage capabilities.
- Scoped dashboard bridge.

---

## 15. Current Quality and Validation Status

### Automated and implementation validation completed

- Frontend production build passes.
- Backend regression suite passes with 19 tests.
- Windows Rust source formats successfully.
- Windows `x86_64-pc-windows-msvc` target compilation passes.
- GPT-5.5 image analysis works after deterministic OCR.
- Gemini 3.1 Pro image analysis works.
- OCR extraction and region extraction work.
- Text, Markdown, JSON, and CSV export APIs work.
- JSON browser download works.
- Restricted clipboard behavior is handled safely.
- Private and saved capture flows work.
- Chrome extension real-site matrix passes seven websites.

### External validation still required

- Sign real installers with the user's PFX certificate.
- Install NSIS on physical Windows 10.
- Install MSI on physical Windows 11.
- Run the mixed-DPI probe on the user's 100% and 150% monitors.
- Return and review the generated Windows ZIP reports.

---

## 16. Scope of the Current Release

### In scope

- Explicit screenshot capture.
- Browser visible-tab capture.
- Windows monitor capture.
- Rectangular and multi-region selection.
- Freehand annotation.
- Manual redaction.
- Multimodal AI understanding.
- Deterministic OCR.
- Text recovery.
- Explain, copy, search guidance, translate, summarize, extract, and compare actions.
- Structured context bundles.
- Source URL and title capture.
- Page-context enrichment.
- Copy and file export.
- Capture history.
- Temporary mode.
- Windows installer and signing automation.
- Mixed-DPI diagnostics.

### Explicitly out of scope for the current release

- Continuous background screen recording.
- Autonomous clicking across arbitrary applications.
- Full-page browser capture.
- Scrolling-region capture.
- Live video understanding.
- Voice-first interaction.
- Mobile applications.
- macOS desktop support.
- Linux desktop support.
- Automatic long-term memory.
- Enterprise administration.
- Team workspaces and permissions.
- Automatic cloud synchronization.
- Dozens of external integrations.
- Autonomous issue creation.
- Production billing.
- User authentication and account management.

---

## 17. Known Product Limitations

### Selection editing

Regions can be created and removed, but they do not yet have full move, resize, and named-label editing controls.

### Annotation editing

Freehand and redaction are supported, but undo, redo, arrows, boxes, and relationship connectors are not complete.

### OCR language support

The current working OCR setup is optimized around English. Multi-language model installation and selection are future work.

### PaddleOCR runtime

PaddleOCR is isolated and integrated, but the current ARM environment does not provide a reliable native Paddle runtime. Tesseract remains the working deterministic engine.

### Browser capture depth

The extension captures the visible tab. Full-page and scrolling capture are not currently implemented.

### Native installation evidence

Installer code and compilation are complete, but final physical signing and installation evidence depends on user-controlled Windows hardware and credentials.

### External actions

The system currently produces answers and exports. It does not yet automatically create Linear, Jira, GitHub, Notion, Slack, or email items.

---

## 18. Product Scope by Phase

### Phase 1 — Completed: AI capture tool

- Select screen context.
- Ask AI.
- Recover text.
- Explain, translate, summarize, compare, and extract.
- Copy or export the result.

### Phase 2 — Substantially completed: Context transfer foundation

- Browser enrichment.
- Windows shell.
- Structured exports.
- Capture history.
- Native packaging and signing automation.

Remaining Phase 2 work:

- Full-page capture.
- Scrolling capture.
- Direct destination integrations.
- Production Windows hardware evidence.

### Phase 3 — Planned: Reusable visual workflows

- User-defined actions.
- Bug-report templates.
- Invoice, contact, and table extraction templates.
- Send-to-application actions.
- Repeatable developer and support workflows.

### Phase 4 — Planned: Context memory

- Projects and capture groups.
- Semantic search across captures.
- Linked captures and outcomes.
- Retention controls.
- Encrypted long-term context storage.

### Phase 5 — Future: Agent interaction layer

- Human-directed visual grounding for agents.
- Safe action approvals.
- Application-aware automation.
- Reusable visual agent skills.

---

## 19. Prioritized Next Scope

### P0 — Release completion

1. Run signed NSIS build on certificate-enabled Windows hardware.
2. Run signed MSI build on certificate-enabled Windows hardware.
3. Validate Windows 10 installation.
4. Validate Windows 11 installation.
5. Validate 100% and 150% mixed-DPI stitching.
6. Review Authenticode, seam, scale, and stitched-image reports.

### P1 — Capture quality

1. Resizable and movable region handles.
2. Region labels.
3. Undo and redo.
4. Arrows, boxes, and relationship connectors.
5. Full-page browser capture.
6. Scrolling-region capture.
7. Better image-to-selection coordinate mapping across aspect ratios.

### P1 — Structured extraction

1. Multi-language OCR.
2. Table structure detection.
3. Invoice schema.
4. Contact-list schema.
5. Bug-report schema.
6. Spreadsheet-row schema.
7. User-defined JSON schemas.

### P1 — Workflow actions

1. Create GitHub issue.
2. Create Linear issue.
3. Create Jira ticket.
4. Save to Notion.
5. Send to Slack.
6. Create email draft.

### P2 — Privacy and organization

1. Automatic sensitive-data detection.
2. Configurable retention cleanup.
3. Encrypted capture history.
4. Projects and capture collections.
5. Audit trail for automated actions.

---

## 20. Definition of Product Completion for the Current Release

The current release can be considered complete when:

1. The NSIS installer is signed and installs successfully on Windows 10.
2. The MSI installer is signed and installs successfully on Windows 11.
3. The installed executable has a valid Authenticode signature.
4. `Alt + Shift + S` captures the display under the cursor.
5. All-display capture correctly stitches a 100% and 150% mixed-DPI setup.
6. Seam diagnostics report a maximum two-pixel difference.
7. Screenshot selection, redaction, OCR, AI, export, and history work from the installed application.
8. The Chrome extension captures and enriches a real browser tab.
9. Temporary mode does not persist captures.
10. Signed hardware validation ZIP reports are retained for Windows 10 and Windows 11.

---

## 21. Team Guidance

### Product

- Keep the primary interaction centered on selecting visible context and acting immediately.
- Avoid expanding into broad automation before capture accuracy and trust are proven.
- Measure success using time-to-context, extraction accuracy, and result reuse.

### Design

- Preserve the direct capture workspace as the first product screen.
- Keep the command bar close to the selected visual context.
- Make privacy state and redaction behavior visible without adding workflow friction.
- Prioritize precise selection and readable structured output over marketing surfaces.

### Engineering

- Keep capture explicit and user-triggered.
- Preserve pixel-level redaction before every external processing step.
- Treat actual image dimensions as authoritative for mixed-DPI capture.
- Keep native OCR failures isolated from the main API process.
- Exclude MongoDB `_id` values from API responses.
- Keep credentials and signing secrets outside source code.
- Require regression and focused validation for capture, privacy, signing, and hardware changes.

---

## 22. Key Product Principle

Spatial AI Context Layer should remain the fastest trusted path between seeing something and using it as AI context.

The product is not intended to become a continuous screen recorder or an uncontrolled automation agent. Its advantage is precise, explicit, user-directed visual grounding.
