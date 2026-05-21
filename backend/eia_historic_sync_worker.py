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
        from backend.services.eia_historic_imports import try_auto_ingest_eia_downloads
    except ImportError:
        from services.eia_historic_imports import try_auto_ingest_eia_downloads

    print("[eia-historic-sync-worker] checking EIA_downloads folder…")
    conn = _db_connection()
    try:
        summary = try_auto_ingest_eia_downloads(conn)
    finally:
        conn.close()
    print("[eia-historic-sync-worker] done:", json.dumps(summary, default=str)[:2000])
    return summary


def main() -> None:
    enabled = (os.getenv("EIA_HISTORIC_SYNC_ENABLED") or "true").strip().lower() not in {
        "0",
        "false",
        "no",
        "off",
    }
    if not enabled:
        print("[eia-historic-sync-worker] EIA_HISTORIC_SYNC_ENABLED is off — exiting.")
        return

    interval_seconds = max(600, _int_env("EIA_HISTORIC_SYNC_INTERVAL_SECONDS", 21_600))
    backoff_seconds = max(300, _int_env("EIA_HISTORIC_SYNC_BACKOFF_SECONDS", 1800))
    while True:
        try:
            run_once()
            time.sleep(interval_seconds)
        except Exception as exc:
            print(f"[eia-historic-sync-worker] sync failed: {exc}")
            time.sleep(backoff_seconds)


if __name__ == "__main__":
    main()
