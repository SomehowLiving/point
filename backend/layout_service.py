"""Reconstructs document structure (headings, paragraphs, lists, tables, code)
from flat OCR word boxes, so exports/copies can preserve layout instead of
flattening everything into one blob of text.

This is heuristic by nature -- OCR gives us word boxes, not real DOM/PDF
structure -- so detection leans on geometry (line height, gaps, column
alignment) rather than anything font-aware. It is tuned for typical
screenshot-resolution text and documented as best-effort, not exact.
"""
import html as html_module
import re
import statistics
from itertools import groupby
from typing import Any, Dict, List, Optional

URL_PATTERN = re.compile(r"(https?://\S+|www\.\S+)", re.IGNORECASE)
BULLET_PATTERN = re.compile(r"^[•\-*‣◦▪]\s+")
ORDERED_PATTERN = re.compile(r"^(\d{1,3}|[a-zA-Z])[.)]\s+")
CODE_TOKEN_PATTERN = re.compile(
    r"[{};]|=>|:=|^\s*(def|function|const|let|var|import|class|return|if|for|while|from)\b"
)

HEADING_RATIO_H1 = 1.8
HEADING_RATIO_H2 = 1.4
HEADING_RATIO_H3 = 1.15
HEADING_MAX_LENGTH = 90
PARAGRAPH_GAP_MULTIPLIER = 1.8
TABLE_COLUMN_TOLERANCE_MULTIPLIER = 2.0
TABLE_MIN_COLUMNS = 2
TABLE_MAX_COLUMNS = 8

# Clean copy: common nav/CTA labels short enough to plausibly BE a whole block by themselves
# (an isolated "Login" button, a stacked sidebar menu where each item is its own line). A
# concatenated single-line navbar ("Home About Contact Blog") can't be reliably split back into
# items once OCR words are space-joined into one line -- that's a real, documented limitation,
# not something this heuristic set claims to catch.
NAV_VOCABULARY = {
    "home", "about", "about us", "contact", "contact us", "login", "log in", "sign in", "sign up",
    "register", "menu", "search", "cart", "checkout", "help", "support", "faq", "careers", "blog",
    "news", "terms", "terms of service", "terms of use", "privacy", "privacy policy",
    "cookie policy", "cookies", "subscribe", "newsletter", "follow us", "share", "skip to content",
    "skip to main content", "back to top", "sitemap", "accessibility", "download", "learn more",
    "read more", "close", "menu toggle", "toggle navigation",
}
FOOTER_PATTERN = re.compile(
    r"©|copyright|all rights reserved|powered by|terms of (service|use)|privacy policy",
    re.IGNORECASE,
)
AD_PATTERN = re.compile(r"\bsponsored\b|\badvertisement\b|\bad choices\b|\bpromoted\b", re.IGNORECASE)


ROW_CENTER_TOLERANCE_MULTIPLIER = 0.6


