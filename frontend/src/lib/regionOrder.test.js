import { deriveRegionOrder, orderedRegions, reorderBefore } from "./regionOrder";

const regions = [
  { id: "a", label: "Region A" },
  { id: "b", label: "Region B" },
  { id: "c", label: "Region C" },
];

describe("deriveRegionOrder", () => {
  test("backward compatibility: no explicit order yet -> falls back to existing array order", () => {
    expect(deriveRegionOrder(regions, [])).toEqual(["a", "b", "c"]);
    expect(deriveRegionOrder(regions, undefined)).toEqual(["a", "b", "c"]);
  });

  test("honors an explicit valid order", () => {
    expect(deriveRegionOrder(regions, ["c", "a", "b"])).toEqual(["c", "a", "b"]);
  });

  test("a newly added region (not yet in regionOrder) is appended at the end", () => {
    const withNew = [...regions, { id: "d", label: "Mask 1" }];
    expect(deriveRegionOrder(withNew, ["b", "a", "c"])).toEqual(["b", "a", "c", "d"]);
  });

  test("a deleted region's id is dropped from the order automatically", () => {
    const withoutB = regions.filter((r) => r.id !== "b");
    expect(deriveRegionOrder(withoutB, ["c", "b", "a"])).toEqual(["c", "a"]);
  });

  test("stale ids from a since-deleted region never resurrect a region", () => {
    expect(deriveRegionOrder(regions, ["x", "a", "y", "b", "c"])).toEqual(["a", "b", "c"]);
  });
});

describe("orderedRegions", () => {
  test("returns full region objects in derived order", () => {
    expect(orderedRegions(regions, ["c", "a", "b"]).map((r) => r.id)).toEqual(["c", "a", "b"]);
    expect(orderedRegions(regions, ["c", "a", "b"])[0].label).toBe("Region C");
  });
});

describe("reorderBefore (drag-and-drop / keyboard reorder)", () => {
  test("moves a region before another, stable ids unchanged", () => {
    const next = reorderBefore(regions, ["a", "b", "c"], "c", "a");
    expect(next).toEqual(["c", "a", "b"]);
  });

  test("moving to the end when beforeId is omitted", () => {
    const next = reorderBefore(regions, ["a", "b", "c"], "a", null);
    expect(next).toEqual(["b", "c", "a"]);
  });

  test("no-op-ish move (before its own next neighbor) is stable", () => {
    const next = reorderBefore(regions, ["a", "b", "c"], "a", "b");
    expect(next).toEqual(["a", "b", "c"]);
  });

  test("works even when regionOrder was never explicitly set yet", () => {
    const next = reorderBefore(regions, [], "c", "a");
    expect(next).toEqual(["c", "a", "b"]);
  });
});
