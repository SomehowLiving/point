"""SQLite capture store + settings store used by the packaged app (no server or Mongo needed)."""
import asyncio
import json

import pytest

import settings_store
from storage import SqliteCaptureStore


def capture(id_, created_at, instruction="", result="", title=""):
    return {"id": id_, "created_at": created_at, "instruction": instruction, "result": result,
            "source": {"window_title": title}, "regions": [], "points": []}


def test_sqlite_store_roundtrip_search_and_delete(tmp_path):
    store = SqliteCaptureStore(tmp_path / "point.db")
    run = asyncio.run
    run(store.insert(capture("a", "2026-01-01T00:00:00", "Explain chart", "APAC leads", "Dashboard")))
    run(store.insert(capture("b", "2026-01-02T00:00:00", "Fix crash", "ZeroDivisionError", "app.py — VS Code")))
    assert [c["id"] for c in run(store.list())] == ["b", "a"]  # newest first
    assert [c["id"] for c in run(store.list("apac"))] == ["a"]  # case-insensitive, matches result
    assert [c["id"] for c in run(store.list("vs code"))] == ["b"]  # matches window title
    assert run(store.list("100%")) == []  # LIKE wildcards are literal
    assert run(store.get("a"))["source"]["window_title"] == "Dashboard"
    assert run(store.delete("a")) is True
    assert run(store.delete("a")) is False
    assert run(store.get("a")) is None


def test_settings_saved_key_wins_and_status_hides_values(tmp_path, monkeypatch):
    monkeypatch.setenv("POINT_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("GROQ_API_KEY", "env-key-1234")
    assert settings_store.get_secret("GROQ_API_KEY") == "env-key-1234"
    settings_store.update({"GROQ_API_KEY": "saved-key-9876"})
    assert settings_store.get_secret("GROQ_API_KEY") == "saved-key-9876"
    status = settings_store.status()["GROQ_API_KEY"]
    assert status == {"configured": True, "source": "settings", "hint": "…9876"}
    assert "saved-key-9876" not in json.dumps(settings_store.status())
    settings_store.update({"GROQ_API_KEY": ""})  # clearing falls back to the environment
    assert settings_store.get_secret("GROQ_API_KEY") == "env-key-1234"


def test_settings_rejects_unknown_keys(tmp_path, monkeypatch):
    monkeypatch.setenv("POINT_DATA_DIR", str(tmp_path))
    with pytest.raises(ValueError):
        settings_store.update({"PATH": "x"})


def test_duckduckgo_result_parsing():
    from server import _strip_tags, parse_duckduckgo
    html = ('<a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fx&amp;rut=1">'
            'Example <b>Site</b></a> ... <a class="result__snippet" href="#">A &amp; B snippet</a>'
            '<a class="result__a" href="https://second.example">Second</a>')
    (url1, title1, snippet1), (url2, title2, snippet2) = parse_duckduckgo(html)
    assert "uddg=" in url1 and _strip_tags(title1) == "Example Site" and _strip_tags(snippet1) == "A & B snippet"
    assert url2 == "https://second.example" and snippet2 == ""  # no snippet bleed from the previous result
