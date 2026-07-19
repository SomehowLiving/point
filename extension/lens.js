// Real-Time Lens: click anything on the live page to get an instant AI explanation in a floating
// panel, no tab switch. Inert until toggled (Alt+Shift+L) — this script loads on every page per
// manifest.json, but does nothing until it receives a TOGGLE_LENS message.
(() => {
  if (window.__spatialAiLensInstalled) return;
  window.__spatialAiLensInstalled = true;

  let active = false;
  let host = null;
  let shadow = null;
  let badge = null;
  let panel = null;

  function ensureOverlay() {
    if (host) return;
    host = document.createElement("div");
    host.id = "spatial-ai-lens-host";
    host.style.cssText = "all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;";
    document.documentElement.appendChild(host);
    shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `
      .badge { position: fixed; top: 16px; right: 16px; background: #111116; color: #fff; font: 600 12px/1 system-ui, sans-serif; padding: 8px 12px; border-radius: 999px; box-shadow: 0 4px 16px rgba(0,0,0,.35); pointer-events: auto; cursor: pointer; display: flex; align-items: center; gap: 6px; }
      .badge:hover { background: #1c1c24; }
      .dot { width: 7px; height: 7px; border-radius: 50%; background: #34d399; box-shadow: 0 0 6px #34d399; }
      .panel { position: fixed; width: 300px; background: #16161c; color: #e4e4e7; font: 13px/1.5 system-ui, sans-serif; border-radius: 10px; box-shadow: 0 12px 32px rgba(0,0,0,.45); padding: 12px 14px; pointer-events: auto; border: 1px solid #2a2a33; }
      .panel .close { position: absolute; top: 4px; right: 6px; cursor: pointer; color: #8b8b95; font-size: 16px; background: none; border: none; line-height: 1; padding: 4px; }
      .panel .close:hover { color: #fff; }
      .panel .body { white-space: pre-wrap; margin: 6px 0 8px; max-height: 220px; overflow: auto; }
      .panel .loading { color: #8b8b95; font-style: italic; }
      .panel .ocr-note { color: #8b8b95; font-size: 11px; margin: -4px 0 8px; }
      .panel input { width: 100%; box-sizing: border-box; background: #0d0d11; border: 1px solid #2a2a33; color: #e4e4e7; border-radius: 6px; padding: 6px 8px; font: inherit; }
      .panel input:focus { outline: 1px solid #34d399; }
      .pin { position: fixed; width: 14px; height: 14px; margin: -7px 0 0 -7px; border-radius: 50%; background: #34d399; border: 2px solid #fff; box-shadow: 0 0 0 3px rgba(52,211,153,.35); pointer-events: none; }
    `;
    shadow.appendChild(style);
  }

  function showBadge() {
    badge = document.createElement("div");
    badge.className = "badge";
    badge.innerHTML = '<span class="dot"></span> Lens on — click anything, Esc to exit';
    badge.addEventListener("click", () => setActive(false));
    shadow.appendChild(badge);
  }

  function closePanel() {
    panel?.remove();
    panel = null;
  }

  function positionPanel(element, clientX, clientY) {
    const left = Math.max(8, Math.min(clientX + 16, innerWidth - 316));
    const top = Math.max(8, Math.min(clientY + 16, innerHeight - 200));
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
  }

  function addFollowUpInput(panelElement, clientX, clientY, normX, normY) {
    if (panelElement.querySelector("input")) return;
    const input = document.createElement("input");
    input.placeholder = "Ask a follow-up…";
    input.addEventListener("keydown", (event) => {
      event.stopPropagation();
      // A follow-up is about the same already-captured point, so it reuses that capture's
      // screenshot + OCR grounding (reuseGrounding=true) instead of re-capturing the screen.
      if (event.key === "Enter" && input.value.trim()) runAnalysis(clientX, clientY, normX, normY, input.value.trim(), true);
    });
    panelElement.appendChild(input);
  }

  function runAnalysis(clientX, clientY, normX, normY, instruction, reuseGrounding = false) {
    closePanel();
    ensureOverlay();
    const pin = document.createElement("div");
    pin.className = "pin";
    pin.style.left = `${clientX}px`;
    pin.style.top = `${clientY}px`;
    shadow.appendChild(pin);

    panel = document.createElement("div");
    panel.className = "panel";
    positionPanel(panel, clientX, clientY);
    panel.innerHTML = '<button class="close">×</button><div class="body loading">Thinking…</div>';
    shadow.appendChild(panel);
    panel.querySelector(".close").addEventListener("click", () => { closePanel(); pin.remove(); });

    const respond = (response, lastError) => {
      if (!panel) return; // closed while we were waiting
      const body = panel.querySelector(".body");
      body.classList.remove("loading");
      if (lastError) { body.textContent = lastError; return; }
      if (!response?.ok) { body.textContent = response?.error || "Analysis failed."; return; }
      body.textContent = response.text;
      if (response.ocrStatus === "error") {
        const note = document.createElement("div");
        note.className = "ocr-note";
        note.textContent = "(text extraction failed — answered from the image only)";
        body.after(note);
      }
      addFollowUpInput(panel, clientX, clientY, normX, normY);
    };

    try {
      chrome.runtime.sendMessage({ type: "LENS_ANALYZE", point: { x: normX, y: normY }, instruction, reuseGrounding }, (response) => {
        respond(response, chrome.runtime.lastError?.message);
      });
    } catch (error) {
      respond(null, "Extension was reloaded — refresh the page to use Lens again.");
    }
  }

  function onClick(event) {
    if (event.target === host) return; // clicks inside our own overlay behave normally
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    runAnalysis(event.clientX, event.clientY, event.clientX / innerWidth, event.clientY / innerHeight, "Explain what's at this point.");
  }

  function onKeydown(event) {
    if (event.key === "Escape") setActive(false);
  }

  function setActive(next) {
    if (active === next) return;
    active = next;
    if (active) {
      ensureOverlay();
      showBadge();
      document.addEventListener("click", onClick, true);
      document.addEventListener("keydown", onKeydown, true);
    } else {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKeydown, true);
      host?.remove();
      host = null;
      shadow = null;
      badge = null;
      panel = null;
    }
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "TOGGLE_LENS") setActive(!active);
  });
})();
