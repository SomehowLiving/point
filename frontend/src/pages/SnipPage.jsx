import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowSquareOut, Clipboard, Lasso, Square, X } from "@phosphor-icons/react";
import { toast } from "sonner";
import { CommandBar } from "@/components/CommandBar";
import Markdown from "@/components/Markdown";
import { analyzeCapture, extractOcr } from "@/lib/api";
import { closeSnip, listenForSnip, openSnipInPoint, writeClipboard } from "@/lib/native";
import { dockPlacement } from "@/lib/snipPlacement";
import { isUsableShape, pathBounds, polygonPoints, simplifyPath } from "@/lib/snipShapes";

// Snipping-Tool-style overlay for the desktop app: the shell freezes the screen and shows it here
// full-screen. Select with a box or a freeform shape (repeat for more), click to drop a point, then
// ask without leaving the screen you were on. Esc steps back: result → selection → closes overlay.

const VERBATIM_ACTIONS = new Set(["copy", "rewrite", "translate", "transform"]);
const DEFAULT_INSTRUCTIONS = {
  ask: "What is this?", explain: "Explain what matters in this selection", copy: "Copy the text exactly",
  search: "Search the web for this", translate: "Translate to English", rewrite: "Rewrite this more clearly",
  transform: "Convert this to a clean table", summarize: "Summarize this", extract: "Extract the structured data",
  compare: "Compare the selected regions",
};
const MODES = [
  { id: "box", label: "Box", key: "B", icon: Square },
  { id: "free", label: "Freeform", key: "F", icon: Lasso },
];
const CLICK_SLOP = 6; // px — a drag shorter than this is a click, which drops a point instead
const MAX_SELECTIONS = 12; // backend limit for regions
const clamp01 = (value) => Math.min(1, Math.max(0, value));

// What the backend receives: every selection is a region (a freeform shape's region is its bounding
// box), and freeform shapes also send their outline as a "mask" annotation, the same format the
// workspace's Lasso tool uses.
export function selectionPayload(selections) {
  const regions = selections.map((s, index) => ({ id: s.id, ...s.box, label: `${s.kind === "free" ? "Freeform" : "Region"} ${index + 1}` }));
  const annotations = selections.filter((s) => s.kind === "free").map((s) => ({ id: `mask-${s.id}`, type: "mask", points: s.outline, edge: "hard" }));
  return { regions, annotations };
}

