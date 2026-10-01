import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowSquareOut, Clipboard, X } from "@phosphor-icons/react";
import { toast } from "sonner";
import { CommandBar } from "@/components/CommandBar";
import Markdown from "@/components/Markdown";
import { analyzeCapture, extractOcr } from "@/lib/api";
import { closeSnip, listenForSnip, openSnipInPoint, writeClipboard } from "@/lib/native";
import { dockPlacement } from "@/lib/snipPlacement";

// Snipping-Tool-style overlay for the desktop app: the shell freezes the screen and shows it here
// full-screen. Drag to select a region (repeat for more), click to drop a point, then ask without
// leaving the screen you were on. Esc steps back: result → selection → closes the overlay.

const VERBATIM_ACTIONS = new Set(["copy", "rewrite", "translate", "transform"]);
const DEFAULT_INSTRUCTIONS = {
  ask: "What is this?", explain: "Explain what matters in this selection", copy: "Copy the text exactly",
  search: "Search the web for this", translate: "Translate to English", rewrite: "Rewrite this more clearly",
  transform: "Convert this to a clean table", summarize: "Summarize this", extract: "Extract the structured data",
  compare: "Compare the selected regions",
};
const CLICK_SLOP = 6; // px — a drag shorter than this is a click, which drops a point instead
const clamp01 = (value) => Math.min(1, Math.max(0, value));
export default function SnipPage() {
  const [capture, setCapture] = useState(null);
  const [regions, setRegions] = useState([]);
  const [points, setPoints] = useState([]);
  const [drag, setDrag] = useState(null);
  const [action, setAction] = useState("explain");
  const [command, setCommand] = useState("");
  const [model, setModel] = useState("gpt-5.5");
  const [extractSchema, setExtractSchema] = useState("auto");
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState("");
  const [resultAction, setResultAction] = useState("explain");
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [barHeight, setBarHeight] = useState(120);
  const stageRef = useRef(null);
  const inputFocusRef = useRef(null);

  const reset = useCallback(() => {
    setRegions([]); setPoints([]); setDrag(null); setResult(""); setCommand(""); setProcessing(false);
  }, []);

  const load = useCallback((payload) => { reset(); setCapture(payload); }, [reset]);

  useEffect(() => {
    let unlisten = () => {};
    listenForSnip(load).then((fn) => { unlisten = fn; });
    window.__pointSnip = load; // lets the browser build (and tests) drive the overlay without the shell
    return () => { unlisten(); delete window.__pointSnip; };
  }, [load]);

  useEffect(() => {
    const onResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // The command bar's height changes with the extract-schema strip, so measure it instead of guessing.
  useEffect(() => {
    const bar = inputFocusRef.current?.querySelector(".command-dock");
    if (!bar) return undefined;
    const observer = new ResizeObserver(() => setBarHeight(bar.offsetHeight || 120));
    observer.observe(bar);
    return () => observer.disconnect();
  });

  const dismiss = useCallback(async () => { reset(); setCapture(null); await closeSnip(); }, [reset]);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key !== "Escape") return;
      if (result || processing) setResult("");
      else if (regions.length || points.length) { setRegions([]); setPoints([]); }
      else dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [result, processing, regions.length, points.length, dismiss]);

  const toNormalized = (event) => {
    const rect = stageRef.current.getBoundingClientRect();
    return { x: clamp01((event.clientX - rect.left) / rect.width), y: clamp01((event.clientY - rect.top) / rect.height), px: event.clientX, py: event.clientY };
  };

  const onPointerDown = (event) => {
    if (event.button !== 0 || event.target !== stageRef.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const start = toNormalized(event);
    setDrag({ start, end: start });
  };
  const onPointerMove = (event) => { if (drag) setDrag({ ...drag, end: toNormalized(event) }); };
  const onPointerUp = () => {
    if (!drag) return;
    const { start, end } = drag;
    setDrag(null);
    if (Math.hypot(end.px - start.px, end.py - start.py) < CLICK_SLOP) {
      setPoints((current) => [...current, { id: crypto.randomUUID(), x: start.x, y: start.y, label: `Point ${current.length + 1}` }].slice(-12));
    } else {
      const box = { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) };
      setRegions((current) => [...current, { id: crypto.randomUUID(), ...box, label: `Region ${current.length + 1}` }].slice(-12));
    }
    setResult("");
    setTimeout(() => inputFocusRef.current?.querySelector("[data-testid=command-input]")?.focus(), 0);
  };

  const run = async () => {
    if (!capture || processing) return;
    const instruction = command.trim() || DEFAULT_INSTRUCTIONS[action] || "Explain this";
    setProcessing(true); setResult(""); setResultAction(action);
    try {
      let ocrText = "";
      try {
        const ocr = await extractOcr({ image_data: capture.screenshot, mime_type: capture.mime_type, engine: "auto", language: "eng", regions });
        ocrText = ocr?.text || "";
      } catch { /* OCR only grounds the answer; image analysis still works without it */ }
      await analyzeCapture({
        image_data: capture.screenshot, mime_type: capture.mime_type, instruction, action, extract_schema: extractSchema, model,
        regions, annotations: [], points, private_mode: false, source: capture.source, ocr_text: ocrText, additional_sources: [],
      }, (delta) => setResult((current) => current + delta));
    } catch (error) { toast.error(error.message); } finally { setProcessing(false); }
  };

  const copy = async () => { await writeClipboard(result); toast.success("Copied"); };
  const openInPoint = async () => { const payload = capture; reset(); setCapture(null); await openSnipInPoint(payload); };

  // Place the dock next to the most recent selection: below it if there's room, else above, else
  // inside it near the bottom (a near-full-screen selection leaves no room outside). Always clamped
  // to the visible screen; the answer card is capped to whatever height remains.
  const anchor = regions.length ? regions[regions.length - 1] : points.length ? { ...points[points.length - 1], width: 0, height: 0 } : null;
  const anchorStyle = anchor ? dockPlacement(anchor, viewport, barHeight) : null;
  const live = drag && { x: Math.min(drag.start.x, drag.end.x), y: Math.min(drag.start.y, drag.end.y), width: Math.abs(drag.end.x - drag.start.x), height: Math.abs(drag.end.y - drag.start.y) };
  const pct = (box) => ({ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.width * 100}%`, height: `${box.height * 100}%` });
  const hasSelection = regions.length > 0 || points.length > 0;

  if (!capture) return <div className="snip-root snip-idle" data-testid="snip-idle" />;

  return (
    <div className="snip-root" data-testid="snip-overlay">
      <img className="snip-frame" src={capture.screenshot} alt="" draggable="false" />
      <div
        ref={stageRef}
        className={`snip-stage ${hasSelection || live ? "has-selection" : ""}`}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
        data-testid="snip-stage"
      >
        {regions.map((region, index) => (
          <div key={region.id} className="snip-region" style={pct(region)} data-testid={`snip-region-${index}`}>
            <span>{String(index + 1).padStart(2, "0")}</span>
          </div>
        ))}
        {live && <div className="snip-region live" style={pct(live)} />}
        {points.map((point, index) => (
          <div key={point.id} className="snip-point" style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }} data-testid={`snip-point-${index}`} />
        ))}
      </div>

      {!hasSelection && !live && (
        <div className="snip-hint" data-testid="snip-hint">
          Drag to select · click to point · <kbd>Esc</kbd> to close
        </div>
      )}

      {hasSelection && !drag && (
        <div className="snip-dock" style={anchorStyle} ref={inputFocusRef} data-testid="snip-dock">
          {(result || processing) && (
            <div className="snip-result" data-testid="snip-result">
              <div className="snip-result-head">
                <span className="eyebrow">{processing && !result ? "Reading selection…" : "Point"}</span>
                <div>
                  {result && <button onClick={copy} aria-label="Copy result" title="Copy" data-testid="snip-copy-button"><Clipboard /></button>}
                  <button onClick={openInPoint} aria-label="Open in Point" title="Open in Point" data-testid="snip-open-button"><ArrowSquareOut /></button>
                  <button onClick={() => setResult("")} aria-label="Close result" title="Close (Esc)"><X /></button>
                </div>
              </div>
              {result && (VERBATIM_ACTIONS.has(resultAction)
                ? <div className="result-content" data-testid="snip-result-content">{result}</div>
                : <Markdown className="result-content markdown" data-testid="snip-result-content">{result}</Markdown>)}
              {processing && !result && <div className="result-loading"><i /><i /><i /></div>}
            </div>
          )}
          <CommandBar
            action={action} setAction={setAction} command={command} setCommand={setCommand}
            model={model} setModel={setModel} extractSchema={extractSchema} setExtractSchema={setExtractSchema}
            onSubmit={run} disabled={processing} processing={processing}
          />
        </div>
      )}
    </div>
  );
}
