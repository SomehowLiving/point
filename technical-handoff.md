# Spatial AI Context Layer — Technical Handoff

**Purpose:** Transfer implementation, operational, release, and troubleshooting knowledge to the next engineering team  
**Current release:** 0.2.0 candidate  
**Last updated:** 2026-07-10

---

## 1. Handoff Summary

Spatial AI Context Layer is a working full-stack visual-context application with:

- React capture workspace.
- FastAPI backend.
- MongoDB history.
- GPT-5.5 and Gemini 3.1 Pro.
- Tesseract OCR.
- Isolated PaddleOCR fallback.
- Chrome Manifest V3 extension.
- Tauri Windows shell.
- NSIS and MSI packaging.
- PFX signing automation.
- Mixed-DPI hardware diagnostics.

The web, API, OCR, export, extension, and Windows source-validation work is complete. Physical Windows signing and monitor validation remain external actions.

---

## 2. Read These Documents First

1. `product.md` — Product scope, features, users, limitations, roadmap.
2. `technical.md` — Architecture and implementation details.
3. `release-review.md` — Current release status and gates.
4. `desktop/HARDWARE_VALIDATION.md` — Physical Windows procedure.
5. `memory/PRD.md` — Historical product decisions and backlog.

---

## 3. Current System State

### Working

- Capture workspace.
- File upload, paste, and drop.
- Multi-region selection.
- Freehand annotation.
- Pixel redaction.
- GPT-5.5.
- Gemini 3.1 Pro.
- Tesseract OCR.
- Structured exports.
- Capture history.
- Temporary mode.
- Chrome extension handoff.
- Browser enrichment.
- Windows source and package configuration.
- Windows target compilation.

### Pending external execution

- Real PFX signing.
- NSIS install on Windows 10.
- MSI install on Windows 11.
- Physical 100%/150% monitor report.
- Human review of stitched PNG.

### Known constrained behavior

- Paddle falls back safely on this ARM host.
- Full-page capture is not implemented.
- Selection regions cannot be moved or resized.
- OCR is currently English-focused.
- No authentication or team boundaries exist.

---

## 4. Required Access

### Development environment

- `/app` workspace.
- Supervisor service access.
- Existing MongoDB environment.
- Existing AI key environment.

### Windows release environment

- Physical Windows 10 and Windows 11 x64 machines.
- Visual Studio C++ Build Tools.
- Windows SDK signing tools.
- Node.js and Yarn.
- Rust stable.
- WebView2.
- PFX certificate.
- PFX password.
- RFC3161 timestamp endpoint.
- Two-monitor 100%/150% setup.

### Credential names

- `WINDOWS_CERT_PATH`
- `WINDOWS_CERT_PASSWORD`
- `TIMESTAMP_URL`

Do not place credential values in documentation, source code, issue text, or test output.

---

## 5. Local Service Map

| Service | Internal port | External access |
| --- | --- | --- |
| React frontend | 3000 | Managed preview URL |
| FastAPI backend | 8001 | `REACT_APP_BACKEND_URL` with `/api` |
| MongoDB | Environment-defined | Backend only |

### Important routing rule

All backend routes must begin with `/api`.

### Important frontend rule

All frontend API requests must derive from:

```javascript
process.env.REACT_APP_BACKEND_URL
```

---

## 6. Starting and Checking Services

### Service status

```bash
sudo supervisorctl status
```

### Restart backend

```bash
sudo supervisorctl restart backend
```

### Restart frontend

```bash
sudo supervisorctl restart frontend
```

### Backend log

```text
/var/log/supervisor/backend.err.log
```

### Frontend log

```text
/var/log/supervisor/frontend.err.log
```

Regular source changes should hot reload. Restart only for dependency or environment changes.

---

## 7. Validation Commands

### Backend regression

```bash
cd /app/backend
python -m pytest tests/test_api.py -q
```

Expected current result:

```text
19 passed
```

### Frontend production build

```bash
cd /app/frontend
yarn build
```

### Extension validation

```bash
cd /app
xvfb-run -a node extension/tests/validate-real-sites.mjs ./extension ./extension/validation-results.json
```

Expected result:

- Seven site records.
- Every `ok` is true.
- Meaningful screenshot payload.
- Enrichment present.

### Windows target check from Linux

```bash
cd /app/desktop/src-tauri
cargo fmt --check
cargo check --target x86_64-pc-windows-msvc
```

Cross-check tooling may require an MSVC-compatible resource compiler and preprocessor.

### Windows signed build

```powershell
powershell -ExecutionPolicy Bypass -File .\desktop\build-windows.ps1
```

### Windows hardware validation

```powershell
powershell -ExecutionPolicy Bypass -File .\desktop\validate-hardware.ps1
```

---

## 8. First-Day Engineering Checklist

