import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle, Clipboard, Cursor, EyeSlash, PencilSimple, ShieldCheck, Trash, UploadSimple } from "@phosphor-icons/react";
import { toast } from "sonner";
import { CaptureCanvas } from "@/components/CaptureCanvas";
import { CommandBar } from "@/components/CommandBar";
import { analyzeCapture } from "@/lib/api";
import { Switch } from "@/components/ui/switch";

const accepted = ["image/png", "image/jpeg", "image/webp"];

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

export default function CapturePage() {
  const [image, setImage] = useState(""); const [mimeType, setMimeType] = useState("image/png");
  const [regions, setRegions] = useState([]); const [annotations, setAnnotations] = useState([]);
  const [tool, setTool] = useState("region"); const [action, setAction] = useState("explain");
  const [command, setCommand] = useState("Explain what matters in this selection"); const [model, setModel] = useState("gpt-5.5");
  const [privateMode, setPrivateMode] = useState(false); const [processing, setProcessing] = useState(false); const [result, setResult] = useState("");
  const [source, setSource] = useState({ application:"Web dashboard", window_title:document.title, url:window.location.href });
  const fileRef = useRef(null);
  const loadFile = useCallback((file) => {
    if (!file || !accepted.includes(file.type)) return toast.error("Use a PNG, JPEG, or WEBP image");
    if (file.size > 8 * 1024 * 1024) return toast.error("Image must be smaller than 8 MB");
    const reader = new FileReader();
    reader.onload = () => { setImage(reader.result); setMimeType(file.type); setRegions([]); setAnnotations([]); setResult(""); };
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
      setImage(payload.screenshot); setMimeType("image/png"); setSource(payload.source || source);
      setRegions([]); setAnnotations([]); setResult(""); toast.success("Browser tab captured with page context");
    };
    window.addEventListener("message", receiveExtensionCapture);
    return () => window.removeEventListener("message", receiveExtensionCapture);
  }, [source]);
  const runAnalysis = async () => {
    if (!image) return toast.error("Add a screenshot first");
    if (!command.trim()) return toast.error("Give Spatial AI an instruction");
    setProcessing(true); setResult("");
    try {
      const protectedImage = await applyRedactions(image, mimeType, annotations);
      const completed = await analyzeCapture({ image_data:protectedImage, mime_type:mimeType, instruction:command.trim(), action, model, regions, annotations, private_mode:privateMode, source }, (delta) => setResult((current) => current + delta));
      toast.success(completed?.saved ? "Analysis saved to history" : "Private analysis complete");
    } catch (error) { toast.error(error.message); } finally { setProcessing(false); }
  };
  const copyResult = async () => { await navigator.clipboard.writeText(result); toast.success("Result copied"); };
  const tools = [{ id:"region",label:"Select region",icon:Cursor },{ id:"freehand",label:"Draw",icon:PencilSimple },{ id:"redaction",label:"Redact",icon:EyeSlash }];
  return <section className="capture-page" data-testid="capture-workspace">
    <div className="capture-toolbar" data-testid="capture-toolbar"><div className="tool-group">{tools.map(({ id,label,icon:Icon }) => <button key={id} className={tool === id ? "active" : ""} onClick={() => setTool(id)} data-testid={`canvas-tool-${id}-button`} title={label}><Icon /><span>{label}</span></button>)}</div><div className="toolbar-actions"><label className="private-toggle" data-testid="private-mode-control"><ShieldCheck /><span>Temporary</span><Switch checked={privateMode} onCheckedChange={setPrivateMode} data-testid="private-mode-switch" /></label><button onClick={() => fileRef.current?.click()} data-testid="upload-screenshot-button"><UploadSimple />Open image</button><button className="icon-only" onClick={() => { setImage("");setRegions([]);setAnnotations([]);setResult(""); }} data-testid="clear-capture-button" aria-label="Clear capture"><Trash /></button><input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => loadFile(event.target.files?.[0])} data-testid="screenshot-file-input" hidden /></div></div>
    <div className="workspace-grid"><div className="canvas-panel" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault();loadFile(event.dataTransfer.files?.[0]); }} data-testid="screenshot-drop-zone"><div className="canvas-meta"><span data-testid="region-count">{regions.length} region{regions.length === 1 ? "" : "s"}</span><span data-testid="annotation-count">{annotations.length} mark{annotations.length === 1 ? "" : "s"}</span></div><CaptureCanvas {...{ image,regions,setRegions,annotations,setAnnotations,tool,processing }} /><CommandBar {...{ action,setAction,command,setCommand,model,setModel,onSubmit:runAnalysis,disabled:processing || !image,processing }} /></div>
      <aside className="result-panel" data-testid="analysis-result-panel"><div className="result-header"><div><span className="eyebrow">AI output</span><h2 data-testid="analysis-result-title">Grounded result</h2></div>{result && <button onClick={copyResult} data-testid="copy-result-button" aria-label="Copy result"><Clipboard /></button>}</div>{processing && !result && <div className="result-loading" data-testid="analysis-loading-state"><i /><i /><i /><span>Reading selected context</span></div>}{result ? <div className="result-content" data-testid="analysis-result-content">{result}</div> : !processing && <div className="result-empty" data-testid="analysis-empty-state"><CheckCircle weight="thin" /><p>Your answer will stay anchored to the regions you point at.</p></div>}<div className="context-bundle" data-testid="context-bundle-summary"><span>CONTEXT BUNDLE</span><code>{`{ image, regions: ${regions.length}, marks: ${annotations.length}, private: ${privateMode} }`}</code></div></aside>
    </div>
  </section>;
}