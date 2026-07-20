"""API regression tests for spatial capture root/models/analyze/history flows."""

import json
import os
import struct
import uuid
import zlib
import base64
import io
from typing import Dict, List, Tuple

import pytest
import requests
from PIL import Image, ImageDraw, ImageFont
from dotenv import load_dotenv


BASE_URL = os.environ.get("REACT_APP_BACKEND_URL")
if not BASE_URL:
    load_dotenv("/app/frontend/.env")
    BASE_URL = os.environ.get("REACT_APP_BACKEND_URL")
if not BASE_URL:
    pytest.skip("REACT_APP_BACKEND_URL is required", allow_module_level=True)

API_BASE = f"{BASE_URL.rstrip('/')}/api"


# These tests call real AI providers end-to-end and are pinned with @pytest.mark.integration —
# they need an internet connection and a provider account that actually has quota (not just a
# present API key). Run them explicitly with `pytest -m integration`; the default local command
# (`pytest`, no -m filter) does not require paid API quota to pass: a provider-side quota/rate-
# limit error causes an automatic skip here rather than a red herring test failure. A genuine bug
# (malformed response, 500, wrong field) still fails normally — this only recognizes the specific,
# well-known "the account has no quota" class of error.
QUOTA_ERROR_HINTS = ("insufficient_quota", "resource_exhausted", "rate limit", "quota", "429")


def _skip_if_provider_unavailable(events: List[Dict]) -> None:
    error_event = next((event for event in events if event.get("type") == "error"), None)
    if not error_event:
        return
    message = str(error_event.get("message", "")).lower()
    if any(hint in message for hint in QUOTA_ERROR_HINTS):
        pytest.skip(f"Provider quota/rate-limit unavailable for this integration test: {error_event.get('message', '')[:200]}")


