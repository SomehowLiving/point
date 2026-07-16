import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  MIN_SIZE,
  clamp01,
  calculatePolygonBounds,
  extractMaskedRegion,
} from "@/lib/selectionGeometry";
import {
  screenToImage,
  zoomAroundScreenPoint,
  clampViewport,
  clampScale,
  fitImageToViewport,
} from "@/lib/viewportTransform";

const NUDGE_STEP = 0.01;
const NUDGE_STEP_LARGE = 0.1;
const CORNERS = ["nw", "ne", "se", "sw"];
const WHEEL_ZOOM_FACTOR = 1.12;
const BUTTON_ZOOM_FACTOR = 1.25;

function moveBox(box, dx, dy) {
  const width = box.width || 0;
  const height = box.height || 0;
  const x = Math.min(Math.max(0, box.x + dx), 1 - width);
  const y = Math.min(Math.max(0, box.y + dy), 1 - height);
  return { ...box, x, y };
}

function resizeBox(box, corner, dx, dy) {
  let { x, y, width, height } = box;
  if (corner.includes("w")) { width -= dx; x += dx; }
  if (corner.includes("e")) { width += dx; }
  if (corner.includes("n")) { height -= dy; y += dy; }
  if (corner.includes("s")) { height += dy; }
  if (width < MIN_SIZE) { if (corner.includes("w")) x -= MIN_SIZE - width; width = MIN_SIZE; }
  if (height < MIN_SIZE) { if (corner.includes("n")) y -= MIN_SIZE - height; height = MIN_SIZE; }
  x = clamp01(x); y = clamp01(y);
  width = Math.min(width, 1 - x);
  height = Math.min(height, 1 - y);
  return { x, y, width, height };
}

const cursorForCorner = (corner) => (corner === "nw" || corner === "se" ? "nwse-resize" : "nesw-resize");

// setPointerCapture can throw (e.g. DOMException "No active pointer with the given id") in edge
// cases — a pointer that's already been released by the time the handler runs, certain synthetic/
// automated input, or browser quirks around rapid multi-touch sequencing. A gesture starting is
// not worth crashing the whole handler over; capture is a nice-to-have (keeps receiving events if
// the pointer leaves the element) but the interaction still mostly works without it.
function safeSetPointerCapture(target, pointerId) {
  try { target.setPointerCapture(pointerId); } catch { /* non-fatal, see above */ }
}

// "Nearest visual element" for a point is scoped to "nearest OCR word already fetched" — this app
// has no live DOM to inspect for an arbitrary screenshot. True DOM-element proximity is a
// separate, not-yet-built roadmap item (browser element-level selection). This is an image-space
// (natural pixel) calculation, independent of viewport zoom/pan by construction.
function nearestOcrWord(point, naturalSize, words) {
  if (!words?.length || !naturalSize.width || !naturalSize.height) return null;
  const px = point.x * naturalSize.width;
  const py = point.y * naturalSize.height;
  let best = null;
  let bestDistance = Infinity;
  for (const word of words) {
    const cx = word.box.x + word.box.width / 2;
    const cy = word.box.y + word.box.height / 2;
    const distance = Math.hypot(px - cx, py - cy);
    if (distance < bestDistance) { bestDistance = distance; best = word; }
  }
  return best;
}

