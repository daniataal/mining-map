from __future__ import annotations

import json
import os
import time
from typing import Any


def _int_env(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default


def _db_connection() -> Any:
    import psycopg2

    return psycopg2.connect(
        host=os.getenv("DB_HOST", "localhost"),
        port=int(os.getenv("DB_PORT", "5432")),
        dbname=os.getenv("DB_NAME", "mining_db"),
        user=os.getenv("DB_USER", "postgres"),
        password=os.getenv("DB_PASSWORD", "password"),
    )


def run_once() -> dict[str, Any]:
    try:
        from backend.services.ingest.sweden_sgu_mining_sync import sync_sweden_sgu_mining
    except ImportError:
        from services.ingest.sweden_sgu_mining_sync import sync_sweden_sgu_mining

    print("[sweden-mining-worker] starting SGU OGC mineral permits sync…")
    conn = _db_connection()
    try:
        summary = sync_sweden_sgu_mining(conn)
        conn.commit()
    finally:
        conn.close()
    print("[sweden-mining-worker] done:", json.dumps(summary, default=str)[:2000])
    return summary


def main() -> None:
    interval_seconds = max(3600, _int_env("SGU_SYNC_INTERVAL_SECONDS", 604_800))
    backoff_seconds = max(300, _int_env("SGU_SYNC_BACKOFF_SECONDS", 3600))
    while True:
        try:
            run_once()
            time.sleep(interval_seconds)
        except Exception as exc:
            print(f"[sweden-mining-worker] sync failed: {exc}")
            time.sleep(backoff_seconds)


if __name__ == "__main__":
    main()
