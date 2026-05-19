"""Persistence helpers for scheduled UN Comtrade HS27 sync runs."""

from __future__ import annotations

from typing import Any, Optional, Sequence


def ensure_comtrade_sync_tables(conn: Any) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS comtrade_sync_runs (
                id SERIAL PRIMARY KEY,
                started_at TIMESTAMPTZ NOT NULL,
                finished_at TIMESTAMPTZ,
                status TEXT NOT NULL,
                year SMALLINT,
                requests_made INTEGER DEFAULT 0,
                rows_upserted INTEGER DEFAULT 0,
                errors JSONB,
                note TEXT
            );
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_comtrade_sync_runs_started
            ON comtrade_sync_runs (started_at DESC);
            """
        )


def start_sync_run(conn: Any, *, year: int) -> int:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO comtrade_sync_runs (started_at, status, year)
            VALUES (NOW(), 'running', %s)
            RETURNING id;
            """,
            (year,),
        )
        row = cur.fetchone()
        return int(row[0])


def finish_sync_run(
    conn: Any,
    run_id: int,
    *,
    status: str,
    requests_made: int,
    rows_upserted: int,
    errors: Optional[list[str]] = None,
    note: Optional[str] = None,
) -> None:
    import json

    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE comtrade_sync_runs
            SET finished_at = NOW(),
                status = %s,
                requests_made = %s,
                rows_upserted = %s,
                errors = %s::jsonb,
                note = %s
            WHERE id = %s;
            """,
            (
                status,
                requests_made,
                rows_upserted,
                json.dumps(errors or []),
                note,
                run_id,
            ),
        )


def list_sync_runs(conn: Any, *, limit: int = 50) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, started_at, finished_at, status, year,
                   requests_made, rows_upserted, errors, note
            FROM comtrade_sync_runs
            ORDER BY started_at DESC
            LIMIT %s;
            """,
            (max(1, min(limit, 200)),),
        )
        rows = cur.fetchall()
    return [_row_to_dict(row) for row in rows]


def _row_to_dict(row: Sequence[Any]) -> dict[str, Any]:
    return {
        "id": row[0],
        "started_at": row[1].isoformat() if row[1] else None,
        "finished_at": row[2].isoformat() if row[2] else None,
        "status": row[3],
        "year": row[4],
        "requests_made": row[5],
        "rows_upserted": row[6],
        "errors": row[7] or [],
        "note": row[8],
    }
