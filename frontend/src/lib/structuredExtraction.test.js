import {
  parseExtractionResult,
  extractionToCsv,
  extractionToJson,
  extractionToMarkdown,
  extractionToText,
} from "./structuredExtraction";

describe("parseExtractionResult", () => {
  it("parses a raw JSON object", () => {
    const raw = '{"schema": "key_value", "data": {"pairs": [{"key": "Total", "value": "193.75"}]}}';
    expect(parseExtractionResult(raw)).toEqual({ schema: "key_value", data: { pairs: [{ key: "Total", value: "193.75" }] } });
  });

  it("strips a ```json code fence before parsing", () => {
    const raw = 'Here you go:\n```json\n{"schema": "table", "data": {"columns": ["A"], "rows": [["1"]]}}\n```';
    expect(parseExtractionResult(raw)).toEqual({ schema: "table", data: { columns: ["A"], rows: [["1"]] } });
  });

  it("returns null for malformed JSON instead of throwing", () => {
    expect(parseExtractionResult("not json at all")).toBeNull();
  });

  it("returns null when the schema field is missing or unknown", () => {
    expect(parseExtractionResult('{"data": {}}')).toBeNull();
    expect(parseExtractionResult('{"schema": "unknown_type", "data": {}}')).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(parseExtractionResult("")).toBeNull();
    expect(parseExtractionResult(null)).toBeNull();
  });
});

describe("table rendering", () => {
  const parsed = { schema: "table", data: { columns: ["Name", "Score"], rows: [["Ana", "92"], ["Bo", "81"]] } };

  it("renders a markdown table", () => {
    const markdown = extractionToMarkdown(parsed);
    expect(markdown).toContain("| Name | Score |");
    expect(markdown).toContain("| --- | --- |");
    expect(markdown).toContain("| Ana | 92 |");
  });

  it("renders CSV with header row", () => {
    expect(extractionToCsv(parsed)).toBe("Name,Score\nAna,92\nBo,81");
  });

  it("csv-escapes cells containing commas", () => {
    const withComma = { schema: "table", data: { columns: ["Name"], rows: [["Smith, Jane"]] } };
    expect(extractionToCsv(withComma)).toBe('Name\n"Smith, Jane"');
  });

  it("renders tab-separated plain text", () => {
    expect(extractionToText(parsed)).toBe("Name\tScore\nAna\t92\nBo\t81");
  });

  it("renders JSON as the raw data value", () => {
    expect(JSON.parse(extractionToJson(parsed))).toEqual(parsed.data);
  });
});

describe("key_value rendering", () => {
  const parsed = { schema: "key_value", data: { pairs: [{ key: "Total", value: "193.75" }, { key: "Date", value: "2026-07-13" }] } };

  it("renders markdown bullets", () => {
    expect(extractionToMarkdown(parsed)).toBe("- **Total:** 193.75\n- **Date:** 2026-07-13");
  });

  it("renders CSV with a Key/Value header", () => {
    expect(extractionToCsv(parsed)).toBe("Key,Value\nTotal,193.75\nDate,2026-07-13");
  });
});

describe("contact_list rendering", () => {
  const parsed = {
    schema: "contact_list",
    data: { contacts: [{ name: "Ana Ray", email: "ana@example.com", phone: null, role: "PM" }] },
  };

  it("renders markdown with details after the name", () => {
    expect(extractionToMarkdown(parsed)).toBe("- **Ana Ray** — PM · ana@example.com");
  });

  it("omits null fields from CSV without throwing", () => {
    expect(extractionToCsv(parsed)).toBe("Name,Email,Phone,Role\nAna Ray,ana@example.com,,PM");
  });
});

describe("task_list rendering", () => {
  const parsed = {
    schema: "task_list",
    data: { tasks: [{ title: "Ship feature", done: false, assignee: "Ana", due: "Friday" }, { title: "Write docs", done: true, assignee: null, due: null }] },
  };

  it("renders a markdown checklist", () => {
    const markdown = extractionToMarkdown(parsed);
    expect(markdown).toContain("- [ ] Ship feature (Ana · Friday)");
    expect(markdown).toContain("- [x] Write docs");
  });
});

describe("json_object rendering falls back to pretty JSON", () => {
  const parsed = { schema: "json_object", data: { nested: { a: 1 } } };

  it("wraps markdown in a code fence", () => {
    expect(extractionToMarkdown(parsed)).toBe('```json\n{\n  "nested": {\n    "a": 1\n  }\n}\n```');
  });

  it("text and csv both fall back to pretty JSON", () => {
    expect(extractionToText(parsed)).toBe(JSON.stringify(parsed.data, null, 2));
    expect(extractionToCsv(parsed)).toBe(JSON.stringify(parsed.data, null, 2));
  });
});
