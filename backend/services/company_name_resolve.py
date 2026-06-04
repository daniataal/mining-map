"""Resolve display names to oil_companies rows for map commercial leads."""

from __future__ import annotations

import re
from difflib import SequenceMatcher
from typing import Any, Optional

try:
    from backend.services.port_authority_directory import _normalize_company_name
except ImportError:
    from services.port_authority_directory import _normalize_company_name  # type: ignore


def normalize_company_name(name: str) -> str:
    return _normalize_company_name(name)


def _similarity(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, a, b).ratio()


def _row_to_payload(row: tuple[Any, ...], *, match_confidence: str, source: str) -> dict[str, Any]:
    company_id, name, normalized_name, country, lei, company_source, confidence = row[:7]
    return {
        "company_id": str(company_id) if company_id is not None else None,
        "name": name,
        "normalized_name": normalized_name,
        "country": country or "",
        "lei": lei,
        "match_confidence": match_confidence,
        "source": source,
        "registry_source": company_source,
        "confidence": float(confidence) if confidence is not None else None,
    }


def resolve_company_name(
    conn: Any,
    *,
    name: str,
    country: str = "",
) -> dict[str, Any]:
    """Lookup oil_companies by normalized name; optional fuzzy top-1."""
    raw = (name or "").strip()
    if len(raw) < 2:
        return {
            "found": False,
            "match_confidence": "none",
            "source": "resolve",
            "reason": "name too short",
        }

    norm = normalize_company_name(raw)
    country_key = (country or "").strip()

    with conn.cursor() as cur:
        if country_key:
            cur.execute(
                """
                SELECT id, name, normalized_name, country, lei, source, confidence
                FROM oil_companies
                WHERE normalized_name = %s AND country = %s
                LIMIT 1;
                """,
                (norm, country_key),
            )
            row = cur.fetchone()
            if row:
                out = _row_to_payload(row, match_confidence="exact", source="oil_companies")
                out["found"] = True
                return out

        cur.execute(
            """
            SELECT id, name, normalized_name, country, lei, source, confidence
            FROM oil_companies
            WHERE normalized_name = %s
            ORDER BY confidence DESC NULLS LAST
            LIMIT 1;
            """,
            (norm,),
        )
        row = cur.fetchone()
        if row:
            out = _row_to_payload(row, match_confidence="exact_no_country", source="oil_companies")
            out["found"] = True
            return out

        pattern = f"%{norm}%"
        cur.execute(
            """
            SELECT id, name, normalized_name, country, lei, source, confidence
            FROM oil_companies
            WHERE normalized_name ILIKE %s
               OR name ILIKE %s
            LIMIT 12;
            """,
            (pattern, f"%{raw}%"),
        )
        candidates = cur.fetchall()

    best_row: Optional[tuple[Any, ...]] = None
    best_score = 0.0
    for row in candidates:
        candidate_norm = row[2] or ""
        score = _similarity(norm, candidate_norm)
        if country_key and (row[3] or "").strip().lower() == country_key.lower():
            score += 0.08
        if score > best_score:
            best_score = score
            best_row = row

    if best_row and best_score >= 0.82:
        out = _row_to_payload(best_row, match_confidence="fuzzy", source="oil_companies")
        out["found"] = True
        out["similarity"] = round(best_score, 3)
        return out

    return {
        "found": False,
        "name": raw,
        "normalized_name": norm,
        "country": country_key,
        "match_confidence": "none",
        "source": "resolve",
        "reason": "no oil_companies match",
    }


def lookup_company_by_id(conn: Any, company_id: str) -> Optional[dict[str, Any]]:
    cid = (company_id or "").strip()
    if not cid:
        return None
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, name, normalized_name, country, lei, source, confidence
            FROM oil_companies
            WHERE id::text = %s
            LIMIT 1;
            """,
            (cid,),
        )
        row = cur.fetchone()
    if not row:
        return None
    out = _row_to_payload(row, match_confidence="id", source="oil_companies")
    out["found"] = True
    return out
