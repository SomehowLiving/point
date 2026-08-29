// Real-Time Lens: point at or draw around anything on the live page to get an instant AI answer
// in a floating panel, no tab switch. Inert until toggled (Alt+Shift+L) — this script loads on
// every page per manifest.json, but does nothing until it receives a TOGGLE_LENS message.
(() => {
  if (window.__spatialAiLensInstalled) return;
  window.__spatialAiLensInstalled = true;

  // Same action set the main dashboard's CommandBar offers, minus ones that don't fit a single
  // click/drag in Lens: "copy" (dashboard's OCR-recovery flow), "search" (needs the citation UI),
  // and "transform" (needs a target-format instruction Lens has no text box for up front).
  const ACTION_INSTRUCTIONS = {
    explain: "Explain what's here.",
    ask: "What is this?",
    summarize: "Summarize this.",
    extract: "Extract the information here as structured data.",
    translate: "Translate this.",
    rewrite: "Rewrite this to be clearer and more concise.",
    compare: "Compare these selections and explain how they relate.",
  };
  const ACTION_LABELS = { explain: "Explain", ask: "Ask", summarize: "Summarize", extract: "Extract", translate: "Translate", rewrite: "Rewrite", compare: "Compare" };

  let active = false;
  let host = null;
  let shadow = null;
  let badge = null;
  let panel = null;
  let mode = "point"; // "point" | "draw"
  let currentAction = "explain";
  let pendingSelections = []; // only accumulated while currentAction === "compare"
  let dragging = false;
  let dragPath = [];
  let dragPreview = null;
  const SVG_NS = "http://www.w3.org/2000/svg";

  chrome.storage.local.get(["lensAction"]).then(({ lensAction }) => {
    if (lensAction && ACTION_INSTRUCTIONS[lensAction]) currentAction = lensAction;
  });

  function ensureOverlay() {
    if (host) return;
    host = document.createElement("div");
    host.id = "spatial-ai-lens-host";
    host.style.cssText = "all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;";
    document.documentElement.appendChild(host);
    shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `
      .badge { position: fixed; top: 16px; right: 16px; background: #111116; color: #fff; font: 12px/1.4 system-ui, sans-serif; padding: 10px 12px; border-radius: 12px; box-shadow: 0 4px 16px rgba(0,0,0,.35); pointer-events: auto; display: flex; flex-direction: column; gap: 8px; width: 220px; }
      .badge-row { display: flex; align-items: center; gap: 6px; }
      .badge-title { display: flex; align-items: center; gap: 6px; font-weight: 600; flex: 1; }
      .dot { width: 7px; height: 7px; border-radius: 50%; background: #34d399; box-shadow: 0 0 6px #34d399; flex-shrink: 0; }
      .exit-btn { background: none; border: none; color: #8b8b95; cursor: pointer; font-size: 15px; line-height: 1; padding: 2px 4px; }
      .exit-btn:hover { color: #fff; }
      .mode-btn { flex: 1; background: #1c1c24; border: 1px solid #2a2a33; color: #a1a1aa; border-radius: 6px; padding: 5px 0; cursor: pointer; font: inherit; }
      .mode-btn.selected { border-color: #34d399; color: #fff; }
      .action-select { flex: 1; background: #1c1c24; border: 1px solid #2a2a33; color: #e4e4e7; border-radius: 6px; padding: 5px 6px; font: inherit; }
      .hint { color: #71717a; font-size: 10px; }
      .compare-row { display: none; align-items: center; gap: 6px; }
      .compare-row.visible { display: flex; }
      .compare-count { flex: 1; color: #a1a1aa; }
      .compare-row button { background: #1c1c24; border: 1px solid #2a2a33; color: #e4e4e7; border-radius: 6px; padding: 4px 8px; cursor: pointer; font: inherit; }
      .compare-row button.primary { border-color: #34d399; }
      .compare-row button:disabled { opacity: .5; cursor: default; }
      .panel { position: fixed; width: 300px; background: #16161c; color: #e4e4e7; font: 13px/1.5 system-ui, sans-serif; border-radius: 10px; box-shadow: 0 12px 32px rgba(0,0,0,.45); padding: 12px 14px; pointer-events: auto; border: 1px solid #2a2a33; }
      .panel .panel-actions { position: absolute; top: 4px; right: 4px; display: flex; gap: 2px; }
      .panel .panel-actions button { cursor: pointer; color: #8b8b95; font-size: 14px; background: none; border: none; line-height: 1; padding: 4px 6px; }
      .panel .panel-actions button:hover { color: #fff; }
      .panel .body { white-space: pre-wrap; margin: 6px 0 8px; max-height: 220px; overflow: auto; }
      .panel .loading { color: #8b8b95; font-style: italic; }
      .panel .ocr-note { color: #8b8b95; font-size: 11px; margin: -4px 0 8px; }
      .panel input { width: 100%; box-sizing: border-box; background: #0d0d11; border: 1px solid #2a2a33; color: #e4e4e7; border-radius: 6px; padding: 6px 8px; font: inherit; }
      .panel input:focus { outline: 1px solid #34d399; }
      .pin { position: fixed; width: 14px; height: 14px; margin: -7px 0 0 -7px; border-radius: 50%; background: #34d399; border: 2px solid #fff; box-shadow: 0 0 0 3px rgba(52,211,153,.35); pointer-events: none; display: flex; align-items: center; justify-content: center; font: 700 9px/1 system-ui, sans-serif; color: #04120c; }
      .region-box { position: fixed; border: 2px solid #34d399; background: rgba(52,211,153,.12); border-radius: 3px; pointer-events: none; }
      .region-box .region-label { position: absolute; top: -18px; left: -2px; background: #34d399; color: #04120c; font: 700 9px/1 system-ui, sans-serif; padding: 2px 4px; border-radius: 3px; }
      .drag-path { position: fixed; inset: 0; pointer-events: none; }
    `;
    shadow.appendChild(style);
  }

  function showBadge() {
    badge = document.createElement("div");
    badge.className = "badge";
    badge.innerHTML = `
      <div class="badge-row">
        <span class="badge-title"><span class="dot"></span> Lens on</span>
        <button class="exit-btn" title="Exit Lens (Esc)">×</button>
      </div>
      <div class="badge-row">
        <button class="mode-btn" data-mode="point">Point</button>
        <button class="mode-btn" data-mode="draw">Draw</button>
      </div>
      <div class="badge-row">
        <select class="action-select">${Object.entries(ACTION_LABELS).map(([id, label]) => `<option value="${id}">${label}</option>`).join("")}</select>
      </div>
      <div class="badge-row compare-row">
        <span class="compare-count">0 selected</span>
        <button class="compare-clear">Clear</button>
        <button class="compare-submit primary" disabled>Compare</button>
      </div>
      <div class="hint">${mode === "point" ? "Click anything" : "Drag or doodle around anything"}</div>
    `;
    shadow.appendChild(badge);
    badge.querySelector(".exit-btn").addEventListener("click", () => setActive(false));
    badge.querySelectorAll(".mode-btn").forEach((button) => button.addEventListener("click", () => setMode(button.dataset.mode)));
    badge.querySelector(".action-select").value = currentAction;
    badge.querySelector(".action-select").addEventListener("change", (event) => setAction(event.target.value));
    badge.querySelector(".compare-clear").addEventListener("click", clearPendingSelections);
    badge.querySelector(".compare-submit").addEventListener("click", () => { if (pendingSelections.length >= 2) submitSelections(pendingSelections.slice(), "compare"); });
    updateBadge();
  }

  function updateBadge() {
    if (!badge) return;
    badge.querySelectorAll(".mode-btn").forEach((button) => button.classList.toggle("selected", button.dataset.mode === mode));
    badge.querySelector(".hint").textContent = mode === "point" ? "Click anything" : "Drag or doodle around anything";
    const compareRow = badge.querySelector(".compare-row");
    compareRow.classList.toggle("visible", currentAction === "compare");
    badge.querySelector(".compare-count").textContent = `${pendingSelections.length} selected`;
    badge.querySelector(".compare-submit").disabled = pendingSelections.length < 2;
  }

  function setMode(next) { mode = next; updateBadge(); }
  function setAction(next) {
    currentAction = next;
    if (next !== "compare") clearPendingSelections();
    updateBadge();
    chrome.storage.local.set({ lensAction: next }).catch(() => {});
  }

  function clearPendingSelections() {
    pendingSelections.forEach((selection) => selection.markerEl?.remove());
    pendingSelections = [];
    updateBadge();
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

  function addFollowUpInput(panelElement, clientX, clientY, points, regions) {
    if (panelElement.querySelector("input")) return;
    const input = document.createElement("input");
    input.placeholder = "Ask a follow-up…";
    input.addEventListener("keydown", (event) => {
      event.stopPropagation();
      // A follow-up is about the same already-captured selection, so it reuses that capture's
      // screenshot + OCR grounding (reuseGrounding=true) instead of re-capturing the screen.
      if (event.key === "Enter" && input.value.trim()) sendAnalyze({ points, regions, instruction: input.value.trim(), action: currentAction, clientX, clientY, reuseGrounding: true });
    });
    panelElement.appendChild(input);
  }

  function markPoint(clientX, clientY, label) {
    ensureOverlay();
    const pin = document.createElement("div");
    pin.className = "pin";
    pin.style.left = `${clientX}px`;
    pin.style.top = `${clientY}px`;
    if (label) pin.textContent = label;
    shadow.appendChild(pin);
    return pin;
  }

  function markRegion(clientBox, label) {
    ensureOverlay();
    const box = document.createElement("div");
    box.className = "region-box";
    box.style.left = `${clientBox.left}px`;
    box.style.top = `${clientBox.top}px`;
    box.style.width = `${clientBox.right - clientBox.left}px`;
    box.style.height = `${clientBox.bottom - clientBox.top}px`;
    if (label) box.innerHTML = `<span class="region-label">${label}</span>`;
    shadow.appendChild(box);
    return box;
  }

  // points/regions are arrays so one panel/one analyze call can cover multiple selections at
  // once (the "compare" flow) as well as the everyday single-selection case.
  function sendAnalyze({ points, regions, instruction, action, clientX, clientY, reuseGrounding }) {
    closePanel();
    ensureOverlay();
    panel = document.createElement("div");
    panel.className = "panel";
    positionPanel(panel, clientX, clientY);
    panel.innerHTML = '<div class="panel-actions"><button class="copy-btn" title="Copy answer">⧉</button><button class="close" title="Close">×</button></div><div class="body loading">Thinking…</div>';
    shadow.appendChild(panel);
    panel.querySelector(".close").addEventListener("click", () => closePanel());
    panel.querySelector(".copy-btn").addEventListener("click", () => {
      const text = panel?.querySelector(".body")?.textContent || "";
      navigator.clipboard?.writeText(text).catch(() => {});
    });

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
      addFollowUpInput(panel, clientX, clientY, points, regions);
    };

    try {
      chrome.runtime.sendMessage({ type: "LENS_ANALYZE", points, regions, instruction, action, reuseGrounding }, (response) => {
        respond(response, chrome.runtime.lastError?.message);
      });
    } catch (error) {
      respond(null, "Extension was reloaded — refresh the page to use Lens again.");
    }
  }

  function submitSelections(selections, action) {
    const points = selections.filter((s) => s.kind === "point").map((s) => s.point);
    const regions = selections.filter((s) => s.kind === "region").map((s) => s.region);
    const last = selections[selections.length - 1];
    if (action === "compare") clearPendingSelections();
    sendAnalyze({ points, regions, instruction: ACTION_INSTRUCTIONS[action], action, clientX: last.clientX, clientY: last.clientY, reuseGrounding: false });
  }

  function handleSelection(selection) {
    if (currentAction === "compare") {
      const label = String(pendingSelections.length + 1);
      selection.markerEl = selection.kind === "point" ? markPoint(selection.clientX, selection.clientY, label) : markRegion(selection.clientBox, label);
      pendingSelections.push(selection);
      updateBadge();
      return;
    }
    if (selection.kind === "point") markPoint(selection.clientX, selection.clientY);
    else markRegion(selection.clientBox);
    submitSelections([selection], currentAction);
  }

  function clientBoxOf(path) {
    const xs = path.map((p) => p.x);
    const ys = path.map((p) => p.y);
    return { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
  }

  function updateDragPreview() {
    if (!dragPreview) {
      ensureOverlay();
      dragPreview = document.createElementNS(SVG_NS, "svg");
      dragPreview.setAttribute("class", "drag-path");
      const polyline = document.createElementNS(SVG_NS, "polyline");
      polyline.setAttribute("fill", "none");
      polyline.setAttribute("stroke", "#34d399");
      polyline.setAttribute("stroke-width", "2");
      polyline.setAttribute("stroke-linejoin", "round");
      dragPreview.appendChild(polyline);
      shadow.appendChild(dragPreview);
    }
    dragPreview.querySelector("polyline").setAttribute("points", dragPath.map((p) => `${p.x},${p.y}`).join(" "));
  }

  function removeDragPreview() {
    dragPreview?.remove();
    dragPreview = null;
  }

  function onMouseDown(event) {
    if (mode !== "draw" || event.target === host) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    dragging = true;
    dragPath = [{ x: event.clientX, y: event.clientY }];
  }

  function onMouseMove(event) {
    if (!dragging) return;
    dragPath.push({ x: event.clientX, y: event.clientY });
    updateDragPreview();
  }

  function onMouseUp() {
    if (!dragging) return;
    dragging = false;
    removeDragPreview();
    if (dragPath.length < 2) return;
    const clientBox = clientBoxOf(dragPath);
    if (clientBox.right - clientBox.left < 6 && clientBox.bottom - clientBox.top < 6) return; // negligible movement, ignore
    const region = {
      x: clientBox.left / innerWidth,
      y: clientBox.top / innerHeight,
      width: (clientBox.right - clientBox.left) / innerWidth,
      height: (clientBox.bottom - clientBox.top) / innerHeight,
    };
    handleSelection({ kind: "region", region, clientBox, clientX: clientBox.right, clientY: clientBox.bottom });
  }

  function onClick(event) {
    if (mode !== "point" || event.target === host) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    handleSelection({ kind: "point", point: { x: event.clientX / innerWidth, y: event.clientY / innerHeight }, clientX: event.clientX, clientY: event.clientY });
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
      document.addEventListener("mousedown", onMouseDown, true);
      document.addEventListener("mousemove", onMouseMove, true);
      document.addEventListener("mouseup", onMouseUp, true);
      document.addEventListener("keydown", onKeydown, true);
    } else {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("mousedown", onMouseDown, true);
      document.removeEventListener("mousemove", onMouseMove, true);
      document.removeEventListener("mouseup", onMouseUp, true);
      document.removeEventListener("keydown", onKeydown, true);
      pendingSelections = [];
      dragging = false;
      host?.remove();
      host = null;
      shadow = null;
      badge = null;
      panel = null;
      dragPreview = null;
    }
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "TOGGLE_LENS") setActive(!active);
  });
})();
