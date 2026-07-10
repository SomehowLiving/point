import csv
import io
import json
from typing import Any, Dict


MIME_TYPES = {
    "text": "text/plain;charset=utf-8",
    "markdown": "text/markdown;charset=utf-8",
    "json": "application/json",
    "csv": "text/csv;charset=utf-8",
}


def render_export(payload: Dict[str, Any], export_format: str, title: str, source: Dict[str, Any]) -> Dict[str, str]:
    safe_title = "".join(character if character.isalnum() or character in "-_" else "-" for character in title.lower()).strip("-") or "spatial-capture"
    if export_format == "text":
        content = payload.get("text", "")
        extension = "txt"
    elif export_format == "markdown":
        source_line = source.get("url") or source.get("window_title") or source.get("application", "")
        content = f"# {title}\n\n{payload.get('text', '')}\n\n---\nSource: {source_line}\n"
        extension = "md"
    elif export_format == "json":
        content = json.dumps({"title": title, "source": source, "ocr": payload}, ensure_ascii=False, indent=2)
        extension = "json"
    elif export_format == "csv":
        stream = io.StringIO()
        writer = csv.DictWriter(stream, fieldnames=["region", "text", "confidence", "x", "y", "width", "height"])
        writer.writeheader()
        for word in payload.get("words", []):
            box = word.get("box", {})
            writer.writerow({"region": word.get("region", 0), "text": word.get("text", ""), "confidence": word.get("confidence", 0), **box})
        content = stream.getvalue()
        extension = "csv"
    else:
        raise ValueError("Unsupported export format")
    return {"content": content, "mime_type": MIME_TYPES[export_format], "filename": f"{safe_title}.{extension}"}