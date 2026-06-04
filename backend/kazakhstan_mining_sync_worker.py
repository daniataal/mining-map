"""Daily Kazakhstan egov mining register sync (optional; ingest module may be absent on older images)."""

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
        from backend.services.ingest.kazakhstan_mining_sync import sync_kazakhstan_mining_register
    except ImportError:
        from services.ingest.kazakhstan_mining_sync import sync_kazakhstan_mining_register  # type: ignore

    max_rows = _int_env("KZ_EGOV_SYNC_MAX_ROWS", 5000)
    print("[kazakhstan-mining-worker] starting egov register sync…", flush=True)
    conn = _db_connection()
    try:
        summary = sync_kazakhstan_mining_register(conn, max_rows=max_rows)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    print("[kazakhstan-mining-worker] done:", json.dumps(summary, default=str)[:2000], flush=True)
    return summary


def main() -> None:
    if not (os.getenv("KZ_EGOV_API_KEY") or "").strip():
        print("[kazakhstan-mining-worker] KZ_EGOV_API_KEY unset — idle.", flush=True)
        while True:
            time.sleep(86400)

    interval_seconds = max(3600, _int_env("KZ_EGOV_SYNC_INTERVAL_SECONDS", 86_400))
    backoff_seconds = max(300, _int_env("KZ_EGOV_SYNC_BACKOFF_SECONDS", 3600))
    while True:
        try:
            run_once()
            time.sleep(interval_seconds)
        except ImportError:
            print(
                "[kazakhstan-mining-worker] ingest module not in image — idle "
                "(use profile extended-ingest after module ships, or stop this service).",
                flush=True,
            )
            time.sleep(86400)
        except Exception as exc:
            print(f"[kazakhstan-mining-worker] sync failed: {exc}", flush=True)
            time.sleep(backoff_seconds)


if __name__ == "__main__":
    main()
