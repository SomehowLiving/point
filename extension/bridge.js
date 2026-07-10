if (window.location.pathname.startsWith("/capture")) {
  chrome.storage.local.get("pendingCapture").then(({ pendingCapture }) => {
    if (!pendingCapture?.screenshot) return;
    window.postMessage({ type: "SPATIAL_AI_EXTENSION_CAPTURE", payload: pendingCapture }, window.location.origin);
    chrome.storage.local.remove("pendingCapture");
  });
}