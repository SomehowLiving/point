// Where the snip overlay's command dock goes relative to the selection (see SnipPage).
const EDGE = 16; // px kept clear at the screen edges
const DOCK_WIDTH = 660;
const MIN_ANSWER = 180; // px of answer we want visible before choosing a side

export function dockPlacement(anchor, viewport, barHeight) {
  const { width: W, height: H } = viewport;
  const top = anchor.y * H;
  const bottom = (anchor.y + anchor.height) * H;
  const dockWidth = Math.min(DOCK_WIDTH, W - EDGE * 2);
  const left = Math.min(Math.max(EDGE, (anchor.x + anchor.width / 2) * W - dockWidth / 2), W - dockWidth - EDGE);
  const need = barHeight + MIN_ANSWER + 10;
  const spaceBelow = H - bottom - 14 - EDGE;
  const spaceAbove = top - 30 - EDGE;
  let placement;
  let room;
  if (spaceBelow >= need) { placement = { top: bottom + 14 }; room = spaceBelow; }
  else if (spaceAbove >= need) { placement = { bottom: H - top + 30 }; room = spaceAbove; }
  else {
    // Not enough room outside: sit inside the selection, just above its bottom edge (or the screen's).
    const fromBottom = Math.max(EDGE + 8, H - bottom + EDGE);
    placement = { bottom: fromBottom };
    room = H - fromBottom - EDGE;
  }
  return { left, width: dockWidth, ...placement, "--snip-room": `${Math.max(120, room - barHeight - 10)}px` };
}
