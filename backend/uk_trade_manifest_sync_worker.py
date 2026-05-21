"""Periodic UK / user manifest CSV ingest into trade_manifest_rows."""

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
        from backend.services.trade_manifest_ingest import sync_uk_open_trade_rows
    except ImportError:
        from services.trade_manifest_ingest import sync_uk_open_trade_rows

    conn = _db_connection()
    try:
        summary = sync_uk_open_trade_rows(conn)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    print("[uk-trade-manifest-worker] done:", json.dumps(summary, default=str))
    return summary


def main() -> None:
    enabled = (os.getenv("UK_TRADE_MANIFEST_SYNC_ENABLED") or "true").strip().lower() not in {
        "0",
        "false",
        "no",
        "off",
    }
    if not enabled:
        print("[uk-trade-manifest-worker] UK_TRADE_MANIFEST_SYNC_ENABLED is off — exiting.")
        return

    interval_seconds = max(3600, _int_env("UK_MANIFEST_SYNC_INTERVAL_SECONDS", 86_400))
    backoff_seconds = max(300, _int_env("UK_MANIFEST_SYNC_BACKOFF_SECONDS", 3600))
    while True:
        try:
            run_once()
            time.sleep(interval_seconds)
        except Exception as exc:
            print(f"[uk-trade-manifest-worker] sync failed: {exc}")
            time.sleep(backoff_seconds)


if __name__ == "__main__":
    main()
