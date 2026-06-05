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
    enabled = (os.getenv("PETROLEUM_OSM_SYNC_ENABLED") or "true").strip().lower()
    if enabled in {"0", "false", "no", "off"}:
        return {"status": "skipped", "reason": "PETROLEUM_OSM_SYNC_ENABLED is off"}

    try:
        from backend.services.petroleum_osm_store import ensure_petroleum_osm_tables, sync_all_layers
    except ImportError:
        from services.petroleum_osm_store import ensure_petroleum_osm_tables, sync_all_layers

    print("[petroleum-osm-worker] starting OSM petroleum tile sync…")
    conn = _db_connection()
    try:
        ensure_petroleum_osm_tables(conn)
        conn.commit()
        summary = sync_all_layers(conn)
        try:
            from backend.services.storage_terminal_display import maybe_materialize_after_osm_sync
        except ImportError:
            from services.storage_terminal_display import maybe_materialize_after_osm_sync  # type: ignore

        summary["storage_terminal_display"] = maybe_materialize_after_osm_sync(conn)
        conn.commit()
    finally:
        conn.close()
    print("[petroleum-osm-worker] done:", json.dumps(summary, default=str)[:2000])
    return summary


def main() -> None:
    interval_seconds = max(3600, _int_env("PETROLEUM_OSM_SYNC_INTERVAL_SECONDS", 86_400))
    backoff_seconds = max(300, _int_env("PETROLEUM_OSM_SYNC_BACKOFF_SECONDS", 3600))
    while True:
        try:
            run_once()
            time.sleep(interval_seconds)
        except Exception as exc:
            print(f"[petroleum-osm-worker] sync failed: {exc}")
            time.sleep(backoff_seconds)


if __name__ == "__main__":
    main()