export const CaptureCanvas = forwardRef(({ image, regions, setRegions, annotations, setAnnotations, points, setPoints, commitMask, tool, processing, ocr, viewport, setViewport }, forwardedRef) => {
  const ref = useRef(null); // fixed-size outer container: receives pointer/wheel events, its own rect is the screen-space origin
  const wrapperRef = useRef(null); // natural-size content div; CSS transform (translate+scale) applied directly here
  const imageElementRef = useRef(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const [interaction, setInteraction] = useState(null);
  const [selectedItem, setSelectedItem] = useState(null); // {kind: "region" | "point", id} | null
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const renameSettledRef = useRef(true);
  const [pendingMask, setPendingMask] = useState(null); // {points, edge} | null — unconfirmed lasso
  const [maskPreview, setMaskPreview] = useState(null); // {dataUrl, boundingBox} for pendingMask
  const [isSpacePressed, setIsSpacePressed] = useState(false);

  // Kept in sync with the latest render's values so the native (non-passive) wheel listener and
  // pan drag loop can read fresh state without resubscribing on every change (Part 8: avoid doing
  // real work / stale closures inside a tight pointer/wheel loop).
  const viewportRef = useRef(viewport);
  const containerSizeRef = useRef(containerSize);
  const naturalSizeRef = useRef(naturalSize);
  viewportRef.current = viewport;
  containerSizeRef.current = containerSize;
  naturalSizeRef.current = naturalSize;
  const fitModeRef = useRef(true); // true while the viewport should keep auto-refitting to container resizes
  const prevContainerSizeRef = useRef(containerSize);
  const containerRectRef = useRef({ left: 0, top: 0 }); // cached container position, refreshed on resize — avoids a getBoundingClientRect() layout read on every pointer event
  const lastPointerScreenRef = useRef(null); // last known cursor position (container-relative), used to preserve the actual focal point on a passive container resize
  const activeTouchesRef = useRef(new Map()); // pointerId -> {x,y} container-relative, touch pointers only, for two-finger pinch-pan-zoom

  // Directly mutates the transformed wrapper's CSS transform, bypassing React state — used during
  // active pan/zoom gestures so dragging/scrolling doesn't force a React re-render on every event.
  // React state (`viewport`) is committed once at the end of the gesture.
  const applyTransformToDom = (nextViewport) => {
    viewportRef.current = nextViewport;
    if (wrapperRef.current) wrapperRef.current.style.transform = `translate(${nextViewport.translateX}px, ${nextViewport.translateY}px) scale(${nextViewport.scale})`;
  };

  const viewportBounds = () => ({ naturalWidth: naturalSizeRef.current.width, naturalHeight: naturalSizeRef.current.height, containerWidth: containerSizeRef.current.width, containerHeight: containerSizeRef.current.height });

  useImperativeHandle(forwardedRef, () => ({
    zoomIn: () => zoomByFactor(BUTTON_ZOOM_FACTOR),
    zoomOut: () => zoomByFactor(1 / BUTTON_ZOOM_FACTOR),
    zoomToFit: () => {
      fitModeRef.current = true;
      const fitted = fitImageToViewport(naturalSizeRef.current.width, naturalSizeRef.current.height, containerSizeRef.current.width, containerSizeRef.current.height);
      setViewport(fitted);
      applyTransformToDom(fitted);
    },
    resetZoom: () => {
      fitModeRef.current = false;
      const { width: cw, height: ch } = containerSizeRef.current;
      const { width: nw, height: nh } = naturalSizeRef.current;
      const centered = { scale: 1, translateX: (cw - nw) / 2, translateY: (ch - nh) / 2 };
      setViewport(centered);
      applyTransformToDom(centered);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  const zoomByFactor = (factor) => {
    fitModeRef.current = false;
    const { width: cw, height: ch } = containerSizeRef.current;
    const center = { x: cw / 2, y: ch / 2 };
    const next = zoomAroundScreenPoint(viewportRef.current, center, viewportRef.current.scale * factor, viewportBounds());
    setViewport(next);
    applyTransformToDom(next);
  };

  useEffect(() => {
    setInteraction(null);
    setSelectedItem(null);
    setRenamingId(null);
    setPendingMask(null);
  }, [tool]);

  useEffect(() => {
    setInteraction(null);
    setSelectedItem(null);
    setRenamingId(null);
    setPendingMask(null);
    setNaturalSize({ width: 0, height: 0 });
    fitModeRef.current = true;
  }, [image]);

  useEffect(() => {
    if (!ref.current) return undefined;
    const node = ref.current;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setContainerSize({ width: entry.contentRect.width, height: entry.contentRect.height });
        containerRectRef.current = { left: entry.contentRect.left, top: entry.contentRect.top };
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Auto-fit on load, and re-fit on container resize as long as the user hasn't manually
  // zoomed/panned since ("fit mode"). When NOT in fit mode, a resize instead re-anchors the
  // viewport to whatever image point was under the cursor's last known position, so the thing the
  // user was actually looking at stays put — falling back to the container's center only if the
  // cursor was never over the canvas yet (e.g. a resize right after page load).
  useEffect(() => {
    if (!naturalSize.width || !naturalSize.height || !containerSize.width || !containerSize.height) return;
    if (fitModeRef.current) {
      const fitted = fitImageToViewport(naturalSize.width, naturalSize.height, containerSize.width, containerSize.height);
      setViewport(fitted);
      applyTransformToDom(fitted);
    } else {
      const prev = prevContainerSizeRef.current;
      if (prev.width && prev.height && (prev.width !== containerSize.width || prev.height !== containerSize.height)) {
        const bounds = { naturalWidth: naturalSize.width, naturalHeight: naturalSize.height, containerWidth: containerSize.width, containerHeight: containerSize.height };
        const anchor = lastPointerScreenRef.current || { x: prev.width / 2, y: prev.height / 2 };
        const anchorImagePoint = screenToImage(anchor, viewportRef.current);
        const shifted = clampViewport({ scale: viewportRef.current.scale, translateX: anchor.x - anchorImagePoint.x * viewportRef.current.scale, translateY: anchor.y - anchorImagePoint.y * viewportRef.current.scale }, bounds);
        setViewport(shifted);
        applyTransformToDom(shifted);
      }
    }
    prevContainerSizeRef.current = containerSize;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [naturalSize, containerSize]);

  // Space-to-pan tracking (document-level so it works regardless of focus; ignored while typing).
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.code !== "Space") return;
      if (event.target.tagName === "INPUT" || event.target.tagName === "TEXTAREA") return;
      setIsSpacePressed(true);
    };
    const onKeyUp = (event) => { if (event.code === "Space") setIsSpacePressed(false); };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => { window.removeEventListener("keydown", onKeyDown); window.removeEventListener("keyup", onKeyUp); };
  }, []);

  // Native (non-passive) wheel listener — React's synthetic onWheel is passive by default, which
  // silently ignores preventDefault(). Cursor-centered zoom needs to suppress page scroll.
  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const onWheel = (event) => {
      if (!image) return;
      event.preventDefault();
      fitModeRef.current = false;
      const cursor = containerPoint(event.clientX, event.clientY);
      const factor = event.deltaY < 0 ? WHEEL_ZOOM_FACTOR : 1 / WHEEL_ZOOM_FACTOR;
      const next = zoomAroundScreenPoint(viewportRef.current, cursor, viewportRef.current.scale * factor, viewportBounds());
      setViewport(next);
      applyTransformToDom(next);
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image]);

  // Regenerate the transparent-cutout preview whenever the pending lasso's shape or edge mode
  // changes, so toggling hard/soft updates immediately without needing to redraw. Runs directly
  // against the source <img> at natural resolution — entirely independent of viewport zoom/pan.
  useEffect(() => {
    if (!pendingMask || !imageElementRef.current) { setMaskPreview(null); return; }
    const result = extractMaskedRegion(imageElementRef.current, pendingMask.points, pendingMask.edge);
    setMaskPreview(result);
  }, [pendingMask]);

  // Screen (client) coordinates -> normalized (0..1) image-space coordinates, via the shared
  // viewport transform. This is the ONLY place pointer coordinates get converted; every other
  // consumer (regions/points/masks/OCR) works in already-normalized or natural-pixel image space.
  // Uses the cached container rect (refreshed only on resize) rather than calling
  // getBoundingClientRect() on every pointer event, per the "avoid repeatedly reading layout
  // inside pointer-move loops" performance guidance.
  const containerPoint = (clientX, clientY) => ({ x: clientX - containerRectRef.current.left, y: clientY - containerRectRef.current.top });

  const toNormalized = (clientX, clientY) => {
    const imagePoint = screenToImage(containerPoint(clientX, clientY), viewportRef.current);
    return { x: imagePoint.x / (naturalSize.width || 1), y: imagePoint.y / (naturalSize.height || 1) };
  };

  const regionStyle = (box) => ({ left: `${box.x * naturalSize.width}px`, top: `${box.y * naturalSize.height}px`, width: `${box.width * naturalSize.width}px`, height: `${box.height * naturalSize.height}px` });
  const pointPxStyle = (point) => ({ left: `${point.x * naturalSize.width}px`, top: `${point.y * naturalSize.height}px` });
  const counterScale = 1 / (viewport.scale || 1); // keeps handles/labels/buttons a constant screen size regardless of zoom

  const commitRegion = (id, patch) => setRegions(regions.map((region) => (region.id === id ? { ...region, ...patch } : region)));
  const deleteRegion = (id) => { setRegions(regions.filter((region) => region.id !== id)); setSelectedItem((current) => (current?.kind === "region" && current.id === id ? null : current)); };
  const duplicateRegion = (region) => {
    const offset = 0.02;
    const duplicate = { ...region, id: crypto.randomUUID(), x: Math.min(1 - region.width, region.x + offset), y: Math.min(1 - region.height, region.y + offset) };
    setRegions([...regions, duplicate]);
    setSelectedItem({ kind: "region", id: duplicate.id });
  };

  const commitPoint = (id, patch) => setPoints(points.map((point) => (point.id === id ? { ...point, ...patch } : point)));
  const deletePoint = (id) => { setPoints(points.filter((point) => point.id !== id)); setSelectedItem((current) => (current?.kind === "point" && current.id === id ? null : current)); };
  const duplicatePoint = (point) => {
    const offset = 0.02;
    const duplicate = { ...point, id: crypto.randomUUID(), x: clamp01(point.x + offset), y: clamp01(point.y + offset) };
    setPoints([...points, duplicate]);
    setSelectedItem({ kind: "point", id: duplicate.id });
  };

  // Interaction precedence: (1) an already-active transient op (handled by returning early here —
  // a new pointerdown only starts once the previous one has ended); (2) space/middle-button/pan-
  // tool pan; (3) the active drawing/selection tool; (4) passive hit-testing (just cursor/hover,
  // not a gesture) is implicit — it never reaches here since nothing is pressed.
  const onPointerDown = (event) => {
    if (!image) return;
    // Two-finger touch is always navigation (pinch-to-zoom + two-finger pan), regardless of the
    // active tool or any single-finger gesture already in progress — the second finger arriving
    // safely abandons whatever single-touch draw/move was underway, same as any other tool switch
    // mid-gesture. This is what makes touch usable without requiring the dedicated Pan tool.
    if (event.pointerType === "touch") {
      safeSetPointerCapture(event.currentTarget, event.pointerId);
      activeTouchesRef.current.set(event.pointerId, containerPoint(event.clientX, event.clientY));
      if (activeTouchesRef.current.size === 2) {
        const [p1, p2] = [...activeTouchesRef.current.values()];
        const centroid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
        setInteraction({ type: "pinch", startDistance: Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1, startScale: viewportRef.current.scale, anchorImagePoint: screenToImage(centroid, viewportRef.current) });
        return;
      }
      if (activeTouchesRef.current.size > 2) return;
    }
    if (pendingMask || interaction) return;
    const wantsPan = tool === "pan" || isSpacePressed || event.button === 1;
    if (wantsPan) {
      event.preventDefault();
      safeSetPointerCapture(event.currentTarget, event.pointerId);
      setInteraction({ type: "pan", startClientX: event.clientX, startClientY: event.clientY, startViewport: viewportRef.current });
      return;
    }
    if (event.button !== 0 && event.pointerType !== "touch") return;
    safeSetPointerCapture(event.currentTarget, event.pointerId);
    ref.current?.focus();
    setSelectedItem(null);
    const point = toNormalized(event.clientX, event.clientY);
    if (tool === "region") {
      setInteraction({ type: "draw-region", startX: point.x, startY: point.y, x: point.x, y: point.y });
    } else if (tool === "point") {
      const placed = { id: crypto.randomUUID(), x: clamp01(point.x), y: clamp01(point.y) };
      setPoints([...points, placed]);
      setSelectedItem({ kind: "point", id: placed.id });
    } else if (tool === "lasso") {
      setInteraction({ type: "lasso-draw", points: [{ x: clamp01(point.x), y: clamp01(point.y) }] });
    } else {
      setInteraction({ type: "draw-mark", id: crypto.randomUUID(), markType: tool, points: [point] });
    }
  };

  const onPointerMove = (event) => {
    if (event.pointerType !== "touch") lastPointerScreenRef.current = containerPoint(event.clientX, event.clientY);
    if (event.pointerType === "touch" && activeTouchesRef.current.has(event.pointerId)) {
      activeTouchesRef.current.set(event.pointerId, containerPoint(event.clientX, event.clientY));
    }
    if (!interaction) return;
    if (interaction.type === "pinch") {
      if (activeTouchesRef.current.size !== 2) return;
      const [p1, p2] = [...activeTouchesRef.current.values()];
      const distance = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1;
      const centroid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      const newScale = clampScale(interaction.startScale * (distance / interaction.startDistance));
      const next = clampViewport({ scale: newScale, translateX: centroid.x - interaction.anchorImagePoint.x * newScale, translateY: centroid.y - interaction.anchorImagePoint.y * newScale }, viewportBounds());
      applyTransformToDom(next);
    } else if (interaction.type === "pan") {
      const dx = event.clientX - interaction.startClientX;
      const dy = event.clientY - interaction.startClientY;
      const next = clampViewport({ ...interaction.startViewport, translateX: interaction.startViewport.translateX + dx, translateY: interaction.startViewport.translateY + dy }, viewportBounds());
      applyTransformToDom(next);
    } else if (interaction.type === "draw-region") {
      const point = toNormalized(event.clientX, event.clientY);
      setInteraction((value) => ({ ...value, x: point.x, y: point.y }));
    } else if (interaction.type === "draw-mark") {
      const point = toNormalized(event.clientX, event.clientY);
      setInteraction((value) => ({ ...value, points: [...value.points, point] }));
    } else if (interaction.type === "lasso-draw") {
      const point = toNormalized(event.clientX, event.clientY);
      setInteraction((value) => ({ ...value, points: [...value.points, { x: clamp01(point.x), y: clamp01(point.y) }] }));
    } else if (interaction.type === "move") {
      const screenDx = event.clientX - interaction.startClientX;
      const screenDy = event.clientY - interaction.startClientY;
      const dx = screenDx / (viewportRef.current.scale * (naturalSize.width || 1));
      const dy = screenDy / (viewportRef.current.scale * (naturalSize.height || 1));
      setInteraction((value) => ({ ...value, liveBox: moveBox(value.startBox, dx, dy) }));
    } else if (interaction.type === "resize") {
      const screenDx = event.clientX - interaction.startClientX;
      const screenDy = event.clientY - interaction.startClientY;
      const dx = screenDx / (viewportRef.current.scale * (naturalSize.width || 1));
      const dy = screenDy / (viewportRef.current.scale * (naturalSize.height || 1));
      setInteraction((value) => ({ ...value, liveBox: resizeBox(value.startBox, value.corner, dx, dy) }));
    }
  };

  const finishPan = () => {
    fitModeRef.current = false;
    setViewport(viewportRef.current);
  };

  const onPointerUp = (event) => {
    if (event.pointerType === "touch") {
      activeTouchesRef.current.delete(event.pointerId);
      // Dropping below two fingers ends the pinch gesture outright (rather than degrading to a
      // single-finger pan) — the user can simply place two fingers down again to resume.
      if (interaction?.type === "pinch" && activeTouchesRef.current.size < 2) {
        fitModeRef.current = false;
        setViewport(viewportRef.current);
        setInteraction(null);
        return;
      }
      if (activeTouchesRef.current.size > 0) return; // other finger(s) still down, gesture continues
    }
    if (!interaction) return;
    if (interaction.type === "pan") {
      finishPan();
    } else if (interaction.type === "draw-region") {
      const width = Math.abs(interaction.x - interaction.startX);
      const height = Math.abs(interaction.y - interaction.startY);
      if (width * naturalSize.width * viewport.scale > 10 && height * naturalSize.height * viewport.scale > 10) {
        const region = { id: crypto.randomUUID(), x: clamp01(Math.min(interaction.startX, interaction.x)), y: clamp01(Math.min(interaction.startY, interaction.y)), width, height, label: `Region ${Date.now().toString().slice(-3)}` };
        setRegions([...regions, region]);
        setSelectedItem({ kind: "region", id: region.id });
      }
    } else if (interaction.type === "draw-mark" && interaction.points.length > 1) {
      setAnnotations([...annotations, { id: interaction.id, type: interaction.markType, points: interaction.points }]);
    } else if (interaction.type === "lasso-draw") {
      const bounds = calculatePolygonBounds(interaction.points);
      const bigEnough = interaction.points.length >= 3 && bounds.width * naturalSize.width * viewport.scale > 10 && bounds.height * naturalSize.height * viewport.scale > 10;
      if (bigEnough) setPendingMask({ points: interaction.points, edge: "hard" });
    } else if (interaction.type === "move" && interaction.liveBox) {
      if (interaction.kind === "region") commitRegion(interaction.id, interaction.liveBox);
      else commitPoint(interaction.id, interaction.liveBox);
      setSelectedItem({ kind: interaction.kind, id: interaction.id });
    } else if (interaction.type === "resize" && interaction.liveBox) {
      commitRegion(interaction.id, interaction.liveBox);
      setSelectedItem({ kind: "region", id: interaction.id });
    }
    setInteraction(null);
  };

  // A pointercancel (e.g. an interrupted touch gesture) must terminate cleanly without committing
  // a half-finished draw/move/pan — unlike onPointerUp, nothing here is persisted.
  const onPointerCancel = (event) => {
    if (event.pointerType === "touch") activeTouchesRef.current.delete(event.pointerId);
    if (interaction?.type === "pan" || interaction?.type === "pinch") setViewport(viewportRef.current);
    setInteraction(null);
  };

  const startMoveItem = (event, kind, item) => {
    if (isSpacePressed || tool === "pan" || event.button !== 0) return; // let it bubble to canvas-level pan handling
    event.stopPropagation();
    if (!image || pendingMask) return;
    safeSetPointerCapture(ref.current, event.pointerId);
    ref.current.focus();
    setSelectedItem({ kind, id: item.id });
    const startBox = kind === "region" ? { x: item.x, y: item.y, width: item.width, height: item.height } : { x: item.x, y: item.y };
    setInteraction({ type: "move", kind, id: item.id, startClientX: event.clientX, startClientY: event.clientY, startBox, liveBox: null });
  };

  const startResize = (event, region, corner) => {
    if (isSpacePressed || tool === "pan" || event.button !== 0) return;
    event.stopPropagation();
    if (pendingMask) return;
    safeSetPointerCapture(ref.current, event.pointerId);
    ref.current.focus();
    setSelectedItem({ kind: "region", id: region.id });
    setInteraction({ type: "resize", id: region.id, corner, startClientX: event.clientX, startClientY: event.clientY, startBox: { x: region.x, y: region.y, width: region.width, height: region.height }, liveBox: null });
  };

  const startRename = (event, region) => {
    event.preventDefault();
    event.stopPropagation();
    renameSettledRef.current = false;
    setSelectedItem({ kind: "region", id: region.id });
    setRenamingId(region.id);
    setRenameValue(region.label || "");
  };

  // Enter unmounts the <input>, which fires a native blur that would call this again before the
  // renamingId state update has flushed — guard with a ref (synchronous, unlike state) so the
  // commit only ever happens once per rename session.
  const commitRename = () => {
    if (renameSettledRef.current) return;
    renameSettledRef.current = true;
    if (renamingId) commitRegion(renamingId, { label: renameValue.trim() || undefined });
    setRenamingId(null);
    ref.current?.focus();
  };

  const cancelRename = () => {
    renameSettledRef.current = true;
    setRenamingId(null);
    ref.current?.focus();
  };

  const confirmMask = () => {
    if (!pendingMask) return;
    const bounds = calculatePolygonBounds(pendingMask.points);
    const maskId = crypto.randomUUID();
    const maskAnnotation = { id: maskId, type: "mask", points: pendingMask.points, edge: pendingMask.edge };
    const region = { id: crypto.randomUUID(), ...bounds, label: `Mask ${regions.length + 1}` };
    commitMask(maskAnnotation, region);
    setPendingMask(null);
    setSelectedItem({ kind: "region", id: region.id });
  };

  const cancelMask = () => setPendingMask(null);

  const onCanvasKeyDown = (event) => {
    if (event.target.tagName === "INPUT" || event.target.tagName === "TEXTAREA") return;
    if (pendingMask) {
      if (event.key === "Escape") { event.preventDefault(); cancelMask(); }
      else if (event.key === "Enter") { event.preventDefault(); confirmMask(); }
      return;
    }
    if (event.key === "Escape") { event.preventDefault(); setSelectedItem(null); return; }
    if (!selectedItem) return;
    const step = event.shiftKey ? NUDGE_STEP_LARGE : NUDGE_STEP;
    if (selectedItem.kind === "region") {
      const region = regions.find((item) => item.id === selectedItem.id);
      if (!region) return;
      if (event.key === "ArrowUp") { event.preventDefault(); commitRegion(region.id, moveBox(region, 0, -step)); }
      else if (event.key === "ArrowDown") { event.preventDefault(); commitRegion(region.id, moveBox(region, 0, step)); }
      else if (event.key === "ArrowLeft") { event.preventDefault(); commitRegion(region.id, moveBox(region, -step, 0)); }
      else if (event.key === "ArrowRight") { event.preventDefault(); commitRegion(region.id, moveBox(region, step, 0)); }
      else if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); deleteRegion(region.id); }
      else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d") { event.preventDefault(); duplicateRegion(region); }
    } else if (selectedItem.kind === "point") {
      const point = points.find((item) => item.id === selectedItem.id);
      if (!point) return;
      if (event.key === "ArrowUp") { event.preventDefault(); commitPoint(point.id, moveBox(point, 0, -step)); }
      else if (event.key === "ArrowDown") { event.preventDefault(); commitPoint(point.id, moveBox(point, 0, step)); }
      else if (event.key === "ArrowLeft") { event.preventDefault(); commitPoint(point.id, moveBox(point, -step, 0)); }
      else if (event.key === "ArrowRight") { event.preventDefault(); commitPoint(point.id, moveBox(point, step, 0)); }
      else if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); deletePoint(point.id); }
      else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d") { event.preventDefault(); duplicatePoint(point); }
    }
  };

  const pointString = (pathPoints = []) => pathPoints.map((point) => `${point.x * naturalSize.width},${point.y * naturalSize.height}`).join(" ");
  const displayBox = (region) => (interaction?.type === "move" && interaction.kind === "region" && interaction.id === region.id && interaction.liveBox) ? interaction.liveBox : (interaction?.type === "resize" && interaction.id === region.id && interaction.liveBox) ? interaction.liveBox : region;
  const displayPoint = (point) => (interaction?.type === "move" && interaction.kind === "point" && interaction.id === point.id && interaction.liveBox) ? interaction.liveBox : point;

  // draw-line/redaction-line represent real drawn content — they scale WITH the image (a
  // redaction must keep covering the same image area regardless of zoom), so these stay fixed
  // fractions of natural image width. lasso-line/mask-outline are selection CHROME, not drawn
  // content — they're counter-scaled to a constant screen thickness so they stay visible and
  // legible at any zoom level, exactly like the region handles/labels/delete buttons above.
  const strokeWidth = Math.max(1, naturalSize.width * 0.003);
  const redactionStrokeWidth = Math.max(8, naturalSize.width * 0.018);
  const chromeStrokeWidth = Math.max(0.5, 2 * counterScale);

  const canvasCursor = tool === "pan" || isSpacePressed ? (interaction?.type === "pan" ? "grabbing" : "grab") : undefined;

  return (
    <div
      className={`capture-canvas ${processing ? "processing" : ""}`}
      ref={ref}
      tabIndex={-1}
      data-testid="capture-canvas"
      style={canvasCursor ? { cursor: canvasCursor } : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onKeyDown={onCanvasKeyDown}
      onDragStart={(event) => event.preventDefault()}
    >
      {!image && <div className="empty-canvas" data-testid="empty-capture-state"><span className="crosshair" /><strong>Drop, paste, or open a screenshot</strong><p>Then drag directly over anything that matters.</p></div>}
      {image && (
        <div className="viewport-content" ref={wrapperRef} style={{ width: naturalSize.width, height: naturalSize.height, transform: `translate(${viewport.translateX}px, ${viewport.translateY}px) scale(${viewport.scale})` }} data-testid="viewport-content">
          <img ref={imageElementRef} src={image} alt="Capture workspace" draggable="false" data-testid="capture-preview-image" onLoad={(event) => setNaturalSize({ width: event.target.naturalWidth, height: event.target.naturalHeight })} />
          {ocr?.words?.map((word, index) => (
            <div key={index} className="ocr-word-box" data-testid={`ocr-word-box-${index}`} style={{ left: word.box.x, top: word.box.y, width: word.box.width, height: word.box.height }} />
          ))}
          {regions.map((region, index) => {
            const box = displayBox(region);
            const selected = selectedItem?.kind === "region" && selectedItem.id === region.id;
            return (
              <div key={region.id} className={`selection-box ${selected ? "selected" : ""}`} role="group" aria-label={region.label || `Region ${index + 1}`} data-testid={`selected-region-${index}`} style={{ ...regionStyle(box), borderWidth: chromeStrokeWidth }} onPointerDown={(event) => startMoveItem(event, "region", region)}>
                {renamingId === region.id ? (
                  <input
                    autoFocus
                    className="region-label-input"
                    maxLength={80}
                    value={renameValue}
                    data-testid={`region-label-input-${index}`}
                    style={{ transform: `scale(${counterScale})`, transformOrigin: "0 100%" }}
                    onChange={(event) => setRenameValue(event.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") { event.preventDefault(); commitRename(); }
                      if (event.key === "Escape") { event.preventDefault(); cancelRename(); }
                    }}
                    onClick={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                  />
                ) : (
                  <span style={{ transform: `scale(${counterScale})`, transformOrigin: "0 100%" }} onPointerDown={(event) => event.stopPropagation()} onDoubleClick={(event) => startRename(event, region)} title="Double-click to rename">{String(index + 1).padStart(2, "0")}</span>
                )}
                {selected && <button className="region-delete" style={{ transform: `scale(${counterScale})` }} onClick={(event) => { event.stopPropagation(); deleteRegion(region.id); }} onPointerDown={(event) => event.stopPropagation()} aria-label="Delete region" title="Delete region (Del)">&times;</button>}
                {CORNERS.map((corner) => <i key={corner} style={{ cursor: cursorForCorner(corner), transform: `scale(${counterScale})` }} onPointerDown={(event) => startResize(event, region, corner)} />)}
              </div>
            );
          })}
          {points.map((point, index) => {
            const displayed = displayPoint(point);
            const selected = selectedItem?.kind === "point" && selectedItem.id === point.id;
            const nearest = selected ? nearestOcrWord(displayed, naturalSize, ocr?.words) : null;
            return (
              <div key={point.id} className={`point-marker ${selected ? "selected" : ""}`} role="group" aria-label={point.label || `Point ${index + 1}`} data-testid={`selected-point-${index}`} style={pointPxStyle(displayed)} onPointerDown={(event) => startMoveItem(event, "point", point)}>
                <span className="point-dot" style={{ transform: `scale(${counterScale})` }} />
                {selected && nearest && <div className="point-nearest-word" style={{ transform: `translateX(-50%) scale(${counterScale})`, transformOrigin: "50% 0" }} data-testid={`point-nearest-word-${index}`}>{nearest.text}</div>}
                {selected && <button className="region-delete" style={{ transform: `scale(${counterScale})` }} onClick={(event) => { event.stopPropagation(); deletePoint(point.id); }} onPointerDown={(event) => event.stopPropagation()} aria-label="Delete point" title="Delete point (Del)">&times;</button>}
              </div>
            );
          })}
          <svg className="annotation-layer" viewBox={`0 0 ${naturalSize.width || 1} ${naturalSize.height || 1}`} width={naturalSize.width} height={naturalSize.height} data-testid="annotation-layer">
            {annotations.map((annotation, index) => (
              annotation.type === "mask"
                ? <polygon key={annotation.id} points={pointString(annotation.points)} className="mask-outline" strokeWidth={chromeStrokeWidth} data-testid={`mask-annotation-${index}`} />
                : <polyline key={annotation.id} points={pointString(annotation.points)} className={annotation.type === "redaction" ? "redaction-line" : "draw-line"} strokeWidth={annotation.type === "redaction" ? redactionStrokeWidth : strokeWidth} data-testid={`${annotation.type}-annotation-${index}`} />
            ))}
            {interaction?.type === "draw-mark" && <polyline points={pointString(interaction.points)} className={interaction.markType === "redaction" ? "redaction-line" : "draw-line"} strokeWidth={interaction.markType === "redaction" ? redactionStrokeWidth : strokeWidth} />}
            {interaction?.type === "lasso-draw" && <polyline points={pointString(interaction.points)} className="lasso-line" strokeWidth={chromeStrokeWidth} />}
            {pendingMask && <polygon points={pointString(pendingMask.points)} className="mask-outline pending" strokeWidth={chromeStrokeWidth} data-testid="pending-mask-outline" />}
          </svg>
          {interaction?.type === "draw-region" && <div className="selection-box draft" style={{ ...regionStyle({ x: Math.min(interaction.startX, interaction.x), y: Math.min(interaction.startY, interaction.y), width: Math.abs(interaction.x - interaction.startX), height: Math.abs(interaction.y - interaction.startY) }), borderWidth: chromeStrokeWidth }} />}
        </div>
      )}
      {image && <div className="canvas-vignette" />}
      {pendingMask && (
        <div className="mask-review-dock" data-testid="mask-review-dock">
          <div className="mask-preview-thumb">{maskPreview?.dataUrl && <img src={maskPreview.dataUrl} alt="Selection preview" data-testid="mask-preview-image" />}</div>
          <div className="mask-review-controls">
            <div className="mask-edge-toggle" data-testid="mask-edge-toggle">
              <button className={pendingMask.edge === "hard" ? "active" : ""} onClick={() => setPendingMask((value) => ({ ...value, edge: "hard" }))} data-testid="mask-edge-hard-button">Hard edge</button>
              <button className={pendingMask.edge === "soft" ? "active" : ""} onClick={() => setPendingMask((value) => ({ ...value, edge: "soft" }))} data-testid="mask-edge-soft-button">Soft edge</button>
            </div>
            <div className="mask-review-actions">
              <button className="mask-cancel" onClick={cancelMask} data-testid="mask-cancel-button">Cancel</button>
              <button className="mask-confirm" onClick={confirmMask} data-testid="mask-confirm-button">Confirm selection</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
