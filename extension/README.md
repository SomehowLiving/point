# Spatial AI Chrome Extension Prototype

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this `extension` directory.
4. Click the extension icon or press `Alt+Shift+S` to capture the visible tab.

The service worker stores the screenshot and browser metadata in `chrome.storage.local`, then opens the capture workspace. A narrowly scoped content-script bridge transfers that pending capture into the workspace and immediately clears it from extension storage.