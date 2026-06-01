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
        from backend.services.oil_live_graph_sync import run_full_graph_sync
    except ImportError:
        from services.oil_live_graph_sync import run_full_graph_sync

    print("[oil-live-graph-sync-worker] starting Meridian commercial graph sync…")
    conn = _db_connection()
    try:
        summary = run_full_graph_sync(conn, rebuild_synthetic_bol=True)
    finally:
        conn.close()
    print("[oil-live-graph-sync-worker] done:", json.dumps(summary, default=str)[:2000])
    return summary


def main() -> None:
    enabled = (os.getenv("OIL_GRAPH_SYNC_ENABLED") or "true").strip().lower() not in {
        "0",
        "false",
        "no",
        "off",
    }
    if not enabled:
        print("[oil-live-graph-sync-worker] OIL_GRAPH_SYNC_ENABLED is off — exiting.")
        return

    interval_seconds = max(3600, _int_env("OIL_GRAPH_SYNC_INTERVAL_SECONDS", 86_400))
    backoff_seconds = max(300, _int_env("OIL_GRAPH_SYNC_BACKOFF_SECONDS", 3600))
    while True:
        try:
            run_once()
            time.sleep(interval_seconds)
        except Exception as exc:
            print(f"[oil-live-graph-sync-worker] sync failed: {exc}")
            time.sleep(backoff_seconds)


if __name__ == "__main__":
    main()
