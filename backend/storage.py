"""Capture-history storage.

MongoDB when MONGO_URL is set (the dev setup), otherwise a SQLite file in POINT_DATA_DIR, which is
what the packaged desktop app uses so installing Point needs no database server.
"""
import asyncio
import json
import os
import sqlite3
from pathlib import Path
from typing import List, Optional


class MongoCaptureStore:
    def __init__(self, url: str, db_name: str):
        from motor.motor_asyncio import AsyncIOMotorClient  # only needed in the Mongo setup
        self._client = AsyncIOMotorClient(url)
        self._db = self._client[db_name]

    async def insert(self, capture: dict) -> None:
        await self._db.captures.insert_one(dict(capture))

    async def list(self, search: str = "") -> List[dict]:
        import re
        query = {}
        if search:
            safe = re.escape(search)
            query = {"$or": [
                {"instruction": {"$regex": safe, "$options": "i"}},
                {"result": {"$regex": safe, "$options": "i"}},
                {"source.window_title": {"$regex": safe, "$options": "i"}},
            ]}
        return await self._db.captures.find(query, {"_id": 0}).sort("created_at", -1).to_list(100)

    async def get(self, capture_id: str) -> Optional[dict]:
        return await self._db.captures.find_one({"id": capture_id}, {"_id": 0})

    async def delete(self, capture_id: str) -> bool:
        result = await self._db.captures.delete_one({"id": capture_id})
        return bool(result.deleted_count)

    def close(self) -> None:
        self._client.close()


class SqliteCaptureStore:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self._path = str(path)
        with self._connect() as conn:
            conn.execute(
                "CREATE TABLE IF NOT EXISTS captures ("
                " id TEXT PRIMARY KEY, created_at TEXT NOT NULL, instruction TEXT, result TEXT,"
                " window_title TEXT, doc TEXT NOT NULL)"
            )
            conn.execute("CREATE INDEX IF NOT EXISTS captures_created_at ON captures(created_at)")

    def _connect(self) -> sqlite3.Connection:
        return sqlite3.connect(self._path, timeout=10)

    def _insert(self, capture: dict) -> None:
        with self._connect() as conn:
            conn.execute(
                "INSERT INTO captures (id, created_at, instruction, result, window_title, doc) VALUES (?, ?, ?, ?, ?, ?)",
                (capture["id"], capture["created_at"], capture.get("instruction", ""), capture.get("result", ""),
                 (capture.get("source") or {}).get("window_title", ""), json.dumps(capture, ensure_ascii=False)),
            )

    def _list(self, search: str) -> List[dict]:
        sql, params = "SELECT doc FROM captures", []
        if search:
            # Escape LIKE wildcards so the search is literal, matching the Mongo regex-escape behaviour.
            like = "%" + search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
            sql += " WHERE instruction LIKE ? ESCAPE '\\' OR result LIKE ? ESCAPE '\\' OR window_title LIKE ? ESCAPE '\\'"
            params = [like, like, like]
        sql += " ORDER BY created_at DESC LIMIT 100"
        with self._connect() as conn:
            return [json.loads(row[0]) for row in conn.execute(sql, params)]

    def _get(self, capture_id: str) -> Optional[dict]:
        with self._connect() as conn:
            row = conn.execute("SELECT doc FROM captures WHERE id = ?", (capture_id,)).fetchone()
        return json.loads(row[0]) if row else None

    def _delete(self, capture_id: str) -> bool:
        with self._connect() as conn:
            return conn.execute("DELETE FROM captures WHERE id = ?", (capture_id,)).rowcount > 0

    async def insert(self, capture: dict) -> None:
        await asyncio.to_thread(self._insert, capture)

    async def list(self, search: str = "") -> List[dict]:
        return await asyncio.to_thread(self._list, search)

    async def get(self, capture_id: str) -> Optional[dict]:
        return await asyncio.to_thread(self._get, capture_id)

    async def delete(self, capture_id: str) -> bool:
        return await asyncio.to_thread(self._delete, capture_id)

    def close(self) -> None:
        pass


def data_dir() -> Path:
    configured = os.environ.get("POINT_DATA_DIR")
    if configured:
        return Path(configured)
    return Path(os.environ.get("LOCALAPPDATA") or Path.home()) / "Point"


def create_store():
    if os.environ.get("MONGO_URL"):
        return MongoCaptureStore(os.environ["MONGO_URL"], os.environ.get("DB_NAME", "point"))
    return SqliteCaptureStore(data_dir() / "point.db")
