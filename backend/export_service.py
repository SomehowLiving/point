import csv
import io
import json
from typing import Any, Dict

from layout_service import analyze_layout, blocks_to_html, blocks_to_markdown, blocks_to_text

MIME_TYPES = {
    "text": "text/plain;charset=utf-8",
    "markdown": "text/markdown;charset=utf-8",
    "json": "application/json",
    "csv": "text/csv;charset=utf-8",
    "html": "text/html;charset=utf-8",
}


def _source_line(source: Dict[str, Any]) -> str:
    return source.get("url") or source.get("window_title") or source.get("application", "")


def render_export(payload: Dict[str, Any], export_format: str, title: str, source: Dict[str, Any]) -> Dict[str, str]:
    safe_title = "".join(character if character.isalnum() or character in "-_" else "-" for character in title.lower()).strip("-") or "spatial-capture"
    blocks = analyze_layout(payload.get("words", []))
    source_line = _source_line(source)

    if export_format == "text":
        body = blocks_to_text(blocks) if blocks else payload.get("text", "")
        content = f"{body}\n\n---\nSource: {source_line}\n" if source_line else body
        extension = "txt"
    elif export_format == "markdown":
        body = blocks_to_markdown(blocks) if blocks else payload.get("text", "")
        content = f"# {title}\n\n{body}\n\n---\nSource: {source_line}\n"
        extension = "md"
    elif export_format == "html":
        import html as html_module

        body = blocks_to_html(blocks) if blocks else f"<p>{html_module.escape(payload.get('text', ''))}</p>"
        footer = f'<footer>Source: <a href="{html_module.escape(source_line)}">{html_module.escape(source_line)}</a></footer>' if source_line else ""
        content = f"<article><h1>{html_module.escape(title)}</h1>\n{body}\n{footer}</article>"
        extension = "html"
    elif export_format == "json":
        content = json.dumps({"title": title, "source": source, "ocr": payload, "structure": blocks}, ensure_ascii=False, indent=2)
        extension = "json"
    elif export_format == "csv":
        table_block = next((block for block in blocks if block["type"] == "table"), None)
        stream = io.StringIO()
        if table_block:
            writer = csv.writer(stream)
            writer.writerows(table_block["rows"])
        else:
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
