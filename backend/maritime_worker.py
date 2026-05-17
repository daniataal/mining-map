from __future__ import annotations

import os
import time
from typing import Any


try:
    from backend.services.maritime_intel import (
        collect_worker_maritime_vessel_feed,
        ensure_maritime_database_exists,
        ensure_maritime_tables,
        invalidate_maritime_memory_cache,
        load_maritime_seed_snapshot,
        persist_maritime_vessel_feed,
        update_maritime_ingest_status,
    )
except ImportError:
    from services.maritime_intel import (
        collect_worker_maritime_vessel_feed,
        ensure_maritime_database_exists,
        ensure_maritime_tables,
        invalidate_maritime_memory_cache,
        load_maritime_seed_snapshot,
        persist_maritime_vessel_feed,
        update_maritime_ingest_status,
    )


def _int_env(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default


def _str_env(name: str, default: str) -> str:
    value = os.getenv(name, default)
    return value.strip() if isinstance(value, str) else default


def _connect():
    try:
        from backend.services.maritime_intel import _db_connect
    except ImportError:
        from services.maritime_intel import _db_connect

    return _db_connect()


def _status_from_feed(feed: dict[str, Any]) -> tuple[str, str | None, bool]:
    limitations = feed.get("limitations") if isinstance(feed, dict) else []
    joined_limitations = "; ".join(str(item) for item in limitations if item)
    live_enabled = bool(feed.get("live_positions_enabled")) if isinstance(feed, dict) else False
    vessels = feed.get("vessels") if isinstance(feed, dict) else []
    if live_enabled:
        return "ok", None, True
    if "not configured" in joined_limitations.lower():
        return "not_configured", joined_limitations, False
    if "failed" in joined_limitations.lower() or "unavailable" in joined_limitations.lower():
        return "error", joined_limitations, False
    if isinstance(vessels, list):
        return "ok", None, True
    return "empty", joined_limitations or None, False


def _maybe_seed_from_file(conn) -> int:
    seed_path = _str_env("MARITIME_AIS_SEED_FILE", "")
    if not seed_path or not os.path.isfile(seed_path):
        return 0
    feed = load_maritime_seed_snapshot(seed_path)
    count = persist_maritime_vessel_feed(conn, feed)
    print(f"[maritime-worker] seeded={count} from={seed_path}")
    return count


def run_once() -> int:
    ensure_maritime_database_exists()
    conn = _connect()
    try:
        ensure_maritime_tables(conn)
        vessel_scope = _str_env("MARITIME_WORKER_SCOPE", "all_vessels")
        feed = collect_worker_maritime_vessel_feed(
            max_vessels=_int_env("MARITIME_WORKER_MAX_VESSELS", 15000),
            capture_window_seconds=_int_env("MARITIME_WORKER_CAPTURE_WINDOW_SECONDS", 25),
            vessel_scope=vessel_scope,
        )
        snapshot_count = persist_maritime_vessel_feed(conn, feed)
        status, error, mark_success = _status_from_feed(feed)
        update_maritime_ingest_status(
            conn,
            status=status,
            source=feed.get("source", "AISStream") if isinstance(feed, dict) else "AISStream",
            snapshot_count=snapshot_count,
            last_error=error,
            metadata={
                "scope": feed.get("scope") if isinstance(feed, dict) else None,
                "geography_mode": feed.get("geography_mode") if isinstance(feed, dict) else None,
                "region_labels": feed.get("region_labels") if isinstance(feed, dict) else [],
                "effective_bbox_count": feed.get("effective_bbox_count") if isinstance(feed, dict) else 0,
            },
            mark_success=mark_success,
        )
        conn.commit()
        invalidate_maritime_memory_cache()
        print(f"[maritime-worker] status={status} upserted={snapshot_count} scope={vessel_scope}")
        return snapshot_count
    except Exception as exc:
        conn.rollback()
        try:
            update_maritime_ingest_status(
                conn,
                status="error",
                snapshot_count=0,
                last_error=str(exc),
                metadata={},
                mark_success=False,
            )
            conn.commit()
        except Exception as status_exc:
            conn.rollback()
            print(f"[maritime-worker] failed to update error status: {status_exc}")
        print(f"[maritime-worker] collection failed: {exc}")
        raise
    finally:
        conn.close()


def main() -> None:
    interval_seconds = max(15, _int_env("MARITIME_WORKER_INTERVAL_SECONDS", 30))
    backoff_seconds = max(5, _int_env("MARITIME_WORKER_BACKOFF_SECONDS", 15))
    seed_path = _str_env("MARITIME_AIS_SEED_FILE", "")
    if seed_path:
        try:
            ensure_maritime_database_exists()
            conn = _connect()
            try:
                ensure_maritime_tables(conn)
                _maybe_seed_from_file(conn)
                conn.commit()
                invalidate_maritime_memory_cache()
            finally:
                conn.close()
        except Exception as exc:
            print(f"[maritime-worker] seed load failed: {exc}")

    while True:
        try:
            run_once()
            time.sleep(interval_seconds)
        except Exception:
            time.sleep(backoff_seconds)


if __name__ == "__main__":
    main()
