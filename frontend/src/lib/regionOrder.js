// Region display order is tracked independently from region identity/data: `regions` (in
// CapturePage.jsx) is the source of truth for each region's x/y/width/height/label, keyed by a
// stable `id`; `regionOrder` (a plain string[] of ids) is the source of truth for display/numbering
// order. This lets numbers change on reorder without ever touching a region's identity, so
// annotations/OCR grounding/analysis results that reference a region by id are never broken by
// reordering.
//
// deriveRegionOrder is the single place that reconciles the two: call it any time you need the
// effective display order, rather than trusting `regionOrder` blindly (it may be stale — a region
// may have been deleted, or a new one added/mask-derived without an explicit reorder yet).
//
// Behavior:
// - Existing saved captures with no `regionOrder` (backward compatibility): every id is "missing",
//   so the result is exactly `regions.map(r => r.id)` — today's array order, unchanged.
// - Region added (drawn, or a mask's derived region): not yet in `regionOrder` -> appended at the
//   end, after all explicitly ordered ids.
// - Region deleted: its id is filtered out automatically (`validIds` no longer contains it).
// - Reorder: `regionOrder` explicitly lists the new order; this function just validates it against
//   current regions.
export function deriveRegionOrder(regions, regionOrder) {
  const validIds = new Set(regions.map((region) => region.id));
  const kept = (regionOrder || []).filter((id) => validIds.has(id));
  const keptSet = new Set(kept);
  const missing = regions.filter((region) => !keptSet.has(region.id)).map((region) => region.id);
  return [...kept, ...missing];
}

export function orderedRegions(regions, regionOrder) {
  const order = deriveRegionOrder(regions, regionOrder);
  const byId = new Map(regions.map((region) => [region.id, region]));
  return order.map((id) => byId.get(id)).filter(Boolean);
}

// Moves `id` to sit just before `beforeId` (or to the end if `beforeId` is null/omitted),
// returning a new order array. Used by both drag-and-drop and keyboard reordering.
export function reorderBefore(regions, regionOrder, id, beforeId) {
  const order = deriveRegionOrder(regions, regionOrder).filter((existing) => existing !== id);
  const insertAt = beforeId ? order.indexOf(beforeId) : -1;
  if (insertAt === -1) return [...order, id];
  return [...order.slice(0, insertAt), id, ...order.slice(insertAt)];
}
