// Freeform (lasso) selections in the snip overlay: turning a pointer path into a polygon the
// backend accepts (Annotation.points is capped at 500) and its bounding box.

const MAX_POINTS = 400;
const MIN_STEP = 0.002; // normalized distance between kept points; drops pointer jitter

export function simplifyPath(points) {
  if (points.length <= 2) return points.slice();
  const kept = [points[0]];
  for (let i = 1; i < points.length; i += 1) {
    const last = kept[kept.length - 1];
    if (Math.hypot(points[i].x - last.x, points[i].y - last.y) >= MIN_STEP) kept.push(points[i]);
  }
  if (kept.length <= MAX_POINTS) return kept;
  // Still too dense: sample evenly, always keeping the first and last point.
  const step = (kept.length - 1) / (MAX_POINTS - 1);
  return Array.from({ length: MAX_POINTS }, (_, i) => kept[Math.round(i * step)]);
}

export function pathBounds(points) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

// A freeform drag only counts as a shape if it encloses something: at least 3 points and a
// bounding box of at least minPx on both sides at the given screen size.
export function isUsableShape(points, viewport, minPx = 10) {
  if (points.length < 3) return false;
  const b = pathBounds(points);
  return b.width * viewport.width >= minPx && b.height * viewport.height >= minPx;
}

export function polygonPoints(points) {
  return points.map((p) => `${p.x},${p.y}`).join(" ");
}