- [ ] Read all four core documents.
- [ ] Confirm supervisor services are healthy.
- [ ] Run backend regression tests.
- [ ] Run frontend build.
- [ ] Open `/capture`.
- [ ] Upload an image.
- [ ] Draw a region.
- [ ] Run OCR.
- [ ] Download JSON.
- [ ] Run GPT-5.5.
- [ ] Run Gemini 3.1 Pro.
- [ ] Enable temporary mode and confirm no history item.
- [ ] Review extension validation results.
- [ ] Cross-check Windows target.
- [ ] Confirm no secrets exist in source.

---

## 9. Primary Workflows

### Screenshot to AI

1. User loads image.
2. User selects regions.
3. User optionally annotates or redacts.
4. Frontend burns redactions into pixels.
5. Frontend sends image and context.
6. Backend normalizes the image.
7. Backend streams model output.
8. Backend persists only when private mode is false.

### Screenshot to OCR

1. User loads image.
2. User selects regions.
3. Frontend burns redactions.
4. Backend crops selected regions.
5. Tesseract extracts words and confidence.
6. Low-confidence auto mode may attempt isolated Paddle.
7. Frontend displays text and export controls.

### Browser extension to workspace

1. User activates extension.
2. Service worker captures visible tab.
3. Service worker extracts page context.
4. Pending capture is stored.
5. Dashboard opens.
6. Bridge transfers the payload.
7. Storage entry is cleared.

### Windows shortcut to workspace

1. User presses `Alt + Shift + S`.
2. Tauri hides the workspace.
3. Display under cursor is resolved.
4. XCap captures native pixels.
5. Tauri restores the workspace.
6. React receives the capture event.

---

## 10. Ownership Handoff

### Backend owner

Owns:

- `backend/server.py`
- `backend/export_service.py`
- MongoDB behavior.
- AI streaming.
- API contracts.

Must preserve:

- `/api` prefix.
- Environment-only credentials.
- `_id` exclusion.
- Temporary-mode persistence rule.

### OCR/ML owner

Owns:

- `backend/ocr_service.py`
- `backend/paddle_worker.py`
- OCR model installation.
- Confidence and box normalization.

Must preserve:

- Native runtime isolation.
- Timeouts.
- Tesseract fallback.
- Redaction-before-OCR invariant.

### Frontend owner

Owns:

- Capture page.
- Canvas.
- Command bar.
- Exports.
- History.
- Responsive behavior.

Must preserve:

- `data-testid` coverage.
- Image format validation.
- Redaction-before-send.
- Environment-derived API URL.

### Extension owner

Owns:

- Manifest.
- Service worker.
- Dashboard bridge.
- Real-site harness.

Must preserve:

- Explicit capture.
- Bounded page context.
- Pending capture cleanup.
- Restricted-page safety.

### Windows owner

Owns:

- Tauri Rust source.
- Global shortcut.
- Monitor capture.
- DPI mapping.
- Clipboard.
- Diagnostics.

Must preserve:

- PMv2 activation before monitor enumeration.
- Signed coordinates.
- Native bitmap dimensions.
- Seam reporting.

### Release/security owner

Owns:

- Signing configuration.
- Build script.
- Hardware validator.
- Package workflow.

Must preserve:

- External PFX credentials.
- SHA-256 signing.
- RFC3161 timestamp.
- Authenticode verification.
- Artifact hashes.

---

## 11. Do-Not-Break Rules

1. Do not send unredacted pixels after a redaction exists.
2. Do not place the AI key in frontend code.
3. Do not store temporary captures.
4. Do not return MongoDB `_id`.
5. Do not import Paddle into the backend process.
6. Do not calculate mixed-DPI placement from CSS or logical browser pixels.
7. Do not remove `%1` from the Tauri sign command.
8. Do not produce release artifacts without signature verification.
9. Do not claim physical Windows validation without returned evidence.
10. Do not add continuous recording to the current architecture.

---

## 12. Common Change Playbooks

### Add a new quick action

1. Add action ID to backend request literal.
2. Add prompt guidance.
3. Add command-bar control.
4. Add test ID.
5. Test AI output.
6. Update documentation.

### Add an export format

1. Add backend format literal.
2. Add MIME type.
3. Add renderer.
4. Add frontend control.
5. Add API test.
6. Test clipboard and download.

### Add a Chrome enrichment field

1. Add bounded extraction.
2. Keep payload size controlled.
3. Add source model support if needed.
4. Re-run seven-site validation.
5. Review privacy impact.

### Add a Windows capture mode

1. Add Rust command.
2. Add frontend native invocation.
3. Preserve window hide/restore.
4. Preserve PMv2.
5. Cross-compile.
6. Run physical validator.

### Add a database field

1. Add response default for older documents.
2. Exclude `_id`.
3. Update insert payload.
4. Update frontend usage.
5. Add regression coverage.

---

