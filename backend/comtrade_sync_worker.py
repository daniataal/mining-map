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
        from backend.services.ingest.comtrade_scheduled_sync import sync_comtrade_hs27
    except ImportError:
        from services.ingest.comtrade_scheduled_sync import sync_comtrade_hs27

    print("[comtrade-sync-worker] starting HS27 Comtrade sync…")
    conn = _db_connection()
    try:
        summary = sync_comtrade_hs27(conn)
    finally:
        conn.close()
    print("[comtrade-sync-worker] done:", json.dumps(summary, default=str)[:2000])
    return summary


def main() -> None:
    interval_seconds = max(3600, _int_env("COMTRADE_SYNC_INTERVAL_SECONDS", 86_400))
    backoff_seconds = max(300, _int_env("COMTRADE_SYNC_BACKOFF_SECONDS", 3600))
    while True:
        try:
            run_once()
            time.sleep(interval_seconds)
        except Exception as exc:
            print(f"[comtrade-sync-worker] sync failed: {exc}")
            time.sleep(backoff_seconds)


if __name__ == "__main__":
    main()
