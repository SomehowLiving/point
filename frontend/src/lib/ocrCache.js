// Identifies whether a cached OCR result still applies to the current image. OCR is scoped to
// regions (the backend crops to each region before extracting), and a redaction blacks out real
// pixels before OCR ever sees them — so either changing invalidates a previously-cached result,
// not just swapping the underlying image.
export function computeOcrKey(image, regions, annotations) {
  if (!image) return null;
  const regionsSignature = (regions || [])
    .map((region) => `${region.id}:${region.x}:${region.y}:${region.width}:${region.height}`)
    .join("|");
  const redactionSignature = (annotations || [])
    .filter((annotation) => annotation.type === "redaction")
    .map((annotation) => (annotation.points || []).map((point) => `${point.x}:${point.y}`).join(","))
    .join("|");
  return `${image}::${regionsSignature}::${redactionSignature}`;
}
