import { Clipboard } from "@phosphor-icons/react";
import { toast } from "sonner";
import { extractionToCsv, extractionToJson, extractionToMarkdown, extractionToText } from "@/lib/structuredExtraction";
import { writeClipboard } from "@/lib/native";

const formats = [
  { id: "markdown", label: "Markdown", render: extractionToMarkdown },
  { id: "csv", label: "CSV", render: extractionToCsv },
  { id: "json", label: "JSON", render: extractionToJson },
  { id: "text", label: "Text", render: extractionToText },
];

export const ExtractionResult = ({ parsed }) => {
  const copy = async (format) => {
    try {
      await writeClipboard(format.render(parsed));
      toast.success(`${format.label} copied`);
    } catch (error) {
      toast.error(error.message || "Clipboard access was denied.");
    }
  };
  return (
    <div className="extraction-result" data-testid="extraction-result">
      <div className="extraction-preview">
        {parsed.schema === "table" && (
          <table data-testid="extraction-table">
            <thead><tr>{(parsed.data.columns || []).map((column, index) => <th key={index}>{column}</th>)}</tr></thead>
            <tbody>{(parsed.data.rows || []).map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{String(cell ?? "")}</td>)}</tr>)}</tbody>
          </table>
        )}
        {parsed.schema === "key_value" && (
          <dl data-testid="extraction-key-value">
            {(parsed.data.pairs || []).map((pair, index) => <div key={index}><dt>{pair.key}</dt><dd>{String(pair.value ?? "")}</dd></div>)}
          </dl>
        )}
        {parsed.schema === "contact_list" && (
          <ul data-testid="extraction-contacts">
            {(parsed.data.contacts || []).map((contact, index) => (
              <li key={index}>
                <strong>{contact.name}</strong>
                {[contact.role, contact.email, contact.phone].filter(Boolean).map((detail, detailIndex) => <span key={detailIndex}> · {detail}</span>)}
              </li>
            ))}
          </ul>
        )}
        {parsed.schema === "task_list" && (
          <ul className="extraction-tasks" data-testid="extraction-tasks">
            {(parsed.data.tasks || []).map((task, index) => (
              <li key={index}>
                <input type="checkbox" checked={Boolean(task.done)} readOnly />
                <span>{task.title}</span>
                {[task.assignee, task.due].filter(Boolean).map((detail, detailIndex) => <em key={detailIndex}> {detail}</em>)}
              </li>
            ))}
          </ul>
        )}
        {parsed.schema === "json_object" && <pre data-testid="extraction-json">{JSON.stringify(parsed.data, null, 2)}</pre>}
      </div>
      <div className="extraction-copy-bar" data-testid="extraction-copy-bar">
        {formats.map((format) => (
          <button key={format.id} onClick={() => copy(format)} data-testid={`copy-extraction-${format.id}-button`}>
            <Clipboard />{format.label}
          </button>
        ))}
      </div>
    </div>
  );
};
