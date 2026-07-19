"""Unit tests for notion_service's pure parsing/formatting helpers -- no live Notion account
needed. The actual HTTP call (server.py's /api/integrations/notion/send) is exercised
separately in test_api.py, skip-guarded on NOTION_API_KEY being configured.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from notion_service import build_notion_blocks, build_notion_page_payload, parse_notion_page_id  # noqa: E402


def test_parse_notion_page_id_from_full_url_with_title_slug():
    url = "https://www.notion.so/My-Workspace/Point-Captures-1a2b3c4d5e6f708192a3b4c5d6e7f809"
    assert parse_notion_page_id(url) == "1a2b3c4d-5e6f-7081-92a3-b4c5d6e7f809"


def test_parse_notion_page_id_from_dashed_uuid_already_formatted():
    url = "https://www.notion.so/1a2b3c4d-5e6f-7081-92a3-b4c5d6e7f809"
    assert parse_notion_page_id(url) == "1a2b3c4d-5e6f-7081-92a3-b4c5d6e7f809"


def test_parse_notion_page_id_from_raw_id_no_url():
    assert parse_notion_page_id("1a2b3c4d5e6f708192a3b4c5d6e7f809") == "1a2b3c4d-5e6f-7081-92a3-b4c5d6e7f809"


def test_parse_notion_page_id_returns_none_when_no_id_present():
    assert parse_notion_page_id("https://www.notion.so/not-a-real-id") is None
    assert parse_notion_page_id("") is None


def test_build_notion_blocks_splits_on_blank_lines_into_paragraphs():
    blocks = build_notion_blocks("First paragraph.\n\nSecond paragraph.")
    assert len(blocks) == 2
    assert blocks[0]["type"] == "paragraph"
    assert blocks[0]["paragraph"]["rich_text"][0]["text"]["content"] == "First paragraph."
    assert blocks[1]["paragraph"]["rich_text"][0]["text"]["content"] == "Second paragraph."


def test_build_notion_blocks_appends_source_link_block_when_provided():
    blocks = build_notion_blocks("Body text.", source_url="https://example.test/article")
    assert len(blocks) == 2
    source_block = blocks[-1]
    runs = source_block["paragraph"]["rich_text"]
    assert runs[0]["text"]["content"] == "Source: "
    assert runs[1]["text"]["content"] == "https://example.test/article"
    assert runs[1]["text"]["link"]["url"] == "https://example.test/article"


def test_build_notion_blocks_omits_source_block_when_no_url():
    blocks = build_notion_blocks("Body text.")
    assert len(blocks) == 1


def test_build_notion_blocks_handles_empty_content_without_throwing():
    assert build_notion_blocks("") == []
    assert build_notion_blocks("   ") == []


def test_build_notion_page_payload_shape():
    payload = build_notion_page_payload("1a2b3c4d-5e6f-7081-92a3-b4c5d6e7f809", "My Title", "Some content.", "https://example.test")
    assert payload["parent"] == {"page_id": "1a2b3c4d-5e6f-7081-92a3-b4c5d6e7f809"}
    assert payload["properties"]["title"]["title"][0]["text"]["content"] == "My Title"
    assert len(payload["children"]) == 2  # body paragraph + source link block
