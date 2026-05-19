"""Postgres persistence for EU TED procurement notices."""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Optional, Sequence


def ensure_eu_procurement_tables(conn: Any) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS eu_procurement_notices (
                notice_id TEXT PRIMARY KEY,
                title TEXT,
                buyer TEXT,
                country TEXT,
                cpv TEXT,
                award_value DOUBLE PRECISION,
                published_at TIMESTAMPTZ,
                source_url TEXT,
                raw_payload JSONB,
                fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_eu_proc_notices_country
            ON eu_procurement_notices (country);
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_eu_proc_notices_cpv
            ON eu_procurement_notices (cpv);
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_eu_proc_notices_published
            ON eu_procurement_notices (published_at DESC);
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS eu_procurement_sync_runs (
                id SERIAL PRIMARY KEY,
                started_at TIMESTAMPTZ NOT NULL,
                finished_at TIMESTAMPTZ,
                status TEXT NOT NULL,
                notices_fetched INTEGER DEFAULT 0,
                notices_upserted INTEGER DEFAULT 0,
                errors JSONB,
                note TEXT
            );
            """
        )


def start_sync_run(conn: Any) -> int:
    ensure_eu_procurement_tables(conn)
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO eu_procurement_sync_runs (started_at, status)
            VALUES (NOW(), 'running')
            RETURNING id;
            """,
        )
        row = cur.fetchone()
        return int(row[0])


def finish_sync_run(
    conn: Any,
    run_id: int,
    *,
    status: str,
    notices_fetched: int = 0,
    notices_upserted: int = 0,
    errors: Optional[list[str]] = None,
    note: Optional[str] = None,
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE eu_procurement_sync_runs
            SET finished_at = NOW(),
                status = %s,
                notices_fetched = %s,
                notices_upserted = %s,
                errors = %s::jsonb,
                note = %s
            WHERE id = %s;
            """,
            (
                status,
                notices_fetched,
                notices_upserted,
                json.dumps(errors or []),
                note,
                run_id,
            ),
        )


def upsert_notice(conn: Any, notice: dict[str, Any]) -> bool:
    notice_id = str(notice.get("notice_id") or "").strip()
    if not notice_id:
        return False
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO eu_procurement_notices (
                notice_id, title, buyer, country, cpv, award_value,
                published_at, source_url, raw_payload, fetched_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, NOW())
            ON CONFLICT (notice_id) DO UPDATE SET
                title = EXCLUDED.title,
                buyer = EXCLUDED.buyer,
                country = EXCLUDED.country,
                cpv = EXCLUDED.cpv,
                award_value = EXCLUDED.award_value,
                published_at = EXCLUDED.published_at,
                source_url = EXCLUDED.source_url,
                raw_payload = EXCLUDED.raw_payload,
                fetched_at = NOW();
            """,
            (
                notice_id,
                notice.get("title"),
                notice.get("buyer"),
                notice.get("country"),
                notice.get("cpv"),
                notice.get("award_value"),
                notice.get("published_at"),
                notice.get("source_url"),
                json.dumps(notice.get("raw_payload") or {}),
            ),
        )
    return True


def list_notices(
    conn: Any,
    *,
    commodity: Optional[str] = None,
    country: Optional[str] = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    ensure_eu_procurement_tables(conn)
    clauses = ["1=1"]
    params: list[Any] = []

    if country:
        clauses.append("UPPER(country) = UPPER(%s)")
        params.append(country.strip())
    if commodity:
        clauses.append(
            "(UPPER(title) LIKE %s OR UPPER(cpv) LIKE %s OR UPPER(buyer) LIKE %s)"
        )
        pattern = f"%{commodity.strip().upper()}%"
        params.extend([pattern, pattern, pattern])

    params.append(max(1, min(limit, 500)))
    sql = f"""
        SELECT notice_id, title, buyer, country, cpv, award_value,
               published_at, source_url, fetched_at
        FROM eu_procurement_notices
        WHERE {' AND '.join(clauses)}
        ORDER BY published_at DESC NULLS LAST, notice_id DESC
        LIMIT %s;
    """
    with conn.cursor() as cur:
        cur.execute(sql, tuple(params))
        rows = cur.fetchall()
    return [_notice_row_to_dict(row) for row in rows]


def list_sync_runs(conn: Any, *, limit: int = 20) -> list[dict[str, Any]]:
    ensure_eu_procurement_tables(conn)
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, started_at, finished_at, status,
                   notices_fetched, notices_upserted, errors, note
            FROM eu_procurement_sync_runs
            ORDER BY started_at DESC
            LIMIT %s;
            """,
            (max(1, min(limit, 100)),),
        )
        rows = cur.fetchall()
    out: list[dict[str, Any]] = []
    for row in rows:
        out.append(
            {
                "id": row[0],
                "started_at": row[1].isoformat() if row[1] else None,
                "finished_at": row[2].isoformat() if row[2] else None,
                "status": row[3],
                "notices_fetched": row[4],
                "notices_upserted": row[5],
                "errors": row[6] or [],
                "note": row[7],
            }
        )
    return out


def _notice_row_to_dict(row: Sequence[Any]) -> dict[str, Any]:
    published = row[6]
    fetched = row[8]
    return {
        "notice_id": row[0],
        "title": row[1],
        "buyer": row[2],
        "country": row[3],
        "cpv": row[4],
        "award_value": row[5],
        "published_at": published.isoformat() if hasattr(published, "isoformat") else published,
        "source_url": row[7],
        "fetched_at": fetched.isoformat() if hasattr(fetched, "isoformat") else fetched,
    }
