"""Persistence helpers for license open-data sync runs (mirrors gov_procurement_sync_runs)."""

from __future__ import annotations

from typing import Any, Optional, Sequence


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
                error TEXT
            );
            """
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
                error = %s
            WHERE id = %s;
            """,
            (status, records_fetched, records_written, records_skipped_manual, error, run_id),
        )


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
                error
            FROM license_sync_runs
            {where}
            ORDER BY started_at DESC
            LIMIT %s
            """,
            tuple(params),
        )
        rows = cur.fetchall()
    results: list[dict[str, Any]] = []
    for row in rows:
        if isinstance(row, dict):
            item = dict(row)
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
            }
        for key in ("started_at", "finished_at"):
            val = item.get(key)
            if hasattr(val, "isoformat"):
                item[key] = val.isoformat()
        results.append(item)
    return results


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
                error
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
            }
        for key in ("started_at", "finished_at"):
            val = item.get(key)
            if hasattr(val, "isoformat"):
                item[key] = val.isoformat()
        results.append(item)
    return results
