# Spatial AI Context Layer — Product Requirements Document

## Original Problem Statement

Build a system-wide spatial interface that lets people point to, select, draw over, redact, or capture anything visible on screen and use it as structured AI context. The core interaction is: **press a shortcut → select anything on screen → give an instruction → receive an answer or trigger an action**.

The initial product should validate a Windows desktop application and Chrome extension around rectangular selection, freehand annotation, OCR/multimodal understanding, a command bar, core AI actions, multi-region comparison, browser metadata, clipboard copy, capture history, and sensitive-data redaction. It must avoid continuous recording, broad autonomous clicking, enterprise administration, mobile support, voice-first interaction, and live video in the first release.

## User Choices

- Deliverables: Chrome extension prototype, Windows desktop scaffold, and web dashboard.
- AI models: OpenAI GPT-5.5 and Google Gemini 3.1 Pro.
- AI credentials: Emergent universal LLM key.
- Input: screenshot upload/paste, drawing/selection, and Chrome extension capture scaffold.
- Persistence: MongoDB capture history plus temporary/private mode.

## User Personas

1. **Developers** — move errors and context between browsers, terminals, IDEs, dashboards, and issue trackers.
2. **Designers** — point to interface elements, annotate changes, compare screens, and create implementation notes.
3. **Support and operations teams** — explain incidents, extract evidence, and turn visual context into responses or tickets.
4. **Researchers and knowledge workers** — extract structured information, preserve sources, summarize, and compare material.
5. **General users** — recover blocked text, translate visible content, understand interfaces, and search visual subjects.

## Architecture Decisions

- **Frontend:** React capture workspace with responsive dashboard routes for Capture, History, Platforms, and Settings.
- **Backend:** FastAPI under `/api`, with streaming SSE responses for multimodal analysis.
- **Database:** MongoDB via the configured `MONGO_URL`; captures use UUID string IDs and API responses exclude MongoDB `_id`.
- **AI routing:** `emergentintegrations` creates a fresh chat per request and streams GPT-5.5 or Gemini 3.1 Pro output.
- **Privacy:** explicit capture only; temporary mode skips MongoDB; redaction strokes are burned into submitted image pixels before model access.
- **Extension:** Manifest V3 service worker captures the visible tab and a scoped bridge transfers screenshot, URL, and title into the dashboard.
- **Desktop:** Tauri 2 Windows shell scaffold registers `Alt+Shift+S` and opens/focuses the capture workspace.
- **Image constraints:** base64 PNG, JPEG, or WEBP; maximum 8 MB.

## Core Requirements (Static)

- Upload, paste, or receive a screenshot from the browser extension.
- Select one or multiple rectangular regions.
- Draw freehand annotations and redact sensitive pixels.
- Enter an instruction through a floating command bar.
- Choose GPT-5.5 or Gemini 3.1 Pro.
- Run copy, explain, search, translate, summarize, extract, and compare actions.
- Stream model responses into the result panel.
- Copy the final result to the clipboard.
- Persist non-temporary captures and search or delete their history.
- Preserve source application, window title, URL, regions, annotations, action, model, and timestamps.
- Expose explicit privacy controls and never continuously record the screen.
- Work without horizontal overflow at desktop and mobile browser widths.

## Implemented

### 2026-07-10 — Signed Hardware Validation Hardening

- Added Windows Per-Monitor V2 DPI awareness before native capture initialization.
- Corrected virtual-desktop stitching to use captured physical bitmap dimensions with signed monitor coordinates, including negative virtual origins.
- Added display capture metrics, physical scale ratios, metadata/capture consistency checks, virtual bounds, seam diagnostics, and stitched PNG evidence.
- Added `--hardware-report` native mode with deterministic pass/fail exit codes and a two-pixel seam tolerance.
- Added local PFX signing through Tauri `signCommand`, required secure environment variables, SHA-256/RFC3161 timestamping, and post-sign Authenticode verification.
- Added signed NSIS/MSI manifest generation with installer hashes, signer, and timestamp details.
- Added a one-command Windows 10/11 hardware validator that installs the OS-specific package, verifies signatures, checks 100%/150% topology, runs the native probe, and returns a ZIP report.
- Added self-hosted Windows workflow support for building, signing, verifying, and collecting both installers.
- Windows target compilation, frontend production build, and 19 backend regressions pass. Mandatory focused testing review confirmed the implementation.
- External action remains: real signing and physical Windows 10/11 dual-monitor execution require the user's PFX environment and Windows hosts; these were not available in the Linux workspace.

