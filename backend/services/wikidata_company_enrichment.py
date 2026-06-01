"""
Wikidata company enrichment (Phase 4c)
======================================

Uses the public MediaWiki action API to map ``oil_companies.name`` →
Wikidata ``Q-ID``, then resolves a small bundle of claims:

* ``P1278`` — Legal Entity Identifier (LEI)
* ``P452``  — industry
* ``P159``  — headquarters location (city / settlement)
* ``P17``   — country (jurisdiction)
* ``P856``  — official website
* ``P646``  — Freebase identifier (legacy bridge for downstream tooling)

Public API endpoints (free, no key, but please be polite — throttle to
≤ 1 req/s and identify yourself in ``User-Agent``):

    https://www.wikidata.org/w/api.php?action=wbsearchentities
    https://www.wikidata.org/w/api.php?action=wbgetentities

We send a descriptive ``User-Agent`` per Wikimedia API guidelines:
https://meta.wikimedia.org/wiki/User-Agent_policy.

Migration 013 (Worker B) adds ``oil_companies.wikidata_qid`` +
``oil_companies.wikidata_facts JSONB`` — until that lands the batch
writer fails soft (logs warning, returns ``status='skipped'``).
"""

from __future__ import annotations

import json
import logging
import os
import time
from typing import Any, Optional

try:
    import requests
except ImportError:  # pragma: no cover - requests is in requirements.txt
    requests = None  # type: ignore

LOG = logging.getLogger("meridian.wikidata")

WIKIDATA_API_URL = "https://www.wikidata.org/w/api.php"

REQUEST_TIMEOUT_SECONDS = 12
THROTTLE_SECONDS = 1.0  # Wikimedia API courtesy
DEFAULT_BATCH_LIMIT = int(os.getenv("WIKIDATA_BATCH_LIMIT", "50") or "50")

USER_AGENT = os.getenv(
    "WIKIDATA_USER_AGENT",
    "Meridian/1.0 (ops@meridian.example)",
)

# Property IDs we care about.
PROP_LEI = "P1278"
PROP_INDUSTRY = "P452"
PROP_HQ = "P159"
PROP_COUNTRY = "P17"
PROP_WEBSITE = "P856"
PROP_FREEBASE = "P646"

_PROPS_TO_FETCH = (
    PROP_LEI,
    PROP_INDUSTRY,
    PROP_HQ,
    PROP_COUNTRY,
    PROP_WEBSITE,
    PROP_FREEBASE,
)


def _is_undefined_column(exc: Exception) -> bool:
    name = type(exc).__name__
    if name == "UndefinedColumn":
        return True
    pgcode = getattr(exc, "pgcode", "") or ""
    return pgcode == "42703"


