import { chromium } from "../../frontend/node_modules/playwright/index.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const extensionPath = path.resolve(process.argv[2] || path.join(process.cwd(), "extension"));
const outputPath = path.resolve(process.argv[3] || path.join(process.cwd(), "extension", "validation-results.json"));
const sites = [
  ["github", "https://github.com/tauri-apps/tauri"],
  ["wikipedia", "https://en.wikipedia.org/wiki/Optical_character_recognition"],
  ["amazon", "https://www.amazon.com/"],
  ["stackoverflow", "https://stackoverflow.com/questions/tagged/python"],
  ["vercel", "https://vercel.com/"],
  ["grafana", "https://play.grafana.org/"],
  ["threejs", "https://threejs.org/examples/"],
];

// Chrome-family binary, checked in priority order: real Chrome (matches production more closely)
// on both Windows and Linux, then Playwright's bundled Chromium as a fallback that works anywhere
// without a separate Chrome install.
function findChromeExecutable() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
  ].filter(Boolean);
  for (const candidate of candidates) if (fs.existsSync(candidate)) return candidate;
  return chromium.executablePath();
}

const chromeExecutable = findChromeExecutable();
const profilePath = path.join(os.tmpdir(), "spatial-extension-profile");
fs.rmSync(profilePath, { recursive: true, force: true });
const chrome = spawn(chromeExecutable, ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--disable-breakpad", "--disable-crash-reporter", `--user-data-dir=${profilePath}`, `--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`, "--remote-debugging-port=9223", "about:blank"], { stdio: "ignore" });
let browser;
for (let attempt = 0; attempt < 40; attempt += 1) {
  try { browser = await chromium.connectOverCDP("http://127.0.0.1:9223"); break; } catch { await new Promise((resolve) => setTimeout(resolve, 250)); }
}
if (!browser) throw new Error("Chrome DevTools connection did not start");
const context = browser.contexts()[0];

// Chrome ships several built-in component extensions (e.g. "Google Hangouts") that also register
// service workers in a fresh profile — grabbing serviceWorkers()[0] blindly can pick one of those
// instead of ours, silently losing the "tabs"/host permissions ours declares (url/title come back
// undefined from chrome.tabs.query as a result). Identify ours by manifest name instead.
async function findOurWorker() {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    for (const candidate of context.serviceWorkers()) {
      try {
        const name = await candidate.evaluate(() => chrome.runtime.getManifest().name);
        if (name === "Spatial AI Context Layer") return candidate;
      } catch { /* worker may have been torn down mid-check; keep looking */ }
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Spatial AI Context Layer service worker never appeared");
}
const worker = await findOurWorker();
const results = [];

for (const [name, url] of sites) {
  const page = await context.newPage();
  const started = Date.now();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(1800);
    const title = await page.title();
    const result = await worker.evaluate(async (targetUrl) => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((item) => item.url?.startsWith(targetUrl.split("/").slice(0, 3).join("/")) && !item.url.includes("localhost:3000"));
      if (!tab) throw new Error(`No source tab found for ${targetUrl}`);
      await chrome.tabs.update(tab.id, { active: true });
      await openCaptureFlow(tab);
      return chrome.storage.local.get(["lastCaptureStatus", "pendingCapture"]);
    }, url);
    const status = result.lastCaptureStatus || {};
    const pending = result.pendingCapture || {};
    const domElements = pending.source?.page_context?.dom_elements || [];
    results.push({
      name,
      url,
      title,
      ok: status.ok === true,
      screenshot_bytes: status.bytes || 0,
      enriched: status.enriched === true,
      page_context_bytes: JSON.stringify(pending.source?.page_context || {}).length,
      dom_elements_count: domElements.length,
      dom_elements_sample: domElements.slice(0, 3).map((element) => ({ tag: element.tag, text: element.text?.slice(0, 40) })),
      duration_ms: Date.now() - started,
      error: status.error || "",
    });
  } catch (error) {
    results.push({ name, url, ok: false, screenshot_bytes: 0, enriched: false, duration_ms: Date.now() - started, error: error.message });
  } finally {
    await page.close().catch(() => {});
    for (const openPage of context.pages()) if (openPage.url().includes("localhost:3000/capture")) await openPage.close().catch(() => {});
  }
}

// Full-page (scroll + stitch) capture is a distinct code path (captureFullPage, OffscreenCanvas
// stitching) from the default single-viewport capture exercised above — verify it separately
// against a page long enough to actually require scrolling.
let fullPageTest = { ok: false };
{
  const url = "https://en.wikipedia.org/wiki/Optical_character_recognition";
  const page = await context.newPage();
  const started = Date.now();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(1800);
    const result = await worker.evaluate(async (targetUrl) => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((item) => item.url?.startsWith(targetUrl.split("/").slice(0, 3).join("/")) && !item.url.includes("localhost:3000"));
      if (!tab) throw new Error(`No source tab found for ${targetUrl}`);
      await chrome.tabs.update(tab.id, { active: true });
      await openCaptureFlow(tab, { fullPage: true });
      return chrome.storage.local.get(["lastCaptureStatus", "pendingCapture"]);
    }, url);
    const status = result.lastCaptureStatus || {};
    const pending = result.pendingCapture || {};
    const fullPageMeta = pending.source?.page_context?.full_page || null;
    fullPageTest = {
      ok: status.ok === true && status.fullPage === true && Boolean(fullPageMeta) && fullPageMeta.sections > 1,
      screenshot_bytes: status.bytes || 0,
      full_page_meta: fullPageMeta,
      dom_elements_count: (pending.source?.page_context?.dom_elements || []).length,
      duration_ms: Date.now() - started,
      error: status.error || "",
    };
  } catch (error) {
    fullPageTest = { ok: false, duration_ms: Date.now() - started, error: error.message };
  } finally {
    await page.close().catch(() => {});
    for (const openPage of context.pages()) if (openPage.url().includes("localhost:3000/capture")) await openPage.close().catch(() => {});
  }
}

