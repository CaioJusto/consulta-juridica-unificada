import json
import os
import sqlite3
import threading
from datetime import datetime
from typing import Any


DB_PATH = os.environ.get(
    "PIPELINE_SQLITE_PATH",
    os.path.join(os.path.dirname(__file__), "data", "pipeline.db"),
)

_LOCK = threading.Lock()


def _ensure_parent_dir() -> None:
    parent = os.path.dirname(DB_PATH)
    if parent:
        os.makedirs(parent, exist_ok=True)


def _connect() -> sqlite3.Connection:
    _ensure_parent_dir()
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    return conn


def init_pipeline_store() -> None:
    with _LOCK:
        with _connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS pipeline_jobs (
                    id TEXT PRIMARY KEY,
                    status TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    payload_json TEXT NOT NULL
                )
                """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_pipeline_jobs_updated_at ON pipeline_jobs(updated_at DESC)"
            )
            conn.commit()


def load_pipeline_jobs() -> dict[str, dict[str, Any]]:
    init_pipeline_store()
    restored: dict[str, dict[str, Any]] = {}
    with _LOCK:
        with _connect() as conn:
            rows = conn.execute(
                "SELECT id, payload_json FROM pipeline_jobs ORDER BY updated_at DESC"
            ).fetchall()
    for row in rows:
        try:
            payload = json.loads(row["payload_json"])
            if payload.get("status") in {"running", "paused"}:
                payload["status"] = "stopped"
                payload["error"] = (
                    payload.get("error")
                    or "Execução interrompida após reinício do servidor. Os dados já coletados foram preservados."
                )
                progress = payload.get("progress") or {}
                progress["stage"] = "interrupted"
                payload["progress"] = progress
            restored[str(payload.get("id") or row["id"])] = payload
        except Exception:
            continue
    return restored


def save_pipeline_job(job: dict[str, Any]) -> None:
    init_pipeline_store()
    payload = json.dumps(job, ensure_ascii=False, default=str)
    now = datetime.utcnow().isoformat()
    with _LOCK:
        with _connect() as conn:
            conn.execute(
                """
                INSERT INTO pipeline_jobs (id, status, created_at, updated_at, payload_json)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    status = excluded.status,
                    updated_at = excluded.updated_at,
                    payload_json = excluded.payload_json
                """,
                (
                    str(job.get("id") or ""),
                    str(job.get("status") or ""),
                    str(job.get("created_at") or now),
                    now,
                    payload,
                ),
            )
            conn.commit()
