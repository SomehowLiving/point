"""User-provided secrets (AI provider keys, integration tokens).

The packaged app has no .env, so keys entered in Settings are saved to POINT_DATA_DIR/settings.json
on the user's machine. A key saved there wins over the environment; the environment (backend/.env)
still works for the dev setup.
"""
import json
import os
import threading
from typing import Dict, Optional

from storage import data_dir

# Keys the Settings screen may read/write. Anything else is rejected.
SECRET_KEYS = (
    "OPENAI_API_KEY",
    "GEMINI_API_KEY",
    "OPENROUTER_API_KEY",
    "GROQ_API_KEY",
    "NOTION_API_KEY",
    "GITHUB_PAT_TOKEN",
)

_lock = threading.Lock()


def _path():
    return data_dir() / "settings.json"


def _load() -> Dict[str, str]:
    try:
        with open(_path(), encoding="utf-8") as handle:
            data = json.load(handle)
        return {key: value for key, value in data.items() if key in SECRET_KEYS and isinstance(value, str)}
    except (OSError, ValueError):
        return {}


def get_secret(name: str, *fallback_env: str) -> Optional[str]:
    saved = _load().get(name)
    if saved:
        return saved
    for env_name in (name, *fallback_env):
        value = os.environ.get(env_name)
        if value:
            return value
    return None


def status() -> Dict[str, dict]:
    """Which keys are configured and where from. Never returns the values themselves."""
    saved = _load()
    result = {}
    for key in SECRET_KEYS:
        if saved.get(key):
            result[key] = {"configured": True, "source": "settings", "hint": "…" + saved[key][-4:]}
        elif os.environ.get(key):
            result[key] = {"configured": True, "source": "environment", "hint": "…" + os.environ[key][-4:]}
        else:
            result[key] = {"configured": False, "source": None, "hint": ""}
    return result


def update(changes: Dict[str, Optional[str]]) -> None:
    """Set keys to new values; an empty value or None removes the saved key."""
    unknown = set(changes) - set(SECRET_KEYS)
    if unknown:
        raise ValueError(f"Unknown setting(s): {', '.join(sorted(unknown))}")
    with _lock:
        data = _load()
        for key, value in changes.items():
            value = (value or "").strip()
            if value:
                data[key] = value
            else:
                data.pop(key, None)
        path = _path()
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        with open(tmp, "w", encoding="utf-8") as handle:
            json.dump(data, handle, indent=2)
        os.replace(tmp, path)
