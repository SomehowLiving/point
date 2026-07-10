import { chromium } from "../../frontend/node_modules/playwright/index.mjs";
import fs from "node:fs";
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

const profilePath = "/tmp/spatial-extension-profile";
fs.rmSync(profilePath, { recursive: true, force: true });
const chrome = spawn("/usr/bin/google-chrome", ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--disable-breakpad", "--disable-crash-reporter", `--user-data-dir=${profilePath}`, `--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`, "--remote-debugging-port=9223", "about:blank"], { stdio: "ignore" });
let browser;
for (let attempt = 0; attempt < 40; attempt += 1) {
  try { browser = await chromium.connectOverCDP("http://127.0.0.1:9223"); break; } catch { await new Promise((resolve) => setTimeout(resolve, 250)); }
}
if (!browser) throw new Error("Chrome DevTools connection did not start");
const context = browser.contexts()[0];

let worker = context.serviceWorkers()[0];
if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 20000 });
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
      const tab = tabs.find((item) => item.url?.startsWith(targetUrl.split("/").slice(0, 3).join("/")) && !item.url.includes("preview.emergentagent.com"));
      if (!tab) throw new Error(`No source tab found for ${targetUrl}`);
      await chrome.tabs.update(tab.id, { active: true });
      await openCaptureFlow(tab);
      return chrome.storage.local.get(["lastCaptureStatus", "pendingCapture"]);
    }, url);
    const status = result.lastCaptureStatus || {};
    const pending = result.pendingCapture || {};
    results.push({ name, url, title, ok: status.ok === true, screenshot_bytes: status.bytes || 0, enriched: status.enriched === true, page_context_bytes: JSON.stringify(pending.source?.page_context || {}).length, duration_ms: Date.now() - started, error: status.error || "" });
  } catch (error) {
    results.push({ name, url, ok: false, screenshot_bytes: 0, enriched: false, duration_ms: Date.now() - started, error: error.message });
  } finally {
    await page.close().catch(() => {});
    for (const openPage of context.pages()) if (openPage.url().includes("preview.emergentagent.com/capture")) await openPage.close().catch(() => {});
  }
}

fs.writeFileSync(outputPath, JSON.stringify({ created_at: new Date().toISOString(), browser: "Google Chrome", sites: results }, null, 2));
await context.close();
chrome.kill("SIGTERM");
const failures = results.filter((result) => !result.ok);
console.log(JSON.stringify(results, null, 2));
if (failures.length) process.exitCode = 1;