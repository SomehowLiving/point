# Security Policy

## Supported versions

Only the latest release receives security fixes.

## Reporting a vulnerability

Please **don't** open a public issue. Report it privately through GitHub: go to the repository's
**Security** tab → **Report a vulnerability**. Include what you found, how to reproduce it, and
the impact you expect.

You should get a first response within a week. Once a fix is released, you'll be credited in the
release notes unless you'd rather not be.

## How Point handles your data

Useful context when assessing a report:

- **Screenshots** are sent only to the AI provider you choose for a request, using your own API
  key. Point has no server of its own and no analytics or telemetry.
- **API keys** entered in Settings are stored in plain text in `settings.json` inside the app's
  local data folder (`%LOCALAPPDATA%\com.spatialai.contextlayer\`), readable by your Windows user
  account. The API that manages them never returns a saved key, only whether one is set.
- **The bundled backend** listens only on `127.0.0.1:47811`. Browser access is limited by CORS to
  the desktop app's own origin.
- **History** (non-temporary captures, including their screenshots) is stored in a local SQLite
  file in the same folder. Temporary mode saves nothing.
