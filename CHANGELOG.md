# Changelog

## 0.4.0 — first open-source release

Point is now open source under the MIT license.

**Privacy**
- Removed a third-party analytics and session-recording script that earlier builds inherited
  from the original project template. **If you installed 0.3.1 or earlier, please update.**
- Fonts are bundled with the app, so Point makes no third-party requests on startup and works
  offline. See [PRIVACY.md](PRIVACY.md) for exactly what is sent where.

**App**
- Renamed to **Point** everywhere: installer, windows, Chrome extension. Settings and history
  from earlier versions carry over.
- Self-contained installer: no Python, Docker or database needed. Enter your own AI provider key
  in Settings (OpenAI, Gemini, OpenRouter or Groq) and press **Alt+Shift+S**.
- Snip overlay: freeze the screen, select with a **box** or **any freeform shape** (or click a
  point), ask, and read the answer in place.

**Project**
- Added CONTRIBUTING.md, SECURITY.md (private vulnerability reporting), PRIVACY.md and
  `.env.example` templates.
- Trimmed the backend's dependencies to what it actually uses.

**Known limitations**
- The installer isn't code-signed yet. Windows SmartScreen shows "Windows protected your PC":
  choose **More info → Run anyway**. On PCs with **Smart App Control** turned on, Windows blocks
  unsigned apps entirely. Signing is in progress.

## 0.3.1

- Self-contained Windows installer with a bundled local backend, SQLite history and in-app API
  keys.
- Fixed the bundled backend crashing on startup.
