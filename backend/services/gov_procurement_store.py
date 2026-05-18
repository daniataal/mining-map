"""Postgres persistence for U.S. federal procurement (USAspending) awards."""

from __future__ import annotations

import json
import re
from datetime import date, datetime, timezone
from typing import Any, Optional

try:
    from backend.services.gov_procurement_intel import (
        COMMODITY_FEED_PROFILES,
        FEED_LIMITATIONS,
        LIMITATIONS,
        SOURCE_HOME,
        SOURCE_NAME,
        _clean_text,
        build_procurement_summary,
        build_recipient_profile,
        format_award_period,
    )
except ImportError:
    from services.gov_procurement_intel import (
        COMMODITY_FEED_PROFILES,
        FEED_LIMITATIONS,
        LIMITATIONS,
        SOURCE_HOME,
        SOURCE_NAME,
        _clean_text,
        build_procurement_summary,
        build_recipient_profile,
        format_award_period,
    )

_COMMODITY_LABELS = {
    str(profile.get("id") or ""): str(profile.get("label") or profile.get("id") or "")
    for profile in COMMODITY_FEED_PROFILES
}

_RECIPIENT_KEY_RE = re.compile(r"[^a-z0-9]+")


def normalize_recipient_key(*, name: str, uei: Optional[str] = None) -> str:
    cleaned_uei = _clean_text(uei)
    if cleaned_uei:
        return f"uei:{cleaned_uei.upper()}"
    slug = _RECIPIENT_KEY_RE.sub("", (name or "").lower())
    return f"name:{slug or 'unknown'}"


def ensure_gov_procurement_tables(conn: Any) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS gov_procurement_awards (
                award_id TEXT NOT NULL,
                commodity_tag TEXT NOT NULL,
                recipient_name TEXT,
                uei TEXT,
                amount DOUBLE PRECISION DEFAULT 0,
                agency TEXT,
                award_date DATE,
                naics TEXT,
                description_snippet TEXT,
                usaspending_url TEXT,
                generated_internal_id TEXT,
                recipient_id TEXT,
                category TEXT,
                commodity_label TEXT,
                start_date DATE,
                end_date DATE,
                psc TEXT,
                award_type TEXT,
                status TEXT,
                fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY (award_id, commodity_tag)
            );
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_gov_proc_awards_uei
            ON gov_procurement_awards (uei);
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_gov_proc_awards_recipient_name
            ON gov_procurement_awards (LOWER(recipient_name));
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_gov_proc_awards_commodity
            ON gov_procurement_awards (commodity_tag);
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS gov_procurement_recipients (
                recipient_key TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                uei TEXT,
                total_amount DOUBLE PRECISION DEFAULT 0,
                award_count INTEGER DEFAULT 0,
                commodity_tags JSONB NOT NULL DEFAULT '[]'::jsonb,
                last_synced_at TIMESTAMPTZ
            );
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_gov_proc_recipients_name
            ON gov_procurement_recipients (LOWER(name));
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS gov_procurement_sync_runs (
                id SERIAL PRIMARY KEY,
                started_at TIMESTAMPTZ NOT NULL,
                finished_at TIMESTAMPTZ,
                status TEXT NOT NULL,
                records_upserted INTEGER DEFAULT 0,
                error TEXT
            );
            """
        )


def start_sync_run(conn: Any) -> int:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO gov_procurement_sync_runs (started_at, status)
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
    records_upserted: int,
    error: Optional[str] = None,
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE gov_procurement_sync_runs
            SET finished_at = NOW(),
                status = %s,
                records_upserted = %s,
                error = %s
            WHERE id = %s;
            """,
            (status, records_upserted, error, run_id),
        )