### 2026-07-10 — Native Packaging, Extension Validation, and Deterministic OCR

- Upgraded the Tauri shell from scaffold to native Windows capture source with active-monitor and stitched all-monitor capture, explicit hide/capture/show behavior, source display metadata, clipboard plugin, and `Alt+Shift+S` capture.
- Configured both NSIS `.exe` and WiX `.msi` installers, generated Windows icon assets, added a local PowerShell packaging script, and added a Windows CI artifact workflow.
- Cross-checked the Rust source against `x86_64-pc-windows-msvc`; formatting and target compilation pass.
- Upgraded the Manifest V3 extension with DOM/page enrichment, capture status diagnostics, and a repeatable real-Chrome validation harness.
- Validated unpacked extension capture and enrichment on GitHub, Wikipedia, Amazon, Stack Overflow, Vercel, Grafana, and Three.js; all seven sites passed.
- Added deterministic Tesseract OCR with text, line structure, confidence, word boxes, image dimensions, and region-only extraction.
- Added PaddleOCR as an isolated worker fallback so provider/runtime crashes cannot terminate the API; the current ARM host safely falls back to Tesseract.
- Added plain-text, Markdown, JSON, and CSV exports with copy and file download controls.
- Added canonical PNG normalization for reliable GPT-5.5 image analysis and explicit stream timeout/completion errors.
- Added graceful browser clipboard fallback and permission-error toasts.
- Expanded backend regression coverage to 19 passing tests.

### 2026-07-10 — Initial MVP

- Built the full capture workspace with upload, paste, drag/drop, rectangular multi-region selection, freehand drawing, redaction, quick actions, model selection, and context-bundle summary.
- Added pixel-level redaction before AI submission.
- Integrated real streaming multimodal analysis with GPT-5.5 and Gemini 3.1 Pro.
- Added FastAPI validation, model discovery, capture analysis, history list/search/detail/delete, and private-mode behavior.
- Added MongoDB-backed searchable capture history and deterministic no-cache refresh behavior.
- Added responsive History, Platforms, and Settings pages with persistent privacy settings.
- Built a Chrome Manifest V3 prototype for explicit visible-tab capture with URL/title enrichment and dashboard handoff.
- Built a Tauri Windows scaffold with the `Alt+Shift+S` global shortcut and frameless capture window configuration.
- Added backend regression tests and image-integration testing requirements.
- Verified both AI models against real visual input; verified private and saved flows, responsive layouts, and platform controls.

## Prioritized Backlog

### P0 — Next Validation Work

- Run `desktop/build-windows.ps1` on the certificate-enabled Windows self-hosted runner.
- Run `desktop/validate-hardware.ps1` on physical Windows 10 and Windows 11 hosts and return both generated ZIP reports.
- Review real seam deltas, captured scaling, and Authenticode evidence before marking hardware validation complete.
- Install and benchmark PaddleOCR on an x86_64 Windows or Linux runtime where its native backend is supported.

### P1 — Product Depth

- Add resizable/movable region handles, region labels, arrows, boxes, and undo/redo.
- Crop selected regions before model submission while preserving coordinate relationships.
- Add full-page browser capture and scrolling-region stitching.
- Add automatic sensitive-data detection and configurable retention cleanup.
- Add result formatting for Markdown, JSON, CSV, HTML, and spreadsheet-ready copy.
- Add project/group organization for captures.

### P2 — Expansion

- Add source discovery and visual search providers.
- Add integrations for Linear, Jira, GitHub, Notion, Slack, and developer tooling.
- Add reusable capture-to-action workflow templates.
- Add encrypted history, audit logs, and enterprise model-provider controls.
- Explore macOS support after Windows behavior is validated.

## Next Tasks

1. Package the Windows shell and implement native screen capture/display metadata.
2. Validate the unpacked Chrome extension end-to-end on real browsing sessions.
3. Add deterministic OCR output and structured extraction schemas.
4. Run privacy/security review for redaction, retention, and extension permissions.
