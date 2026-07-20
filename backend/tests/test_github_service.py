"""Unit tests for github_service's pure parsing/formatting helpers -- no live GitHub account
needed. The actual HTTP call (server.py's /api/integrations/github/create-issue) is exercised
separately in test_api.py, skip-guarded on GITHUB_TOKEN being configured.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from github_service import build_issue_body, build_issue_payload, parse_github_repo  # noqa: E402


def test_parse_github_repo_from_full_url():
    assert parse_github_repo("https://github.com/anthropics/claude-code") == ("anthropics", "claude-code")


def test_parse_github_repo_from_url_with_trailing_path():
    assert parse_github_repo("https://github.com/anthropics/claude-code/issues") == ("anthropics", "claude-code")


def test_parse_github_repo_from_git_ssh_url():
    assert parse_github_repo("git@github.com:anthropics/claude-code.git") == ("anthropics", "claude-code")


def test_parse_github_repo_from_shorthand():
    assert parse_github_repo("anthropics/claude-code") == ("anthropics", "claude-code")


def test_parse_github_repo_returns_none_for_garbage():
    assert parse_github_repo("not a repo at all") is None
    assert parse_github_repo("") is None


def test_build_issue_body_appends_source_when_provided():
    body = build_issue_body("The login button is broken.", "https://example.test/app")
    assert body == "The login button is broken.\n\n---\nCaptured from: https://example.test/app"


def test_build_issue_body_omits_source_footer_when_absent():
    assert build_issue_body("The login button is broken.") == "The login button is broken."


def test_build_issue_body_handles_empty_content_with_source():
    assert build_issue_body("", "https://example.test/app") == "Captured from: https://example.test/app"


def test_build_issue_payload_shape():
    payload = build_issue_payload("Login button broken", "Steps: click Pay Now.", "https://example.test/checkout")
    assert payload["title"] == "Login button broken"
    assert "Steps: click Pay Now." in payload["body"]
    assert "Captured from: https://example.test/checkout" in payload["body"]
    assert "labels" not in payload


def test_build_issue_payload_includes_labels_when_given():
    payload = build_issue_payload("Bug", "Body", labels=["bug", "point-capture"])
    assert payload["labels"] == ["bug", "point-capture"]


def test_build_issue_payload_truncates_long_title():
    payload = build_issue_payload("x" * 300, "body")
    assert len(payload["title"]) == 256
