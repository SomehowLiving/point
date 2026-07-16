// Parses and renders the AI's "extract" action output, which the backend prompt (see
// server.py's EXTRACT_SCHEMA_SHAPES) asks the model to return as one consistent wire shape:
// {"schema": "table"|"key_value"|"contact_list"|"task_list"|"json_object", "data": {...}}
// regardless of which schema the user picked (or "auto" chose). Models don't always obey
// formatting instructions perfectly, so parsing is defensive and callers must treat a null
// result as "fall back to showing the raw text" rather than as an error.

const KNOWN_SCHEMAS = ["table", "key_value", "contact_list", "task_list", "json_object"];

export function parseExtractionResult(rawText) {
  if (!rawText || !rawText.trim()) return null;
  const fenced = rawText.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : rawText).trim();
  let parsed;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || !KNOWN_SCHEMAS.includes(parsed.schema) || parsed.data === undefined) {
    return null;
  }
  return { schema: parsed.schema, data: parsed.data };
}

function escapeCsvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function rowsToCsv(rows) {
  return rows.map((row) => row.map(escapeCsvCell).join(",")).join("\n");
}

function extractionRows(parsed) {
  switch (parsed.schema) {
    case "table":
      return [parsed.data.columns || [], ...(parsed.data.rows || [])];
    case "key_value":
      return [["Key", "Value"], ...(parsed.data.pairs || []).map((pair) => [pair.key, pair.value])];
    case "contact_list":
      return [
        ["Name", "Email", "Phone", "Role"],
        ...(parsed.data.contacts || []).map((c) => [c.name, c.email, c.phone, c.role]),
      ];
    case "task_list":
      return [
        ["Task", "Done", "Assignee", "Due"],
        ...(parsed.data.tasks || []).map((t) => [t.title, t.done ? "yes" : "no", t.assignee, t.due]),
      ];
    default:
      return null;
  }
}

export function extractionToCsv(parsed) {
  const rows = extractionRows(parsed);
  if (!rows) return JSON.stringify(parsed.data, null, 2);
  return rowsToCsv(rows);
}

export function extractionToJson(parsed) {
  return JSON.stringify(parsed.data, null, 2);
}

export function extractionToMarkdown(parsed) {
  switch (parsed.schema) {
    case "table": {
      const { columns = [], rows = [] } = parsed.data;
      if (!columns.length) return "";
      const header = `| ${columns.join(" | ")} |`;
      const divider = `| ${columns.map(() => "---").join(" | ")} |`;
      const body = rows.map((row) => `| ${row.map((cell) => String(cell ?? "")).join(" | ")} |`).join("\n");
      return [header, divider, body].filter(Boolean).join("\n");
    }
    case "key_value":
      return (parsed.data.pairs || []).map((pair) => `- **${pair.key}:** ${pair.value}`).join("\n");
    case "contact_list":
      return (parsed.data.contacts || [])
        .map((c) => {
          const details = [c.role, c.email, c.phone].filter(Boolean).join(" · ");
          return `- **${c.name}**${details ? ` — ${details}` : ""}`;
        })
        .join("\n");
    case "task_list":
      return (parsed.data.tasks || [])
        .map((t) => {
          const meta = [t.assignee, t.due].filter(Boolean).join(" · ");
          return `- [${t.done ? "x" : " "}] ${t.title}${meta ? ` (${meta})` : ""}`;
        })
        .join("\n");
    default:
      return "```json\n" + JSON.stringify(parsed.data, null, 2) + "\n```";
  }
}

export function extractionToText(parsed) {
  switch (parsed.schema) {
    case "table": {
      const { columns = [], rows = [] } = parsed.data;
      return [columns.join("\t"), ...rows.map((row) => row.map((cell) => String(cell ?? "")).join("\t"))].join("\n");
    }
    case "key_value":
      return (parsed.data.pairs || []).map((pair) => `${pair.key}: ${pair.value}`).join("\n");
    case "contact_list":
      return (parsed.data.contacts || [])
        .map((c) => [c.name, c.role, c.email, c.phone].filter(Boolean).join(" — "))
        .join("\n");
    case "task_list":
      return (parsed.data.tasks || [])
        .map((t) => `${t.done ? "[done]" : "[ ]"} ${t.title}${t.assignee ? ` — ${t.assignee}` : ""}${t.due ? ` (due ${t.due})` : ""}`)
        .join("\n");
    default:
      return JSON.stringify(parsed.data, null, 2);
  }
}
