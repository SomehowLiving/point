"""API regression tests for spatial capture root/models/analyze/history flows."""

import json
import os
import struct
import zlib
import base64
from typing import Dict, List, Tuple

import pytest
import requests
from dotenv import load_dotenv


BASE_URL = os.environ.get("REACT_APP_BACKEND_URL")
if not BASE_URL:
    load_dotenv("/app/frontend/.env")
    BASE_URL = os.environ.get("REACT_APP_BACKEND_URL")
if not BASE_URL:
    pytest.skip("REACT_APP_BACKEND_URL is required", allow_module_level=True)

API_BASE = f"{BASE_URL.rstrip('/')}/api"


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


def test_private_mode_analysis_not_saved():
    marker = "TEST_PRIVATE_MODE_ANALYSIS"
    response, events = _analyze_request(
        model="gpt-5.5",
        private_mode=True,
        instruction=f"{marker}: Describe visible elements.",
    )
    assert response.status_code == 200
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


def test_saved_capture_history_detail_and_delete_flow():
    marker = "TEST_SAVED_MODE_ANALYSIS"
    response, events = _analyze_request(
        model="gemini-3.1-pro-preview",
        private_mode=False,
        instruction=f"{marker}: Summarize highlighted context.",
    )
    assert response.status_code == 200
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