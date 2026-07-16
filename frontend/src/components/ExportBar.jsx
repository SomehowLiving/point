import { Clipboard, DownloadSimple } from "@phosphor-icons/react";
import { toast } from "sonner";
import { renderExport } from "@/lib/api";
import { writeClipboard, writeRichClipboard } from "@/lib/native";

const formats = ["text", "markdown", "html", "json", "csv"];

export const ExportBar = ({ payload, source }) => {
  const create = async (format) => renderExport({ format, title: "Spatial AI OCR export", source, payload });
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
    } catch (error) {
      toast.error(error.message || "Clipboard access was denied. Download the file instead.");
    }
  };
  const download = async (format) => {
    const file = await create(format); const url = URL.createObjectURL(new Blob([file.content], { type: file.mime_type }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = file.filename; anchor.click(); URL.revokeObjectURL(url); toast.success(`${file.filename} downloaded`);
  };
  return <div className="export-bar" data-testid="structured-export-bar">{formats.map((format)=><div key={format}><span data-testid={`export-${format}-label`}>{format}</span><button onClick={()=>copy(format)} data-testid={`copy-${format}-export-button`} aria-label={`Copy ${format}`}><Clipboard /></button><button onClick={()=>download(format)} data-testid={`download-${format}-export-button`} aria-label={`Download ${format}`}><DownloadSimple /></button></div>)}</div>;
};