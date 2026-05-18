"""Sync U.S. federal procurement awards from USAspending into Postgres."""

from __future__ import annotations

import logging
import os
import time
from typing import Any, Callable, Optional

try:
    from backend.services.gov_procurement_intel import (
        COMMODITY_FEED_PROFILES,
        FEED_LIMIT_PER_PROFILE,
        REQUEST_TIMEOUT_SECONDS,
        USASPENDING_API_BASE,
        USASPENDING_SEARCH_PATH,
        _clean_text,
        _default_http_post,
        _gov_procurement_disabled,
        build_commodity_feed_search_payload,
        fetch_usaspending_awards,
        normalize_usaspending_row,
    )
    from backend.services.gov_procurement_store import (
        ensure_gov_procurement_tables,
        finish_sync_run,
        rebuild_recipient_aggregates,
        start_sync_run,
        upsert_award,
    )
except ImportError:
    from services.gov_procurement_intel import (
        COMMODITY_FEED_PROFILES,
        FEED_LIMIT_PER_PROFILE,
        REQUEST_TIMEOUT_SECONDS,
        USASPENDING_API_BASE,
        USASPENDING_SEARCH_PATH,
        _clean_text,
        _default_http_post,
        _gov_procurement_disabled,
        build_commodity_feed_search_payload,
        fetch_usaspending_awards,
        normalize_usaspending_row,
    )
    from services.gov_procurement_store import (
        ensure_gov_procurement_tables,
        finish_sync_run,
        rebuild_recipient_aggregates,
        start_sync_run,
        upsert_award,
    )

logger = logging.getLogger(__name__)

SYNC_ENABLED = (os.getenv("GOV_PROCUREMENT_SYNC_ENABLED") or "true").strip().lower() not in {
    "0",
    "false",
    "no",
    "off",
}
MAX_PAGES_PER_PROFILE = max(1, int(os.getenv("GOV_PROCUREMENT_SYNC_MAX_PAGES_PER_PROFILE", "3")))
SLEEP_SECONDS = max(0.0, float(os.getenv("GOV_PROCUREMENT_SYNC_SLEEP_SECONDS", "0.25")))
ENTITY_SYNC_TAG = "_entity"


def fetch_commodity_feed_page(
    profile: dict[str, Any],
    *,
    page: int,
    http_post: Callable[..., dict[str, Any]] = _default_http_post,
) -> tuple[list[dict[str, Any]], list[str]]:
    if _gov_procurement_disabled():
        return [], ["Live USAspending lookup is disabled (GOV_PROCUREMENT_DISABLED)."]

    url = f"{USASPENDING_API_BASE}{USASPENDING_SEARCH_PATH}"
    payload = build_commodity_feed_search_payload(profile, page=page)
    warnings: list[str] = []
    try:
        body = http_post(url, payload, timeout=REQUEST_TIMEOUT_SECONDS)
    except Exception as exc:
        logger.warning("USAspending commodity feed error (%s p%s): %s", profile.get("id"), page, exc)
        warnings.append(f"USAspending feed failed for {profile.get('id')}: {exc}")
        return [], warnings

    awards: list[dict[str, Any]] = []
    for row in body.get("results") or []:
        if not isinstance(row, dict):
            continue
        normalized = normalize_usaspending_row(row, recipient_name=_clean_text(row.get("Recipient Name")) or "")
        profile_label = profile.get("label") or profile.get("id")
        if profile_label:
            normalized["commodity"] = profile_label
        category = profile.get("category")
        if category:
            normalized["category"] = category
        awards.append(normalized)
    return awards, warnings


def sync_gov_procurement_data(
    conn: Any,
    *,
    http_post: Callable[..., dict[str, Any]] = _default_http_post,
    max_pages_per_profile: int = MAX_PAGES_PER_PROFILE,
) -> dict[str, Any]:
    """Pull commodity-filtered USAspending pages and upsert into Postgres."""
    if not SYNC_ENABLED:
        return {"status": "skipped", "reason": "GOV_PROCUREMENT_SYNC_ENABLED is off"}

    if _gov_procurement_disabled():
        return {"status": "skipped", "reason": "GOV_PROCUREMENT_DISABLED"}

    ensure_gov_procurement_tables(conn)
    conn.commit()

    run_id = start_sync_run(conn)
    conn.commit()
    upserted = 0
    warnings: list[str] = []

    try:
        with conn.cursor() as cur:
            for profile in COMMODITY_FEED_PROFILES:
                commodity_tag = str(profile.get("id") or "unknown")
                for page in range(1, max_pages_per_profile + 1):
                    awards, page_warnings = fetch_commodity_feed_page(
                        profile, page=page, http_post=http_post
                    )
                    warnings.extend(page_warnings)
                    if not awards:
                        break
                    for award in awards:
                        upsert_award(cur, award, commodity_tag=commodity_tag)
                        upserted += 1
                    conn.commit()
                    if SLEEP_SECONDS:
                        time.sleep(SLEEP_SECONDS)
                    if len(awards) < FEED_LIMIT_PER_PROFILE:
                        break

        recipients_updated = rebuild_recipient_aggregates(conn)
        conn.commit()
        finish_sync_run(conn, run_id, status="ok", records_upserted=upserted)
        conn.commit()
        return {
            "status": "ok",
            "records_upserted": upserted,
            "recipients_updated": recipients_updated,
            "warnings": warnings[:20],
        }
    except Exception as exc:
        conn.rollback()
        finish_sync_run(conn, run_id, status="error", records_upserted=upserted, error=str(exc))
        conn.commit()
        logger.exception("gov procurement sync failed")
        return {"status": "error", "message": str(exc), "records_upserted": upserted}


def sync_entity_awards_to_db(
    conn: Any,
    company_name: str,
    *,
    http_post: Callable[..., dict[str, Any]] = _default_http_post,
) -> dict[str, Any]:
    """Fetch awards for one company from USAspending and persist under _entity tag."""
    awards, warnings = fetch_usaspending_awards(company_name, http_post=http_post)
    if not awards:
        return {"records_upserted": 0, "warnings": warnings}

    ensure_gov_procurement_tables(conn)
    with conn.cursor() as cur:
        for award in awards:
            upsert_award(cur, award, commodity_tag=ENTITY_SYNC_TAG)
    conn.commit()
    rebuild_recipient_aggregates(conn)
    conn.commit()
    return {"records_upserted": len(awards), "warnings": warnings}
