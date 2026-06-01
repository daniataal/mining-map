"""
OpenSanctions screening service (Phase 4a)
==========================================

Free-tier API: https://api.opensanctions.org/search/default
Documented optional higher-rate-limit key: set ``OPENSANCTIONS_API_KEY``
(passed via ``Authorization: ApiKey <key>`` header).

Public helpers
--------------
* ``screen_company(name)``                       → ``{ status, matches }``
* ``screen_companies_for_sanctions(conn, limit)`` → batched DB writer

Database side-effects (Worker B migration 013 adds these columns to
``oil_companies``):

* ``sanctions_status TEXT``         — ``clear`` | ``flagged`` | ``review`` | ``unknown``
* ``sanctions_checked_at TIMESTAMPTZ``
* ``sanctions_matches JSONB``       — top-5 minimal hits

If migration 013 is not yet applied, the writer **fails soft** (logs a
warning and returns ``status='skipped'``) so the rest of graph-sync still
runs. We **never** auto-block the UI — flagged matches surface as a chip
in the OilLiveEntityDrawer.
"""

from __future__ import annotations

import json
import logging
import os
import re
import time
from typing import Any, Optional

try:
    import requests
except ImportError:  # pragma: no cover - requests is in requirements.txt
    requests = None  # type: ignore

LOG = logging.getLogger("meridian.opensanctions")

OPENSANCTIONS_SEARCH_URL = "https://api.opensanctions.org/search/default"

REQUEST_TIMEOUT_SECONDS = 10
DEFAULT_BATCH_LIMIT = int(os.getenv("OPENSANCTIONS_BATCH_LIMIT", "50") or "50")
THROTTLE_SECONDS = 1.0  # OpenSanctions free tier ≈ 1 req/s
SCORE_FLAG_THRESHOLD = 0.8
SCORE_REVIEW_THRESHOLD = 0.5

USER_AGENT = os.getenv(
    "OPENSANCTIONS_USER_AGENT",
    "Meridian/1.0 (open-data screening; ops@meridian.example)",
)


def _is_undefined_column(exc: Exception) -> bool:
    """Detect ``psycopg2.errors.UndefinedColumn`` without importing it at module load."""
    name = type(exc).__name__
    if name == "UndefinedColumn":
        return True
    pgcode = getattr(exc, "pgcode", "") or ""
    return pgcode == "42703"  # SQLSTATE undefined_column


def _classify_status(matches: list[dict[str, Any]]) -> str:
    if not matches:
        return "clear"
    top = matches[0]
    top_score = float(top.get("score") or 0.0)
    if top_score >= SCORE_FLAG_THRESHOLD:
        return "flagged"
    if top_score >= SCORE_REVIEW_THRESHOLD:
        return "review"
    return "clear"


def _trim_match(item: dict[str, Any]) -> dict[str, Any]:
    """Reduce a raw OpenSanctions result to a small JSON-safe dict."""
    if not isinstance(item, dict):
        return {}
    props = item.get("properties") or {}

    def _first(values: Any) -> Optional[str]:
        if isinstance(values, list) and values:
            return str(values[0])
        if isinstance(values, str):
            return values
        return None

    return {
        "id": item.get("id"),
        "caption": item.get("caption") or _first(props.get("name")),
        "schema": item.get("schema"),
        "score": float(item.get("score") or 0.0),
        "datasets": item.get("datasets") or [],
        "topics": item.get("topics") or props.get("topics") or [],
        "countries": props.get("country") or props.get("jurisdiction") or [],
        "first_seen": item.get("first_seen"),
        "last_seen": item.get("last_seen"),
    }


def _build_headers() -> dict[str, str]:
    headers = {"Accept": "application/json", "User-Agent": USER_AGENT}
    key = (os.getenv("OPENSANCTIONS_API_KEY") or "").strip()
    if key:
        headers["Authorization"] = f"ApiKey {key}"
    return headers


