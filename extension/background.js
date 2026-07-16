const DEFAULT_DASHBOARD_URL = "http://localhost:3000/capture";

async function collectPageContext(tab) {
  if (!tab?.id || !tab.url?.startsWith("http")) return {};
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => ({
        page_title: document.title,
        canonical_url: document.querySelector('link[rel="canonical"]')?.href || location.href,
        description: document.querySelector('meta[name="description"]')?.content || "",
        selected_text: window.getSelection()?.toString().slice(0, 4000) || "",
        headings: [...document.querySelectorAll("h1,h2,h3")].slice(0, 40).map((element) => ({ level: element.tagName.toLowerCase(), text: element.innerText.trim().slice(0, 300) })).filter((item) => item.text),
        visible_text: document.body?.innerText.slice(0, 12000) || "",
        links: [...document.querySelectorAll("a[href]")].slice(0, 80).map((element) => ({ text: element.innerText.trim().slice(0, 160), href: element.href })).filter((item) => item.text),
        viewport: { width: innerWidth, height: innerHeight, device_pixel_ratio: devicePixelRatio },
      }),
    });
    return result || {};
  } catch (error) {
    return { enrichment_error: error.message };
  }
}

async function openCaptureFlow(tab) {
  if (!tab?.windowId) return;
  try {
    const [screenshot, pageContext] = await Promise.all([
      chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" }),
      collectPageContext(tab),
    ]);
    const pendingCapture = {
      screenshot,
      source: { application: "Google Chrome", window_title: tab.title || "", url: tab.url || "", page_context: pageContext },
      createdAt: new Date().toISOString(),
    };
    await chrome.storage.local.set({ pendingCapture, lastCaptureStatus: { ok: true, host: new URL(tab.url).host, bytes: screenshot.length, enriched: Boolean(pageContext.visible_text), at: pendingCapture.createdAt } });
    const { dashboardUrl } = await chrome.storage.local.get("dashboardUrl");
    await chrome.tabs.create({ url: dashboardUrl || DEFAULT_DASHBOARD_URL });
  } catch (error) {
    await chrome.storage.local.set({ lastCaptureStatus: { ok: false, error: error.message, at: new Date().toISOString() } });
    throw error;
  }
}

chrome.action.onClicked.addListener(openCaptureFlow);
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "capture-context") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await openCaptureFlow(tab);
});