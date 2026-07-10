# Spatial AI Chrome Extension Prototype

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this `extension` directory.
4. Click the extension icon or press `Alt+Shift+S` to capture the visible tab.

The service worker stores the screenshot and enriched browser context in `chrome.storage.local`, then opens the capture workspace. Enrichment includes the URL, title, canonical URL, description, selected text, headings, visible text, links, and viewport metadata. A narrowly scoped content-script bridge transfers the pending capture into the workspace and immediately clears it from extension storage.

The extension writes its latest validation result to `chrome.storage.local.lastCaptureStatus`, including the tested hostname, screenshot payload size, enrichment status, and any capture error.