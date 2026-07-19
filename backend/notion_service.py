"""Sends captured content to Notion via Notion's official API (an integration token the user
creates once in their own Notion settings -- no OAuth app registration, no browser automation,
no cookies). See README 10.1 "Share or send".

Pure parsing/formatting helpers live here so they're unit-testable without a live Notion
account; the actual HTTP call is a thin wrapper in server.py, consistent with how search_web
calls out to SearXNG there.
"""
import re
from typing import Any, Dict, List, Optional

NOTION_ID_PATTERN = re.compile(r"([0-9a-f]{32})", re.IGNORECASE)
NOTION_API_VERSION = "2022-06-28"
MAX_BLOCK_TEXT_LENGTH = 2000  # Notion's own per-rich-text-block character limit


def parse_notion_page_id(raw: str) -> Optional[str]:
    """Extracts a Notion page/database ID from a pasted URL or raw ID, normalized to 8-4-4-4-12
    UUID form. Notion's API accepts IDs with or without dashes, but normalizing avoids surprises.
    Returns None if no 32-hex-character ID is found anywhere in the input.
    """
    match = NOTION_ID_PATTERN.search(raw.replace("-", ""))
    if not match:
        return None
    hex_id = match.group(1).lower()
    return f"{hex_id[0:8]}-{hex_id[8:12]}-{hex_id[12:16]}-{hex_id[16:20]}-{hex_id[20:32]}"


def _text_run(content: str, url: Optional[str] = None) -> Dict[str, Any]:
    text: Dict[str, Any] = {"content": content[:MAX_BLOCK_TEXT_LENGTH]}
    if url:
        text["link"] = {"url": url}
    return {"type": "text", "text": text}


def _paragraph_block(*runs: Dict[str, Any]) -> Dict[str, Any]:
    return {"object": "block", "type": "paragraph", "paragraph": {"rich_text": list(runs)}}


def build_notion_blocks(content: str, source_url: str = "") -> List[Dict[str, Any]]:
    """Splits plain-text content into one paragraph block per blank-line-separated chunk, plus
    a trailing source-link block when a source URL is available.

    Deliberately simple: rich structure (headings/lists/tables) is what the OCR-based smart-copy
    pipeline (layout_service.py) already reconstructs from word boxes -- an AI text *answer* has
    no such layout to re-derive, so this just needs to land readable paragraphs in Notion.
    """
    paragraphs = [chunk.strip() for chunk in content.split("\n\n") if chunk.strip()] or ([content.strip()] if content.strip() else [])
    blocks = [_paragraph_block(_text_run(paragraph)) for paragraph in paragraphs]
    if source_url:
        blocks.append(_paragraph_block(_text_run("Source: "), _text_run(source_url, source_url)))
    return blocks


def build_notion_page_payload(parent_page_id: str, title: str, content: str, source_url: str = "") -> Dict[str, Any]:
    return {
        "parent": {"page_id": parent_page_id},
        "properties": {"title": {"title": [{"type": "text", "text": {"content": title[:200]}}]}},
        "children": build_notion_blocks(content, source_url),
    }
