import { useEffect, useRef, useState } from "react";

const normalize = (box, rect) => ({ id: crypto.randomUUID(), x: Math.max(0, box.x / rect.width), y: Math.max(0, box.y / rect.height), width: Math.min(1, box.width / rect.width), height: Math.min(1, box.height / rect.height), label: `Region ${Date.now().toString().slice(-3)}` });

export const CaptureCanvas = ({ image, regions, setRegions, annotations, setAnnotations, tool, processing }) => {
  const ref = useRef(null);
  const [draft, setDraft] = useState(null);
  const [drawing, setDrawing] = useState(false);
  useEffect(() => setDraft(null), [tool, image]);
  const position = (event) => { const rect = ref.current.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top, rect }; };
  const onPointerDown = (event) => {
    if (!image) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = position(event); setDrawing(true);
    if (tool === "region") setDraft({ x: point.x, y: point.y, width: 0, height: 0, startX: point.x, startY: point.y });
    else setDraft({ id: crypto.randomUUID(), type: tool, points: [{ x: point.x / point.rect.width, y: point.y / point.rect.height }] });
  };
  const onPointerMove = (event) => {
    if (!drawing || !draft) return;
    const point = position(event);
    if (tool === "region") setDraft((value) => ({ ...value, x: Math.min(value.startX, point.x), y: Math.min(value.startY, point.y), width: Math.abs(point.x - value.startX), height: Math.abs(point.y - value.startY) }));
    else setDraft((value) => ({ ...value, points: [...value.points, { x: point.x / point.rect.width, y: point.y / point.rect.height }] }));
  };
  const onPointerUp = () => {
    if (!draft) return setDrawing(false);
    if (tool === "region" && draft.width > 10 && draft.height > 10) setRegions([...regions, normalize(draft, ref.current.getBoundingClientRect())]);
    else if (tool !== "region" && draft.points.length > 1) setAnnotations([...annotations, draft]);
    setDraft(null); setDrawing(false);
  };
  const pointString = (points = []) => points.map((point) => `${point.x * 100},${point.y * 100}`).join(" ");
  return (
    <div className={`capture-canvas ${processing ? "processing" : ""}`} ref={ref} data-testid="capture-canvas" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
      {image ? <img src={image} alt="Capture workspace" draggable="false" data-testid="capture-preview-image" /> : <div className="empty-canvas" data-testid="empty-capture-state"><span className="crosshair" /><strong>Drop, paste, or open a screenshot</strong><p>Then drag directly over anything that matters.</p></div>}
      {image && <div className="canvas-vignette" />}
      {regions.map((region, index) => <button key={region.id} className="selection-box" data-testid={`selected-region-${index}`} style={{ left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.width * 100}%`, height: `${region.height * 100}%` }} onClick={(event) => { event.stopPropagation(); setRegions(regions.filter((item) => item.id !== region.id)); }} title="Remove region"><span>{String(index + 1).padStart(2, "0")}</span><i /><i /><i /><i /></button>)}
      <svg className="annotation-layer" viewBox="0 0 100 100" preserveAspectRatio="none" data-testid="annotation-layer">
        {annotations.map((annotation, index) => <polyline key={annotation.id} points={pointString(annotation.points)} className={annotation.type === "redaction" ? "redaction-line" : "draw-line"} data-testid={`${annotation.type}-annotation-${index}`} />)}
        {draft && tool !== "region" && <polyline points={pointString(draft.points)} className={tool === "redaction" ? "redaction-line" : "draw-line"} />}
      </svg>
      {draft && tool === "region" && <div className="selection-box draft" style={{ left: draft.x, top: draft.y, width: draft.width, height: draft.height }} />}
    </div>
  );
};