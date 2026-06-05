"""Weekly KZ + PH ArcGIS reachability probes (optional; ingest modules may be absent on older images)."""

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
        from backend.services.ingest import kazakhstan_arcgis_probe, philippines_mgb_arcgis_probe
    except ImportError:
        from services.ingest import kazakhstan_arcgis_probe, philippines_mgb_arcgis_probe  # type: ignore

    print("[arcgis-probe-worker] running KZ + PH probes…", flush=True)
    conn = _db_connection()
    try:
        kz = kazakhstan_arcgis_probe.run_and_persist_probe(conn)
        ph = philippines_mgb_arcgis_probe.run_and_persist_probe(conn)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    summary = {"status": "ok", "kazakhstan": kz, "philippines": ph}
    print("[arcgis-probe-worker] done:", json.dumps(summary, default=str)[:2000], flush=True)
    return summary


def main() -> None:
    enabled = (os.getenv("PROBE_SYNC_ENABLED") or "true").strip().lower() not in {
        "0",
        "false",
        "no",
        "off",
    }
    if not enabled:
        print("[arcgis-probe-worker] PROBE_SYNC_ENABLED is off — idle.", flush=True)
        while True:
            time.sleep(86400)

    interval_seconds = max(3600, _int_env("PROBE_SYNC_INTERVAL_SECONDS", 604_800))
    backoff_seconds = max(300, _int_env("PROBE_SYNC_BACKOFF_SECONDS", 3600))
    while True:
        try:
            run_once()
            time.sleep(interval_seconds)
        except ImportError:
            print(
                "[arcgis-probe-worker] ingest modules not in image — idle "
                "(use profile extended-ingest after modules ship, or stop this service).",
                flush=True,
            )
            time.sleep(86400)
        except Exception as exc:
            print(f"[arcgis-probe-worker] sync failed: {exc}", flush=True)
            time.sleep(backoff_seconds)


if __name__ == "__main__":
    main()
