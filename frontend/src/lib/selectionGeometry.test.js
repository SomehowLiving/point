import {
  MIN_SIZE,
  FEATHER_PX,
  clamp01,
  imageRectWithin,
  screenToImageCoordinates,
  calculatePolygonBounds,
  createLassoMask,
  extractMaskedRegion,
  applyMaskFeathering,
} from "./selectionGeometry";

describe("clamp01", () => {
  test("clamps below 0 and above 1, passes through in-range values", () => {
    expect(clamp01(-0.5)).toBe(0);
    expect(clamp01(1.5)).toBe(1);
    expect(clamp01(0.42)).toBe(0.42);
  });
});

describe("imageRectWithin", () => {
  test("no letterboxing when aspect ratios match", () => {
    const rect = imageRectWithin({ width: 800, height: 400 }, 1600, 800);
    expect(rect).toEqual({ left: 0, top: 0, width: 800, height: 400 });
  });

  test("letterboxes top/bottom when the image is wider than the container", () => {
    const rect = imageRectWithin({ width: 800, height: 400 }, 1600, 500); // image aspect 3.2, container aspect 2
    expect(rect.left).toBe(0);
    expect(rect.width).toBe(800);
    expect(rect.height).toBeCloseTo(250, 5);
    expect(rect.top).toBeCloseTo(75, 5);
  });

  test("letterboxes left/right when the image is taller (narrower) than the container", () => {
    const rect = imageRectWithin({ width: 800, height: 400 }, 400, 400); // image aspect 1, container aspect 2
    expect(rect.top).toBe(0);
    expect(rect.height).toBe(400);
    expect(rect.width).toBeCloseTo(400, 5);
    expect(rect.left).toBeCloseTo(200, 5);
  });

  test("returns a safe zero rect when the container hasn't been measured yet", () => {
    expect(imageRectWithin({ width: 0, height: 0 }, 100, 100)).toEqual({ left: 0, top: 0, width: 0, height: 0 });
  });

  test("falls back to the full container before the image has loaded (no natural size yet)", () => {
    expect(imageRectWithin({ width: 500, height: 300 }, 0, 0)).toEqual({ left: 0, top: 0, width: 500, height: 300 });
  });
});

describe("screenToImageCoordinates", () => {
  test("converts a client point into normalized image-space coordinates", () => {
    const containerRect = { left: 100, top: 50 };
    const imageRect = { left: 0, top: 75, width: 800, height: 250 };
    // a point at the exact center of the rendered image
    const point = screenToImageCoordinates(100 + 400, 50 + 75 + 125, containerRect, imageRect);
    expect(point.x).toBeCloseTo(0.5, 5);
    expect(point.y).toBeCloseTo(0.5, 5);
  });

  test("does not clamp — points outside the image rect (e.g. in the letterbox) yield out-of-range values", () => {
    const containerRect = { left: 0, top: 0 };
    const imageRect = { left: 0, top: 75, width: 800, height: 250 };
    const point = screenToImageCoordinates(400, 10, containerRect, imageRect); // inside the top letterbox bar
    expect(point.y).toBeLessThan(0);
  });
});

describe("calculatePolygonBounds", () => {
  test("computes the normalized bounding box of a simple polygon", () => {
    const bounds = calculatePolygonBounds([{ x: 0.2, y: 0.3 }, { x: 0.6, y: 0.3 }, { x: 0.4, y: 0.8 }]);
    expect(bounds.x).toBeCloseTo(0.2, 5);
    expect(bounds.y).toBeCloseTo(0.3, 5);
    expect(bounds.width).toBeCloseTo(0.4, 5);
    expect(bounds.height).toBeCloseTo(0.5, 5);
  });

  test("degenerate single-point input still returns a minimum-size box, not zero-area", () => {
    const bounds = calculatePolygonBounds([{ x: 0.5, y: 0.5 }]);
    expect(bounds.width).toBeGreaterThanOrEqual(MIN_SIZE);
    expect(bounds.height).toBeGreaterThanOrEqual(MIN_SIZE);
  });

  test("empty input does not throw and returns a minimum-size box", () => {
    const bounds = calculatePolygonBounds([]);
    expect(bounds.width).toBeGreaterThanOrEqual(MIN_SIZE);
    expect(bounds.height).toBeGreaterThanOrEqual(MIN_SIZE);
  });

  test("self-intersecting paths still resolve to a sane bounding box (min/max, no crash)", () => {
    const bounds = calculatePolygonBounds([{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.9 }, { x: 0.1, y: 0.9 }, { x: 0.9, y: 0.1 }]);
    expect(bounds.x).toBeCloseTo(0.1, 5);
    expect(bounds.y).toBeCloseTo(0.1, 5);
    expect(bounds.width).toBeCloseTo(0.8, 5);
    expect(bounds.height).toBeCloseTo(0.8, 5);
  });

  test("clamps out-of-range points into 0..1 before computing the box", () => {
    const bounds = calculatePolygonBounds([{ x: -0.5, y: -0.5 }, { x: 1.5, y: 1.5 }]);
    expect(bounds.x).toBe(0);
    expect(bounds.y).toBe(0);
    expect(bounds.width).toBeCloseTo(1, 5);
    expect(bounds.height).toBeCloseTo(1, 5);
  });
});

// jsdom (this project's test environment) does not implement real canvas 2D rendering —
// getContext("2d") returns null. createLassoMask/extractMaskedRegion are written to degrade
// gracefully rather than throw in that case, so what's testable here (honestly, without a canvas
// polyfill dependency) is: dimensions are computed correctly, and both edge modes run to
// completion without throwing.
describe("createLassoMask / extractMaskedRegion (dimension + no-throw checks)", () => {
  const fakeImage = { naturalWidth: 1000, naturalHeight: 500 };
  const square = [{ x: 0.1, y: 0.2 }, { x: 0.5, y: 0.2 }, { x: 0.5, y: 0.6 }, { x: 0.1, y: 0.6 }];

  test("computes canvas dimensions from the polygon bounding box in natural pixels", () => {
    const canvas = createLassoMask(fakeImage, square, "hard");
    expect(canvas.width).toBe(Math.round(0.4 * 1000));
    expect(canvas.height).toBe(Math.round(0.4 * 500));
  });

  test("hard and soft edge modes both run without throwing", () => {
    expect(() => createLassoMask(fakeImage, square, "hard")).not.toThrow();
    expect(() => createLassoMask(fakeImage, square, "soft")).not.toThrow();
  });

  test("extractMaskedRegion returns a boundingBox and does not throw even without a real 2D context", () => {
    const result = extractMaskedRegion(fakeImage, square, "hard");
    expect(result.boundingBox.width).toBeCloseTo(0.4, 5);
    expect(result.boundingBox.height).toBeCloseTo(0.4, 5);
  });

  test("FEATHER_PX is an isolated, positive constant", () => {
    expect(FEATHER_PX).toBeGreaterThan(0);
  });

  test("applyMaskFeathering does not throw when given a real 2d-like context stub", () => {
    const ctxStub = { save: jest.fn(), restore: jest.fn(), fill: jest.fn(), filter: "" };
    const fakePath = {};
    expect(() => applyMaskFeathering(ctxStub, fakePath, FEATHER_PX)).not.toThrow();
    expect(ctxStub.filter).toBe(`blur(${FEATHER_PX}px)`);
    expect(ctxStub.fill).toHaveBeenCalledWith(fakePath);
  });
});
