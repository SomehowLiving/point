# Spatial AI Windows Desktop Scaffold

This scaffold documents the native shell boundary for the Windows MVP.

## Shell responsibilities

- Register the global `Alt+Shift+S` shortcut.
- Freeze/dim the active display and collect a PNG screenshot.
- Open the web capture workspace in a frameless overlay window.
- Pass screenshot, display coordinates, active application, and window title to the workspace.
- Return copy-ready results to the Windows clipboard.

## Proposed packaging

Use a lightweight Tauri shell around the React capture workspace. The production shell should expose only explicit, user-triggered capture commands and must not record continuously. Native implementation is intentionally separated from this web-first MVP so the selection and AI workflow can be validated first.