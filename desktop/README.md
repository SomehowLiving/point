# Spatial AI Windows Desktop Package

This scaffold documents the native shell boundary for the Windows MVP.

## Shell responsibilities

- Register the global `Alt+Shift+S` shortcut.
- Freeze/dim the active display and collect a PNG screenshot.
- Open the web capture workspace in a frameless overlay window.
- Pass screenshot, display coordinates, active application, and window title to the workspace.
- Return copy-ready results to the Windows clipboard.

## Native behavior

- `Alt+Shift+S` hides the shell, captures the display under the cursor, and opens the selection workspace.
- **Active display** and **All displays** commands provide single-monitor or stitched virtual-desktop PNG captures.
- Results can be returned to the Windows clipboard through the Tauri clipboard plugin.
- Capture is explicit and event-driven; no background recording occurs.

## Build both installers

On Windows 10/11 with Node.js, Yarn, Rust, and Visual Studio C++ Build Tools installed:

```powershell
powershell -ExecutionPolicy Bypass -File .\desktop\build-windows.ps1
```

This creates an NSIS `.exe` and WiX `.msi` under `desktop/src-tauri/target/release/bundle`. The repository workflow `.github/workflows/windows-installers.yml` performs the same build on a Windows runner.

The build requires `WINDOWS_CERT_PATH`, `WINDOWS_CERT_PASSWORD`, and `TIMESTAMP_URL`. Tauri signs the inner executable and generated installers; the script verifies every signature and writes SHA-256 hashes to `signed-package-manifest.json`.

## Physical mixed-DPI validation

Follow `HARDWARE_VALIDATION.md`, or run:

```powershell
powershell -ExecutionPolicy Bypass -File .\desktop\validate-hardware.ps1
```

The native probe uses Per-Monitor V2 awareness and captured pixel dimensions—not logical dimensions—to stitch mixed-DPI displays. It returns a JSON report, stitched PNG, signature evidence, and ZIP package.