def upsert_award(
    cur: Any,
    award: dict[str, Any],
    *,
    commodity_tag: str,
) -> None:
    start = award.get("start_date")
    end = award.get("end_date")
    award_date = start
    if isinstance(award_date, str):
        award_date = award_date[:10]
    cur.execute(
        """
        INSERT INTO gov_procurement_awards (
            award_id, commodity_tag, recipient_name, uei, amount, agency, award_date,
            naics, description_snippet, usaspending_url, generated_internal_id,
            recipient_id, category, commodity_label, start_date, end_date, psc,
            award_type, status, fetched_at
        ) VALUES (
            %s, %s, %s, %s, %s, %s, %s,
            %s, %s, %s, %s,
            %s, %s, %s, %s, %s, %s,
            %s, %s, NOW()
        )
        ON CONFLICT (award_id, commodity_tag) DO UPDATE SET
            recipient_name = EXCLUDED.recipient_name,
            uei = EXCLUDED.uei,
            amount = EXCLUDED.amount,
            agency = EXCLUDED.agency,
            award_date = EXCLUDED.award_date,
            naics = EXCLUDED.naics,
            description_snippet = EXCLUDED.description_snippet,
            usaspending_url = EXCLUDED.usaspending_url,
            generated_internal_id = EXCLUDED.generated_internal_id,
            recipient_id = EXCLUDED.recipient_id,
            category = EXCLUDED.category,
            commodity_label = EXCLUDED.commodity_label,
            start_date = EXCLUDED.start_date,
            end_date = EXCLUDED.end_date,
            psc = EXCLUDED.psc,
            award_type = EXCLUDED.award_type,
            status = EXCLUDED.status,
            fetched_at = NOW();
        """,
        (
            award.get("award_id") or "unknown",
            commodity_tag,
            award.get("recipient"),
            award.get("uei"),
            float(award.get("value_usd") or 0),
            award.get("agency"),
            award_date,
            award.get("naics"),
            (award.get("title") or "")[:500],
            award.get("source_url"),
            award.get("generated_internal_id"),
            award.get("recipient_id"),
            award.get("category"),
            award.get("commodity"),
            start,
            end,
            award.get("psc"),
            award.get("award_type"),
            award.get("status"),
        ),
    )


def rebuild_recipient_aggregates(conn: Any) -> int:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO gov_procurement_recipients (
                recipient_key, name, uei, total_amount, award_count, commodity_tags, last_synced_at
            )
            SELECT
                CASE
                    WHEN NULLIF(BTRIM(uei), '') IS NOT NULL THEN 'uei:' || UPPER(BTRIM(uei))
                    ELSE 'name:' || REGEXP_REPLACE(LOWER(COALESCE(recipient_name, '')), '[^a-z0-9]', '', 'g')
                END AS recipient_key,
                MAX(recipient_name) AS name,
                MAX(uei) AS uei,
                COALESCE(SUM(amount), 0) AS total_amount,
                COUNT(*)::INTEGER AS award_count,
                COALESCE(
                    jsonb_agg(DISTINCT commodity_tag) FILTER (WHERE commodity_tag IS NOT NULL),
                    '[]'::jsonb
                ) AS commodity_tags,
                MAX(fetched_at) AS last_synced_at
            FROM gov_procurement_awards
            WHERE COALESCE(recipient_name, '') <> ''
            GROUP BY 1
            ON CONFLICT (recipient_key) DO UPDATE SET
                name = EXCLUDED.name,
                uei = EXCLUDED.uei,
                total_amount = EXCLUDED.total_amount,
                award_count = EXCLUDED.award_count,
                commodity_tags = EXCLUDED.commodity_tags,
                last_synced_at = EXCLUDED.last_synced_at;
            """
        )
        return cur.rowcount


def _award_row_to_intel(row: dict[str, Any]) -> dict[str, Any]:
    start = row.get("start_date")
    end = row.get("end_date")
    if hasattr(start, "isoformat"):
        start_s = start.isoformat()
    else:
        start_s = str(start) if start else None
    if hasattr(end, "isoformat"):
        end_s = end.isoformat()
    else:
        end_s = str(end) if end else None

    period = format_award_period(
        start if isinstance(start, date) else None,
        end if isinstance(end, date) else None,
    )
    return {
        "award_id": row.get("award_id"),
        "title": row.get("description_snippet") or row.get("commodity_label") or "Federal award",
        "agency": row.get("agency") or "U.S. Federal",
        "value_usd": float(row.get("amount") or 0),
        "commodity": row.get("commodity_label") or row.get("commodity_tag") or "Federal Award",
        "category": row.get("category") or "other",
        "uei": row.get("uei"),
        "duns": None,
        "status": row.get("status") or "ACTIVE",
        "period": period,
        "recipient": row.get("recipient_name"),
        "start_date": start_s,
        "end_date": end_s,
        "naics": row.get("naics"),
        "psc": row.get("psc"),
        "award_type": row.get("award_type"),
        "source_name": SOURCE_NAME,
        "source_url": row.get("usaspending_url"),
        "generated_internal_id": row.get("generated_internal_id"),
        "recipient_id": row.get("recipient_id"),
    }


def _company_match_sql() -> str:
    return """
        (
            LOWER(name) = LOWER(%s)
            OR LOWER(name) LIKE LOWER(%s)
            OR LOWER(%s) LIKE LOWER(name) || '%%'
            OR (
                LENGTH(REGEXP_REPLACE(LOWER(%s), '[^a-z0-9]', '', 'g')) >= 4
                AND REGEXP_REPLACE(LOWER(name), '[^a-z0-9]', '', 'g')
                    LIKE '%%' || REGEXP_REPLACE(LOWER(%s), '[^a-z0-9]', '', 'g') || '%%'
            )
        )
    """


def find_recipient_keys_for_company(conn: Any, company_name: str) -> list[str]:
    cleaned = _clean_text(company_name)
    if not cleaned:
        return []
    like_pattern = f"%{cleaned}%"
    with conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT recipient_key FROM gov_procurement_recipients
            WHERE {_company_match_sql()};
            """,
            (cleaned, like_pattern, cleaned, cleaned, cleaned),
        )
        return [row[0] for row in cur.fetchall()]