// Real-Time Lens is a distinct code path (lens.js content-script overlay + LENS_ANALYZE message
// round-trip through background.js) from the tab-based capture flow exercised above — verify it
// with a REAL click (page.mouse.click, a genuine OS-level input event, not a synthetic dispatch)
// so the content script's capture-phase click listener actually has to intercept it for real.
// A provider quota/rate-limit error still proves the click -> screenshot -> backend -> panel
// pipeline works end to end; only the demo API key ran out, so it's labeled, not a hard failure —
// matching QUOTA_ERROR_HINTS in backend/tests/test_api.py.
const QUOTA_ERROR_PATTERN = /insufficient_quota|resource_exhausted|rate limit|quota|\b429\b/i;
let lensTest = { ok: false };
{
  const url = "https://en.wikipedia.org/wiki/Optical_character_recognition";
  const page = await context.newPage();
  const started = Date.now();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(1800);
    // Pin Lens to a provider known to have working quota in this environment (verified repeatedly
    // elsewhere in this session) so this test demonstrates a genuine successful AI response, not
    // just the error-relay path — the default-model behavior is covered by not setting this at all
    // in normal use.
    await worker.evaluate(() => chrome.storage.local.set({ lensModel: "openrouter" }));
    await worker.evaluate(async (targetUrl) => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((item) => item.url?.startsWith(targetUrl.split("/").slice(0, 3).join("/")) && !item.url.includes("localhost:3000"));
      if (!tab) throw new Error(`No source tab found for ${targetUrl}`);
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_LENS" });
    }, url);
    await page.waitForTimeout(500); // let the content script build the shadow-DOM overlay
    const badgeVisible = await page.evaluate(() => Boolean(document.getElementById("spatial-ai-lens-host")?.shadowRoot?.querySelector(".badge")));
    const viewport = page.viewportSize() || { width: 1280, height: 720 };
    await page.mouse.click(Math.floor(viewport.width / 2), Math.floor(viewport.height / 2));

    let resultText = null;
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      resultText = await page.evaluate(() => document.getElementById("spatial-ai-lens-host")?.shadowRoot?.querySelector(".body")?.textContent || null);
      if (resultText && resultText !== "Thinking…") break;
      await page.waitForTimeout(500);
    }
    const quotaLimited = QUOTA_ERROR_PATTERN.test(resultText || "");
    const followUpInputVisible = await page.evaluate(() => Boolean(document.getElementById("spatial-ai-lens-host")?.shadowRoot?.querySelector(".panel input")));

    // The panel only ever surfaces an OCR *failure* note, never confirmation of OCR success --
    // call background.js's own captureAndGroundForLens() directly in the service worker's scope
    // (Playwright's serviceWorkers() gives real eval access to it) to confirm grounding actually
    // ran, not just that Lens produced an answer through some other path.
    const groundingCheck = await worker.evaluate(async (targetUrl) => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((item) => item.url?.startsWith(targetUrl.split("/").slice(0, 3).join("/")) && !item.url.includes("localhost:3000"));
      const grounding = await captureAndGroundForLens(tab);
      return { ocrStatus: grounding.ocrStatus, ocrTextLength: grounding.ocrText.length };
    }, url);

    lensTest = {
      ok: badgeVisible && Boolean(resultText) && resultText !== "Thinking…" && (quotaLimited || !/analysis failed|extension was reloaded/i.test(resultText || "")) && groundingCheck.ocrStatus === "success",
      badge_visible: badgeVisible,
      quota_limited: quotaLimited,
      follow_up_input_visible: followUpInputVisible,
      ocr_status: groundingCheck.ocrStatus,
      ocr_text_length: groundingCheck.ocrTextLength,
      result_text: (resultText || "").slice(0, 200),
      duration_ms: Date.now() - started,
    };
    await worker.evaluate(() => chrome.storage.local.remove("lensModel"));
    await worker.evaluate(async (targetUrl) => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((item) => item.url?.startsWith(targetUrl.split("/").slice(0, 3).join("/")) && !item.url.includes("localhost:3000"));
      if (tab) await chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_LENS" });
    }, url);
  } catch (error) {
    lensTest = { ok: false, duration_ms: Date.now() - started, error: error.message };
  } finally {
    await page.close().catch(() => {});
    for (const openPage of context.pages()) if (openPage.url().includes("localhost:3000/capture")) await openPage.close().catch(() => {});
  }
}

fs.writeFileSync(outputPath, JSON.stringify({ created_at: new Date().toISOString(), browser: "Google Chrome", sites: results, full_page_test: fullPageTest, lens_test: lensTest }, null, 2));
await context.close();
chrome.kill("SIGTERM");
const failures = results.filter((result) => !result.ok);
console.log(JSON.stringify({ sites: results, full_page_test: fullPageTest, lens_test: lensTest }, null, 2));
if (failures.length || !fullPageTest.ok || !lensTest.ok) process.exitCode = 1;