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
        // Bounding boxes normalized 0..1 against the viewport — the same coordinate space the
        // screenshot (captureVisibleTab, viewport-only) and the app's regions/points already use,
        // so the backend can match a user's drawn selection straight to the DOM elements under it
        // with no extra coordinate transform. Clipped to what's actually visible (and thus what's
        // actually in the screenshot), deduped by rounded rect to avoid near-identical wrapper/
        // child pairs (e.g. a link wrapping an image), and capped so payload size stays bounded.
        dom_elements: (() => {
          const selector = 'a[href], button, input, select, textarea, [role], h1,h2,h3,h4,h5,h6, img[alt], label, li, td, th, article, [aria-label]';
          const seen = new Set();
          const elements = [];
          for (const element of document.querySelectorAll(selector)) {
            if (elements.length >= 300) break;
            const rect = element.getBoundingClientRect();
            const visibleLeft = Math.max(0, rect.left);
            const visibleTop = Math.max(0, rect.top);
            const visibleRight = Math.min(innerWidth, rect.right);
            const visibleBottom = Math.min(innerHeight, rect.bottom);
            if (visibleRight <= visibleLeft || visibleBottom <= visibleTop) continue;
            const key = `${Math.round(visibleLeft)}:${Math.round(visibleTop)}:${Math.round(visibleRight)}:${Math.round(visibleBottom)}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const text = (element.innerText || element.getAttribute("aria-label") || element.getAttribute("alt") || element.value || "").trim().slice(0, 160);
            const entry = {
              tag: element.tagName.toLowerCase(),
              role: element.getAttribute("role") || undefined,
              text,
              href: element.tagName === "A" ? element.href : undefined,
              box: {
                x: visibleLeft / innerWidth,
                y: visibleTop / innerHeight,
                width: (visibleRight - visibleLeft) / innerWidth,
                height: (visibleBottom - visibleTop) / innerHeight,
              },
            };
            elements.push(entry);
          }
          return elements;
        })(),
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