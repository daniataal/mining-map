"""Weekly KZ + PH ArcGIS reachability probes → open_data_probe_results."""

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
    enabled = os.getenv("PROBE_SYNC_ENABLED", "true").strip().lower() not in {
        "0",
        "false",
        "no",
    }
    if not enabled:
        return {"status": "skipped", "reason": "PROBE_SYNC_ENABLED is false"}

    try:
        from backend.services.ingest.kazakhstan_arcgis_probe import run_and_persist_probe as run_kz
        from backend.services.ingest.philippines_mgb_arcgis_probe import run_and_persist_probe as run_ph
    except ImportError:
        from services.ingest.kazakhstan_arcgis_probe import run_and_persist_probe as run_kz
        from services.ingest.philippines_mgb_arcgis_probe import run_and_persist_probe as run_ph

    print("[arcgis-probe-worker] running KZ + PH probes…")
    conn = _db_connection()
    summary: dict[str, Any] = {"status": "ok", "probes": {}}
    try:
        summary["probes"]["kazakhstan_arcgis_hub"] = run_kz(conn)
        summary["probes"]["philippines_mgb_arcgis"] = run_ph(conn)
        conn.commit()
    finally:
        conn.close()
    print("[arcgis-probe-worker] done:", json.dumps(summary, default=str)[:2000])
    return summary


def main() -> None:
    interval_seconds = max(3600, _int_env("PROBE_SYNC_INTERVAL_SECONDS", 604_800))
    backoff_seconds = max(300, _int_env("PROBE_SYNC_BACKOFF_SECONDS", 3600))
    while True:
        try:
            result = run_once()
            if result.get("status") == "skipped":
                print(f"[arcgis-probe-worker] idle: {result.get('reason')}")
            time.sleep(interval_seconds)
        except Exception as exc:
            print(f"[arcgis-probe-worker] failed: {exc}")
            time.sleep(backoff_seconds)


if __name__ == "__main__":
    main()
