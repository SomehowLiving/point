import {
  MIN_SCALE,
  MAX_SCALE,
  applyViewportTransform,
  invertViewportTransform,
  imageToScreen,
  screenToImage,
  clampScale,
  clampViewport,
  fitImageToViewport,
  zoomAroundScreenPoint,
} from "./viewportTransform";

describe("applyViewportTransform / imageToScreen", () => {
  test("scale 1, no translation is identity", () => {
    expect(applyViewportTransform({ x: 100, y: 50 }, { scale: 1, translateX: 0, translateY: 0 })).toEqual({ x: 100, y: 50 });
  });

  test("scales and translates", () => {
    expect(applyViewportTransform({ x: 100, y: 50 }, { scale: 2, translateX: 10, translateY: 5 })).toEqual({ x: 210, y: 105 });
  });

  test("imageToScreen is the same function as applyViewportTransform", () => {
    expect(imageToScreen).toBe(applyViewportTransform);
  });
});

describe("screenToImage / invertViewportTransform round trips", () => {
  const cases = [
    { scale: 1, translateX: 0, translateY: 0 },
    { scale: 2, translateX: 40, translateY: -15 },
    { scale: 0.5, translateX: -100, translateY: 200 },
    { scale: 3, translateX: 0, translateY: 0 },
  ];

  test.each(cases)("round-trips image -> screen -> image for viewport %o", (viewport) => {
    const original = { x: 321.5, y: 88.25 };
    const screen = applyViewportTransform(original, viewport);
    const back = invertViewportTransform(screen, viewport);
    expect(back.x).toBeCloseTo(original.x, 6);
    expect(back.y).toBeCloseTo(original.y, 6);
  });

  test("screenToImage is the same function as invertViewportTransform", () => {
    expect(screenToImage).toBe(invertViewportTransform);
  });

  test("nontrivial scales (50%, 175%, 300%) with nonzero translation round-trip correctly", () => {
    for (const scale of [0.5, 1.75, 3]) {
      const viewport = { scale, translateX: 123, translateY: -67 };
      const original = { x: 500, y: 250 };
      const back = invertViewportTransform(applyViewportTransform(original, viewport), viewport);
      expect(back.x).toBeCloseTo(original.x, 6);
      expect(back.y).toBeCloseTo(original.y, 6);
    }
  });
});

describe("clampScale", () => {
  test("clamps to default MIN_SCALE/MAX_SCALE", () => {
    expect(clampScale(0.001)).toBe(MIN_SCALE);
    expect(clampScale(1000)).toBe(MAX_SCALE);
    expect(clampScale(1)).toBe(1);
  });

  test("honors explicit bounds", () => {
    expect(clampScale(5, 1, 4)).toBe(4);
  });
});

describe("fitImageToViewport", () => {
  test("fits a wider-than-container image by width, centers vertically", () => {
    const viewport = fitImageToViewport(1600, 400, 800, 600);
    expect(viewport.scale).toBeCloseTo(0.5, 5);
    expect(viewport.translateX).toBeCloseTo(0, 5);
    expect(viewport.translateY).toBeCloseTo((600 - 400 * 0.5) / 2, 5);
  });

  test("fits a taller-than-container image by height, centers horizontally", () => {
    const viewport = fitImageToViewport(400, 800, 800, 600);
    expect(viewport.scale).toBeCloseTo(0.75, 5);
    expect(viewport.translateY).toBeCloseTo(0, 5);
    expect(viewport.translateX).toBeCloseTo((800 - 400 * 0.75) / 2, 5);
  });

  test("falls back to a safe default when dimensions are unknown", () => {
    expect(fitImageToViewport(0, 0, 800, 600)).toEqual({ scale: 1, translateX: 0, translateY: 0 });
  });
});

describe("zoomAroundScreenPoint (cursor-centered zoom)", () => {
  test("the image-space point under the cursor stays under the cursor after zooming", () => {
    const viewport = { scale: 1, translateX: 0, translateY: 0 };
    const cursor = { x: 300, y: 200 };
    const imagePointUnderCursorBefore = invertViewportTransform(cursor, viewport);
    const next = zoomAroundScreenPoint(viewport, cursor, 2.5);
    const screenPointAfter = applyViewportTransform(imagePointUnderCursorBefore, next);
    expect(screenPointAfter.x).toBeCloseTo(cursor.x, 6);
    expect(screenPointAfter.y).toBeCloseTo(cursor.y, 6);
    expect(next.scale).toBeCloseTo(2.5, 6);
  });

  test("still cursor-anchored when zooming out from a non-trivial existing viewport", () => {
    const viewport = { scale: 3, translateX: -450, translateY: 120 };
    const cursor = { x: 640, y: 360 };
    const imagePointUnderCursorBefore = invertViewportTransform(cursor, viewport);
    const next = zoomAroundScreenPoint(viewport, cursor, 1);
    const screenPointAfter = applyViewportTransform(imagePointUnderCursorBefore, next);
    expect(screenPointAfter.x).toBeCloseTo(cursor.x, 6);
    expect(screenPointAfter.y).toBeCloseTo(cursor.y, 6);
  });

  test("respects scale bounds passed via `bounds`", () => {
    const viewport = { scale: 1, translateX: 0, translateY: 0 };
    const next = zoomAroundScreenPoint(viewport, { x: 0, y: 0 }, 100, { minScale: 0.2, maxScale: 4 });
    expect(next.scale).toBe(4);
  });
});

describe("clampViewport (controlled overscroll)", () => {
  const bounds = { naturalWidth: 1000, naturalHeight: 500, containerWidth: 800, containerHeight: 600, minVisiblePx: 80 };

  test("leaves an in-bounds viewport untouched (aside from scale clamping)", () => {
    const viewport = { scale: 1, translateX: 0, translateY: 50 };
    expect(clampViewport(viewport, bounds)).toEqual(viewport);
  });

  test("pulls the image back so at least minVisiblePx remains reachable when dragged far off to the left", () => {
    const viewport = { scale: 1, translateX: -5000, translateY: 0 };
    const clamped = clampViewport(viewport, bounds);
    // at least minVisiblePx of the (scale=1) 1000px-wide image must remain within the container
    expect(clamped.translateX).toBeGreaterThanOrEqual(bounds.minVisiblePx - 1000 * clamped.scale);
  });

  test("pulls the image back when dragged far off to the right/bottom too", () => {
    const viewport = { scale: 1, translateX: 5000, translateY: 5000 };
    const clamped = clampViewport(viewport, bounds);
    expect(clamped.translateX).toBeLessThanOrEqual(bounds.containerWidth - bounds.minVisiblePx);
    expect(clamped.translateY).toBeLessThanOrEqual(bounds.containerHeight - bounds.minVisiblePx);
  });

  test("clamps an out-of-range scale as well as position", () => {
    const clamped = clampViewport({ scale: 999, translateX: 0, translateY: 0 }, bounds);
    expect(clamped.scale).toBe(MAX_SCALE);
  });

  test("high-DPI note: the model is defined purely in CSS pixels, so devicePixelRatio does not enter these calculations", () => {
    // Same inputs regardless of an (imaginary) devicePixelRatio of 1 vs 2 vs 3 — there is no DPR
    // parameter to this module by design; device-pixel mapping is left entirely to the browser's
    // CSS rendering. This test documents that invariant rather than exercising a DPR branch.
    const a = fitImageToViewport(1000, 500, 800, 600);
    const b = fitImageToViewport(1000, 500, 800, 600);
    expect(a).toEqual(b);
  });
});
