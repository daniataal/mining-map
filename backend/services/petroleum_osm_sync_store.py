"""Persistence helpers for petroleum OSM sync runs (mirrors comtrade_sync_runs)."""

from __future__ import annotations

from typing import Any, Optional, Sequence


def ensure_petroleum_osm_sync_tables(conn: Any) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS petroleum_osm_sync_runs (
                id SERIAL PRIMARY KEY,
                started_at TIMESTAMPTZ NOT NULL,
                finished_at TIMESTAMPTZ,
                status TEXT NOT NULL,
                layers_processed INTEGER DEFAULT 0,
                features_upserted INTEGER DEFAULT 0,
                errors JSONB,
                note TEXT
            );
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_petroleum_osm_sync_runs_started
            ON petroleum_osm_sync_runs (started_at DESC);
            """
        )


def start_sync_run(conn: Any) -> int:
    ensure_petroleum_osm_sync_tables(conn)
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO petroleum_osm_sync_runs (started_at, status)
            VALUES (NOW(), 'running')
            RETURNING id;
            """
        )
        row = cur.fetchone()
        return int(row[0])


def finish_sync_run(
    conn: Any,
    run_id: int,
    *,
    status: str,
    layers_processed: int = 0,
    features_upserted: int = 0,
    errors: Optional[list[str]] = None,
    note: Optional[str] = None,
) -> None:
    import json

    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE petroleum_osm_sync_runs
            SET finished_at = NOW(),
                status = %s,
                layers_processed = %s,
                features_upserted = %s,
                errors = %s::jsonb,
                note = %s
            WHERE id = %s;
            """,
            (
                status,
                layers_processed,
                features_upserted,
                json.dumps(errors or []),
                note,
                run_id,
            ),
        )


def list_sync_runs(conn: Any, *, limit: int = 50) -> list[dict[str, Any]]:
    ensure_petroleum_osm_sync_tables(conn)
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, started_at, finished_at, status,
                   layers_processed, features_upserted, errors, note
            FROM petroleum_osm_sync_runs
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
        "layers_processed": row[4],
        "features_upserted": row[5],
        "errors": row[6] or [],
        "note": row[7],
    }