def _http_get_json(params: dict[str, Any]) -> Optional[dict[str, Any]]:
    if requests is None:
        return None
    try:
        resp = requests.get(
            WIKIDATA_API_URL,
            params=params,
            headers={"Accept": "application/json", "User-Agent": USER_AGENT},
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
    except Exception as exc:  # noqa: BLE001
        LOG.warning("Wikidata HTTP error params=%s err=%s", params, exc)
        return None
    if resp.status_code != 200:
        LOG.warning("Wikidata HTTP %s params=%s", resp.status_code, params)
        return None
    try:
        return resp.json()
    except Exception as exc:  # noqa: BLE001
        LOG.warning("Wikidata JSON parse error: %s", exc)
        return None


def _search_entity(name: str, *, limit: int = 3) -> list[dict[str, Any]]:
    payload = _http_get_json(
        {
            "action": "wbsearchentities",
            "search": name,
            "type": "item",
            "language": "en",
            "format": "json",
            "limit": int(limit),
        }
    )
    if not payload:
        return []
    return payload.get("search") or []


def _get_entities(qids: list[str]) -> dict[str, dict[str, Any]]:
    if not qids:
        return {}
    payload = _http_get_json(
        {
            "action": "wbgetentities",
            "ids": "|".join(qids[:50]),
            "props": "claims|labels|descriptions",
            "languages": "en",
            "format": "json",
        }
    )
    if not payload:
        return {}
    return payload.get("entities") or {}


def _extract_string_claims(entity: dict[str, Any], pid: str) -> list[str]:
    """Pull string-valued claims (P1278 LEI, P856 website, P646 Freebase)."""
    out: list[str] = []
    for claim in (entity.get("claims") or {}).get(pid, []) or []:
        mainsnak = claim.get("mainsnak") or {}
        if mainsnak.get("snaktype") != "value":
            continue
        dv = mainsnak.get("datavalue") or {}
        val = dv.get("value")
        if isinstance(val, str) and val.strip():
            out.append(val.strip())
    return out


def _extract_entity_claims(entity: dict[str, Any], pid: str) -> list[str]:
    """Pull Q-id references from claims like P452 industry / P159 HQ / P17 country."""
    out: list[str] = []
    for claim in (entity.get("claims") or {}).get(pid, []) or []:
        mainsnak = claim.get("mainsnak") or {}
        if mainsnak.get("snaktype") != "value":
            continue
        dv = mainsnak.get("datavalue") or {}
        val = dv.get("value")
        if isinstance(val, dict):
            qid = val.get("id")
            if qid:
                out.append(str(qid))
    return out


def _resolve_labels(qids: list[str]) -> dict[str, str]:
    """Best-effort resolve Q-ids to English labels (single batch call)."""
    if not qids:
        return {}
    payload = _http_get_json(
        {
            "action": "wbgetentities",
            "ids": "|".join(sorted({q for q in qids if q})[:50]),
            "props": "labels",
            "languages": "en",
            "format": "json",
        }
    )
    if not payload:
        return {q: q for q in qids}
    labels: dict[str, str] = {}
    for qid, ent in (payload.get("entities") or {}).items():
        label = ((ent.get("labels") or {}).get("en") or {}).get("value")
        labels[qid] = label or qid
    return labels


def _entity_to_facts(entity: dict[str, Any]) -> dict[str, Any]:
    industries_qids = _extract_entity_claims(entity, PROP_INDUSTRY)
    hq_qids = _extract_entity_claims(entity, PROP_HQ)
    country_qids = _extract_entity_claims(entity, PROP_COUNTRY)
    labels = _resolve_labels(industries_qids + hq_qids + country_qids)

    lei_list = _extract_string_claims(entity, PROP_LEI)
    websites = _extract_string_claims(entity, PROP_WEBSITE)
    freebase = _extract_string_claims(entity, PROP_FREEBASE)
    description = ((entity.get("descriptions") or {}).get("en") or {}).get("value")

    return {
        "lei": lei_list[0] if lei_list else None,
        "industries": [labels.get(q, q) for q in industries_qids][:5],
        "hq": labels.get(hq_qids[0], hq_qids[0]) if hq_qids else None,
        "country": labels.get(country_qids[0], country_qids[0]) if country_qids else None,
        "website": websites[0] if websites else None,
        "freebase_id": freebase[0] if freebase else None,
        "description": description,
    }


def lookup_company(name: str) -> Optional[dict[str, Any]]:
    """
    Resolve a company name to a Wikidata Q-id plus a small facts dict.

    Returns ``None`` when the name doesn't match anything; returns
    ``{ qid, facts, label }`` on success.
    """
    query = (name or "").strip()
    if not query:
        return None

    candidates = _search_entity(query, limit=3)
    if not candidates:
        return None

    top = candidates[0]
    qid = top.get("id")
    if not qid:
        return None

    entities = _get_entities([qid])
    entity = entities.get(qid)
    if not entity:
        return {
            "qid": qid,
            "label": top.get("label") or query,
            "facts": {},
        }

    facts = _entity_to_facts(entity)
    return {
        "qid": qid,
        "label": top.get("label") or query,
        "description": top.get("description"),
        "facts": facts,
    }


def _has_wikidata_columns(cur: Any) -> bool:
    try:
        cur.execute(
            """
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'oil_companies'
              AND column_name = 'wikidata_qid'
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


def enrich_companies_with_wikidata(
    conn: Any,
    *,
    limit: int = DEFAULT_BATCH_LIMIT,
    throttle_seconds: float = THROTTLE_SECONDS,
) -> dict[str, Any]:
    """
    Walk rows in ``oil_companies`` where ``wikidata_qid IS NULL`` and
    populate ``wikidata_qid`` + a small ``wikidata_facts`` JSON
    (industries, hq, country, website).

    Safe to re-run; fails soft if migration 013 hasn't landed yet.
    """
    if conn is None:
        return {"status": "skipped", "reason": "no db connection"}

    summary: dict[str, Any] = {
        "status": "ok",
        "candidates": 0,
        "qid_written": 0,
        "no_match": 0,
        "errors": [],
        "skipped_missing_columns": False,
    }

    try:
        with conn.cursor() as cur:
            if not _has_wikidata_columns(cur):
                summary["status"] = "skipped"
                summary["skipped_missing_columns"] = True
                summary["reason"] = "oil_companies.wikidata_qid missing — apply migration 013"
                LOG.warning(
                    "enrich_companies_with_wikidata skipped: migration 013 not applied"
                )
                return summary

            cur.execute(
                """
                SELECT id::text, name
                FROM oil_companies
                WHERE wikidata_qid IS NULL
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
            summary["reason"] = "oil_companies.wikidata_qid missing"
            return summary
        summary["status"] = "error"
        summary["errors"].append(f"select: {exc}")
        return summary

    summary["candidates"] = len(rows)

    for row in rows:
        company_id, name = row[0], row[1]
        try:
            match = lookup_company(str(name))
        except Exception as exc:
            summary["errors"].append(f"{company_id}: lookup raised {exc}")
            continue

        if not match or not match.get("qid"):
            summary["no_match"] += 1
            if throttle_seconds > 0:
                time.sleep(throttle_seconds)
            continue

        facts = match.get("facts") or {}
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE oil_companies
                    SET wikidata_qid = %s,
                        wikidata_facts = %s,
                        updated_at = now()
                    WHERE id = %s::uuid
                    """,
                    (match.get("qid"), _coerce_json(facts), company_id),
                )
            conn.commit()
            summary["qid_written"] += 1
        except Exception as exc:
            if _is_undefined_column(exc):
                try:
                    conn.rollback()
                except Exception:
                    pass
                summary["status"] = "skipped"
                summary["skipped_missing_columns"] = True
                summary["reason"] = "oil_companies.wikidata_qid missing"
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
    "lookup_company",
    "enrich_companies_with_wikidata",
    "WIKIDATA_API_URL",
]
