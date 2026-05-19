"""Persistence helpers for license open-data sync runs (mirrors gov_procurement_sync_runs)."""

from __future__ import annotations

import json
import os
from typing import Any, Optional, Sequence


def _drift_alert_pct() -> float:
    try:
        return float(os.getenv("SYNC_DRIFT_ALERT_PCT", "20"))
    except (TypeError, ValueError):
        return 20.0


def ensure_license_sync_tables(conn: Any) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS license_sync_runs (
                id SERIAL PRIMARY KEY,
                source_id TEXT,
                started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                finished_at TIMESTAMPTZ,
                status TEXT NOT NULL,
                records_fetched INTEGER DEFAULT 0,
                records_written INTEGER DEFAULT 0,
                records_skipped_manual INTEGER DEFAULT 0,
                error TEXT,
                drift_warning JSONB
            );
            """
        )
        cur.execute(
            "ALTER TABLE license_sync_runs ADD COLUMN IF NOT EXISTS drift_warning JSONB;"
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_license_sync_runs_source_started
            ON license_sync_runs (source_id, started_at DESC);
            """
        )


def start_license_sync_run(conn: Any, *, source_id: Optional[str] = None) -> int:
    ensure_license_sync_tables(conn)
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO license_sync_runs (source_id, started_at, status)
            VALUES (%s, NOW(), 'running')
            RETURNING id;
            """,
            (source_id,),
        )
        row = cur.fetchone()
        return int(row[0])


def finish_license_sync_run(
    conn: Any,
    run_id: int,
    *,
    status: str,
    records_fetched: int = 0,
    records_written: int = 0,
    records_skipped_manual: int = 0,
    error: Optional[str] = None,
    drift_warning: Optional[dict[str, Any]] = None,
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE license_sync_runs
            SET finished_at = NOW(),
                status = %s,
                records_fetched = %s,
                records_written = %s,
                records_skipped_manual = %s,
                error = %s,
                drift_warning = %s
            WHERE id = %s;
            """,
            (
                status,
                records_fetched,
                records_written,
                records_skipped_manual,
                error,
                json.dumps(drift_warning) if drift_warning else None,
                run_id,
            ),
        )


def _previous_success_written(
    conn: Any,
    *,
    source_id: Optional[str],
    exclude_run_id: int,
) -> Optional[int]:
    """Records written from the most recent successful run for this source (excluding current)."""
    ensure_license_sync_tables(conn)
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT records_written
            FROM license_sync_runs
            WHERE COALESCE(source_id, '') = COALESCE(%s, '')
              AND status = 'success'
              AND id <> %s
              AND records_written IS NOT NULL
            ORDER BY started_at DESC
            LIMIT 1;
            """,
            (source_id, exclude_run_id),
        )
        row = cur.fetchone()
    if not row:
        return None
    if isinstance(row, dict):
        val = row.get("records_written")
    else:
        val = row[0]
    try:
        return int(val) if val is not None else None
    except (TypeError, ValueError):
        return None


def evaluate_sync_drift(
    conn: Any,
    *,
    run_id: int,
    source_id: Optional[str],
    records_written: int,
) -> Optional[dict[str, Any]]:
    """
    Compare records_written to the previous successful run for the same source_id.
    Returns a drift_warning dict when drop exceeds SYNC_DRIFT_ALERT_PCT (default 20).
    """
    prev_written = _previous_success_written(conn, source_id=source_id, exclude_run_id=run_id)
    if prev_written is None or prev_written <= 0:
        return None

    current = max(0, int(records_written or 0))
    drop = prev_written - current
    if drop <= 0:
        return None

    drop_pct = (drop / prev_written) * 100.0
    threshold = _drift_alert_pct()
    if drop_pct <= threshold:
        return None

    warning = {
        "type": "records_written_drop",
        "threshold_pct": threshold,
        "previous_records_written": prev_written,
        "current_records_written": current,
        "drop_count": drop,
        "drop_pct": round(drop_pct, 2),
        "message": (
            f"records_written dropped {drop_pct:.1f}% "
            f"({prev_written} → {current}) vs previous successful sync"
        ),
    }
    print(
        f"[license-sync] DRIFT WARNING source={source_id!r} run_id={run_id}: {warning['message']}"
    )
    return warning


def list_license_sync_runs(
    conn: Any,
    *,
    limit: int = 50,
    source_id: Optional[str] = None,
) -> list[dict[str, Any]]:
    """Return recent sync runs, newest first."""
    ensure_license_sync_tables(conn)
    safe_limit = max(1, min(int(limit or 50), 200))
    params: list[Any] = []
    where = ""
    if source_id:
        where = "WHERE source_id = %s"
        params.append(source_id)
    params.append(safe_limit)
    with conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT
                id,
                source_id,
                started_at,
                finished_at,
                status,
                records_fetched,
                records_written,
                records_skipped_manual,
                error,
                drift_warning
            FROM license_sync_runs
            {where}
            ORDER BY started_at DESC
            LIMIT %s
            """,
            tuple(params),
        )
        rows = cur.fetchall()
    return list_license_sync_runs_from_rows(rows)


