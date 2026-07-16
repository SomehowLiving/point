"""Unit tests for layout_service's OCR-word -> structured-block reconstruction.

These are pure-function tests against synthetic word boxes (no OCR engine,
no live server) so they run fast and deterministically exercise the
heading/paragraph/list/table/code heuristics independently.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from layout_service import (  # noqa: E402
    analyze_layout,
    blocks_to_html,
    blocks_to_markdown,
    blocks_to_text,
    linkify_html,
    linkify_markdown,
)


def word(text, x, y, width, height, region=0, line_key="0:0:0:0", confidence=0.95):
    return {
        "text": text,
        "confidence": confidence,
        "box": {"x": x, "y": y, "width": width, "height": height},
        "region": region,
        "line_key": line_key,
    }


def test_empty_words_returns_no_blocks():
    assert analyze_layout([]) == []


def test_heading_detected_by_relative_line_height():
    words = [
        word("Introduction", 0, 0, 200, 30, line_key="0:0:0:0"),
        word("This", 0, 50, 30, 14, line_key="0:1:0:0"),
        word("is", 34, 50, 16, 14, line_key="0:1:0:0"),
        word("body", 54, 50, 40, 14, line_key="0:1:0:0"),
        word("text.", 98, 50, 40, 14, line_key="0:1:0:0"),
        word("More", 0, 66, 40, 14, line_key="0:1:1:0"),
        word("body", 44, 66, 40, 14, line_key="0:1:1:0"),
        word("here.", 88, 66, 40, 14, line_key="0:1:1:0"),
        word("Even", 0, 82, 40, 14, line_key="0:1:2:0"),
        word("more.", 44, 82, 40, 14, line_key="0:1:2:0"),
    ]
    blocks = analyze_layout(words)
    assert blocks[0] == {"type": "heading", "level": 1, "text": "Introduction"}
    assert blocks[1]["type"] == "paragraph"
    assert blocks[1]["text"] == "This is body text. More body here. Even more."


def test_bulleted_and_ordered_lists_detected_as_separate_blocks():
    words = [
        word("•", 0, 0, 10, 14, line_key="0:0:0:0"),
        word("Item", 14, 0, 40, 14, line_key="0:0:0:0"),
        word("one", 58, 0, 30, 14, line_key="0:0:0:0"),
        word("•", 0, 16, 10, 14, line_key="0:0:0:1"),
        word("Item", 14, 16, 40, 14, line_key="0:0:0:1"),
        word("two", 58, 16, 30, 14, line_key="0:0:0:1"),
        word("1.", 0, 32, 16, 14, line_key="0:0:0:2"),
        word("First", 20, 32, 40, 14, line_key="0:0:0:2"),
        word("2.", 0, 48, 16, 14, line_key="0:0:0:3"),
        word("Second", 20, 48, 50, 14, line_key="0:0:0:3"),
    ]
    blocks = analyze_layout(words)
    assert [b["type"] for b in blocks] == ["list", "list"]
    assert blocks[0] == {"type": "list", "ordered": False, "items": ["Item one", "Item two"]}
    assert blocks[1] == {"type": "list", "ordered": True, "items": ["First", "Second"]}


def test_aligned_grid_detected_as_table():
    words = [
        word("Name", 0, 0, 40, 14, line_key="0:0:0:0"),
        word("Score", 200, 0, 40, 14, line_key="0:0:0:0"),
        word("Ana", 3, 30, 30, 14, line_key="0:0:1:0"),
        word("92", 202, 30, 20, 14, line_key="0:0:1:0"),
        word("Bo", 5, 60, 24, 14, line_key="0:0:2:0"),
        word("81", 198, 60, 20, 14, line_key="0:0:2:0"),
    ]
    blocks = analyze_layout(words)
    assert len(blocks) == 1
    assert blocks[0]["type"] == "table"
    assert blocks[0]["rows"] == [["Name", "Score"], ["Ana", "92"], ["Bo", "81"]]


def test_indented_code_lines_detected_with_relative_indent_preserved():
    words = [
        word("def", 0, 0, 24, 14, line_key="0:0:0:0"),
        word("foo():", 30, 0, 48, 14, line_key="0:0:0:0"),
        word("return", 40, 16, 48, 14, line_key="0:0:0:1"),
        word("1", 94, 16, 8, 14, line_key="0:0:0:1"),
    ]
    blocks = analyze_layout(words)
    assert len(blocks) == 1
    assert blocks[0]["type"] == "code"
    first_line, second_line = blocks[0]["lines"]
    assert first_line == "def foo():"
    assert second_line.strip() == "return 1"
    assert len(second_line) - len(second_line.lstrip(" ")) > 0


def test_heading_prose_and_table_together_do_not_bleed_into_one_paragraph():
    # Regression: a long prose line sitting right above a real table used to get swept into
    # the table's "run" (killing table detection) or the table rows got swept into the prose
    # paragraph via the gap-based merge (killing both the table AND the paragraph boundary).
    words = [
        word("Summary", 21, 20, 126, 26, line_key="0:0:0:0"),
        word("This", 20, 78, 30, 12, line_key="0:1:0:0"),
        word("is", 56, 81, 10, 9, line_key="0:1:0:0"),
        word("body", 72, 78, 33, 15, line_key="0:1:0:0"),
        word("text", 110, 78, 26, 12, line_key="0:1:0:0"),
        word("describing", 140, 78, 72, 15, line_key="0:1:0:0"),
        word("the", 218, 78, 21, 12, line_key="0:1:0:0"),
        word("results", 245, 78, 46, 12, line_key="0:1:0:0"),
        word("below.", 297, 78, 40, 12, line_key="0:1:0:0"),
        word("Name", 21, 128, 41, 12, line_key="0:2:0:0"),
        word("Score", 221, 128, 40, 12, line_key="0:2:1:0"),
        word("Ana", 20, 158, 28, 12, line_key="0:3:0:0"),
        word("92", 221, 158, 16, 12, line_key="0:3:1:0"),
        word("Bo", 21, 188, 18, 12, line_key="0:4:0:0"),
        word("81", 221, 188, 14, 12, line_key="0:4:1:0"),
    ]
    blocks = analyze_layout(words)
    assert blocks[0]["type"] == "heading" and blocks[0]["text"] == "Summary"
    assert blocks[1]["type"] == "paragraph"
    assert blocks[1]["text"] == "This is body text describing the results below."
    assert blocks[2]["type"] == "table"
    assert blocks[2]["rows"] == [["Name", "Score"], ["Ana", "92"], ["Bo", "81"]]
    assert len(blocks) == 3


def test_separate_regions_never_merge_into_one_block():
    words = [
        word("Region one text.", 0, 0, 200, 14, line_key="0:0:0:0", region=0),
        word("Region two text.", 0, 0, 200, 14, line_key="1:0:0:0", region=1),
    ]
    blocks = analyze_layout(words)
    assert len(blocks) == 2
    assert all(block["type"] == "paragraph" for block in blocks)


def test_linkify_markdown_wraps_bare_url():
    assert linkify_markdown("See https://example.com/docs for more") == "See <https://example.com/docs> for more"


def test_linkify_html_escapes_and_anchors():
    result = linkify_html("Visit https://example.com now")
    assert '<a href="https://example.com">https://example.com</a>' in result


def test_render_markdown_covers_all_block_types():
    blocks = [
        {"type": "heading", "level": 2, "text": "Title"},
        {"type": "paragraph", "text": "Some text."},
        {"type": "list", "ordered": False, "items": ["a", "b"]},
        {"type": "code", "lines": ["x = 1"]},
        {"type": "table", "rows": [["A", "B"], ["1", "2"]]},
    ]
    markdown = blocks_to_markdown(blocks)
    assert "## Title" in markdown
    assert "Some text." in markdown
    assert "- a" in markdown and "- b" in markdown
    assert "```\nx = 1\n```" in markdown
    assert "| A | B |" in markdown and "| --- | --- |" in markdown


def test_render_text_and_html_do_not_throw_on_all_block_types():
    blocks = [
        {"type": "heading", "level": 1, "text": "Title"},
        {"type": "paragraph", "text": "Body"},
        {"type": "list", "ordered": True, "items": ["one"]},
        {"type": "code", "lines": ["a = 1"]},
        {"type": "table", "rows": [["A"], ["1"]]},
    ]
    text = blocks_to_text(blocks)
    html = blocks_to_html(blocks)
    assert "Title" in text and "Body" in text and "1. one" in text
    assert "<h1>Title</h1>" in html
    assert "<pre><code>a = 1</code></pre>" in html
    assert "<table>" in html
