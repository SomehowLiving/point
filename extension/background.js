const DEFAULT_DASHBOARD_URL = "https://screen-pointer.internal.preview.emergentagent.com/capture";

async function openCaptureFlow(tab) {
  if (!tab?.windowId) return;
  const screenshot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  await chrome.storage.local.set({
    pendingCapture: {
      screenshot,
      source: {
        application: "Google Chrome",
        window_title: tab.title || "",
        url: tab.url || ""
      },
      createdAt: new Date().toISOString()
    }
  });
  const { dashboardUrl } = await chrome.storage.local.get("dashboardUrl");
  await chrome.tabs.create({ url: dashboardUrl || DEFAULT_DASHBOARD_URL });
}

chrome.action.onClicked.addListener(openCaptureFlow);
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "capture-context") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await openCaptureFlow(tab);
});