import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowClockwise, ArrowCounterClockwise, ArrowsOutSimple, CheckCircle, Clipboard, Cursor, Desktop, EyeSlash, GithubLogo, Hand, Lasso, MagnifyingGlassMinus, MagnifyingGlassPlus, MapPin, Monitor, PaperPlaneTilt, PencilSimple, Plus, Scan, ShieldCheck, Trash, UploadSimple, X } from "@phosphor-icons/react";
import { toast } from "sonner";
import { CaptureCanvas } from "@/components/CaptureCanvas";
import { CommandBar } from "@/components/CommandBar";
import { analyzeCapture, createGitHubIssue, extractOcr, sendToNotion } from "@/lib/api";
import { captureNative, isNativeShell, listenForNativeCapture, writeClipboard } from "@/lib/native";
import { ExportBar } from "@/components/ExportBar";
import { ExtractionResult } from "@/components/ExtractionResult";
import Markdown from "@/components/Markdown";

// Actions whose output is the user's own text transformed — show it exactly, don't reinterpret as markdown.
const VERBATIM_ACTIONS = new Set(["copy", "rewrite", "translate", "transform"]);
import { Switch } from "@/components/ui/switch";
import { orderedRegions, reorderBefore } from "@/lib/regionOrder";
import { parseExtractionResult } from "@/lib/structuredExtraction";
import { computeOcrKey } from "@/lib/ocrCache";

const accepted = ["image/png", "image/jpeg", "image/webp"];
const DEFAULT_VIEWPORT = { scale: 1, translateX: 0, translateY: 0 };
// Matches the backend's AnalyzeRequest.additional_sources cap (README 5.5's own cross-screen
// example names exactly 3: browser, terminal, dashboard).
const MAX_ADDITIONAL_SOURCES = 3;

async function applyRedactions(imageData, mimeType, annotations) {
  const redactions = annotations.filter((item) => item.type === "redaction");
  if (!redactions.length) return imageData;
  const image = new Image();
  image.src = imageData;
  await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; });
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  context.strokeStyle = "#000"; context.lineCap = "square"; context.lineJoin = "round";
  context.lineWidth = Math.max(18, Math.min(canvas.width, canvas.height) * 0.045);
  redactions.forEach((annotation) => {
    context.beginPath();
    annotation.points.forEach((point, index) => { const x = point.x * canvas.width; const y = point.y * canvas.height; if (index === 0) context.moveTo(x, y); else context.lineTo(x, y); });
    context.stroke();
  });
  return canvas.toDataURL(mimeType, 0.92);
}