def _group_lines(words: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    # Rows are found by vertical-center clustering, not by trusting the OCR engine's own
    # line/paragraph numbering: Tesseract's sparse-text mode (psm 11) frequently assigns
    # widely-spaced words on the same visual row (e.g. two table columns) to different
    # "lines", which would silently break table detection if we grouped on that instead.
    by_region: Dict[Any, List[Dict[str, Any]]] = {}
    for w in words:
        by_region.setdefault(w.get("region", 0), []).append(w)

    lines = []
    for region, region_words in by_region.items():
        ordered = sorted(region_words, key=lambda w: (w["box"]["y"] + w["box"]["height"] / 2, w["box"]["x"]))
        rows: List[Dict[str, Any]] = []
        for w in ordered:
            center = w["box"]["y"] + w["box"]["height"] / 2
            row = rows[-1] if rows else None
            if row and abs(center - row["center"]) <= max(row["height"], w["box"]["height"]) * ROW_CENTER_TOLERANCE_MULTIPLIER:
                row["words"].append(w)
                row["center"] = (row["center"] * row["count"] + center) / (row["count"] + 1)
                row["height"] = max(row["height"], w["box"]["height"])
                row["count"] += 1
            else:
                rows.append({"center": center, "height": w["box"]["height"], "count": 1, "words": [w]})

        for row in rows:
            row_words = sorted(row["words"], key=lambda w: w["box"]["x"])
            boxes = [w["box"] for w in row_words]
            x0 = min(b["x"] for b in boxes)
            y0 = min(b["y"] for b in boxes)
            x1 = max(b["x"] + b["width"] for b in boxes)
            y1 = max(b["y"] + b["height"] for b in boxes)
            lines.append({
                "text": " ".join(w["text"] for w in row_words),
                "words": row_words,
                "x": x0,
                "y": y0,
                "width": x1 - x0,
                "height": y1 - y0,
                "region": region,
            })
    lines.sort(key=lambda line: (line["region"], line["y"], line["x"]))
    return lines


def _is_list_line(text: str) -> Optional[bool]:
    if BULLET_PATTERN.match(text):
        return False
    if ORDERED_PATTERN.match(text):
        return True
    return None


def _is_code_line(line: Dict[str, Any]) -> bool:
    text = line["text"]
    if not CODE_TOKEN_PATTERN.search(text):
        return False
    return len(text) < 200


def _char_width(line: Dict[str, Any]) -> float:
    widths = [w["box"]["width"] / max(1, len(w["text"])) for w in line["words"] if w["text"]]
    return statistics.median(widths) if widths else 8.0


def _run_char_width(lines: List[Dict[str, Any]]) -> float:
    widths = [w["box"]["width"] / max(1, len(w["text"])) for line in lines for w in line["words"] if w["text"]]
    return statistics.median(widths) if widths else 8.0


def _cluster_columns(lines: List[Dict[str, Any]], tolerance: float) -> Optional[List[float]]:
    starts = sorted({word["box"]["x"] for line in lines for word in line["words"]})
    if not starts:
        return None
    clusters = [starts[0]]
    for value in starts[1:]:
        if value - clusters[-1] > tolerance:
            clusters.append(value)
        # else: falls within the current column's tolerance band
    return clusters


def _assign_column(x: float, clusters: List[float], tolerance: float) -> int:
    best_index, best_distance = 0, float("inf")
    for index, cluster_x in enumerate(clusters):
        distance = abs(x - cluster_x)
        if distance < best_distance:
            best_index, best_distance = index, distance
    return best_index


def _try_table(lines: List[Dict[str, Any]], median_height: float) -> Optional[List[List[str]]]:
    # Column tolerance is deliberately tight (glyph-width scale, not line-height scale):
    # left-aligned paragraph text also repeats an x=0 start on every line, so a generous
    # tolerance clusters unrelated word positions into false "columns". Real table columns
    # line up within a couple of characters; wrapped prose does not.
    if len(lines) < 2:
        return None
    tolerance = max(_run_char_width(lines) * TABLE_COLUMN_TOLERANCE_MULTIPLIER, 8)
    clusters = _cluster_columns(lines, tolerance)
    if not clusters or not (TABLE_MIN_COLUMNS <= len(clusters) <= TABLE_MAX_COLUMNS):
        return None
    rows = []
    for line in lines:
        row = [""] * len(clusters)
        for word in line["words"]:
            column = _assign_column(word["box"]["x"], clusters, tolerance)
            row[column] = f"{row[column]} {word['text']}".strip()
        if "" in row:
            return None
        rows.append(row)
    return rows


def _has_wide_gap(line: Dict[str, Any]) -> bool:
    # A table row has a big blank stretch between columns; wrapped prose has fairly uniform
    # inter-word spacing even when it's long. This is what tells "Name    Score" (a row)
    # apart from "This is body text..." (a paragraph) -- word count alone can't.
    words = line["words"]
    if len(words) < 2:
        return False
    ordered = sorted(words, key=lambda w: w["box"]["x"])
    gaps = [ordered[i + 1]["box"]["x"] - (ordered[i]["box"]["x"] + ordered[i]["box"]["width"]) for i in range(len(ordered) - 1)]
    gaps = [gap for gap in gaps if gap > 0]
    if not gaps:
        return False
    if len(gaps) == 1:
        return gaps[0] > max(line["height"] * 3, 40)
    return max(gaps) > max(statistics.median(gaps) * 3, line["height"] * 3)


def _classify_line(line: Dict[str, Any]):
    list_flag = _is_list_line(line["text"])
    if list_flag is not None:
        return ("list", list_flag)
    if _is_code_line(line):
        return ("code", None)
    if len(line["words"]) >= 2 and _has_wide_gap(line):
        return ("row", None)
    return ("plain", None)


def analyze_layout(words: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Group OCR words into structural blocks: heading/paragraph/list/code/table."""
    lines = _group_lines(words)
    if not lines:
        return []

    blocks: List[Dict[str, Any]] = []
    for _, region_lines_iter in groupby(lines, key=lambda line: line["region"]):
        region_lines = list(region_lines_iter)
        count = len(region_lines)
        gaps = [max(0.0, region_lines[i + 1]["y"] - (region_lines[i]["y"] + region_lines[i]["height"])) for i in range(count - 1)]
        positive_gaps = [gap for gap in gaps if gap > 0]
        labels = [_classify_line(line) for line in region_lines]

        # The heading baseline is the "normal body text" size for this region. Table rows and
        # list bullets are often a different (usually smaller) size than prose and would skew a
        # region-wide median, so they're excluded when they can be -- fall back to everything if
        # the whole region turns out to be non-prose.
        plain_heights = [region_lines[i]["height"] for i in range(count) if labels[i][0] == "plain" and region_lines[i]["height"] > 0]
        all_heights = [line["height"] for line in region_lines if line["height"] > 0]
        median_height = statistics.median(plain_heights or all_heights) if (plain_heights or all_heights) else 12
        median_gap = statistics.median(positive_gaps) if positive_gaps else median_height * 0.5

        index = 0
        while index < count:
            label, meta = labels[index]

            if label == "list":
                cursor = index + 1
                while cursor < count and labels[cursor] == ("list", meta):
                    cursor += 1
                items = [
                    ORDERED_PATTERN.sub("", BULLET_PATTERN.sub("", region_lines[i]["text"]))
                    for i in range(index, cursor)
                ]
                blocks.append({"type": "list", "ordered": bool(meta), "items": items})
                index = cursor
                continue

            if label == "code":
                cursor = index + 1
                while cursor < count and labels[cursor][0] == "code":
                    cursor += 1
                run_lines = region_lines[index:cursor]
                base_x = min(line["x"] for line in run_lines)
                unit = _char_width(run_lines[0])
                code_lines = [
                    f"{' ' * (max(0, round((line['x'] - base_x) / unit)) if unit else 0)}{line['text']}"
                    for line in run_lines
                ]
                blocks.append({"type": "code", "lines": code_lines})
                index = cursor
                continue

            if label == "row":
                cursor = index + 1
                while cursor < count and labels[cursor][0] == "row":
                    cursor += 1
                run_lines = region_lines[index:cursor]
                table = _try_table(run_lines, median_height) if len(run_lines) >= 2 else None
                if table:
                    blocks.append({"type": "table", "rows": table})
                else:
                    for run_line in run_lines:
                        blocks.append({"type": "paragraph", "text": run_line["text"]})
                index = cursor
                continue

            # label == "plain"
            line = region_lines[index]
            next_line = region_lines[index + 1] if index + 1 < count else None
            ratio_to_median = line["height"] / median_height if median_height else 1
            ratio_to_next = (line["height"] / next_line["height"]) if next_line and next_line["height"] else ratio_to_median
            # A line can look "heading-tall" against the document median yet sit right next to a
            # similarly-sized line (short capture, noisy median) -- also treat a sharp height drop
            # to the very next line as its own heading signal, since that's what actually reads as
            # a heading regardless of how generous the gap below it is.
            ratio = max(ratio_to_median, ratio_to_next)
            gap_before_next = gaps[index] if index < len(gaps) else 0
            next_breaks = (
                next_line is None
                or ratio_to_next >= HEADING_RATIO_H2
                or gap_before_next > max(median_gap * PARAGRAPH_GAP_MULTIPLIER, line["height"] * 0.6)
            )
            if len(line["text"]) <= HEADING_MAX_LENGTH and ratio >= HEADING_RATIO_H3 and next_breaks:
                level = 1 if ratio >= HEADING_RATIO_H1 else 2 if ratio >= HEADING_RATIO_H2 else 3
                blocks.append({"type": "heading", "level": level, "text": line["text"]})
                index += 1
                continue

            run_lines = [line]
            cursor = index + 1
            while cursor < count and labels[cursor][0] == "plain":
                gap = gaps[cursor - 1] if cursor - 1 < len(gaps) else 0
                threshold = max(median_gap * PARAGRAPH_GAP_MULTIPLIER, region_lines[cursor - 1]["height"] * 0.6)
                if gap > threshold:
                    break
                run_lines.append(region_lines[cursor])
                cursor += 1
            blocks.append({"type": "paragraph", "text": " ".join(l["text"] for l in run_lines)})
            index = cursor

    return blocks


def _looks_like_nav_label(text: str) -> bool:
    return text.strip().lower().rstrip(".!") in NAV_VOCABULARY


def _boilerplate_reason(block: Dict[str, Any]) -> Optional[str]:
    if block["type"] == "list":
        items = block.get("items", [])
        if items and all(_looks_like_nav_label(item) for item in items):
            return "navigation list"
        return None
    if block["type"] == "paragraph":
        text = block.get("text", "")
        if _looks_like_nav_label(text):
            return "navigation label"
        if FOOTER_PATTERN.search(text):
            return "footer/copyright text"
        if AD_PATTERN.search(text):
            return "advertisement label"
        return None
    return None


def clean_blocks(blocks: List[Dict[str, Any]]) -> Any:
    """Filters likely navigation/footer/ad boilerplate and exact-duplicate blocks out of an
    analyze_layout() result. Returns (kept_blocks, removed_blocks) -- removed blocks are reported,
    never silently dropped, so a caller can show what was taken out.

    This is textual pattern-matching over a single capture, not the full "clean copy" spec: it
    has no cross-capture history to spot "repeated headers" across pages, and no visual signal to
    spot an actual watermark image -- both would need capabilities this OCR-based pipeline doesn't
    have. It catches common nav/footer/ad text patterns and same-capture exact duplicates.
    """
    kept: List[Dict[str, Any]] = []
    removed: List[Dict[str, Any]] = []
    seen_text = set()
    for block in blocks:
        reason = _boilerplate_reason(block)
        if reason:
            removed.append({**block, "removed_reason": reason})
            continue
        signature = block.get("text") if block["type"] in {"paragraph", "heading"} else None
        if signature is not None:
            if signature in seen_text:
                removed.append({**block, "removed_reason": "duplicate content"})
                continue
            seen_text.add(signature)
        kept.append(block)
    return kept, removed


def linkify_markdown(text: str) -> str:
    return URL_PATTERN.sub(lambda match: f"<{match.group(0)}>", text)


def linkify_html(text: str) -> str:
    escaped = html_module.escape(text)

    def replace(match: "re.Match[str]") -> str:
        url = html_module.escape(match.group(0))
        return f'<a href="{url}">{url}</a>'

    return URL_PATTERN.sub(replace, escaped)


def blocks_to_markdown(blocks: List[Dict[str, Any]]) -> str:
    parts = []
    for block in blocks:
        if block["type"] == "heading":
            parts.append(f"{'#' * block['level']} {linkify_markdown(block['text'])}")
        elif block["type"] == "paragraph":
            parts.append(linkify_markdown(block["text"]))
        elif block["type"] == "list":
            lines = [
                f"{index + 1}. {linkify_markdown(item)}" if block["ordered"] else f"- {linkify_markdown(item)}"
                for index, item in enumerate(block["items"])
            ]
            parts.append("\n".join(lines))
        elif block["type"] == "code":
            parts.append("```\n" + "\n".join(block["lines"]) + "\n```")
        elif block["type"] == "table":
            rows = block["rows"]
            if not rows:
                continue
            def escape_cell(cell: str) -> str:
                return cell.replace("|", "\\|")
            header = "| " + " | ".join(escape_cell(cell) for cell in rows[0]) + " |"
            separator = "| " + " | ".join("---" for _ in rows[0]) + " |"
            body = "\n".join("| " + " | ".join(escape_cell(cell) for cell in row) + " |" for row in rows[1:])
            parts.append("\n".join([header, separator, body]) if body else "\n".join([header, separator]))
    return "\n\n".join(parts)


def blocks_to_text(blocks: List[Dict[str, Any]]) -> str:
    parts = []
    for block in blocks:
        if block["type"] == "heading":
            parts.append(block["text"])
        elif block["type"] == "paragraph":
            parts.append(block["text"])
        elif block["type"] == "list":
            lines = [
                f"{index + 1}. {item}" if block["ordered"] else f"- {item}"
                for index, item in enumerate(block["items"])
            ]
            parts.append("\n".join(lines))
        elif block["type"] == "code":
            parts.append("\n".join(block["lines"]))
        elif block["type"] == "table":
            rows = block["rows"]
            if not rows:
                continue
            widths = [max(len(row[column]) for row in rows) for column in range(len(rows[0]))]
            parts.append("\n".join(
                "  ".join(cell.ljust(widths[index]) for index, cell in enumerate(row)) for row in rows
            ))
    return "\n\n".join(parts)


def blocks_to_html(blocks: List[Dict[str, Any]]) -> str:
    parts = []
    for block in blocks:
        if block["type"] == "heading":
            level = min(6, max(1, block["level"]))
            parts.append(f"<h{level}>{linkify_html(block['text'])}</h{level}>")
        elif block["type"] == "paragraph":
            parts.append(f"<p>{linkify_html(block['text'])}</p>")
        elif block["type"] == "list":
            tag = "ol" if block["ordered"] else "ul"
            items = "".join(f"<li>{linkify_html(item)}</li>" for item in block["items"])
            parts.append(f"<{tag}>{items}</{tag}>")
        elif block["type"] == "code":
            code_text = html_module.escape("\n".join(block["lines"]))
            parts.append(f"<pre><code>{code_text}</code></pre>")
        elif block["type"] == "table":
            rows = block["rows"]
            if not rows:
                continue
            header_cells = "".join(f"<th>{html_module.escape(cell)}</th>" for cell in rows[0])
            body_rows = "".join(
                "<tr>" + "".join(f"<td>{html_module.escape(cell)}</td>" for cell in row) + "</tr>"
                for row in rows[1:]
            )
            parts.append(f"<table><thead><tr>{header_cells}</tr></thead><tbody>{body_rows}</tbody></table>")
    return "\n".join(parts)
