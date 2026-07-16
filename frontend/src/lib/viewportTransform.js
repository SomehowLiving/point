// Single source of truth for image <-> screen coordinate conversion. A viewport is
// { scale, translateX, translateY }: translateX/translateY are the CSS-pixel screen position
// (relative to the canvas container) of natural-image pixel (0,0); scale maps natural image
// pixels to CSS pixels. scale === 1 is "100%" (native resolution, one image pixel per CSS pixel).
//
// Canonical coordinate space for these functions is NATURAL IMAGE PIXELS (matching the existing
// OCR word-box convention already used elsewhere in this app). Regions/points/masks are stored
// normalized (0..1) as before — multiply by naturalWidth/naturalHeight to get natural pixels
// before calling these, and divide after. Viewport transforms are presentation state only: never
// persisted, never written into regions/points/masks/annotations/history/API payloads.
//
// devicePixelRatio is deliberately not part of this model — CSS transforms and CSS-pixel
// positioning are resolution-independent; the browser handles the CSS-pixel-to-device-pixel
// mapping. DPR only matters where an actual canvas backing store is rasterized (mask extraction),
// which already operates directly in natural image pixels via selectionGeometry.js, untouched by
// viewport zoom.

export const MIN_SCALE = 0.1; // 10%
export const MAX_SCALE = 8; // 800%

export function applyViewportTransform(point, viewport) {
  return { x: point.x * viewport.scale + viewport.translateX, y: point.y * viewport.scale + viewport.translateY };
}

export function invertViewportTransform(point, viewport) {
  return { x: (point.x - viewport.translateX) / viewport.scale, y: (point.y - viewport.translateY) / viewport.scale };
}

// Aliases matching the requested naming.
export const imageToScreen = applyViewportTransform;
export const screenToImage = invertViewportTransform;

export function clampScale(scale, minScale = MIN_SCALE, maxScale = MAX_SCALE) {
  return Math.min(maxScale, Math.max(minScale, scale));
}

// Keeps the viewport within a "controlled overscroll" band: the image can be panned partially
// out of view, but at least `minVisiblePx` of it must remain reachable on each axis, so it can
// never be permanently lost off-screen.
export function clampViewport(viewport, { naturalWidth, naturalHeight, containerWidth, containerHeight, minScale = MIN_SCALE, maxScale = MAX_SCALE, minVisiblePx = 80 }) {
  const scale = clampScale(viewport.scale, minScale, maxScale);
  const scaledWidth = naturalWidth * scale;
  const scaledHeight = naturalHeight * scale;
  const minX = Math.min(minVisiblePx - scaledWidth, containerWidth - minVisiblePx);
  const maxX = Math.max(minVisiblePx - scaledWidth, containerWidth - minVisiblePx);
  const minY = Math.min(minVisiblePx - scaledHeight, containerHeight - minVisiblePx);
  const maxY = Math.max(minVisiblePx - scaledHeight, containerHeight - minVisiblePx);
  const translateX = Math.min(maxX, Math.max(minX, viewport.translateX));
  const translateY = Math.min(maxY, Math.max(minY, viewport.translateY));
  return { scale, translateX, translateY };
}

// Centers the image at the largest scale that fits entirely within the container without
// distorting aspect ratio ("Fit to screen"). Falls back to scale 1 if dimensions are unknown.
export function fitImageToViewport(naturalWidth, naturalHeight, containerWidth, containerHeight) {
  if (!naturalWidth || !naturalHeight || !containerWidth || !containerHeight) return { scale: 1, translateX: 0, translateY: 0 };
  const scale = clampScale(Math.min(containerWidth / naturalWidth, containerHeight / naturalHeight));
  return { scale, translateX: (containerWidth - naturalWidth * scale) / 2, translateY: (containerHeight - naturalHeight * scale) / 2 };
}

// Rescales around a fixed SCREEN point (typically the cursor) so the image-space point currently
// beneath it stays beneath it after the zoom — the defining property of cursor-centered zoom.
export function zoomAroundScreenPoint(viewport, screenPoint, newScale, bounds) {
  const clampedScale = clampScale(newScale, bounds?.minScale, bounds?.maxScale);
  const imagePoint = invertViewportTransform(screenPoint, viewport);
  const next = {
    scale: clampedScale,
    translateX: screenPoint.x - imagePoint.x * clampedScale,
    translateY: screenPoint.y - imagePoint.y * clampedScale,
  };
  return bounds ? clampViewport(next, bounds) : next;
}