def screen_company(name: str, *, limit: int = 5) -> dict[str, Any]:
    """
    Look up a single legal name against the default OpenSanctions dataset.

    Returns ``{ status, matches, message?, status_code? }``. ``status``:

    * ``flagged`` — top match score ≥ 0.8
    * ``review``  — top match score 0.5–0.8 (operator should eyeball)
    * ``clear``   — zero matches above 0.5
    * ``unknown`` — HTTP 429/5xx, network error, or bad payload

    Never auto-blocks. Caller stores the status + matches and shows a chip
    in the UI; **we never claim a confirmed sanction**.
    """
    query = (name or "").strip()
    if not query:
        return {"status": "unknown", "matches": [], "message": "empty name"}
    if requests is None:
        return {
            "status": "unknown",
            "matches": [],
            "message": "requests library unavailable",
        }

    params = {"q": query, "limit": int(limit) if limit else 5}
    try:
        resp = requests.get(
            OPENSANCTIONS_SEARCH_URL,
            params=params,
            headers=_build_headers(),
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
    except Exception as exc:  # noqa: BLE001 — best-effort, treat as unknown
        LOG.warning("OpenSanctions network error for %s: %s", query, exc)
        return {
            "status": "unknown",
            "matches": [],
            "message": f"network error: {exc}",
        }

    status_code = getattr(resp, "status_code", 0)
    if status_code in (429,) or 500 <= status_code < 600:
        LOG.warning(
            "OpenSanctions HTTP %s for query=%s — treating as unknown",
            status_code,
            query,
        )
        return {
            "status": "unknown",
            "matches": [],
            "status_code": status_code,
            "message": "rate limited or upstream error",
        }
    if status_code != 200:
        return {
            "status": "unknown",
            "matches": [],
            "status_code": status_code,
            "message": f"HTTP {status_code}",
        }

    try:
        payload = resp.json()
    except Exception as exc:  # noqa: BLE001
        return {
            "status": "unknown",
            "matches": [],
            "status_code": status_code,
            "message": f"bad JSON: {exc}",
        }

    raw_results = payload.get("results") if isinstance(payload, dict) else []
    matches = [_trim_match(r) for r in (raw_results or [])][:limit]
    matches.sort(key=lambda m: float(m.get("score") or 0.0), reverse=True)

    return {
        "status": _classify_status(matches),
        "matches": matches,
        "query": query,
        "status_code": status_code,
    }


def _has_required_columns(cur: Any) -> bool:
    """Quick probe — graph-sync should not crash if Worker B migration 013 is missing."""
    try:
        cur.execute(
            """
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'oil_companies'
              AND column_name = 'sanctions_status'
            LIMIT 1
            """
        )
        return cur.fetchone() is not None
    except Exception:
        return False


def _coerce_json(payload: Any) -> Any:
    try:
        from psycopg2.extras import Json  # type: ignore
        return Json(payload)
    except Exception:
        return json.dumps(payload, default=str)


def screen_companies_for_sanctions(
    conn: Any,
    *,
    limit: int = DEFAULT_BATCH_LIMIT,
    throttle_seconds: float = THROTTLE_SECONDS,
    recheck_after_days: int = 30,
) -> dict[str, Any]:
    """
    Pick up to ``limit`` rows from ``oil_companies`` where
    ``sanctions_checked_at`` is NULL or older than ``recheck_after_days``,
    call :func:`screen_company`, write status back into ``oil_companies``.

    Wraps every step in try/except; an upstream outage produces
    ``status='unknown'`` rows (not a hard error) so the next graph-sync run
    can retry. Returns a counters dict.
    """
    if conn is None:
        return {"status": "skipped", "reason": "no db connection"}

    summary: dict[str, Any] = {
        "status": "ok",
        "checked": 0,
        "flagged": 0,
        "review": 0,
        "clear": 0,
        "unknown": 0,
        "skipped_missing_columns": False,
        "errors": [],
    }

    try:
        with conn.cursor() as cur:
            if not _has_required_columns(cur):
                summary["status"] = "skipped"
                summary["skipped_missing_columns"] = True
                summary["reason"] = (
                    "oil_companies.sanctions_status missing — apply migration 013"
                )
                LOG.warning(
                    "screen_companies_for_sanctions skipped: migration 013 not applied"
                )
                return summary

            cur.execute(
                """
                SELECT id::text, name
                FROM oil_companies
                WHERE (sanctions_checked_at IS NULL
                       OR sanctions_checked_at < now() - %s::interval)
                  AND name IS NOT NULL
                  AND length(TRIM(name)) >= 3
                ORDER BY
                  CASE WHEN sanctions_checked_at IS NULL THEN 0 ELSE 1 END,
                  COALESCE(updated_at, created_at) DESC NULLS LAST
                LIMIT %s
                """,
                (f"{int(recheck_after_days)} days", int(limit)),
            )
            rows = cur.fetchall() or []
    except Exception as exc:
        if _is_undefined_column(exc):
            summary["status"] = "skipped"
            summary["skipped_missing_columns"] = True
            summary["reason"] = "oil_companies.sanctions_status missing"
            LOG.warning(
                "screen_companies_for_sanctions: missing column, skipping (%s)", exc
            )
            return summary
        summary["status"] = "error"
        summary["errors"].append(f"select: {exc}")
        return summary

    for row in rows:
        company_id, name = row[0], row[1]
        result = screen_company(str(name))
        status = result.get("status") or "unknown"
        summary[status] = summary.get(status, 0) + 1
        summary["checked"] += 1

        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE oil_companies
                    SET sanctions_status = %s,
                        sanctions_checked_at = now(),
                        sanctions_matches = %s,
                        updated_at = now()
                    WHERE id = %s::uuid
                    """,
                    (status, _coerce_json(result.get("matches") or []), company_id),
                )
            conn.commit()
        except Exception as exc:
            if _is_undefined_column(exc):
                try:
                    conn.rollback()
                except Exception:
                    pass
                summary["status"] = "skipped"
                summary["skipped_missing_columns"] = True
                summary["reason"] = "oil_companies.sanctions_status missing"
                LOG.warning(
                    "screen_companies_for_sanctions: lost columns mid-batch (%s)",
                    exc,
                )
                return summary
            try:
                conn.rollback()
            except Exception:
                pass
            summary["errors"].append(f"{company_id}: {exc}")

        if throttle_seconds > 0:
            time.sleep(throttle_seconds)

    return summary


__all__ = [
    "screen_company",
    "screen_companies_for_sanctions",
    "OPENSANCTIONS_SEARCH_URL",
]
