import { computeOcrKey } from "./ocrCache";

const region = (id, x = 0.1, y = 0.1, width = 0.2, height = 0.2) => ({ id, x, y, width, height });
const redaction = (points) => ({ type: "redaction", points });

describe("computeOcrKey", () => {
  it("returns null when there is no image", () => {
    expect(computeOcrKey(null, [], [])).toBeNull();
    expect(computeOcrKey("", [], [])).toBeNull();
  });

  it("returns the same key for the same image/regions/annotations", () => {
    const regions = [region("r1")];
    const annotations = [redaction([{ x: 0.1, y: 0.1 }])];
    expect(computeOcrKey("data:image/png;base64,AAA", regions, annotations)).toBe(
      computeOcrKey("data:image/png;base64,AAA", regions, annotations)
    );
  });

  it("changes when the image changes", () => {
    const keyA = computeOcrKey("data:image/png;base64,AAA", [], []);
    const keyB = computeOcrKey("data:image/png;base64,BBB", [], []);
    expect(keyA).not.toBe(keyB);
  });

  it("changes when regions change", () => {
    const image = "data:image/png;base64,AAA";
    const keyA = computeOcrKey(image, [region("r1")], []);
    const keyB = computeOcrKey(image, [region("r1"), region("r2")], []);
    const keyC = computeOcrKey(image, [region("r1", 0.5, 0.5, 0.1, 0.1)], []);
    expect(keyA).not.toBe(keyB);
    expect(keyA).not.toBe(keyC);
  });

  it("changes when a redaction is added, moved, or removed", () => {
    const image = "data:image/png;base64,AAA";
    const noRedaction = computeOcrKey(image, [], []);
    const oneRedaction = computeOcrKey(image, [], [redaction([{ x: 0.1, y: 0.1 }])]);
    const movedRedaction = computeOcrKey(image, [], [redaction([{ x: 0.2, y: 0.2 }])]);
    expect(noRedaction).not.toBe(oneRedaction);
    expect(oneRedaction).not.toBe(movedRedaction);
  });

  it("ignores non-redaction annotations (they don't change the OCR'd pixels)", () => {
    const image = "data:image/png;base64,AAA";
    const withFreehand = computeOcrKey(image, [], [{ type: "freehand", points: [{ x: 0.1, y: 0.1 }] }]);
    const withoutAny = computeOcrKey(image, [], []);
    expect(withFreehand).toBe(withoutAny);
  });
});