export default function SnipPage() {
  const [capture, setCapture] = useState(null);
  const [mode, setMode] = useState("box");
  const [selections, setSelections] = useState([]);
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
    setSelections([]); setPoints([]); setDrag(null); setResult(""); setCommand(""); setProcessing(false);
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
      const typing = ["INPUT", "TEXTAREA"].includes(event.target.tagName);
      if (event.key === "Escape") {
        if (result || processing) setResult("");
        else if (selections.length || points.length) { setSelections([]); setPoints([]); }
        else dismiss();
        return;
      }
      if (typing || event.ctrlKey || event.altKey || event.metaKey) return;
      const next = MODES.find((m) => m.key === event.key.toUpperCase());
      if (next) setMode(next.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [result, processing, selections.length, points.length, dismiss]);

  const toNormalized = (event) => {
    const rect = stageRef.current.getBoundingClientRect();
    return { x: clamp01((event.clientX - rect.left) / rect.width), y: clamp01((event.clientY - rect.top) / rect.height), px: event.clientX, py: event.clientY };
  };

  const onPointerDown = (event) => {
    if (event.button !== 0 || event.target !== stageRef.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const start = toNormalized(event);
    setDrag({ start, end: start, path: [{ x: start.x, y: start.y }] });
  };
  const onPointerMove = (event) => {
    if (!drag) return;
    const end = toNormalized(event);
    setDrag({ ...drag, end, path: mode === "free" ? [...drag.path, { x: end.x, y: end.y }] : drag.path });
  };
  const onPointerUp = () => {
    if (!drag) return;
    const { start, end, path } = drag;
    setDrag(null);
    const moved = mode === "free"
      ? path.some((p) => Math.hypot((p.x - start.x) * viewport.width, (p.y - start.y) * viewport.height) >= CLICK_SLOP)
      : Math.hypot(end.px - start.px, end.py - start.py) >= CLICK_SLOP;
    if (!moved) {
      setPoints((current) => [...current, { id: crypto.randomUUID(), x: start.x, y: start.y, label: `Point ${current.length + 1}` }].slice(-12));
    } else if (mode === "free") {
      const outline = simplifyPath(path);
      if (!isUsableShape(outline, viewport)) return;
      setSelections((current) => [...current, { id: crypto.randomUUID(), kind: "free", box: pathBounds(outline), outline }].slice(-MAX_SELECTIONS));
    } else {
      const box = { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) };
      setSelections((current) => [...current, { id: crypto.randomUUID(), kind: "box", box }].slice(-MAX_SELECTIONS));
    }
    setResult("");
    setTimeout(() => inputFocusRef.current?.querySelector("[data-testid=command-input]")?.focus(), 0);
  };

  const run = async () => {
    if (!capture || processing) return;
    const instruction = command.trim() || DEFAULT_INSTRUCTIONS[action] || "Explain this";
    const { regions, annotations } = selectionPayload(selections);
    setProcessing(true); setResult(""); setResultAction(action);
    try {
      let ocrText = "";
      try {
        const ocr = await extractOcr({ image_data: capture.screenshot, mime_type: capture.mime_type, engine: "auto", language: "eng", regions });
        ocrText = ocr?.text || "";
      } catch { /* OCR only grounds the answer; image analysis still works without it */ }
      await analyzeCapture({
        image_data: capture.screenshot, mime_type: capture.mime_type, instruction, action, extract_schema: extractSchema, model,
        regions, annotations, points, private_mode: false, source: capture.source, ocr_text: ocrText, additional_sources: [],
      }, (delta) => setResult((current) => current + delta));
    } catch (error) { toast.error(error.message); } finally { setProcessing(false); }
  };

  const copy = async () => { await writeClipboard(result); toast.success("Copied"); };
  const openInPoint = async () => { const payload = capture; reset(); setCapture(null); await openSnipInPoint(payload); };

  // Place the dock next to the most recent selection: below it if there's room, else above, else
  // inside it near the bottom (a near-full-screen selection leaves no room outside). Always clamped
  // to the visible screen; the answer card is capped to whatever height remains.
  const lastPoint = points[points.length - 1];
  const anchor = selections.length ? selections[selections.length - 1].box : lastPoint ? { ...lastPoint, width: 0, height: 0 } : null;
  const anchorStyle = anchor ? dockPlacement(anchor, viewport, barHeight) : null;
  const liveBox = drag && mode === "box" && { x: Math.min(drag.start.x, drag.end.x), y: Math.min(drag.start.y, drag.end.y), width: Math.abs(drag.end.x - drag.start.x), height: Math.abs(drag.end.y - drag.start.y) };
  const livePath = drag && mode === "free" && drag.path.length > 1 ? drag.path : null;
  const hasSelection = selections.length > 0 || points.length > 0;
  const showDim = hasSelection || liveBox || livePath;

  if (!capture) return <div className="snip-root snip-idle" data-testid="snip-idle" />;

  return (
    <div className="snip-root" data-testid="snip-overlay">
      <img className="snip-frame" src={capture.screenshot} alt="" draggable="false" />
      <div
        ref={stageRef}
        className={`snip-stage ${showDim ? "has-selection" : ""} mode-${mode}`}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
        data-testid="snip-stage"
      >
        {/* One SVG draws the dimming with holes cut for every selection, whatever its shape. */}
        <svg className="snip-shapes" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
          {showDim && (
            <>
              <defs>
                <mask id="snip-dim-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="1" height="1">
                  <rect x="0" y="0" width="1" height="1" fill="white" />
                  {selections.map((s) => (s.kind === "free"
                    ? <polygon key={s.id} points={polygonPoints(s.outline)} fill="black" />
                    : <rect key={s.id} x={s.box.x} y={s.box.y} width={s.box.width} height={s.box.height} fill="black" />))}
                  {liveBox && <rect x={liveBox.x} y={liveBox.y} width={liveBox.width} height={liveBox.height} fill="black" />}
                  {livePath && <polygon points={polygonPoints(livePath)} fill="black" />}
                </mask>
              </defs>
              <rect className="snip-dim" x="0" y="0" width="1" height="1" mask="url(#snip-dim-mask)" />
            </>
          )}
          {selections.map((s, index) => (s.kind === "free"
            ? <polygon key={s.id} className="snip-outline" points={polygonPoints(s.outline)} data-testid={`snip-free-${index}`} />
            : <rect key={s.id} className="snip-outline" x={s.box.x} y={s.box.y} width={s.box.width} height={s.box.height} data-testid={`snip-region-${index}`} />))}
          {liveBox && <rect className="snip-outline live" x={liveBox.x} y={liveBox.y} width={liveBox.width} height={liveBox.height} />}
          {livePath && <polyline className="snip-outline live" points={polygonPoints(livePath)} />}
        </svg>
        {selections.map((s, index) => (
          <span key={s.id} className="snip-label" style={{ left: `${s.box.x * 100}%`, top: `${s.box.y * 100}%` }}>{String(index + 1).padStart(2, "0")}</span>
        ))}
        {points.map((point, index) => (
          <div key={point.id} className="snip-point" style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }} data-testid={`snip-point-${index}`} />
        ))}
      </div>

      {!drag && (
        <div className="snip-toolbar" data-testid="snip-toolbar">
          {MODES.map(({ id, label, key, icon: Icon }) => (
            <button key={id} type="button" className={mode === id ? "active" : ""} onClick={() => setMode(id)} title={`${label} (${key})`} data-testid={`snip-mode-${id}`}>
              <Icon weight={mode === id ? "bold" : "regular"} />{label}<kbd>{key}</kbd>
            </button>
          ))}
          {!hasSelection && <span className="snip-toolbar-hint">{mode === "free" ? "Draw around anything" : "Drag a box"} · click to point · <kbd>Esc</kbd> to close</span>}
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
