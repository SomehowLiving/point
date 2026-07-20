"""Creates GitHub issues from captured content via GitHub's official REST API (a personal access
token the user creates once in GitHub's own settings -- no OAuth app registration, no browser
automation). See README 10.2 "Create tasks". Mirrors notion_service.py's shape: pure parsing/
formatting helpers here, the actual HTTP call is a thin wrapper in server.py.
"""
import re
from typing import Any, Dict, List, Optional, Tuple

GITHUB_API_VERSION = "2022-11-28"
GITHUB_URL_PATTERN = re.compile(r"github\.com[:/]+([\w.-]+)/([\w.-]+?)(?:\.git)?(?:[/?#].*)?$", re.IGNORECASE)
SHORTHAND_PATTERN = re.compile(r"^([\w.-]+)/([\w.-]+)$")


def parse_github_repo(raw: str) -> Optional[Tuple[str, str]]:
    """Extracts (owner, repo) from a pasted GitHub URL or an "owner/repo" shorthand. Returns None
    if neither form matches."""
    candidate = raw.strip()
    match = GITHUB_URL_PATTERN.search(candidate)
    if match:
        return match.group(1), match.group(2)
    match = SHORTHAND_PATTERN.match(candidate)
    if match:
        return match.group(1), match.group(2)
    return None


def build_issue_body(content: str, source_url: str = "") -> str:
    body = content.strip()
    if source_url:
        body = f"{body}\n\n---\nCaptured from: {source_url}" if body else f"Captured from: {source_url}"
    return body


def build_issue_payload(title: str, content: str, source_url: str = "", labels: Optional[List[str]] = None) -> Dict[str, Any]:
    payload: Dict[str, Any] = {"title": title[:256], "body": build_issue_body(content, source_url)}
    if labels:
        payload["labels"] = labels
    return payload
