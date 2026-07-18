const DEFAULT_DASHBOARD_URL = "http://localhost:3000/capture";

// dom_elements' box is normalized 0..1 against whatever the delivered screenshot actually shows —
// the viewport for a normal capture, or the full scrolled document for a full-page capture — so it
// always lines up with the app's regions/points, which are normalized against the same image.
// fullDocument=false clips to what's visible right now (matching a single-viewport screenshot);
// fullDocument=true keeps every element (in-viewport or not) positioned against the whole document
// (matching the stitched full-page screenshot).
async function collectPageContext(tab, { fullDocument = false } = {}) {
  if (!tab?.id || !tab.url?.startsWith("http")) return {};
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      args: [fullDocument],
      func: (fullDocument) => ({
        page_title: document.title,
        canonical_url: document.querySelector('link[rel="canonical"]')?.href || location.href,
        description: document.querySelector('meta[name="description"]')?.content || "",
        selected_text: window.getSelection()?.toString().slice(0, 4000) || "",
        headings: [...document.querySelectorAll("h1,h2,h3")].slice(0, 40).map((element) => ({ level: element.tagName.toLowerCase(), text: element.innerText.trim().slice(0, 300) })).filter((item) => item.text),
        visible_text: document.body?.innerText.slice(0, 12000) || "",
        links: [...document.querySelectorAll("a[href]")].slice(0, 80).map((element) => ({ text: element.innerText.trim().slice(0, 160), href: element.href })).filter((item) => item.text),
        viewport: { width: innerWidth, height: innerHeight, device_pixel_ratio: devicePixelRatio },
        dom_elements: (() => {
          const docWidth = document.documentElement.scrollWidth;
          const docHeight = document.documentElement.scrollHeight;
          const selector = 'a[href], button, input, select, textarea, [role], h1,h2,h3,h4,h5,h6, img[alt], label, li, td, th, article, [aria-label]';
          const seen = new Set();
          const elements = [];
          for (const element of document.querySelectorAll(selector)) {
            if (elements.length >= 300) break;
            const rect = element.getBoundingClientRect();
            let left, top, right, bottom;
            if (fullDocument) {
              left = rect.left + scrollX; top = rect.top + scrollY; right = rect.right + scrollX; bottom = rect.bottom + scrollY;
            } else {
              left = Math.max(0, rect.left); top = Math.max(0, rect.top);
              right = Math.min(innerWidth, rect.right); bottom = Math.min(innerHeight, rect.bottom);
            }
            if (right <= left || bottom <= top) continue;
            // Dedup by rounded rect to avoid near-identical wrapper/child pairs (e.g. a link wrapping
            // an image); capped element count keeps payload size bounded.
            const key = `${Math.round(left)}:${Math.round(top)}:${Math.round(right)}:${Math.round(bottom)}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const text = (element.innerText || element.getAttribute("aria-label") || element.getAttribute("alt") || element.value || "").trim().slice(0, 160);
            const width = fullDocument ? docWidth : innerWidth;
            const height = fullDocument ? docHeight : innerHeight;
            elements.push({
              tag: element.tagName.toLowerCase(),
              role: element.getAttribute("role") || undefined,
              text,
              href: element.tagName === "A" ? element.href : undefined,
              box: { x: left / width, y: top / height, width: (right - left) / width, height: (bottom - top) / height },
            });
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

function captureVisibleTabWithRetry(windowId, attempts = 4) {
  return new Promise((resolve, reject) => {
    const attempt = (remaining) => {
      chrome.tabs.captureVisibleTab(windowId, { format: "png" }, (dataUrl) => {
        const error = chrome.runtime.lastError;
        if (!error) return resolve(dataUrl);
        if (remaining <= 1 || !/MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND/i.test(error.message || "")) return reject(new Error(error.message));
        setTimeout(() => attempt(remaining - 1), 700);
      });
    };
    attempt(attempts);
  });
}

function arrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  return btoa(binary);
}

const FULL_PAGE_MAX_STEPS = 25;
// Backend caps decoded image bytes at 8 MB (see MAX_IMAGE_BYTES in server.py) — a long page
// stitched at full resolution can exceed that, so fall back to JPEG at decreasing quality until
// it fits rather than letting the eventual analyze/OCR call fail with a 413.
const FULL_PAGE_MAX_BYTES = 7 * 1024 * 1024;

async function encodeWithinByteBudget(canvas, maxBytes) {
  let blob = await canvas.convertToBlob({ type: "image/png" });
  if (blob.size <= maxBytes) return { blob, mimeType: "image/png" };
  for (const quality of [0.9, 0.75, 0.6, 0.45, 0.3]) {
    blob = await canvas.convertToBlob({ type: "image/jpeg", quality });
    if (blob.size <= maxBytes) return { blob, mimeType: "image/jpeg" };
  }
  return { blob, mimeType: "image/jpeg" }; // best effort — still returned so the user gets *something*, not a silent failure
}

// Scrolls the tab in viewport-height increments, capturing each step and stitching them into one
// tall image via OffscreenCanvas (available in MV3 service workers, no content-script canvas
// needed). Returns null when the page isn't actually taller than one viewport, so the caller can
// fall back to a normal single-viewport capture instead of a pointless one-step "stitch".
async function captureFullPage(tab) {
  const [{ result: metrics }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => ({
      scrollHeight: document.documentElement.scrollHeight,
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      devicePixelRatio,
      originalScrollX: scrollX,
      originalScrollY: scrollY,
    }),
  });
  if (metrics.scrollHeight <= metrics.viewportHeight * 1.05) return null;

  const totalSteps = Math.ceil(metrics.scrollHeight / metrics.viewportHeight);
  const truncated = totalSteps > FULL_PAGE_MAX_STEPS;
  const steps = Math.min(totalSteps, FULL_PAGE_MAX_STEPS);

  // Fixed/sticky elements (headers, nav bars) would otherwise be duplicated once per scroll step
  // in the stitched image — hide them for the duration of the capture and restore afterward.
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      const candidates = document.querySelectorAll('header, nav, footer, [class*="sticky" i], [class*="fixed" i], [style*="fixed" i], [style*="sticky" i]');
      const hidden = [];
      candidates.forEach((element) => {
        if (["fixed", "sticky"].includes(getComputedStyle(element).position)) {
          hidden.push({ element, previous: element.style.visibility });
          element.style.visibility = "hidden";
        }
      });
      window.__spatialAiHiddenFixedElements = hidden;
    },
  });

  const shots = [];
  try {
    for (let index = 0; index < steps; index += 1) {
      const y = Math.min(index * metrics.viewportHeight, metrics.scrollHeight - metrics.viewportHeight);
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, args: [y], func: (scrollY) => window.scrollTo(0, scrollY) });
      await new Promise((resolve) => setTimeout(resolve, 350));
      shots.push({ dataUrl: await captureVisibleTabWithRetry(tab.windowId), y });
    }
  } finally {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      args: [metrics.originalScrollX, metrics.originalScrollY],
      func: (scrollXBack, scrollYBack) => {
        (window.__spatialAiHiddenFixedElements || []).forEach(({ element, previous }) => { element.style.visibility = previous; });
        delete window.__spatialAiHiddenFixedElements;
        window.scrollTo(scrollXBack, scrollYBack);
      },
    });
  }

  const dpr = metrics.devicePixelRatio || 1;
  const canvas = new OffscreenCanvas(Math.round(metrics.viewportWidth * dpr), Math.round(metrics.scrollHeight * dpr));
  const context = canvas.getContext("2d");
  for (const shot of shots) {
    const bitmap = await createImageBitmap(await (await fetch(shot.dataUrl)).blob());
    context.drawImage(bitmap, 0, Math.round(shot.y * dpr));
  }
  const { blob, mimeType } = await encodeWithinByteBudget(canvas, FULL_PAGE_MAX_BYTES);
  const base64 = arrayBufferToBase64(await blob.arrayBuffer());
  return { dataUrl: `data:${mimeType};base64,${base64}`, mimeType, sections: shots.length, truncated };
}

async function openCaptureFlow(tab, { fullPage = false } = {}) {
  if (!tab?.windowId) return;
  try {
    let screenshot;
    let mimeType = "image/png";
    let fullPageMeta = null;
    if (fullPage) {
      const stitched = await captureFullPage(tab);
      if (stitched) { screenshot = stitched.dataUrl; mimeType = stitched.mimeType; fullPageMeta = { sections: stitched.sections, truncated: stitched.truncated }; }
    }
    if (!screenshot) screenshot = await captureVisibleTabWithRetry(tab.windowId);
    // Collected after any scrolling completes (lazy-loaded content has settled by then), and in
    // fullDocument mode only when the capture actually stitched multiple sections — a single-shot
    // fallback (page too short to scroll) still needs viewport-relative coordinates.
    const pageContext = await collectPageContext(tab, { fullDocument: Boolean(fullPageMeta) });
    const pendingCapture = {
      screenshot,
      mimeType,
      source: { application: "Google Chrome", window_title: tab.title || "", url: tab.url || "", page_context: { ...pageContext, full_page: fullPageMeta } },
      createdAt: new Date().toISOString(),
    };
    await chrome.storage.local.set({ pendingCapture, lastCaptureStatus: { ok: true, host: new URL(tab.url).host, bytes: screenshot.length, enriched: Boolean(pageContext.visible_text), fullPage: Boolean(fullPageMeta), at: pendingCapture.createdAt } });
    const { dashboardUrl } = await chrome.storage.local.get("dashboardUrl");
    await chrome.tabs.create({ url: dashboardUrl || DEFAULT_DASHBOARD_URL });
  } catch (error) {
    await chrome.storage.local.set({ lastCaptureStatus: { ok: false, error: error.message, at: new Date().toISOString() } });
    throw error;
  }
}

const DEFAULT_BACKEND_URL = "http://localhost:8001";

// Real-Time Lens: the content script (lens.js) can't call captureVisibleTab or reach the backend
// itself (a page-origin fetch to localhost:8001 would be blocked by CORS, and captureVisibleTab
// requires the background/service-worker context) — it asks the background script to do both and
// relay back the final answer, reusing the exact same screenshot + page-context + analyze pipeline
// the regular capture flow already uses.
async function fetchLensAnalysis({ imageData, mimeType, instruction, point, source }) {
  const { backendUrl, lensModel } = await chrome.storage.local.get(["backendUrl", "lensModel"]);
  const base = (backendUrl || DEFAULT_BACKEND_URL).replace(/\/$/, "");
  const body = {
    image_data: imageData,
    mime_type: mimeType,
    instruction,
    action: "explain",
    regions: [],
    annotations: [],
    points: [{ id: crypto.randomUUID(), x: point.x, y: point.y, label: null }],
    source,
    private_mode: true,
    ocr_text: "",
  };
  if (lensModel) body.model = lensModel; // else the backend applies its own default
  const response = await fetch(`${base}/api/captures/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || `Analysis failed (${response.status})`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  const consume = (raw) => {
    const line = raw.split("\n").find((item) => item.startsWith("data: "));
    if (!line) return;
    const event = JSON.parse(line.slice(6));
    if (event.type === "delta") text += event.content;
    if (event.type === "error") throw new Error(event.message);
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() || "";
    for (const raw of events) consume(raw);
  }
  if (buffer.trim()) consume(buffer);
  return text || "(no response)";
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "LENS_ANALYZE" || !sender.tab) return false;
  (async () => {
    try {
      const [imageData, pageContext] = await Promise.all([
        captureVisibleTabWithRetry(sender.tab.windowId),
        collectPageContext(sender.tab, { fullDocument: false }),
      ]);
      const text = await fetchLensAnalysis({
        imageData,
        mimeType: "image/png",
        instruction: message.instruction || "Explain what's at this point.",
        point: message.point,
        source: { application: "Google Chrome", window_title: sender.tab.title || "", url: sender.tab.url || "", page_context: pageContext },
      });
      sendResponse({ ok: true, text });
    } catch (error) {
      sendResponse({ ok: false, error: error.message });
    }
  })();
  return true; // keep the message channel open for the async sendResponse above
});

chrome.action.onClicked.addListener((tab) => openCaptureFlow(tab));
chrome.commands.onCommand.addListener(async (command) => {
  if (command === "toggle-lens") {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_LENS" });
    } catch {
      // Content script may not be injected yet (page open since before install/update) — inject once, then retry.
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["lens.js"] });
        await chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_LENS" });
      } catch {
        /* restricted page (chrome://, Web Store, etc.) — nothing we can do */
      }
    }
    return;
  }
  if (command !== "capture-context" && command !== "capture-full-page") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await openCaptureFlow(tab, { fullPage: command === "capture-full-page" });
});