def list_sync_drift_alerts(
    conn: Any,
    *,
    limit: int = 50,
) -> list[dict[str, Any]]:
    """Recent sync runs that recorded a drift_warning."""
    ensure_license_sync_tables(conn)
    safe_limit = max(1, min(int(limit or 50), 200))
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT
                id,
                source_id,
                started_at,
                finished_at,
                status,
                records_fetched,
                records_written,
                records_skipped_manual,
                error,
                drift_warning
            FROM license_sync_runs
            WHERE drift_warning IS NOT NULL
            ORDER BY started_at DESC
            LIMIT %s;
            """,
            (safe_limit,),
        )
        rows = cur.fetchall()
    return list_license_sync_runs_from_rows(rows)


def list_latest_sync_run_per_source(conn: Any) -> list[dict[str, Any]]:
    """One row per source_id: the most recent finished or running sync."""
    ensure_license_sync_tables(conn)
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT DISTINCT ON (COALESCE(source_id, ''))
                id,
                source_id,
                started_at,
                finished_at,
                status,
                records_fetched,
                records_written,
                records_skipped_manual,
                error,
                drift_warning
            FROM license_sync_runs
            ORDER BY COALESCE(source_id, ''), started_at DESC
            """
        )
        rows = cur.fetchall()
    return list_license_sync_runs_from_rows(rows)


def list_license_sync_runs_from_rows(rows: Sequence[Any]) -> list[dict[str, Any]]:
    """Serialize cursor rows from sync-run queries."""
    results: list[dict[str, Any]] = []
    for row in rows:
        if isinstance(row, dict):
            item = dict(row)
        else:
            if len(row) >= 10:
                (
                    run_id,
                    sid,
                    started_at,
                    finished_at,
                    status,
                    records_fetched,
                    records_written,
                    records_skipped_manual,
                    error,
                    drift_warning,
                ) = row[:10]
            else:
                (
                    run_id,
                    sid,
                    started_at,
                    finished_at,
                    status,
                    records_fetched,
                    records_written,
                    records_skipped_manual,
                    error,
                ) = row
                drift_warning = None
            item = {
                "id": run_id,
                "source_id": sid,
                "started_at": started_at,
                "finished_at": finished_at,
                "status": status,
                "records_fetched": records_fetched,
                "records_written": records_written,
                "records_skipped_manual": records_skipped_manual,
                "error": error,
                "drift_warning": drift_warning,
            }
        drift = item.get("drift_warning")
        if isinstance(drift, str):
            try:
                item["drift_warning"] = json.loads(drift)
            except json.JSONDecodeError:
                pass
        for key in ("started_at", "finished_at"):
            val = item.get(key)
            if hasattr(val, "isoformat"):
                item[key] = val.isoformat()
        results.append(item)
    return results