function RegionList({ regions, onReorder }) {
  const [draggingId, setDraggingId] = useState(null);
  const [overId, setOverId] = useState(null);
  if (regions.length < 2) return null;
  return (
    <div className="region-list-panel" data-testid="region-list-panel">
      <h4>Regions</h4>
      {regions.map((region, index) => (
        <div key={region.id}>
          {overId === region.id && draggingId && draggingId !== region.id && <div className="region-list-drop-indicator" data-testid="region-list-drop-indicator" />}
          <div
            className={`region-list-item ${draggingId === region.id ? "dragging" : ""}`}
            draggable
            tabIndex={0}
            data-testid={`region-list-item-${index}`}
            onDragStart={() => setDraggingId(region.id)}
            onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); setOverId(region.id); }}
            onDrop={(event) => { event.preventDefault(); event.stopPropagation(); if (draggingId && draggingId !== region.id) onReorder(draggingId, region.id); setDraggingId(null); setOverId(null); }}
            onDragEnd={() => { setDraggingId(null); setOverId(null); }}
            onKeyDown={(event) => {
              if (event.key === "ArrowUp" && index > 0) { event.preventDefault(); onReorder(region.id, regions[index - 1].id); }
              else if (event.key === "ArrowDown" && index < regions.length - 1) { event.preventDefault(); onReorder(region.id, regions[index + 2]?.id ?? null); }
            }}
          >
            <span className="drag-handle">⋮⋮</span>
            <span>{String(index + 1).padStart(2, "0")} {region.label || ""}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function CapturePage() {
  const [image, setImage] = useState(""); const [mimeType, setMimeType] = useState("image/png");
  const [regions, setRegions] = useState([]); const [annotations, setAnnotations] = useState([]);
  const [points, setPoints] = useState([]);
  const [regionOrder, setRegionOrder] = useState([]);
  // Viewport (zoom/pan) is navigation state, not a document edit — deliberately kept OUT of the
  // undo/redo history stack below. Annotation undo/redo must never move the camera, and zoom/pan
  // must never be undoable as if it were a drawn region.
  const [viewport, setViewport] = useState(DEFAULT_VIEWPORT);
  const canvasRef = useRef(null);
  const [history, setHistory] = useState({ past: [], future: [] });
  const snapshot = useCallback(() => ({ regions, annotations, points, regionOrder }), [regions, annotations, points, regionOrder]);
  const resetRegionState = () => { setRegions([]); setAnnotations([]); setPoints([]); setRegionOrder([]); setHistory({ past: [], future: [] }); setAdditionalSources([]); setActiveSourceIndex(0); };
  const setRegionsTracked = (next) => { setHistory((current) => ({ past: [...current.past, snapshot()], future: [] })); setRegions(next); };
  const setAnnotationsTracked = (next) => { setHistory((current) => ({ past: [...current.past, snapshot()], future: [] })); setAnnotations(next); };
  const setPointsTracked = (next) => { setHistory((current) => ({ past: [...current.past, snapshot()], future: [] })); setPoints(next); };
  const reorderRegionsTracked = (draggedId, beforeId) => {
    const next = reorderBefore(regions, regionOrder, draggedId, beforeId);
    setHistory((current) => ({ past: [...current.past, snapshot()], future: [] }));
    setRegionOrder(next);
  };
  // Confirming a lasso mask changes both annotations (the polygon) and regions (its derived
  // bounding box) together — pushed as ONE history entry so a single undo reverts the whole
  // "confirm selection" action, not just half of it.
  const commitMask = (maskAnnotation, region) => {
    setHistory((current) => ({ past: [...current.past, snapshot()], future: [] }));
    setAnnotations([...annotations, maskAnnotation]);
    setRegions([...regions, region]);
  };
  const undo = useCallback(() => {
    if (!history.past.length) return;
    const previous = history.past[history.past.length - 1];
    setHistory({ past: history.past.slice(0, -1), future: [snapshot(), ...history.future] });
    setRegions(previous.regions);
    setAnnotations(previous.annotations);
    setPoints(previous.points);
    setRegionOrder(previous.regionOrder || []);
  }, [history, snapshot]);
  const redo = useCallback(() => {
    if (!history.future.length) return;
    const next = history.future[0];
    setHistory({ past: [...history.past, snapshot()], future: history.future.slice(1) });
    setRegions(next.regions);
    setAnnotations(next.annotations);
    setPoints(next.points);
    setRegionOrder(next.regionOrder || []);
  }, [history, snapshot]);
  useEffect(() => {
    const onKeyDown = (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z") return;
      if (event.target.tagName === "INPUT" || event.target.tagName === "TEXTAREA") return;
      event.preventDefault();
      if (event.shiftKey) redo(); else undo();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo, redo]);
  const [tool, setTool] = useState("region"); const [action, setAction] = useState("explain"); const [resultAction, setResultAction] = useState("explain");
  const [command, setCommand] = useState("Explain what matters in this selection"); const [model, setModel] = useState("gpt-5.5");
  const [extractSchema, setExtractSchema] = useState("auto");
  const [privateMode, setPrivateMode] = useState(false); const [processing, setProcessing] = useState(false); const [result, setResult] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [source, setSource] = useState({ application:"Web dashboard", window_title:document.title, url:window.location.href });
  const [ocr, setOcr] = useState(null); const [ocrLoading, setOcrLoading] = useState(false); const nativeShell = isNativeShell();
  const [notionPage, setNotionPage] = useState(() => localStorage.getItem("notionPage") || "");
  const [sendingToNotion, setSendingToNotion] = useState(false);
  const [githubRepo, setGithubRepo] = useState(() => localStorage.getItem("githubRepo") || "");
  const [creatingGithubIssue, setCreatingGithubIssue] = useState(false);
  // Tracks which (image, regions, redactions) triple the current `ocr` state was extracted
  // from, so an AI action can tell a merely-present OCR result apart from a stale one (e.g. the
  // user added a region or redaction since OCR last ran) and only re-run OCR when it actually
  // needs to. ocrInFlightRef dedupes overlapping triggers (e.g. a rapid double-submit) onto the
  // same in-flight request instead of firing OCR twice.
  const ocrKeyRef = useRef(null);
  const ocrInFlightRef = useRef(null);
  const fileRef = useRef(null);
  // Cross-screen selection (README 5.5): additionalSources holds 0-3 extra captures (e.g. a
  // terminal window, a dashboard) reasoned across alongside the primary capture in one analyze
  // call. Each carries its own regions/annotations/points/OCR, mirroring the primary source's
  // own state shape one level down. activeSourceIndex (0 = primary, 1..3 = additionalSources[i-1])
  // picks which source the canvas is currently bound to for drawing/editing.
  const [additionalSources, setAdditionalSources] = useState([]);
  const [activeSourceIndex, setActiveSourceIndex] = useState(0);
  const addSourceFileRef = useRef(null);
  const activeAdditionalSource = activeSourceIndex > 0 ? additionalSources[activeSourceIndex - 1] : null;
  const updateActiveAdditionalSource = (patch) => {
    setAdditionalSources((current) => current.map((entry, index) => (index === activeSourceIndex - 1 ? { ...entry, ...patch } : entry)));
  };
  const switchActiveSource = (index) => { setActiveSourceIndex(index); setViewport(DEFAULT_VIEWPORT); };
  const addSourceEntry = (entry) => {
    if (additionalSources.length >= MAX_ADDITIONAL_SOURCES) return toast.error(`Up to ${MAX_ADDITIONAL_SOURCES} additional sources (${MAX_ADDITIONAL_SOURCES + 1} total)`);
    setAdditionalSources((current) => [...current, { id: crypto.randomUUID(), label: `Source ${current.length + 2}`, regions: [], annotations: [], points: [], ocr: null, ocrKey: null, ...entry }]);
    switchActiveSource(additionalSources.length + 1);
  };
  const addSourceFromFile = useCallback((file) => {
    if (!file || !accepted.includes(file.type)) return toast.error("Use a PNG, JPEG, or WEBP image");
    if (file.size > 8 * 1024 * 1024) return toast.error("Image must be smaller than 8 MB");
    const reader = new FileReader();
    reader.onload = () => { addSourceEntry({ image: reader.result, mimeType: file.type, source: { application: "Uploaded image", window_title: file.name, url: "" } }); toast.success("Added as a new source"); };
    reader.readAsDataURL(file);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [additionalSources.length]);
  const addSourceFromNative = async () => {
    try { const payload = await captureNative("active"); addSourceEntry({ image: payload.screenshot, mimeType: payload.mime_type || "image/png", source: payload.source }); toast.success("Captured as a new source"); }
    catch (error) { toast.error(error.message); }
  };
  const removeSource = (index) => {
    setAdditionalSources((current) => current.filter((_, i) => i !== index));
    setActiveSourceIndex((current) => (current === index + 1 ? 0 : current > index + 1 ? current - 1 : current));
  };
  const renameSource = (index, label) => setAdditionalSources((current) => current.map((entry, i) => (i === index ? { ...entry, label } : entry)));
  const loadFile = useCallback((file) => {
    if (!file || !accepted.includes(file.type)) return toast.error("Use a PNG, JPEG, or WEBP image");
    if (file.size > 8 * 1024 * 1024) return toast.error("Image must be smaller than 8 MB");
    const reader = new FileReader();
    reader.onload = () => { setImage(reader.result); setMimeType(file.type); resetRegionState(); setViewport(DEFAULT_VIEWPORT); setResult(""); setSearchResults([]); setOcr(null); };
    reader.readAsDataURL(file);
  }, []);
  useEffect(() => {
    const paste = (event) => { const file = [...(event.clipboardData?.files || [])].find((item) => item.type.startsWith("image/")); if (file) { event.preventDefault(); loadFile(file); toast.success("Screenshot pasted"); } };
    window.addEventListener("paste", paste); return () => window.removeEventListener("paste", paste);
  }, [loadFile]);
  useEffect(() => {
    const receiveExtensionCapture = (event) => {
      if (event.origin !== window.location.origin || event.data?.type !== "SPATIAL_AI_EXTENSION_CAPTURE") return;
      const payload = event.data.payload;
      if (!payload?.screenshot) return;
      setImage(payload.screenshot); setMimeType(payload.mimeType || "image/png"); setSource(payload.source || source);
      resetRegionState(); setViewport(DEFAULT_VIEWPORT); setResult(""); setSearchResults([]); setOcr(null);
      const sections = payload.source?.page_context?.full_page?.sections;
      toast.success(sections ? `Full page captured · ${sections} section${sections === 1 ? "" : "s"} stitched` : "Browser tab captured with page context");
    };
    window.addEventListener("message", receiveExtensionCapture);
    return () => window.removeEventListener("message", receiveExtensionCapture);
  }, [source]);
  useEffect(() => {
    let stop = () => {};
    listenForNativeCapture((payload) => { setImage(payload.screenshot);setMimeType(payload.mime_type||"image/png");setSource(payload.source);resetRegionState();setViewport(DEFAULT_VIEWPORT);setResult("");setSearchResults([]);setOcr(null);toast.success("Windows display captured"); }).then((unlisten)=>{stop=unlisten;});
    return () => stop();
  }, []);
  const runNativeCapture = async (mode) => { try { const payload=await captureNative(mode);setImage(payload.screenshot);setMimeType(payload.mime_type);setSource(payload.source);resetRegionState();setViewport(DEFAULT_VIEWPORT);setResult("");setSearchResults([]);setOcr(null);toast.success(mode==="all"?"All displays captured":"Active display captured"); } catch(error){toast.error(error.message);} };
  const performOcr = async () => {
    const protectedImage = await applyRedactions(image, mimeType, annotations);
    return extractOcr({ image_data: protectedImage, mime_type: mimeType, engine: "auto", language: "eng", regions });
  };
  const runOcr = async () => {
    if (!image) return toast.error("Add a screenshot first");
    setOcrLoading(true);
    try {
      const data = await performOcr();
      setOcr(data); ocrKeyRef.current = computeOcrKey(image, regions, annotations);
      toast.success(`OCR complete · ${data.engine}`);
    } catch (error) { toast.error(error.message); } finally { setOcrLoading(false); }
  };
  // Auto-grounding: every AI action funnels through here first so it never silently skips OCR
  // for a text-heavy capture. Reuses the cached result when the image/regions/redactions haven't
  // changed since OCR last ran, dedupes concurrent callers onto one in-flight request, and never
  // blocks the AI action on an OCR failure -- it just proceeds ungrounded and says so.
  const ensureOcr = async () => {
    if (!image) return null;
    const key = computeOcrKey(image, regions, annotations);
    if (ocr && ocrKeyRef.current === key) return ocr;
    if (ocrInFlightRef.current) return ocrInFlightRef.current;
    setOcrLoading(true);
    const request = performOcr()
      .then((data) => { setOcr(data); ocrKeyRef.current = key; return data; })
      .catch(() => { toast.message("Text extraction failed. Continuing with image analysis only."); return null; })
      .finally(() => { setOcrLoading(false); ocrInFlightRef.current = null; });
    ocrInFlightRef.current = request;
    return request;
  };
  // Same auto-grounding idea as ensureOcr(), scoped to one additional source. Only ever called
  // sequentially from runAnalysis's own pre-flight loop (not from concurrent UI triggers the way
  // the primary's ensureOcr can be), so it skips ensureOcr's in-flight-promise dedup as unneeded
  // complexity here.
  const ensureAdditionalSourceOcr = async (index) => {
    const entry = additionalSources[index];
    if (!entry) return null;
    const key = computeOcrKey(entry.image, entry.regions, entry.annotations);
    if (entry.ocr && entry.ocrKey === key) return entry.ocr;
    try {
      const protectedImage = await applyRedactions(entry.image, entry.mimeType, entry.annotations);
      const data = await extractOcr({ image_data: protectedImage, mime_type: entry.mimeType, engine: "auto", language: "eng", regions: entry.regions });
      setAdditionalSources((current) => current.map((item, i) => (i === index ? { ...item, ocr: data, ocrKey: key } : item)));
      return data;
    } catch {
      toast.message(`Text extraction failed for "${entry.label}". Continuing with image analysis only.`);
      return null;
    }
  };
  const runAnalysis = async () => {
    if (!image) return toast.error("Add a screenshot first");
    if (!command.trim()) return toast.error("Give Spatial AI an instruction");
    setProcessing(true); setResult(""); setSearchResults([]); setResultAction(action);
    try {
      const groundingOcr = await ensureOcr();
      const protectedImage = await applyRedactions(image, mimeType, annotations);
      const additionalSourcesPayload = [];
      for (let index = 0; index < additionalSources.length; index += 1) {
        const entry = additionalSources[index];
        const entryOcr = await ensureAdditionalSourceOcr(index);
        const protectedEntryImage = await applyRedactions(entry.image, entry.mimeType, entry.annotations);
        additionalSourcesPayload.push({ id: entry.id, label: entry.label, image_data: protectedEntryImage, mime_type: entry.mimeType, regions: entry.regions, annotations: entry.annotations, points: entry.points, source: entry.source, ocr_text: entryOcr?.text || "" });
      }
      const completed = await analyzeCapture({ image_data:protectedImage, mime_type:mimeType, instruction:command.trim(), action, extract_schema:extractSchema, model, regions, annotations, points, private_mode:privateMode, source, ocr_text:groundingOcr?.text||"", additional_sources:additionalSourcesPayload }, (delta) => setResult((current) => current + delta), (results) => setSearchResults(results || []));
      toast.success(completed?.saved ? "Analysis saved to history" : "Private analysis complete");
    } catch (error) { toast.error(error.message); } finally { setProcessing(false); }
  };
  const copyResult = async () => { await writeClipboard(result); toast.success("Result copied"); };
  const rememberNotionPage = (value) => { setNotionPage(value); localStorage.setItem("notionPage", value); };
  const sendNotion = async () => {
    if (!notionPage.trim()) return toast.error("Paste a Notion page URL first (it's remembered after that)");
    setSendingToNotion(true);
    try {
      const sent = await sendToNotion({ title: command.trim() || "Point capture", content: result, source_url: source?.url || "", parent_page: notionPage.trim() });
      toast.success("Sent to Notion", sent.url ? { action: { label: "Open", onClick: () => window.open(sent.url, "_blank") } } : undefined);
    } catch (error) { toast.error(error.message); } finally { setSendingToNotion(false); }
  };
  const rememberGithubRepo = (value) => { setGithubRepo(value); localStorage.setItem("githubRepo", value); };
  const createIssue = async () => {
    if (!githubRepo.trim()) return toast.error("Paste a GitHub repo (owner/repo or URL) first (it's remembered after that)");
    setCreatingGithubIssue(true);
    try {
      const created = await createGitHubIssue({ title: command.trim() || "Point capture", content: result, source_url: source?.url || "", repo: githubRepo.trim() });
      toast.success(`Created issue #${created.issue_number}`, created.url ? { action: { label: "Open", onClick: () => window.open(created.url, "_blank") } } : undefined);
    } catch (error) { toast.error(error.message); } finally { setCreatingGithubIssue(false); }
  };
  const tools = [{ id:"region",label:"Select region",icon:Cursor },{ id:"point",label:"Point",icon:MapPin },{ id:"lasso",label:"Lasso",icon:Lasso },{ id:"freehand",label:"Draw",icon:PencilSimple },{ id:"redaction",label:"Redact",icon:EyeSlash },{ id:"pan",label:"Pan",icon:Hand }];
  const displayRegions = orderedRegions(regions, regionOrder);
  const extraction = result ? parseExtractionResult(result) : null;
  // Whichever source is active is what the canvas/toolbar/RegionList bind to — the primary
  // source keeps its existing tracked setters (undo/redo, region ordering); an additional source
  // is a plain object in additionalSources, updated in place via updateActiveAdditionalSource.
  const canvasImage = activeAdditionalSource ? activeAdditionalSource.image : image;
  const canvasRegions = activeAdditionalSource ? activeAdditionalSource.regions : displayRegions;
  const canvasSetRegions = activeAdditionalSource ? (next) => updateActiveAdditionalSource({ regions: next }) : setRegionsTracked;
  const canvasAnnotations = activeAdditionalSource ? activeAdditionalSource.annotations : annotations;
  const canvasSetAnnotations = activeAdditionalSource ? (next) => updateActiveAdditionalSource({ annotations: next }) : setAnnotationsTracked;
  const canvasPoints = activeAdditionalSource ? activeAdditionalSource.points : points;
  const canvasSetPoints = activeAdditionalSource ? (next) => updateActiveAdditionalSource({ points: next }) : setPointsTracked;
  const canvasOcr = activeAdditionalSource ? activeAdditionalSource.ocr : ocr;
  const canvasCommitMask = activeAdditionalSource
    ? (maskAnnotation, region) => updateActiveAdditionalSource({ annotations: [...activeAdditionalSource.annotations, maskAnnotation], regions: [...activeAdditionalSource.regions, region] })
    : commitMask;
  return <section className="capture-page" data-testid="capture-workspace">
    <div className="capture-toolbar" data-testid="capture-toolbar"><div className="tool-group">{tools.map(({ id,label,icon:Icon }) => <button key={id} className={tool === id ? "active" : ""} onClick={() => setTool(id)} data-testid={`canvas-tool-${id}-button`} title={label}><Icon /><span>{label}</span></button>)}<button onClick={runOcr} disabled={ocrLoading||!image} data-testid="run-ocr-button"><Scan /><span>{ocrLoading?"Reading…":"OCR"}</span></button><button className="icon-only" onClick={undo} disabled={!history.past.length || activeSourceIndex !== 0} data-testid="undo-button" aria-label="Undo" title="Undo (Ctrl+Z)"><ArrowCounterClockwise /></button><button className="icon-only" onClick={redo} disabled={!history.future.length || activeSourceIndex !== 0} data-testid="redo-button" aria-label="Redo" title="Redo (Ctrl+Shift+Z)"><ArrowClockwise /></button></div><div className="toolbar-actions">{nativeShell&&<><button onClick={()=>runNativeCapture("active")} data-testid="capture-active-display-button"><Desktop />Active display</button><button onClick={()=>runNativeCapture("all")} data-testid="capture-all-displays-button"><Monitor />All displays</button></>}<label className="private-toggle" data-testid="private-mode-control"><ShieldCheck /><span>Temporary</span><Switch checked={privateMode} onCheckedChange={setPrivateMode} data-testid="private-mode-switch" /></label><button onClick={() => fileRef.current?.click()} data-testid="upload-screenshot-button"><UploadSimple />Open image</button><button className="icon-only" onClick={() => { setImage("");resetRegionState();setViewport(DEFAULT_VIEWPORT);setResult("");setSearchResults([]);setOcr(null); }} data-testid="clear-capture-button" aria-label="Clear capture"><Trash /></button><input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => loadFile(event.target.files?.[0])} data-testid="screenshot-file-input" hidden /></div></div>
    {image && <div className="sources-strip" data-testid="sources-strip">
      <button className={activeSourceIndex === 0 ? "source-thumb selected" : "source-thumb"} onClick={() => switchActiveSource(0)} data-testid="source-thumb-primary"><img src={image} alt="Primary source" /><span>Primary</span></button>
      {additionalSources.map((entry, index) => (
        <div key={entry.id} className={activeSourceIndex === index + 1 ? "source-thumb selected" : "source-thumb"} data-testid={`source-thumb-${index}`}>
          <button onClick={() => switchActiveSource(index + 1)} aria-label={`Switch to ${entry.label}`}><img src={entry.image} alt={entry.label} /></button>
          <input value={entry.label} onChange={(event) => renameSource(index, event.target.value)} data-testid={`source-label-${index}`} />
          <button className="icon-only remove-source" onClick={() => removeSource(index)} aria-label={`Remove ${entry.label}`} data-testid={`remove-source-${index}`}><X /></button>
        </div>
      ))}
      {additionalSources.length < MAX_ADDITIONAL_SOURCES && <button className="add-source" onClick={() => (nativeShell ? addSourceFromNative() : addSourceFileRef.current?.click())} data-testid="add-source-button" title="Add another source (e.g. a terminal or dashboard) to reason across"><Plus /><span>Add source</span></button>}
      <input ref={addSourceFileRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => addSourceFromFile(event.target.files?.[0])} data-testid="add-source-file-input" hidden />
    </div>}
    <div className="workspace-grid"><div className="canvas-panel" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault();loadFile(event.dataTransfer.files?.[0]); }} data-testid="screenshot-drop-zone"><div className="canvas-meta"><span data-testid="region-count">{canvasRegions.length} region{canvasRegions.length === 1 ? "" : "s"}</span><span data-testid="point-count">{canvasPoints.length} point{canvasPoints.length === 1 ? "" : "s"}</span><span data-testid="annotation-count">{canvasAnnotations.length} mark{canvasAnnotations.length === 1 ? "" : "s"}</span></div>
      {activeSourceIndex === 0 && <RegionList regions={displayRegions} onReorder={reorderRegionsTracked} />}
      <CaptureCanvas ref={canvasRef} {...{ image:canvasImage,regions:canvasRegions,setRegions:canvasSetRegions,annotations:canvasAnnotations,setAnnotations:canvasSetAnnotations,points:canvasPoints,setPoints:canvasSetPoints,commitMask:canvasCommitMask,tool,processing,ocr:canvasOcr,viewport,setViewport }} />
      <div className="zoom-controls" data-testid="zoom-controls">
        <button onClick={() => canvasRef.current?.zoomOut()} disabled={!image} aria-label="Zoom out" title="Zoom out" data-testid="zoom-out-button"><MagnifyingGlassMinus /></button>
        <span className="zoom-percentage" data-testid="zoom-percentage">{Math.round(viewport.scale * 100)}%</span>
        <button onClick={() => canvasRef.current?.zoomIn()} disabled={!image} aria-label="Zoom in" title="Zoom in" data-testid="zoom-in-button"><MagnifyingGlassPlus /></button>
        <button onClick={() => canvasRef.current?.zoomToFit()} disabled={!image} aria-label="Fit to screen" title="Fit to screen" data-testid="zoom-fit-button"><ArrowsOutSimple /></button>
        <button onClick={() => canvasRef.current?.resetZoom()} disabled={!image} aria-label="Reset to 100%" title="Reset to 100%" data-testid="zoom-reset-button">100%</button>
      </div>
      <CommandBar {...{ action,setAction,command,setCommand,model,setModel,extractSchema,setExtractSchema,onSubmit:runAnalysis,disabled:processing || !image,processing }} /></div>
      <aside className="result-panel" data-testid="analysis-result-panel"><div className="result-header"><div><span className="eyebrow">{ocr&&!result?"Deterministic OCR":"AI output"}</span><h2 data-testid="analysis-result-title">{ocr&&!result?"Structured extraction":"Grounded result"}</h2></div>{result && <button onClick={copyResult} data-testid="copy-result-button" aria-label="Copy result"><Clipboard /></button>}{result && <div className="notion-send" data-testid="notion-send-control"><input value={notionPage} onChange={(event) => rememberNotionPage(event.target.value)} placeholder="Notion page URL" data-testid="notion-page-input" /><button onClick={sendNotion} disabled={sendingToNotion} data-testid="send-notion-button" aria-label="Send to Notion" title="Send to Notion"><PaperPlaneTilt /></button></div>}{result && <div className="notion-send" data-testid="github-issue-control"><input value={githubRepo} onChange={(event) => rememberGithubRepo(event.target.value)} placeholder="owner/repo" data-testid="github-repo-input" /><button onClick={createIssue} disabled={creatingGithubIssue} data-testid="create-github-issue-button" aria-label="Create GitHub issue" title="Create GitHub issue"><GithubLogo /></button></div>}</div>{(processing||ocrLoading)&&!result&&!ocr&&<div className="result-loading" data-testid="analysis-loading-state"><i /><i /><i /><span>{ocrLoading?"Recovering text":"Reading selected context"}</span></div>}{result?<>{extraction?<ExtractionResult parsed={extraction} />:(VERBATIM_ACTIONS.has(resultAction)?<div className="result-content" data-testid="analysis-result-content">{result}</div>:<Markdown className="result-content markdown" data-testid="analysis-result-content">{result}</Markdown>)}{searchResults.length>0&&<div className="search-sources" data-testid="search-sources"><span className="sources-label">Sources</span>{searchResults.map((item,index)=><a key={index} href={item.url} target="_blank" rel="noreferrer" className="source-item" data-testid={`source-item-${index}`}><span className="source-title">{item.title||item.url}</span><span className="source-url">{item.url}</span>{item.snippet&&<span className="source-snippet">{item.snippet}</span>}</a>)}</div>}</>:ocr?<div className="ocr-result" data-testid="ocr-result"><div className="ocr-stats"><span data-testid="ocr-engine">{ocr.engine}</span><span data-testid="ocr-confidence">{Math.round(ocr.average_confidence*100)}% confidence</span><span data-testid="ocr-word-count">{ocr.words.length} words</span></div><pre data-testid="ocr-text-content">{ocr.text||"No text detected"}</pre><ExportBar payload={ocr} source={source} /></div>:!processing&&!ocrLoading&&<div className="result-empty" data-testid="analysis-empty-state"><CheckCircle weight="thin" /><p>Your answer will stay anchored to the regions you point at.</p></div>}<div className="context-bundle" data-testid="context-bundle-summary"><span>CONTEXT BUNDLE</span><code>{`{ image, regions: ${regions.length}, points: ${points.length}, marks: ${annotations.length}, ocr: ${ocr?.words?.length||0}, private: ${privateMode} }`}</code></div></aside>
    </div>
  </section>;
}
