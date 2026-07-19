import { useState } from "react";
import { Clipboard, DownloadSimple } from "@phosphor-icons/react";
import { toast } from "sonner";
import { renderExport } from "@/lib/api";
import { writeClipboard, writeRichClipboard } from "@/lib/native";

const formats = ["text", "markdown", "html", "json", "csv"];

export const ExportBar = ({ payload, source }) => {
  const [clean, setClean] = useState(false);
  const create = async (format) => renderExport({ format, title: "Spatial AI OCR export", source, payload, clean });
  const notifyCleaned = (file) => {
    if (clean && file.cleaned_count > 0) toast.message(`Removed ${file.cleaned_count} likely boilerplate block${file.cleaned_count === 1 ? "" : "s"}`);
  };
  const copy = async (format) => {
    try {
      const file = await create(format);
      if (format === "html") {
        const plainFile = await create("text");
        await writeRichClipboard(file.content, plainFile.content);
      } else {
        await writeClipboard(file.content);
      }
      toast.success(`${format.toUpperCase()} copied`);
      notifyCleaned(file);
    } catch (error) {
      toast.error(error.message || "Clipboard access was denied. Download the file instead.");
    }
  };
  const download = async (format) => {
    const file = await create(format); const url = URL.createObjectURL(new Blob([file.content], { type: file.mime_type }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = file.filename; anchor.click(); URL.revokeObjectURL(url); toast.success(`${file.filename} downloaded`);
    notifyCleaned(file);
  };
  return (
    <div className="export-bar" data-testid="structured-export-bar">
      <label className="clean-copy-toggle" data-testid="clean-copy-toggle">
        <input type="checkbox" checked={clean} onChange={(event) => setClean(event.target.checked)} data-testid="clean-copy-checkbox" />
        <span>Clean copy (remove nav/footer/ad text)</span>
      </label>
      {formats.map((format) => (
        <div key={format}>
          <span data-testid={`export-${format}-label`}>{format}</span>
          <button onClick={() => copy(format)} data-testid={`copy-${format}-export-button`} aria-label={`Copy ${format}`}><Clipboard /></button>
          <button onClick={() => download(format)} data-testid={`download-${format}-export-button`} aria-label={`Download ${format}`}><DownloadSimple /></button>
        </div>
      ))}
    </div>
  );
};