def _chunk(tag: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


def _build_featured_png_base64(width: int = 320, height: int = 220) -> str:
    rows = []
    for y in range(height):
        row = bytearray()
        for x in range(width):
            # Gradient + checker + stripe features (non-uniform visual content)
            r = (x * 255) // max(1, width - 1)
            g = (y * 255) // max(1, height - 1)
            checker = 220 if ((x // 24 + y // 24) % 2 == 0) else 40
            b = (checker + (x * y) % 35) % 256
            if abs(x - y) < 3 or abs(x - (width - y - 1)) < 3:
                r, g, b = 255, 255, 255
            row.extend((r, g, b))
        rows.append(bytes([0]) + bytes(row))  # filter type 0

    raw = b"".join(rows)
    compressed = zlib.compress(raw, level=6)
    signature = b"\x89PNG\r\n\x1a\n"
    ihdr = _chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
    idat = _chunk(b"IDAT", compressed)
    iend = _chunk(b"IEND", b"")
    png_bytes = signature + ihdr + idat + iend
    return base64.b64encode(png_bytes).decode("ascii")


SAMPLE_IMAGE_DATA_URL = f"data:image/png;base64,{_build_featured_png_base64()}"


def _stream_events(response: requests.Response) -> List[Dict]:
    events: List[Dict] = []
    for raw in response.iter_lines(decode_unicode=True):
        if not raw:
            continue
        if not raw.startswith("data: "):
            continue
        payload = raw[6:]
        events.append(json.loads(payload))
    return events


def _analyze_request(model: str, private_mode: bool, instruction: str) -> Tuple[requests.Response, List[Dict]]:
    response = requests.post(
        f"{API_BASE}/captures/analyze",
        json={
            "image_data": SAMPLE_IMAGE_DATA_URL,
            "mime_type": "image/png",
            "instruction": instruction,
            "action": "explain",
            "model": model,
            "regions": [
                {
                    "id": "TEST_region_1",
                    "x": 0.1,
                    "y": 0.1,
                    "width": 0.6,
                    "height": 0.6,
                    "label": "TEST region",
                }
            ],
            "annotations": [
                {
                    "id": "TEST_ann_1",
                    "type": "freehand",
                    "points": [{"x": 0.12, "y": 0.12}, {"x": 0.66, "y": 0.66}],
                }
            ],
            "source": {
                "application": "Web dashboard",
                "window_title": "TEST Spatial Window",
                "url": "https://example.test/context",
            },
            "private_mode": private_mode,
        },
        timeout=180,
        stream=True,
    )
    events = _stream_events(response)
    return response, events


def test_root():
    response = requests.get(f"{API_BASE}/", timeout=30)
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ready"
    assert "Spatial AI" in data["message"]


def test_models():
    response = requests.get(f"{API_BASE}/models", timeout=30)
    assert response.status_code == 200
    data = response.json()
    model_ids = {item["id"] for item in data["models"]}
    assert "gpt-5.5" in model_ids
    assert "gemini-3.1-pro-preview" in model_ids


def test_analyze_validation_invalid_mime():
    response = requests.post(
        f"{API_BASE}/captures/analyze",
        json={
            "image_data": SAMPLE_IMAGE_DATA_URL,
            "mime_type": "image/gif",
            "instruction": "TEST invalid mime",
            "model": "gpt-5.5",
        },
        timeout=30,
    )
    assert response.status_code == 422
    data = response.json()
    detail = json.dumps(data)
    assert "supported" in detail.lower() or "png" in detail.lower()


@pytest.mark.integration
def test_private_mode_analysis_not_saved():
    marker = "TEST_PRIVATE_MODE_ANALYSIS"
    response, events = _analyze_request(
        model="gpt-5.5",
        private_mode=True,
        instruction=f"{marker}: Describe visible elements.",
    )
    assert response.status_code == 200
    _skip_if_provider_unavailable(events)
    assert any(event.get("type") == "delta" for event in events)
    done = next((event for event in events if event.get("type") == "done"), None)
    assert done is not None
    assert done.get("saved") is False
    capture = done["capture"]
    assert capture["instruction"].startswith(marker)
    assert isinstance(capture["result"], str)
    assert capture["model"] == "gpt-5.5"

    # Verify private capture not persisted
    listed = requests.get(f"{API_BASE}/captures", params={"search": marker}, timeout=30)
    assert listed.status_code == 200
    records = listed.json()
    assert all(marker not in item["instruction"] for item in records)


@pytest.mark.integration
def test_saved_capture_history_detail_and_delete_flow():
    marker = "TEST_SAVED_MODE_ANALYSIS"
    response, events = _analyze_request(
        model="gemini-3.1-pro-preview",
        private_mode=False,
        instruction=f"{marker}: Summarize highlighted context.",
    )
    assert response.status_code == 200
    _skip_if_provider_unavailable(events)
    assert any(event.get("type") == "delta" for event in events)

    done = next((event for event in events if event.get("type") == "done"), None)
    assert done is not None
    assert done.get("saved") is True
    capture = done["capture"]
    capture_id = capture["id"]

    # List search should include persisted capture
    listed = requests.get(f"{API_BASE}/captures", params={"search": marker}, timeout=30)
    assert listed.status_code == 200
    records = listed.json()
    assert any(item["id"] == capture_id for item in records)

    # Detail fetch
    detail = requests.get(f"{API_BASE}/captures/{capture_id}", timeout=30)
    assert detail.status_code == 200
    detail_data = detail.json()
    assert detail_data["instruction"].startswith(marker)
    assert detail_data["id"] == capture_id

    # Delete then verify 404
    deleted = requests.delete(f"{API_BASE}/captures/{capture_id}", timeout=30)
    assert deleted.status_code == 200
    deleted_data = deleted.json()
    assert deleted_data["deleted"] is True

    missing = requests.get(f"{API_BASE}/captures/{capture_id}", timeout=30)
    assert missing.status_code == 404


def test_delete_unknown_capture_returns_404():
    unknown_id = "TEST_UNKNOWN_CAPTURE_ID"
    response = requests.delete(f"{API_BASE}/captures/{unknown_id}", timeout=30)
    assert response.status_code == 404
    data = response.json()
    assert "not found" in data["detail"].lower()


def _ocr_image_data_url() -> str:
    image = Image.new("RGB", (1200, 320), "white")
    draw = ImageDraw.Draw(image)
    font = ImageFont.load_default(size=64)
    draw.text((45, 45), "Spatial OCR Invoice 4821", fill="black", font=font)
    draw.text((45, 150), "Total: 193.75 USD Status: PAID", fill="black", font=font)
    stream = io.BytesIO()
    image.save(stream, format="PNG")
    return f"data:image/png;base64,{base64.b64encode(stream.getvalue()).decode('ascii')}"


def test_deterministic_ocr_and_status():
    status = requests.get(f"{API_BASE}/ocr/status", timeout=30)
    assert status.status_code == 200
    assert status.json()["engines"][0]["available"] is True
    response = requests.post(
        f"{API_BASE}/ocr/extract",
        json={"image_data": _ocr_image_data_url(), "mime_type": "image/png", "engine": "tesseract", "language": "eng", "regions": []},
        timeout=60,
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["engine"] == "tesseract"
    assert "Spatial OCR" in payload["text"]
    assert "193.75" in payload["text"]
    assert payload["words"] and payload["average_confidence"] > 0.5


def test_ocr_extract_returns_word_boxes_engine_metadata_and_image_dimensions():
    response = requests.post(
        f"{API_BASE}/ocr/extract",
        json={
            "image_data": _ocr_image_data_url(),
            "mime_type": "image/png",
            "engine": "tesseract",
            "language": "eng",
            "regions": [],
        },
        timeout=60,
    )
    assert response.status_code == 200
    payload = response.json()
    assert isinstance(payload.get("text"), str)
    assert isinstance(payload.get("words"), list)
    assert payload.get("engine") == "tesseract"
    assert isinstance(payload.get("engines_tried"), list)
    assert payload.get("image", {}).get("width") == 1200
    assert payload.get("image", {}).get("height") == 320
    first_word = payload["words"][0]
    assert isinstance(first_word.get("confidence"), float)
    assert set(first_word.get("box", {}).keys()) == {"x", "y", "width", "height"}


def _ocr_region_test_image_data_url() -> str:
    image = Image.new("RGB", (1400, 320), "white")
    draw = ImageDraw.Draw(image)
    font = ImageFont.load_default(size=70)
    draw.text((40, 110), "LEFT 11111", fill="black", font=font)
    draw.text((860, 110), "RIGHT 99999", fill="black", font=font)
    stream = io.BytesIO()
    image.save(stream, format="PNG")
    return f"data:image/png;base64,{base64.b64encode(stream.getvalue()).decode('ascii')}"


def test_ocr_region_only_extraction_respects_normalized_rectangles():
    payload = {
        "image_data": _ocr_region_test_image_data_url(),
        "mime_type": "image/png",
        "engine": "tesseract",
        "language": "eng",
        "regions": [{"id": "left", "x": 0.0, "y": 0.0, "width": 0.49, "height": 1.0}],
    }
    response = requests.post(f"{API_BASE}/ocr/extract", json=payload, timeout=60)
    assert response.status_code == 200
    data = response.json()
    text = data.get("text", "").upper()
    assert "11111" in text or "LEFT" in text
    assert "99999" not in text and "RIGHT" not in text


def test_ocr_explicit_paddle_request_isolated_fallback_does_not_crash_backend():
    paddle_response = requests.post(
        f"{API_BASE}/ocr/extract",
        json={
            "image_data": _ocr_image_data_url(),
            "mime_type": "image/png",
            "engine": "paddle",
            "language": "eng",
            "regions": [],
        },
        timeout=120,
    )
    assert paddle_response.status_code == 200
    payload = paddle_response.json()
    assert payload.get("engine") in {"paddleocr", "tesseract"}
    assert "paddleocr" in payload.get("engines_tried", [])
    assert isinstance(payload.get("fallback_used"), bool)

    # Health check after explicit paddle path confirms backend did not crash.
    health = requests.get(f"{API_BASE}/", timeout=30)
    assert health.status_code == 200


@pytest.mark.parametrize("export_format,expected_extension", [("text", ".txt"), ("markdown", ".md"), ("json", ".json"), ("csv", ".csv"), ("html", ".html")])
def test_structured_exports(export_format: str, expected_extension: str):
    response = requests.post(
        f"{API_BASE}/exports/render",
        json={
            "format": export_format,
            "title": "Invoice 4821",
            "source": {"application": "Test", "window_title": "Invoice", "url": "https://example.test"},
            "payload": {"text": "Invoice 4821\nTotal 193.75", "words": [{"region": 0, "text": "Invoice", "confidence": 0.98, "box": {"x": 1, "y": 2, "width": 80, "height": 20}}]},
        },
        timeout=30,
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["filename"].endswith(expected_extension)
    assert payload["content"]


@pytest.mark.parametrize(
    "export_format,expected_extension,expected_mime",
    [
        ("text", ".txt", "text/plain;charset=utf-8"),
        ("markdown", ".md", "text/markdown;charset=utf-8"),
        ("json", ".json", "application/json"),
        ("csv", ".csv", "text/csv;charset=utf-8"),
        ("html", ".html", "text/html;charset=utf-8"),
    ],
)
def test_export_mime_filename_and_non_empty_content(
    export_format: str,
    expected_extension: str,
    expected_mime: str,
):
    response = requests.post(
        f"{API_BASE}/exports/render",
        json={
            "format": export_format,
            "title": "Spatial OCR report",
            "source": {"application": "Test", "window_title": "Invoice", "url": "https://example.test"},
            "payload": {
                "text": "Invoice 4821\nTotal 193.75",
                "words": [
                    {
                        "region": 0,
                        "text": "Invoice",
                        "confidence": 0.98,
                        "box": {"x": 1, "y": 2, "width": 80, "height": 20},
                    }
                ],
            },
        },
        timeout=30,
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["filename"].endswith(expected_extension)
    assert payload["mime_type"] == expected_mime
    assert isinstance(payload["content"], str) and len(payload["content"].strip()) > 0


def test_send_to_notion_rejects_unparseable_page_url_regardless_of_configuration():
    response = requests.post(
        f"{API_BASE}/integrations/notion/send",
        json={"title": "Test", "content": "Body", "source_url": "", "parent_page": "https://www.notion.so/not-a-real-id"},
        timeout=15,
    )
    assert response.status_code == 400


def test_send_to_notion_reports_missing_configuration():
    # Whether NOTION_API_KEY is configured is a property of the SERVER process under test, not
    # this pytest process (they don't share an environment) -- so this checks the server's actual
    # response rather than a local os.environ read, matching how the quota-skip tests elsewhere in
    # this file detect provider availability at runtime instead of via a static env-var guard.
    response = requests.post(
        f"{API_BASE}/integrations/notion/send",
        json={"title": "Test", "content": "Body", "source_url": "", "parent_page": "1a2b3c4d5e6f708192a3b4c5d6e7f809"},
        timeout=15,
    )
    if response.status_code != 503:
        pytest.skip("Notion is configured on the server under test; this scenario only applies when it isn't")
    assert "NOTION_API_KEY" in response.json()["detail"]


@pytest.mark.integration
def test_send_to_notion_creates_a_real_page():
    parent_page = os.environ.get("NOTION_TEST_PAGE")
    if not os.environ.get("NOTION_API_KEY") or not parent_page:
        pytest.skip("Requires NOTION_API_KEY and NOTION_TEST_PAGE (a page shared with the integration) to run live")
    marker = f"TEST_NOTION_SEND_{uuid.uuid4().hex[:8]}"
    response = requests.post(
        f"{API_BASE}/integrations/notion/send",
        json={"title": marker, "content": "Created by an automated test.", "source_url": "https://example.test", "parent_page": parent_page},
        timeout=30,
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["page_id"]
    # Notion's API has returned page URLs under both www.notion.so and app.notion.com in
    # practice -- assert it's a Notion URL, not a specific domain.
    assert "notion" in payload["url"]


def test_create_github_issue_rejects_unparseable_repo_regardless_of_configuration():
    response = requests.post(
        f"{API_BASE}/integrations/github/create-issue",
        json={"title": "Test", "content": "Body", "repo": "not a repo"},
        timeout=15,
    )
    assert response.status_code == 400


def test_create_github_issue_reports_missing_configuration():
    # Same runtime-detection approach as the Notion "missing configuration" test above: whether
    # GITHUB_TOKEN is set is a property of the server process under test, not this pytest process.
    response = requests.post(
        f"{API_BASE}/integrations/github/create-issue",
        json={"title": "Test", "content": "Body", "repo": "octocat/Hello-World"},
        timeout=15,
    )
    if response.status_code != 503:
        pytest.skip("GitHub is configured on the server under test; this scenario only applies when it isn't")
    assert "GITHUB_TOKEN" in response.json()["detail"]


@pytest.mark.integration
def test_create_github_issue_creates_a_real_issue():
    repo = os.environ.get("GITHUB_TEST_REPO")
    if not os.environ.get("GITHUB_TOKEN") or not repo:
        pytest.skip("Requires GITHUB_TOKEN and GITHUB_TEST_REPO (a repo the token can create issues in) to run live")
    marker = f"TEST_GITHUB_ISSUE_{uuid.uuid4().hex[:8]}"
    response = requests.post(
        f"{API_BASE}/integrations/github/create-issue",
        json={"title": marker, "content": "Created by an automated test.", "source_url": "https://example.test", "repo": repo, "labels": []},
        timeout=30,
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["issue_number"]
    assert payload["url"].startswith("https://github.com/")


def test_clean_copy_removes_boilerplate_and_reports_count():
    words = [
        {"region": 0, "text": "•", "confidence": 0.98, "box": {"x": 0, "y": 0, "width": 10, "height": 14}, "line_key": "0:0:0:0"},
        {"region": 0, "text": "Home", "confidence": 0.98, "box": {"x": 14, "y": 0, "width": 40, "height": 14}, "line_key": "0:0:0:0"},
        {"region": 0, "text": "•", "confidence": 0.98, "box": {"x": 0, "y": 16, "width": 10, "height": 14}, "line_key": "0:0:0:1"},
        {"region": 0, "text": "About", "confidence": 0.98, "box": {"x": 14, "y": 16, "width": 40, "height": 14}, "line_key": "0:0:0:1"},
        {"region": 0, "text": "Real", "confidence": 0.98, "box": {"x": 0, "y": 80, "width": 40, "height": 14}, "line_key": "0:1:0:0"},
        {"region": 0, "text": "content", "confidence": 0.98, "box": {"x": 44, "y": 80, "width": 60, "height": 14}, "line_key": "0:1:0:0"},
        {"region": 0, "text": "here.", "confidence": 0.98, "box": {"x": 108, "y": 80, "width": 40, "height": 14}, "line_key": "0:1:0:0"},
    ]
    dirty_response = requests.post(
        f"{API_BASE}/exports/render",
        json={"format": "text", "title": "Report", "source": {}, "payload": {"text": "", "words": words}},
        timeout=30,
    )
    assert dirty_response.status_code == 200
    dirty = dirty_response.json()
    assert "Home" in dirty["content"] and "About" in dirty["content"]
    assert dirty.get("cleaned_count", 0) == 0

    clean_response = requests.post(
        f"{API_BASE}/exports/render",
        json={"format": "text", "title": "Report", "source": {}, "payload": {"text": "", "words": words}, "clean": True},
        timeout=30,
    )
    assert clean_response.status_code == 200
    cleaned = clean_response.json()
    assert "Home" not in cleaned["content"] and "About" not in cleaned["content"]
    assert "Real content here." in cleaned["content"]
    assert cleaned["cleaned_count"] == 1


def test_smart_copy_preserves_heading_and_paragraph_structure_in_markdown_and_html():
    words = [
        {"region": 0, "text": "Summary", "confidence": 0.98, "box": {"x": 0, "y": 0, "width": 140, "height": 30}, "line_key": "0:0:0:0"},
        {"region": 0, "text": "This", "confidence": 0.98, "box": {"x": 0, "y": 50, "width": 30, "height": 14}, "line_key": "0:1:0:0"},
        {"region": 0, "text": "is", "confidence": 0.98, "box": {"x": 34, "y": 50, "width": 16, "height": 14}, "line_key": "0:1:0:0"},
        {"region": 0, "text": "body", "confidence": 0.98, "box": {"x": 54, "y": 50, "width": 40, "height": 14}, "line_key": "0:1:0:0"},
        {"region": 0, "text": "text.", "confidence": 0.98, "box": {"x": 98, "y": 50, "width": 40, "height": 14}, "line_key": "0:1:0:0"},
    ]
    response = requests.post(
        f"{API_BASE}/exports/render",
        json={"format": "markdown", "title": "Report", "source": {"url": "https://example.test/report"}, "payload": {"text": "", "words": words}},
        timeout=30,
    )
    assert response.status_code == 200
    markdown = response.json()["content"]
    assert "# Summary" in markdown
    assert "This is body text." in markdown
    assert "Source: https://example.test/report" in markdown

    html_response = requests.post(
        f"{API_BASE}/exports/render",
        json={"format": "html", "title": "Report", "source": {"url": "https://example.test/report"}, "payload": {"text": "", "words": words}},
        timeout=30,
    )
    assert html_response.status_code == 200
    html = html_response.json()["content"]
    assert "<h1>Summary</h1>" in html
    assert "<p>This is body text.</p>" in html


def test_smart_copy_reconstructs_table_in_csv_and_json_structure():
    words = [
        {"region": 0, "text": "Name", "confidence": 0.98, "box": {"x": 0, "y": 0, "width": 40, "height": 14}, "line_key": "0:0:0:0"},
        {"region": 0, "text": "Score", "confidence": 0.98, "box": {"x": 200, "y": 0, "width": 40, "height": 14}, "line_key": "0:0:0:0"},
        {"region": 0, "text": "Ana", "confidence": 0.98, "box": {"x": 3, "y": 30, "width": 30, "height": 14}, "line_key": "0:0:1:0"},
        {"region": 0, "text": "92", "confidence": 0.98, "box": {"x": 202, "y": 30, "width": 20, "height": 14}, "line_key": "0:0:1:0"},
        {"region": 0, "text": "Bo", "confidence": 0.98, "box": {"x": 5, "y": 60, "width": 24, "height": 14}, "line_key": "0:0:2:0"},
        {"region": 0, "text": "81", "confidence": 0.98, "box": {"x": 198, "y": 60, "width": 20, "height": 14}, "line_key": "0:0:2:0"},
    ]
    csv_response = requests.post(
        f"{API_BASE}/exports/render",
        json={"format": "csv", "title": "Scores", "source": {}, "payload": {"text": "", "words": words}},
        timeout=30,
    )
    assert csv_response.status_code == 200
    csv_content = csv_response.json()["content"]
    assert "Name,Score" in csv_content.replace("\r\n", "\n")
    assert "Ana,92" in csv_content.replace("\r\n", "\n")

    json_response = requests.post(
        f"{API_BASE}/exports/render",
        json={"format": "json", "title": "Scores", "source": {}, "payload": {"text": "", "words": words}},
        timeout=30,
    )
    assert json_response.status_code == 200
    structure = json_response.json()["content"]
    parsed = json.loads(structure)
    assert any(block["type"] == "table" and block["rows"][0] == ["Name", "Score"] for block in parsed["structure"])


@pytest.mark.integration
def test_saved_capture_persists_ocr_text_field():
    marker = "TEST_OCR_CONTEXT_PERSIST"
    ocr_text = "DETERMINISTIC_OCR_CONTEXT: invoice 4821 total 193.75"
    response = requests.post(
        f"{API_BASE}/captures/analyze",
        json={
            "image_data": SAMPLE_IMAGE_DATA_URL,
            "mime_type": "image/png",
            "instruction": f"{marker} include ocr context",
            "action": "summarize",
            "model": "gemini-3.1-pro-preview",
            "regions": [],
            "annotations": [],
            "source": {
                "application": "Web dashboard",
                "window_title": "TEST OCR",
                "url": "https://example.test/ocr",
            },
            "private_mode": False,
            "ocr_text": ocr_text,
        },
        timeout=180,
        stream=True,
    )
    assert response.status_code == 200
    events = _stream_events(response)
    _skip_if_provider_unavailable(events)
    done = next((event for event in events if event.get("type") == "done"), None)
    assert done is not None
    capture = done["capture"]
    capture_id = capture["id"]
    assert capture.get("ocr_text") == ocr_text

    detail = requests.get(f"{API_BASE}/captures/{capture_id}", timeout=30)
    assert detail.status_code == 200
    detail_payload = detail.json()
    assert detail_payload.get("ocr_text") == ocr_text

    cleanup = requests.delete(f"{API_BASE}/captures/{capture_id}", timeout=30)
    assert cleanup.status_code == 200


def test_extract_search_query_prefers_deterministic_ocr_text_over_instruction():
    # Pure-function unit test — no network, no live server dependency. Imports directly from the
    # server module rather than going through HTTP, since this is plumbing logic, not an endpoint.
    from server import extract_search_query, AnalyzeRequest

    request = AnalyzeRequest(
        image_data=SAMPLE_IMAGE_DATA_URL,
        mime_type="image/png",
        instruction="find the official docs for this",
        action="search",
        model="gpt-5.5",
        ocr_text="  Playwright   browser automation  ",
    )
    assert extract_search_query(request) == "Playwright browser automation"


def test_extract_search_query_falls_back_to_instruction_without_ocr_text():
    from server import extract_search_query, AnalyzeRequest

    request = AnalyzeRequest(
        image_data=SAMPLE_IMAGE_DATA_URL,
        mime_type="image/png",
        instruction="find the official docs for this product",
        action="search",
        model="gpt-5.5",
    )
    assert extract_search_query(request) == "find the official docs for this product"


def test_build_prompt_extract_action_includes_only_the_requested_schema_shape():
    # Pure-function unit test — build_prompt is internal prompt-construction logic, not an
    # endpoint, so this imports directly rather than going through HTTP (matches the
    # extract_search_query tests above).
    from server import build_prompt, AnalyzeRequest

    request = AnalyzeRequest(
        image_data=SAMPLE_IMAGE_DATA_URL,
        mime_type="image/png",
        instruction="pull out the contacts",
        action="extract",
        extract_schema="contact_list",
        model="gpt-5.5",
    )
    prompt = build_prompt(request)
    assert '"schema": "contact_list"' in prompt
    assert "no prose" in prompt
    assert '"schema": "table"' not in prompt


def test_build_prompt_extract_action_auto_schema_offers_every_shape():
    from server import build_prompt, AnalyzeRequest

    request = AnalyzeRequest(
        image_data=SAMPLE_IMAGE_DATA_URL,
        mime_type="image/png",
        instruction="pull out whatever structured data is visible",
        action="extract",
        model="gpt-5.5",
    )
    prompt = build_prompt(request)
    for schema in ["table", "key_value", "contact_list", "task_list", "json_object"]:
        assert f'"schema": "{schema}"' in prompt


@pytest.mark.integration
def test_extract_action_with_schema_streams_successfully():
    marker = "TEST_STRUCTURED_EXTRACT_ACTION"
    response = requests.post(
        f"{API_BASE}/captures/analyze",
        json={
            "image_data": SAMPLE_IMAGE_DATA_URL,
            "mime_type": "image/png",
            "instruction": f"{marker}: extract the totals as a table",
            "action": "extract",
            "extract_schema": "table",
            "model": "gemini-3.1-pro-preview",
            "regions": [],
            "annotations": [],
            "source": {"application": "Web dashboard", "window_title": "TEST extract", "url": "https://example.test/extract"},
            "private_mode": True,
            "ocr_text": "Invoice 4821\nTotal 193.75",
        },
        timeout=180,
        stream=True,
    )
    assert response.status_code == 200
    events = _stream_events(response)
    _skip_if_provider_unavailable(events)
    done = next((event for event in events if event.get("type") == "done"), None)
    assert done is not None


def test_build_prompt_matches_region_to_overlapping_dom_element():
    from server import build_prompt, AnalyzeRequest

    request = AnalyzeRequest(
        image_data=SAMPLE_IMAGE_DATA_URL,
        mime_type="image/png",
        instruction="what is this button",
        action="ask",
        model="gpt-5.5",
        regions=[{"id": "r1", "x": 0.1, "y": 0.1, "width": 0.2, "height": 0.1, "label": ""}],
        source={
            "application": "Google Chrome",
            "window_title": "Test",
            "url": "https://example.test",
            "page_context": {
                "dom_elements": [
                    {"tag": "button", "role": None, "text": "Buy now", "href": None, "box": {"x": 0.12, "y": 0.11, "width": 0.1, "height": 0.05}},
                    {"tag": "a", "role": None, "text": "Unrelated link", "href": "https://example.test/x", "box": {"x": 0.8, "y": 0.8, "width": 0.1, "height": 0.05}},
                ]
            },
        },
    )
    prompt = build_prompt(request)
    context = json.loads(prompt.split("Structured context bundle:\n", 1)[1])
    matched = context["sources"][0]["selected_dom_elements"]["regions"]
    assert len(matched) == 1
    assert matched[0]["region_id"] == "r1"
    assert matched[0]["elements"] == [{"tag": "button", "text": "Buy now"}]
    assert "ground truth" in prompt


def test_build_prompt_matches_point_to_nearest_dom_element():
    from server import build_prompt, AnalyzeRequest

    request = AnalyzeRequest(
        image_data=SAMPLE_IMAGE_DATA_URL,
        mime_type="image/png",
        instruction="what is at this point",
        action="ask",
        model="gpt-5.5",
        points=[{"id": "p1", "x": 0.15, "y": 0.15, "label": None}],
        source={
            "application": "Google Chrome",
            "window_title": "Test",
            "url": "https://example.test",
            "page_context": {
                "dom_elements": [
                    {"tag": "button", "role": None, "text": "Buy now", "href": None, "box": {"x": 0.1, "y": 0.1, "width": 0.1, "height": 0.1}},
                    {"tag": "a", "role": None, "text": "Far away", "href": "https://example.test/x", "box": {"x": 0.9, "y": 0.9, "width": 0.05, "height": 0.05}},
                ]
            },
        },
    )
    prompt = build_prompt(request)
    context = json.loads(prompt.split("Structured context bundle:\n", 1)[1])
    matched = context["sources"][0]["selected_dom_elements"]["points"]
    assert matched[0]["point_id"] == "p1"
    assert matched[0]["elements"][0]["text"] == "Buy now"


def test_build_prompt_omits_dom_ground_truth_note_when_no_dom_elements_present():
    from server import build_prompt, AnalyzeRequest

    request = AnalyzeRequest(
        image_data=SAMPLE_IMAGE_DATA_URL,
        mime_type="image/png",
        instruction="explain this",
        action="ask",
        model="gpt-5.5",
        regions=[{"id": "r1", "x": 0.1, "y": 0.1, "width": 0.2, "height": 0.1, "label": ""}],
        source={"application": "Windows desktop", "window_title": "Notepad", "url": ""},
    )
    prompt = build_prompt(request)
    assert "ground truth" not in prompt
    context = json.loads(prompt.split("Structured context bundle:\n", 1)[1])
    assert context["sources"][0]["selected_dom_elements"] == {"regions": [], "points": []}


def test_build_prompt_rewrite_and_transform_actions_have_distinct_guides():
    from server import build_prompt, AnalyzeRequest

    rewrite_prompt = build_prompt(AnalyzeRequest(
        image_data=SAMPLE_IMAGE_DATA_URL, mime_type="image/png",
        instruction="make this more formal", action="rewrite", model="gpt-5.5",
    ))
    transform_prompt = build_prompt(AnalyzeRequest(
        image_data=SAMPLE_IMAGE_DATA_URL, mime_type="image/png",
        instruction="turn this into a ticket description", action="transform", model="gpt-5.5",
    ))
    assert "Rewrite the selected content" in rewrite_prompt
    assert "Task mode: rewrite" in rewrite_prompt
    assert "Transform the selected content" in transform_prompt
    assert "Task mode: transform" in transform_prompt
    assert rewrite_prompt != transform_prompt


def test_analyze_request_accepts_rewrite_and_transform_actions():
    from server import AnalyzeRequest

    for action in ("rewrite", "transform"):
        request = AnalyzeRequest(image_data=SAMPLE_IMAGE_DATA_URL, mime_type="image/png", instruction="do it", action=action, model="gpt-5.5")
        assert request.action == action


def test_build_prompt_builds_sources_array_with_primary_and_additional_sources():
    from server import build_prompt, AnalyzeRequest

    request = AnalyzeRequest(
        image_data=SAMPLE_IMAGE_DATA_URL,
        mime_type="image/png",
        instruction="does the browser error match the terminal log?",
        action="ask",
        model="gpt-5.5",
        regions=[{"id": "r1", "x": 0.1, "y": 0.1, "width": 0.2, "height": 0.1, "label": ""}],
        source={"application": "Google Chrome", "window_title": "App", "url": "https://example.test"},
        additional_sources=[
            {
                "id": "s1",
                "label": "Terminal",
                "image_data": SAMPLE_IMAGE_DATA_URL,
                "mime_type": "image/png",
                "regions": [{"id": "r2", "x": 0.2, "y": 0.2, "width": 0.3, "height": 0.1, "label": ""}],
                "ocr_text": "ERROR: connection refused on port 5432",
                "source": {"application": "Windows Terminal", "window_title": "psql", "url": ""},
            }
        ],
    )
    prompt = build_prompt(request)
    context = json.loads(prompt.split("Structured context bundle:\n", 1)[1])
    assert len(context["sources"]) == 2
    assert context["sources"][0]["label"] == "Primary"
    assert context["sources"][0]["regions_normalized_to_image"][0]["id"] == "r1"
    assert context["sources"][1]["label"] == "Terminal"
    assert context["sources"][1]["regions_normalized_to_image"][0]["id"] == "r2"
    assert context["sources"][1]["deterministic_ocr"] == "ERROR: connection refused on port 5432"
    assert "Reason across all of them together" in prompt


def test_build_prompt_omits_multi_source_note_for_a_single_source():
    from server import build_prompt, AnalyzeRequest

    request = AnalyzeRequest(image_data=SAMPLE_IMAGE_DATA_URL, mime_type="image/png", instruction="explain", action="ask", model="gpt-5.5")
    prompt = build_prompt(request)
    context = json.loads(prompt.split("Structured context bundle:\n", 1)[1])
    assert len(context["sources"]) == 1
    assert "Reason across all of them together" not in prompt


def test_additional_sources_capped_at_three_and_validates_mime_type():
    from pydantic import ValidationError
    from server import AnalyzeRequest

    def source(i):
        return {"id": f"s{i}", "image_data": SAMPLE_IMAGE_DATA_URL, "mime_type": "image/png"}

    request = AnalyzeRequest(
        image_data=SAMPLE_IMAGE_DATA_URL, mime_type="image/png", instruction="x", action="ask", model="gpt-5.5",
        additional_sources=[source(1), source(2), source(3)],
    )
    assert len(request.additional_sources) == 3

    with pytest.raises(ValidationError):
        AnalyzeRequest(
            image_data=SAMPLE_IMAGE_DATA_URL, mime_type="image/png", instruction="x", action="ask", model="gpt-5.5",
            additional_sources=[source(1), source(2), source(3), source(4)],
        )

    with pytest.raises(ValidationError):
        AnalyzeRequest(
            image_data=SAMPLE_IMAGE_DATA_URL, mime_type="image/png", instruction="x", action="ask", model="gpt-5.5",
            additional_sources=[{"id": "bad", "image_data": SAMPLE_IMAGE_DATA_URL, "mime_type": "application/pdf"}],
        )


@pytest.mark.integration
def test_analyze_with_additional_source_streams_successfully():
    marker = "TEST_MULTI_SOURCE_ANALYZE"
    response = requests.post(
        f"{API_BASE}/captures/analyze",
        json={
            "image_data": SAMPLE_IMAGE_DATA_URL,
            "mime_type": "image/png",
            "instruction": f"{marker}: do these two sources look related?",
            "action": "ask",
            "model": "openrouter",
            "regions": [],
            "annotations": [],
            "source": {"application": "Web dashboard", "window_title": "TEST primary", "url": "https://example.test/primary"},
            "private_mode": True,
            "additional_sources": [
                {
                    "id": "s1",
                    "label": "Terminal",
                    "image_data": SAMPLE_IMAGE_DATA_URL,
                    "mime_type": "image/png",
                    "source": {"application": "Windows Terminal", "window_title": "TEST terminal", "url": ""},
                }
            ],
        },
        timeout=180,
        stream=True,
    )
    assert response.status_code == 200
    events = _stream_events(response)
    _skip_if_provider_unavailable(events)
    done = next((event for event in events if event.get("type") == "done"), None)
    assert done is not None


def test_build_prompt_includes_ocr_conflict_resolution_guidance_when_ocr_text_present():
    from server import build_prompt, AnalyzeRequest

    request = AnalyzeRequest(
        image_data=SAMPLE_IMAGE_DATA_URL,
        mime_type="image/png",
        instruction="what does this say",
        action="ask",
        model="gpt-5.5",
        source={"application": "Windows desktop", "window_title": "Notepad", "url": ""},
        ocr_text="172 points by sebjones",
    )
    prompt = build_prompt(request)
    assert "resolve using" in prompt
    assert "deterministic_ocr" in prompt


def test_build_prompt_omits_ocr_guidance_when_no_ocr_text():
    from server import build_prompt, AnalyzeRequest

    request = AnalyzeRequest(
        image_data=SAMPLE_IMAGE_DATA_URL,
        mime_type="image/png",
        instruction="what does this say",
        action="ask",
        model="gpt-5.5",
        source={"application": "Windows desktop", "window_title": "Notepad", "url": ""},
    )
    prompt = build_prompt(request)
    assert "resolve using" not in prompt


def _searxng_reachable() -> bool:
    searxng_url = os.environ.get("SEARXNG_URL", "http://localhost:8888")
    try:
        response = requests.get(f"{searxng_url}/search", params={"q": "ping", "format": "json"}, timeout=5)
        return response.status_code == 200
    except requests.RequestException:
        return False


@pytest.mark.integration
def test_search_action_returns_real_ranked_results_with_citations():
    if not _searxng_reachable():
        pytest.skip("SearXNG is not reachable at SEARXNG_URL — this integration test needs the local SearXNG container running")
    marker = "TEST_REAL_SEARCH_ACTION"
    response = requests.post(
        f"{API_BASE}/captures/analyze",
        json={
            "image_data": SAMPLE_IMAGE_DATA_URL,
            "mime_type": "image/png",
            "instruction": f"{marker}: find the official documentation for this",
            "action": "search",
            "model": "openrouter",
            "regions": [],
            "annotations": [],
            "source": {"application": "Web dashboard", "window_title": "TEST search", "url": "https://example.test/search"},
            "private_mode": True,
            "ocr_text": "Playwright browser automation",
        },
        timeout=180,
        stream=True,
    )
    assert response.status_code == 200
    events = _stream_events(response)
    _skip_if_provider_unavailable(events)

    search_event = next((event for event in events if event.get("type") == "search_results"), None)
    assert search_event is not None, "expected a search_results event before the AI answer streams"
    results = search_event["results"]
    assert len(results) > 0
    assert all(result.get("url", "").startswith("http") for result in results)
    assert any("playwright" in (result.get("url", "") + result.get("title", "")).lower() for result in results), \
        "expected at least one result about Playwright given the OCR-grounded query"

    done = next((event for event in events if event.get("type") == "done"), None)
    assert done is not None
    assert done["capture"]["search_results"] == results