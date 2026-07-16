// Pure geometry + canvas-masking helpers shared by regions, points, and lasso selections in
// CaptureCanvas.jsx. Kept dependency-free (no React) so it's independently unit-testable.

export const MIN_SIZE = 0.01; // smallest normalized width/height/bbox dimension allowed
export const FEATHER_PX = 6; // soft-edge blur radius in source-image pixels — change this one
// constant to retune, or to promote to a UI-configurable radius later without touching the
// masking pipeline itself.

export const clamp01 = (value) => Math.max(0, Math.min(1, value));

// The <img> renders with object-fit:contain, so it letterboxes whenever the source image's aspect
// ratio doesn't match the canvas panel. Every selection tool (region/point/lasso) must normalize
// against this rendered image rect, not the raw container rect, or coordinates drift under
// letterboxing. Kept zoom/pan-ready: always derived from the live container size + natural image
// size, never a cached screen offset — if a viewport transform is added later, callers just need
// to feed in the transformed container rect/size here.
export function imageRectWithin(container, naturalWidth, naturalHeight) {
  if (!container.width || !container.height) return { left: 0, top: 0, width: 0, height: 0 };
  if (!naturalWidth || !naturalHeight) return { left: 0, top: 0, width: container.width, height: container.height };
  const containerAspect = container.width / container.height;
  const imageAspect = naturalWidth / naturalHeight;
  const width = imageAspect > containerAspect ? container.width : container.height * imageAspect;
  const height = imageAspect > containerAspect ? container.width / imageAspect : container.height;
  return { left: (container.width - width) / 2, top: (container.height - height) / 2, width, height };
}

// clientX/clientY are viewport coordinates (as given by a pointer event); containerRect is the
// canvas container's getBoundingClientRect(); imageRect is the result of imageRectWithin(...) for
// that same container. Returns normalized (0..1) coordinates, NOT clamped — callers decide
// whether out-of-bounds values should clamp (selections) or pass through (e.g. a raw readout).
export function screenToImageCoordinates(clientX, clientY, containerRect, imageRect) {
  return {
    x: (clientX - containerRect.left - imageRect.left) / (imageRect.width || 1),
    y: (clientY - containerRect.top - imageRect.top) / (imageRect.height || 1),
  };
}

// Normalized (0..1) bounding box of a list of {x, y} points. Degenerate inputs (0 or 1 point, or
// all points coincident) still return a valid, minimum-size box rather than a zero-area one.
export function calculatePolygonBounds(points) {
  if (!points || !points.length) return { x: 0, y: 0, width: MIN_SIZE, height: MIN_SIZE };
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = clamp01(Math.min(...xs));
  const minY = clamp01(Math.min(...ys));
  const maxX = clamp01(Math.max(...xs));
  const maxY = clamp01(Math.max(...ys));
  return {
    x: minX,
    y: minY,
    width: Math.max(maxX - minX, MIN_SIZE),
    height: Math.max(maxY - minY, MIN_SIZE),
  };
}

function pathFromNormalizedPoints(points, naturalWidth, naturalHeight, offsetX, offsetY) {
  const path = new Path2D();
  points.forEach((point, index) => {
    const x = point.x * naturalWidth - offsetX;
    const y = point.y * naturalHeight - offsetY;
    if (index === 0) path.moveTo(x, y);
    else path.lineTo(x, y);
  });
  path.closePath();
  return path;
}

// Fills `path` into `ctx` with a Gaussian blur applied first, so the resulting alpha channel is
// genuinely feathered at the boundary (a real soft edge) rather than a post-hoc blur of already-
// composited pixels. Isolated as its own function so a configurable radius can be wired in later
// without touching createLassoMask's compositing logic.
export function applyMaskFeathering(ctx, path, featherPx) {
  ctx.save();
  ctx.filter = `blur(${featherPx}px)`;
  ctx.fillStyle = "#000";
  ctx.fill(path);
  ctx.restore();
}

// Real canvas compositing (not CSS clip-path/blur): draws the source image at natural (DPI-
// independent) resolution into a canvas cropped to the polygon's bounding box, then uses
// destination-in compositing to erase everything outside the (optionally feathered) polygon,
// producing a transparent-background cutout. Returns the canvas with width/height always set
// correctly, even in environments without a working 2D context (e.g. jsdom in tests) — drawing is
// skipped rather than throwing, so dimension checks stay meaningful everywhere.
export function createLassoMask(imageElement, normalizedPoints, edge = "hard") {
  const naturalWidth = imageElement.naturalWidth;
  const naturalHeight = imageElement.naturalHeight;
  const bounds = calculatePolygonBounds(normalizedPoints);
  const offsetX = bounds.x * naturalWidth;
  const offsetY = bounds.y * naturalHeight;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bounds.width * naturalWidth));
  canvas.height = Math.max(1, Math.round(bounds.height * naturalHeight));

  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  ctx.drawImage(imageElement, -offsetX, -offsetY, naturalWidth, naturalHeight);
  const path = pathFromNormalizedPoints(normalizedPoints, naturalWidth, naturalHeight, offsetX, offsetY);

  ctx.globalCompositeOperation = "destination-in";
  if (edge === "soft") {
    const maskCanvas = document.createElement("canvas");
    maskCanvas.width = canvas.width;
    maskCanvas.height = canvas.height;
    const maskCtx = maskCanvas.getContext("2d");
    if (maskCtx) {
      applyMaskFeathering(maskCtx, path, FEATHER_PX);
      ctx.drawImage(maskCanvas, 0, 0);
    }
  } else {
    ctx.fillStyle = "#000";
    ctx.fill(path);
  }
  return canvas;
}

// Convenience wrapper: createLassoMask(...) + toDataURL, with the bounding box included for
// callers that also need to derive an auto-Region. toDataURL is wrapped in try/catch for the
// (unreachable in this app today — images are always same-origin data: URLs, never tainted)
// cross-origin-canvas case, so a failure here surfaces as a handled error rather than a crash.
export function extractMaskedRegion(imageElement, normalizedPoints, edge = "hard") {
  const boundingBox = calculatePolygonBounds(normalizedPoints);
  const canvas = createLassoMask(imageElement, normalizedPoints, edge);
  try {
    return { dataUrl: canvas.toDataURL("image/png"), boundingBox, error: null };
  } catch (error) {
    return { dataUrl: null, boundingBox, error: error.message };
  }
}
