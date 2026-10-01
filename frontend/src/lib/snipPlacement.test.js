import { dockPlacement } from "./snipPlacement";

const vp = { width: 1536, height: 864 };
const inView = (style, bar) => {
  const room = parseFloat(style["--snip-room"]);
  const height = bar + 10 + room;
  const top = style.top ?? vp.height - style.bottom - height;
  return top >= 0 && top + height <= vp.height && style.left >= 0 && style.left + style.width <= vp.width;
};

test("small selection near the top: dock goes below it", () => {
  const style = dockPlacement({ x: 0.1, y: 0.1, width: 0.2, height: 0.15 }, vp, 120);
  expect(style.top).toBeDefined();
  expect(inView(style, 120)).toBe(true);
});

test("selection near the bottom: dock goes above it", () => {
  const style = dockPlacement({ x: 0.5, y: 0.6, width: 0.3, height: 0.35 }, vp, 120);
  expect(style.bottom).toBeGreaterThan(vp.height * 0.4);
  expect(inView(style, 120)).toBe(true);
});

test("near-full-screen selection: dock stays fully on screen", () => {
  const style = dockPlacement({ x: 0.01, y: 0.1, width: 0.77, height: 0.69 }, vp, 120);
  expect(inView(style, 120)).toBe(true);
});

test("selection at the right edge: dock is clamped horizontally", () => {
  const style = dockPlacement({ x: 0.9, y: 0.2, width: 0.1, height: 0.1 }, vp, 120);
  expect(style.left + style.width).toBeLessThanOrEqual(vp.width - 16);
});