## 13. Incident Playbooks

### AI provider outage

Symptoms:

- SSE error event.
- Timeout.
- No `done` event.

Actions:

1. Check backend log.
2. Verify model status.
3. Verify key availability.
4. Try the alternate model.
5. Confirm OCR still works.
6. Do not lose the user capture state.

### OCR outage

Symptoms:

- OCR endpoint error.
- Tesseract unavailable.

Actions:

1. Check `GET /api/ocr/status`.
2. Confirm Tesseract executable.
3. Confirm language package.
4. Check Paddle subprocess log.
5. Restart backend only after dependency correction.

### Database outage

Symptoms:

- History load failure.
- Save failure after AI result.

Actions:

1. Check Mongo environment.
2. Check backend log.
3. Confirm private mode still processes without save.
4. Avoid returning partial Mongo objects.

### Extension failure

Symptoms:

- No dashboard handoff.
- Missing screenshot.

Actions:

1. Inspect `lastCaptureStatus`.
2. Confirm source tab is not restricted.
3. Confirm dashboard match pattern.
4. Confirm storage quota.
5. Re-run harness.

### Windows seam failure

Symptoms:

- Exit code `3`.
- Visible gap or overlap.

Actions:

1. Inspect PMv2 flag.
2. Compare metadata and capture dimensions.
3. Inspect scale factors.
4. Inspect X/Y origins.
5. Review stitched PNG.
6. Fix native geometry, not frontend rendering.

### Signing failure

Symptoms:

- Build script stops.
- Authenticode status is not valid.

Actions:

1. Confirm all three signing variables.
2. Confirm PFX file access.
3. Confirm password.
4. Confirm certificate validity.
5. Confirm timestamp access.
6. Confirm Windows SDK.

---

## 14. Release Handoff Procedure

### Before build

- [ ] Backend tests pass.
- [ ] Frontend build passes.
- [ ] Extension matrix passes.
- [ ] Windows target compiles.
- [ ] Version is correct.
- [ ] Signing variables are available.

### After build

- [ ] NSIS exists.
- [ ] MSI exists.
- [ ] Signed package manifest exists.
- [ ] Installer signatures are valid.
- [ ] Hashes are recorded.

### Windows 10

- [ ] NSIS installs.
- [ ] Executable signature is valid.
- [ ] Shortcut capture works.
- [ ] Hardware ZIP returned.

### Windows 11

- [ ] MSI installs.
- [ ] Executable signature is valid.
- [ ] Shortcut capture works.
- [ ] Hardware ZIP returned.

### Final release

- [ ] Compare reports.
- [ ] Inspect stitched PNGs.
- [ ] Confirm seam tolerance.
- [ ] Complete release sign-off table.
- [ ] Update known issues.

---

## 15. Pending Work Handoff

### P0

1. Execute signed build on PFX-enabled Windows runner.
2. Execute Win10 hardware validator.
3. Execute Win11 hardware validator.
4. Review mixed-DPI evidence.
5. Correct any physical seam issue.

### P1

1. Region move and resize.
2. Region labels.
3. Undo/redo.
4. Full-page browser capture.
5. Scrolling capture.
6. Structured extraction templates.
7. Multi-language OCR.

### P2

1. External workflow destinations.
2. Projects and capture groups.
3. Automatic sensitive-data detection.
4. Retention cleanup.
5. Encrypted history.

---

## 16. Handoff Acceptance Checklist

The receiving team should confirm:

- [ ] Repository access.
- [ ] Environment access.
- [ ] Service control access.
- [ ] Mongo configuration understanding.
- [ ] AI key handling understanding.
- [ ] OCR isolation understanding.
- [ ] Chrome extension loading capability.
- [ ] Windows runner access.
- [ ] PFX custody owner identified.
- [ ] Physical monitor topology available.
- [ ] Release evidence storage location selected.
- [ ] P0 owners assigned.

---

## 17. Handoff Contacts and Ownership Record

Complete during transfer:

| Responsibility | Owner | Backup | Contact channel |
| --- | --- | --- | --- |
| Product | Pending | Pending | Pending |
| Frontend | Pending | Pending | Pending |
| Backend | Pending | Pending | Pending |
| OCR/ML | Pending | Pending | Pending |
| Chrome extension | Pending | Pending | Pending |
| Windows native | Pending | Pending | Pending |
| Release/signing | Pending | Pending | Pending |
| QA | Pending | Pending | Pending |
| Security | Pending | Pending | Pending |

---

## 18. Final Handoff Statement

The receiving team is inheriting a functional MVP with strong implementation coverage and a clearly bounded release gap.

The most important immediate responsibility is to complete the signed physical Windows evidence rather than expand product scope. Once Windows 10, Windows 11, signature, and mixed-DPI gates pass, the team can proceed to capture-quality and workflow features with a stable release baseline.
