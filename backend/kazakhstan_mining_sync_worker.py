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
    api_key = (os.getenv("KZ_EGOV_API_KEY") or "").strip()
    if not api_key:
        return {"status": "skipped", "reason": "KZ_EGOV_API_KEY not configured"}

    try:
        from backend.services.ingest.kazakhstan_mining_sync import sync_kazakhstan_mining_register
    except ImportError:
        from services.ingest.kazakhstan_mining_sync import sync_kazakhstan_mining_register

    print("[kazakhstan-mining-worker] starting egov.kz mining register sync…")
    conn = _db_connection()
    try:
        summary = sync_kazakhstan_mining_register(conn)
        conn.commit()
    finally:
        conn.close()
    print("[kazakhstan-mining-worker] done:", json.dumps(summary, default=str)[:2000])
    return summary


def main() -> None:
    interval_seconds = max(3600, _int_env("KZ_EGOV_SYNC_INTERVAL_SECONDS", 86_400))
    backoff_seconds = max(300, _int_env("KZ_EGOV_SYNC_BACKOFF_SECONDS", 3600))
    while True:
        try:
            result = run_once()
            if result.get("status") == "skipped":
                print(f"[kazakhstan-mining-worker] idle: {result.get('reason')}")
                time.sleep(interval_seconds)
                continue
            time.sleep(interval_seconds)
        except Exception as exc:
            print(f"[kazakhstan-mining-worker] sync failed: {exc}")
            time.sleep(backoff_seconds)


if __name__ == "__main__":
    main()
