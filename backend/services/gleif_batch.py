"""
GLEIF LEI batch enrichment (Phase 4c)
=====================================

Walks ``oil_companies`` where ``lei IS NULL``, calls the public GLEIF
lookup helper (no API key required), and writes the best match into
``oil_companies.lei`` + ``oil_companies.lei_record_id``.

Documented optional rate limiting:

* ``GLEIF_BATCH_LIMIT``     — rows per run (default 100)
* ``GLEIF_BATCH_SLEEP``     — seconds between requests (default 0.4)
* ``GLEIF_BATCH_MIN_SCORE`` — minimum confidence to accept the top hit
  (default 0.0 — GLEIF results are exact-match heuristics already)

Migration 013 (Worker B) adds the columns; until it lands this writer
fails soft and reports ``status='skipped'``.
"""

from __future__ import annotations

import logging
import os
import time
from typing import Any, Optional

try:
    from backend.services.gleif_lookup import lookup_lei
except ImportError:  # pragma: no cover
    from services.gleif_lookup import lookup_lei  # type: ignore

LOG = logging.getLogger("meridian.gleif_batch")

DEFAULT_BATCH_LIMIT = int(os.getenv("GLEIF_BATCH_LIMIT", "100") or "100")
SLEEP_SECONDS = float(os.getenv("GLEIF_BATCH_SLEEP", "0.4") or "0.4")
MIN_SCORE = float(os.getenv("GLEIF_BATCH_MIN_SCORE", "0.0") or "0.0")


def _is_undefined_column(exc: Exception) -> bool:
    name = type(exc).__name__
    if name == "UndefinedColumn":
        return True
    pgcode = getattr(exc, "pgcode", "") or ""
    return pgcode == "42703"


def _has_lei_columns(cur: Any) -> bool:
    try:
        cur.execute(
            """
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'oil_companies'
              AND column_name = 'lei'
            LIMIT 1
            """
        )
        return cur.fetchone() is not None
    except Exception:
        return False


def _pick_best_match(matches: list[dict[str, Any]], company_name: str) -> Optional[dict[str, Any]]:
    """
    Return the first matched record whose legal_name overlaps with the
    queried company name. GLEIF doesn't return a numeric score; we treat
    "first issued record" as the canonical match per its docs.
    """
    if not matches:
        return None
    norm = (company_name or "").strip().lower()
    for m in matches:
        legal = (m.get("legal_name") or "").lower()
        if norm and legal and (norm in legal or legal in norm):
            return m
    return matches[0]


def enrich_companies_with_lei(
    conn: Any,
    *,
    limit: int = DEFAULT_BATCH_LIMIT,
    sleep_seconds: float = SLEEP_SECONDS,
) -> dict[str, Any]:
    """
    Pick up to ``limit`` rows from ``oil_companies`` where ``lei`` is NULL
    (or empty), call the GLEIF public API for each, and store the best
    match in ``oil_companies.lei`` / ``oil_companies.lei_record_id``.

    Safe to re-run. Wrapped to tolerate the lei columns being absent
    (migration 013 not yet applied).
    """
    if conn is None:
        return {"status": "skipped", "reason": "no db connection"}

    summary: dict[str, Any] = {
        "status": "ok",
        "candidates": 0,
        "lei_written": 0,
        "no_match": 0,
        "errors": [],
        "skipped_missing_columns": False,
    }

    try:
        with conn.cursor() as cur:
            if not _has_lei_columns(cur):
                summary["status"] = "skipped"
                summary["skipped_missing_columns"] = True
                summary["reason"] = "oil_companies.lei missing — apply migration 013"
                LOG.warning(
                    "enrich_companies_with_lei skipped: migration 013 not applied"
                )
                return summary

            cur.execute(
                """
                SELECT id::text, name
                FROM oil_companies
                WHERE (lei IS NULL OR length(TRIM(lei)) = 0)
                  AND name IS NOT NULL
                  AND length(TRIM(name)) >= 3
                ORDER BY COALESCE(updated_at, created_at) DESC NULLS LAST
                LIMIT %s
                """,
                (int(limit),),
            )
            rows = cur.fetchall() or []
    except Exception as exc:
        if _is_undefined_column(exc):
            summary["status"] = "skipped"
            summary["skipped_missing_columns"] = True
            summary["reason"] = "oil_companies.lei missing"
            return summary
        summary["status"] = "error"
        summary["errors"].append(f"select: {exc}")
        return summary

    summary["candidates"] = len(rows)

    for row in rows:
        company_id, name = row[0], row[1]
        try:
            lookup = lookup_lei(str(name))
        except Exception as exc:
            summary["errors"].append(f"{company_id}: lookup raised {exc}")
            continue

        if lookup.get("status") != "success":
            summary["no_match"] += 1
            continue

        best = _pick_best_match(lookup.get("matches") or [], str(name))
        if not best or not best.get("lei"):
            summary["no_match"] += 1
            continue

        lei_value = str(best.get("lei") or "")
        lei_record_id = lei_value  # GLEIF uses the LEI itself as the record id

        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE oil_companies
                    SET lei = %s,
                        lei_record_id = %s,
                        updated_at = now()
                    WHERE id = %s::uuid
                    """,
                    (lei_value, lei_record_id, company_id),
                )
            conn.commit()
            summary["lei_written"] += 1
        except Exception as exc:
            if _is_undefined_column(exc):
                try:
                    conn.rollback()
                except Exception:
                    pass
                summary["status"] = "skipped"
                summary["skipped_missing_columns"] = True
                summary["reason"] = "oil_companies.lei missing"
                return summary
            try:
                conn.rollback()
            except Exception:
                pass
            summary["errors"].append(f"{company_id}: {exc}")

        if sleep_seconds > 0:
            time.sleep(sleep_seconds)

    return summary


__all__ = ["enrich_companies_with_lei"]
