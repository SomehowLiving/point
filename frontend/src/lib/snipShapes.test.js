import { isUsableShape, pathBounds, polygonPoints, simplifyPath } from "./snipShapes";

const circle = (n) => Array.from({ length: n }, (_, i) => ({ x: 0.5 + 0.2 * Math.cos((2 * Math.PI * i) / n), y: 0.5 + 0.2 * Math.sin((2 * Math.PI * i) / n) }));

test("dense paths are reduced under the backend's 500-point cap", () => {
  const simplified = simplifyPath(circle(5000));
  expect(simplified.length).toBeLessThanOrEqual(400);
  expect(simplified.length).toBeGreaterThan(50);
});

test("jitter below the minimum step is dropped, endpoints kept", () => {
  const path = [{ x: 0.1, y: 0.1 }, { x: 0.1001, y: 0.1 }, { x: 0.1002, y: 0.1001 }, { x: 0.3, y: 0.3 }];
  const simplified = simplifyPath(path);
  expect(simplified[0]).toEqual(path[0]);
  expect(simplified).toHaveLength(2);
});

test("bounds enclose the path", () => {
  const b = pathBounds([{ x: 0.2, y: 0.3 }, { x: 0.6, y: 0.1 }, { x: 0.4, y: 0.7 }]);
  expect(b.x).toBeCloseTo(0.2);
  expect(b.y).toBeCloseTo(0.1);
  expect(b.width).toBeCloseTo(0.4);
  expect(b.height).toBeCloseTo(0.6);
});

test("tiny or degenerate shapes are rejected", () => {
  const viewport = { width: 1000, height: 1000 };
  expect(isUsableShape([{ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.5 }], viewport)).toBe(false);
  expect(isUsableShape([{ x: 0.1, y: 0.1 }, { x: 0.105, y: 0.1 }, { x: 0.1, y: 0.105 }], viewport)).toBe(false);
  expect(isUsableShape(circle(40), viewport)).toBe(true);
});

test("polygon points serialize for SVG", () => {
  expect(polygonPoints([{ x: 0.1, y: 0.2 }, { x: 0.3, y: 0.4 }])).toBe("0.1,0.2 0.3,0.4");
});
