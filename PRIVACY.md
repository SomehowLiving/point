# Privacy Policy

_Last updated: October 2026_

Point is open-source software that runs on your own computer. The Point project has **no
servers, no accounts and no analytics**. We (the maintainers) never receive your screenshots,
questions, answers, API keys or any usage data.

This policy explains where your data goes when you use Point. Everything below can be checked in
the source code of this repository.

## What stays on your computer

- **Screenshots and selections.** Captures exist in the app's memory while you work. They are
  saved only if History is on (see below).
- **History.** Unless you use **Temporary** mode, each analysis is saved locally: your question,
  the answer, the selected regions, the source window title or page URL, the recognised text, and
  a copy of the screenshot. In the desktop app this is a SQLite file in
  `%LOCALAPPDATA%\com.spatialai.contextlayer\`. If you run the developer setup with MongoDB, it's
  your own local MongoDB. You can delete items in the History page, or delete the folder.
- **API keys.** Keys you enter in Settings are stored in `settings.json` in the same folder, in
  plain text, readable by your Windows user account. They are only ever sent to the provider they
  belong to.
- **Text recognition (OCR)** runs locally with Tesseract. Nothing is uploaded for OCR.
- **Chrome extension storage.** The extension briefly keeps a pending capture in the browser's
  local extension storage to hand it to the Point window, then deletes it. Its settings (backend
  URL, model) are stored there too.

## What leaves your computer, and only when you ask

| When you… | What is sent | Sent to |
|---|---|---|
| Ask a question (any action) | The screenshot(s), your selections, your question, recognised text, and the source context (window title; for web pages captured with the extension: URL, title, selected text, headings, visible text and links) | **The AI provider you chose** (OpenAI, Google Gemini, OpenRouter or Groq), using **your** API key |
| Use the **Search** action | A short search query taken from the selected text or your question | Your own SearXNG instance if one is running, otherwise **DuckDuckGo** |
| Click **Send to Notion** | The answer, your question as the title, and the source URL | **Notion**, using your Notion key |
| Click **Create GitHub issue** | The answer, your question as the title, and the source URL | **GitHub**, using your token |

How those services handle your data is governed by their own privacy policies and your agreement
with them, for example OpenAI's, Google's, OpenRouter's, Groq's, DuckDuckGo's, Notion's and
GitHub's. Point sends nothing to any of them unless you take the action listed.

## What Point never does

- No telemetry, analytics, crash reporting or tracking of any kind.
- No background recording. Point captures the screen only when you press the shortcut or a
  capture button.
- No third-party requests on startup. Fonts and all other app assets are bundled.
- No selling or sharing of data. There's nothing to share: the project never receives any.

## Children

Point is a general-purpose tool and is not directed at children.

## Changes

Changes to this policy are made in this file, and its history is public in the repository.

## Contact

Questions: open an issue at <https://github.com/SomehowLiving/point/issues>. For security
problems, follow [SECURITY.md](SECURITY.md).