def list_awards_for_company(conn: Any, company_name: str, *, limit: int = 100) -> list[dict[str, Any]]:
    cleaned = _clean_text(company_name)
    if not cleaned:
        return []
    like_pattern = f"%{cleaned}%"
    recipient_keys = find_recipient_keys_for_company(conn, company_name)
    with conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT DISTINCT ON (award_id)
                award_id, commodity_tag, recipient_name, uei, amount, agency, award_date,
                naics, description_snippet, usaspending_url, generated_internal_id,
                recipient_id, category, commodity_label, start_date, end_date, psc,
                award_type, status, fetched_at
            FROM gov_procurement_awards
            WHERE COALESCE(recipient_name, '') <> ''
              AND (
                {_company_match_sql().replace('name', 'recipient_name')}
                OR (
                    %s::text[] IS NOT NULL
                    AND CASE
                        WHEN NULLIF(BTRIM(uei), '') IS NOT NULL THEN 'uei:' || UPPER(BTRIM(uei))
                        ELSE 'name:' || REGEXP_REPLACE(LOWER(COALESCE(recipient_name, '')), '[^a-z0-9]', '', 'g')
                    END = ANY(%s::text[])
                )
              )
            ORDER BY award_id, amount DESC NULLS LAST
            LIMIT %s;
            """,
            (
                cleaned,
                like_pattern,
                cleaned,
                cleaned,
                cleaned,
                recipient_keys or [],
                recipient_keys or [],
                limit,
            ),
        )
        columns = [desc[0] for desc in cur.description]
        rows = [dict(zip(columns, row)) for row in cur.fetchall()]
    awards = [_award_row_to_intel(row) for row in rows]
    awards.sort(key=lambda row: float(row.get("value_usd") or 0), reverse=True)
    return awards


def list_companies(
    conn: Any,
    *,
    commodity: Optional[str] = None,
    page: int = 1,
    page_size: int = 50,
) -> tuple[list[dict[str, Any]], int]:
    page = max(1, page)
    page_size = max(1, min(page_size, 200))
    offset = (page - 1) * page_size
    params: list[Any] = []
    where = ""
    if commodity:
        where = "WHERE commodity_tags @> %s::jsonb"
        params.append(json.dumps([commodity.strip().lower()]))

    with conn.cursor() as cur:
        cur.execute(
            f"SELECT COUNT(*) FROM gov_procurement_recipients {where};",
            params,
        )
        total = int(cur.fetchone()[0])
        cur.execute(
            f"""
            SELECT recipient_key, name, uei, total_amount, award_count, commodity_tags, last_synced_at
            FROM gov_procurement_recipients
            {where}
            ORDER BY total_amount DESC NULLS LAST, name ASC
            LIMIT %s OFFSET %s;
            """,
            [*params, page_size, offset],
        )
        columns = [desc[0] for desc in cur.description]
        rows = [dict(zip(columns, row)) for row in cur.fetchall()]

    companies = [_recipient_row_to_company_api(row) for row in rows]
    return companies, total


def _recipient_row_to_company_api(row: dict[str, Any]) -> dict[str, Any]:
    tags = row.get("commodity_tags")
    if isinstance(tags, str):
        try:
            tags = json.loads(tags)
        except json.JSONDecodeError:
            tags = []
    if not isinstance(tags, list):
        tags = []
    commodities = [_COMMODITY_LABELS.get(str(tag), str(tag).title()) for tag in tags]
    return {
        "companyKey": row.get("recipient_key"),
        "name": row.get("name"),
        "uei": row.get("uei"),
        "totalAwardedUsd": float(row.get("total_amount") or 0),
        "awardCount": int(row.get("award_count") or 0),
        "commodities": commodities,
        "commodityTags": tags,
        "lastSyncedAt": (
            row["last_synced_at"].isoformat()
            if row.get("last_synced_at") and hasattr(row["last_synced_at"], "isoformat")
            else row.get("last_synced_at")
        ),
    }


def collect_commodity_feed_from_db(
    conn: Any,
    *,
    commodity: Optional[str] = None,
    page: int = 1,
    page_size: int = 50,
) -> dict[str, Any]:
    companies, total = list_companies(conn, commodity=commodity, page=page, page_size=page_size)
    return {
        "source": SOURCE_NAME,
        "source_url": SOURCE_HOME,
        "scope": "U.S. federal contracts by commodity (database browse feed)",
        "limitations": FEED_LIMITATIONS,
        "warnings": [] if companies else ["No companies in database yet — run gov procurement sync."],
        "cached": False,
        "data_origin": "database",
        "cached_at": None,
        "queried_at": datetime.now(timezone.utc).isoformat(),
        "companies": companies,
        "commodity_profiles": [
            {"id": p.get("id"), "label": p.get("label"), "category": p.get("category")}
            for p in COMMODITY_FEED_PROFILES
        ],
        "pagination": {"page": page, "pageSize": page_size, "total": total},
    }


def collect_gov_procurement_from_db(
    conn: Any,
    *,
    company_name: str,
    country: Optional[str] = None,
    limit: int = 100,
) -> dict[str, Any]:
    awards = list_awards_for_company(conn, company_name, limit=limit)
    summary = build_procurement_summary(awards)
    recipient_profile = build_recipient_profile(awards, query_name=company_name)
    scope_notes = list(LIMITATIONS)
    scope_notes.insert(
        0,
        "Results loaded from the local procurement database (synced from USAspending).",
    )
    if country and country.strip().lower() not in {
        "united states",
        "usa",
        "us",
        "u.s.",
        "u.s.a.",
    }:
        scope_notes.insert(
            1,
            f"License country is {country.strip()} — federal U.S. awards may not apply to this entity.",
        )
    last_synced = None
    keys = find_recipient_keys_for_company(conn, company_name)
    if keys:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT MAX(last_synced_at) FROM gov_procurement_recipients
                WHERE recipient_key = ANY(%s);
                """,
                (keys,),
            )
            row = cur.fetchone()
            if row and row[0]:
                last_synced = row[0]

    return {
        "source": SOURCE_NAME,
        "source_url": SOURCE_HOME,
        "scope": "U.S. federal awards (contracts, grants, loans)",
        "limitations": scope_notes,
        "warnings": [] if awards else ["No matching awards in local database — run sync or use ?live=1."],
        "recipient_profile": recipient_profile,
        "summary": summary,
        "awards": awards,
        "queried_at": datetime.now(timezone.utc).isoformat(),
        "query_company": _clean_text(company_name),
        "data_origin": "database",
        "last_synced_at": (
            last_synced.isoformat() if last_synced and hasattr(last_synced, "isoformat") else last_synced
        ),
    }

