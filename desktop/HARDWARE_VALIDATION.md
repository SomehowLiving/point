# Signed Windows Hardware Validation

## Required runner environment

- Physical Windows 10 or Windows 11 x64 machine
- Visual Studio C++ Build Tools and Windows 10/11 SDK
- Node.js, Yarn, Rust stable, WebView2
- Two displays; baseline is primary 1920×1080 at 100% and secondary 2560×1440 at 150%, positioned to the right
- `WINDOWS_CERT_PATH`, `WINDOWS_CERT_PASSWORD`, and `TIMESTAMP_URL` configured as machine/user environment variables

## Build and sign

```powershell
powershell -ExecutionPolicy Bypass -File .\desktop\build-windows.ps1
```

The build fails unless Tauri signs and verifies the application and both NSIS/MSI installers. It writes `signed-package-manifest.json` with SHA-256 hashes and signer details.

## Validate Windows 10 and Windows 11

Run the same command on each physical machine. Windows 10 automatically installs/tests NSIS; Windows 11 automatically installs/tests MSI.

```powershell
powershell -ExecutionPolicy Bypass -File .\desktop\validate-hardware.ps1
```

The validator checks installer/executable signatures, installs the package, enables Per-Monitor V2 awareness, captures each monitor at native resolution, stitches using physical coordinates, measures seam deltas, verifies the expected 100%/150% scale factors, and produces a ZIP under `desktop\hardware-results`.

Return both ZIP files for final comparison. The included stitched PNG should show an unbroken desktop across the monitor boundary; every seam delta must be at most two physical pixels.