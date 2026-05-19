"""Match EU TED procurement notices to license / dossier entities by company name."""

from __future__ import annotations

import re
from typing import Any, Optional

try:
    from backend.services.eu_procurement_store import ensure_eu_procurement_tables, list_notices
except ImportError:
    from services.eu_procurement_store import ensure_eu_procurement_tables, list_notices


def _clean_text(value: Optional[str]) -> str:
    if not value:
        return ""
    return re.sub(r"\s+", " ", str(value).strip())


def _normalize_name(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.lower())


def _names_match(company: str, candidate: str) -> bool:
    a = _clean_text(company)
    b = _clean_text(candidate)
    if not a or not b:
        return False
    if a.lower() == b.lower():
        return True
    if len(a) >= 4 and a.lower() in b.lower():
        return True
    if len(b) >= 4 and b.lower() in a.lower():
        return True
    norm_a = _normalize_name(a)
    norm_b = _normalize_name(b)
    if len(norm_a) >= 4 and len(norm_b) >= 4:
        if norm_a in norm_b or norm_b in norm_a:
            return True
    return False


def collect_eu_procurement_for_company(
    conn: Any,
    *,
    company_name: str,
    country: Optional[str] = None,
    limit: int = 50,
    cpv_bucket: Optional[str] = None,
) -> dict[str, Any]:
    """Return TED notices whose buyer/title fuzzy-match the company name."""
    ensure_eu_procurement_tables(conn)
    cleaned = _clean_text(company_name)
    if not cleaned:
        return {
            "source": "TED (EU procurement)",
            "source_url": "https://ted.europa.eu/",
            "scope": "EU public procurement (mining / petroleum CPV)",
            "query_company": "",
            "country_filter": country,
            "limitations": [
                "Matches are heuristic on buyer name and notice title; verify at ted.europa.eu.",
            ],
            "warnings": ["No company name provided for matching."],
            "notices": [],
            "summary": {"notice_count": 0, "countries": []},
        }

    pool_limit = max(limit * 8, 200)
    candidates = list_notices(
        conn,
        country=country,
        cpv_bucket=cpv_bucket,
        limit=pool_limit,
    )

    matched: list[dict[str, Any]] = []
    countries_seen: set[str] = set()
    for notice in candidates:
        buyer = str(notice.get("buyer") or "")
        title = str(notice.get("title") or "")
        if _names_match(cleaned, buyer) or _names_match(cleaned, title):
            matched.append(notice)
            c = str(notice.get("country") or "").strip()
            if c:
                countries_seen.add(c)
        if len(matched) >= limit:
            break

    warnings: list[str] = []
    if not matched:
        warnings.append(
            f"No EU TED notices matched '{cleaned}'"
            + (f" in {country}" if country else "")
            + ". Sync via POST /api/admin/eu-procurement/sync if the table is empty."
        )

    return {
        "source": "TED (EU procurement)",
        "source_url": "https://ted.europa.eu/",
        "scope": "EU public procurement (mining / petroleum CPV)",
        "query_company": cleaned,
        "country_filter": country,
        "limitations": [
            "Heuristic name match on buyer and title only; not a legal entity registry link.",
            "CPV filter covers division 091* (mining / petroleum) and related metal codes.",
        ],
        "warnings": warnings,
        "notices": matched,
        "summary": {
            "notice_count": len(matched),
            "countries": sorted(countries_seen),
        },
    }


def serialize_eu_procurement_response(payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "source": payload.get("source"),
        "sourceUrl": payload.get("source_url"),
        "scope": payload.get("scope"),
        "queryCompany": payload.get("query_company"),
        "countryFilter": payload.get("country_filter"),
        "limitations": payload.get("limitations") or [],
        "warnings": payload.get("warnings") or [],
        "notices": payload.get("notices") or [],
        "summary": payload.get("summary") or {},
    }
