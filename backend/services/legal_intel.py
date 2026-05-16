"""Legal / litigation intelligence for AI Due Diligence.

Two responsibilities:
1. Collect litigation signals about an entity from pluggable adapters
   (CourtListener, PACER, KYB providers, OpenSanctions, etc.). When no
   API keys are configured the collector falls back to a small, clearly
   labelled stub fixture so the UI keeps a working contract.
2. Normalize + persist litigation rows into the ``legal_events`` table so
   the dossier can show stable, source-backed history without re-running
   the AI on every dossier open.

This module is intentionally side-effect-free for unit tests: every
external HTTP call is encapsulated in a single helper that can be
monkey-patched, and the DB writer accepts any DB-API 2.0 connection.

Env vars (all optional; module falls back to stubs when missing):
    COURTLISTENER_API_KEY    free-tier US courts (https://www.courtlistener.com/help/api/)
    PACER_API_TOKEN          paid US federal docket access (commercial extension point)
    OPENCORPORATES_API_KEY   company KYB enrichment (https://api.opencorporates.com/)
    KYB_PROVIDER_API_KEY     generic commercial KYB / litigation provider hook
    OPENSANCTIONS_API_KEY    sanctions + PEP + adverse media (https://www.opensanctions.org)
    LEGAL_INTEL_DISABLED     set to 1/true/yes to skip all live providers
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import uuid
from datetime import date, datetime
from typing import Any, Iterable, Optional

logger = logging.getLogger(__name__)

try:
    from psycopg2.extras import Json, RealDictCursor
except ImportError:  # pragma: no cover - psycopg2 missing in test envs
    RealDictCursor = None

    def Json(value: Any) -> Any:  # type: ignore[misc]
        return value


VALID_ROLES = {"plaintiff", "defendant", "respondent", "petitioner", "third_party", "regulatory_target", "subject"}
ROLE_ALIASES = {
    "plaintif": "plaintiff",
    "claimant": "plaintiff",
    "complainant": "plaintiff",
    "applicant": "plaintiff",
    "defender": "defendant",
    "accused": "defendant",
    "appellant": "defendant",
    "respondant": "respondent",
}
PLAINTIFF_ROLES = {"plaintiff", "claimant", "applicant", "petitioner", "complainant"}
DEFENDANT_ROLES = {"defendant", "respondent", "accused", "appellant"}

VALID_STATUSES = {
    "open",
    "pending",
    "filed",
    "active",
    "settled",
    "dismissed",
    "judgment",
    "judgement",
    "appeal",
    "closed",
    "concluded",
    "withdrawn",
    "stayed",
    "unknown",
}


# ---------------------------------------------------------------------------
# Cleaning + normalization
# ---------------------------------------------------------------------------

def _clean_text(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, str):
        cleaned = " ".join(value.split())
        return cleaned or None
    cleaned = str(value).strip()
    return cleaned or None


def _parse_date(value: Any) -> Optional[date]:
    if value in (None, "", " "):
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    raw = _clean_text(value)
    if not raw:
        return None
    candidate = raw.replace("Z", "+00:00")
    for layout in ("%Y-%m-%d", "%Y/%m/%d", "%d-%m-%Y", "%d/%m/%Y", "%Y"):
        try:
            return datetime.strptime(candidate[: len(layout)], layout).date()
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(candidate).date()
    except ValueError:
        return None


def _normalize_role(role: Any) -> str:
    raw = (_clean_text(role) or "").lower()
    if not raw:
        return "subject"
    raw = ROLE_ALIASES.get(raw, raw)
    if raw in VALID_ROLES:
        return raw
    if raw in PLAINTIFF_ROLES:
        return "plaintiff"
    if raw in DEFENDANT_ROLES:
        return "defendant"
    return "subject"


def _normalize_status(status: Any) -> str:
    raw = (_clean_text(status) or "").lower()
    if raw in VALID_STATUSES:
        return raw
    if any(tok in raw for tok in ("settle",)):
        return "settled"
    if any(tok in raw for tok in ("dismiss",)):
        return "dismissed"
    if any(tok in raw for tok in ("appeal",)):
        return "appeal"
    if any(tok in raw for tok in ("open", "pend", "active", "ongoing", "filed")):
        return "open"
    if any(tok in raw for tok in ("clos", "conclud", "withdraw", "judg")):
        return "closed"
    return "unknown"


def _normalize_jurisdiction(value: Any) -> Optional[str]:
    cleaned = _clean_text(value)
    if not cleaned:
        return None
    return cleaned


def _looks_like_url(value: Any) -> bool:
    cleaned = _clean_text(value)
    return bool(cleaned and re.match(r"^https?://", cleaned, re.IGNORECASE))


def _fingerprint(
    entity_kind: str,
    entity_id: str,
    case_title: str,
    role: str,
    court: str,
    filed_date: Optional[date],
) -> str:
    parts = [
        entity_kind,
        entity_id,
        (case_title or "").strip().lower(),
        role,
        (court or "").strip().lower(),
        filed_date.isoformat() if filed_date else "",
    ]
    return hashlib.sha1("|".join(parts).encode("utf-8")).hexdigest()


def normalize_legal_events(
    *,
    entity_kind: str,
    entity_id: str,
    events: Iterable[Any],
    default_source_name: Optional[str] = None,
    default_source_url: Optional[str] = None,
    default_discovered_by: str = "ai",
    default_source_type: Optional[str] = None,
    default_confidence: float = 0.5,
) -> list[dict[str, Any]]:
    """Coerce arbitrary dict payloads (LLM JSON, API responses) into the
    canonical ``legal_events`` row shape used by the DB writer."""

    normalized: list[dict[str, Any]] = []
    for raw in events or []:
        if not isinstance(raw, dict):
            continue

        case_title = _clean_text(
            raw.get("case_title")
            or raw.get("caseTitle")
            or raw.get("title")
            or raw.get("name")
        )
        if not case_title:
            continue

        role = _normalize_role(raw.get("role"))
        court = _clean_text(raw.get("court") or raw.get("court_name") or raw.get("forum"))
        jurisdiction = _normalize_jurisdiction(
            raw.get("jurisdiction") or raw.get("country") or raw.get("region")
        )
        filed_date = _parse_date(
            raw.get("filed_date")
            or raw.get("filedDate")
            or raw.get("date_filed")
            or raw.get("date")
        )
        status = _normalize_status(raw.get("status") or raw.get("disposition"))
        summary = _clean_text(raw.get("summary") or raw.get("description") or raw.get("snippet"))
        parties = raw.get("parties")
        if isinstance(parties, list):
            parties_str = "; ".join(_clean_text(p) or "" for p in parties if _clean_text(p))
        else:
            parties_str = _clean_text(parties) or ""

        source_name = _clean_text(raw.get("source_name") or raw.get("sourceName")) or default_source_name
        source_url_candidate = _clean_text(raw.get("source_url") or raw.get("sourceUrl") or raw.get("url"))
        source_url = source_url_candidate if _looks_like_url(source_url_candidate) else default_source_url
        source_type = _clean_text(raw.get("source_type") or raw.get("sourceType")) or default_source_type
        discovered_by = _clean_text(raw.get("discovered_by") or raw.get("discoveredBy")) or default_discovered_by

        try:
            confidence = float(raw.get("confidence") or raw.get("confidence_score") or default_confidence)
        except (TypeError, ValueError):
            confidence = default_confidence
        confidence = max(0.0, min(1.0, confidence))

        fingerprint = _fingerprint(entity_kind, entity_id, case_title, role, court or "", filed_date)
        normalized.append(
            {
                "id": str(uuid.uuid5(uuid.NAMESPACE_DNS, fingerprint)),
                "fingerprint": fingerprint,
                "entity_kind": entity_kind,
                "entity_id": entity_id,
                "case_title": case_title,
                "parties": parties_str or None,
                "role": role,
                "court": court,
                "jurisdiction": jurisdiction,
                "filed_date": filed_date,
                "status": status,
                "summary": summary,
                "source_name": source_name,
                "source_url": source_url,
                "source_type": source_type or ("ai_extracted" if discovered_by == "ai" else discovered_by),
                "discovered_by": discovered_by,
                "confidence_score": confidence,
                "raw_payload": raw,
            }
        )
    return normalized


# ---------------------------------------------------------------------------
# Adapter layer (live API calls are stubbed; keys gate behaviour)
# ---------------------------------------------------------------------------

def _live_providers_enabled() -> bool:
    flag = (os.getenv("LEGAL_INTEL_DISABLED") or "").strip().lower()
    return flag not in {"1", "true", "yes", "on"}


def fetch_courtlistener_events(
    *,
    company_name: str,
    country: Optional[str] = None,
    api_key: Optional[str] = None,
    http_get: Any = None,
) -> list[dict[str, Any]]:
    """CourtListener free-tier adapter.

    Real API (when ``COURTLISTENER_API_KEY`` is set): GET
    https://www.courtlistener.com/api/rest/v3/search/?q=<company>&type=r

    We intentionally guard the import of ``requests`` so importing this
    module never fails in minimal test environments.
    """

    api_key = api_key or os.getenv("COURTLISTENER_API_KEY")
    if not api_key:
        return []
    if not _live_providers_enabled():
        return []
    if http_get is None:
        try:
            import requests  # pylint: disable=import-outside-toplevel

            http_get = requests.get
        except ImportError:  # pragma: no cover
            logger.warning("requests not installed; CourtListener adapter inactive")
            return []

    try:
        response = http_get(
            "https://www.courtlistener.com/api/rest/v3/search/",
            params={"q": company_name, "type": "r"},
            headers={"Authorization": f"Token {api_key}"},
            timeout=20,
        )
        if getattr(response, "status_code", 0) != 200:
            logger.info("CourtListener returned status=%s for %s", getattr(response, "status_code", "?"), company_name)
            return []
        payload = response.json() if callable(getattr(response, "json", None)) else {}
    except Exception as exc:  # pragma: no cover - network-dependent
        logger.warning("CourtListener adapter failed for %s: %s", company_name, exc)
        return []

    results = payload.get("results") if isinstance(payload, dict) else None
    if not isinstance(results, list):
        return []

    normalized: list[dict[str, Any]] = []
    for hit in results[:25]:
        if not isinstance(hit, dict):
            continue
        case_title = hit.get("caseName") or hit.get("case_name") or hit.get("name") or ""
        court = hit.get("court") or hit.get("court_id") or ""
        filed = hit.get("dateFiled") or hit.get("date_filed")
        absolute_url = hit.get("absolute_url") or hit.get("download_url")
        source_url = (
            f"https://www.courtlistener.com{absolute_url}"
            if isinstance(absolute_url, str) and absolute_url.startswith("/")
            else absolute_url
        )
        # We cannot reliably tell the role from a free-text search hit, so we
        # mark these as "subject" until a human enrichment pass updates it.
        normalized.append(
            {
                "case_title": case_title,
                "court": court,
                "jurisdiction": country or "United States",
                "filed_date": filed,
                "status": hit.get("status") or "unknown",
                "role": hit.get("party_role") or "subject",
                "summary": hit.get("snippet") or hit.get("description"),
                "source_name": "CourtListener",
                "source_url": source_url,
                "source_type": "court_listener",
                "discovered_by": "court_listener",
                "confidence": 0.62,
            }
        )
    return normalized


# Stubbed adapters that document the integration path without making a
# request. Each one returns [] until env vars are set + the helper is
# implemented behind the same shape as ``fetch_courtlistener_events``.

def fetch_pacer_events(*, company_name: str, country: Optional[str] = None) -> list[dict[str, Any]]:
    """PACER (US federal courts) — commercial. Implement using the
    requested entity's PACER credentials. Returns [] when token missing."""
    if not (os.getenv("PACER_API_TOKEN") and _live_providers_enabled()):
        return []
    logger.info("PACER adapter is documented but not implemented; integrate via the agency's billing portal.")
    return []


def fetch_kyb_provider_events(*, company_name: str, country: Optional[str] = None) -> list[dict[str, Any]]:
    """Generic commercial KYB provider hook (Sayari / Refinitiv WC / LexisNexis).
    Implement via the provider SDK and shape output to match
    ``normalize_legal_events``."""
    if not (os.getenv("KYB_PROVIDER_API_KEY") and _live_providers_enabled()):
        return []
    logger.info("KYB provider adapter requires vendor SDK; returning [] until wired.")
    return []


def fetch_opensanctions_adverse_events(
    *, company_name: str, country: Optional[str] = None
) -> list[dict[str, Any]]:
    """OpenSanctions adverse media + PEP litigation overlay."""
    if not (os.getenv("OPENSANCTIONS_API_KEY") and _live_providers_enabled()):
        return []
    logger.info("OpenSanctions adapter is documented but not implemented.")
    return []


def fetch_opencorporates_filings(
    *, company_name: str, country: Optional[str] = None
) -> list[dict[str, Any]]:
    """OpenCorporates filings overlay — useful for regulatory actions and
    bankruptcy notices."""
    if not (os.getenv("OPENCORPORATES_API_KEY") and _live_providers_enabled()):
        return []
    logger.info("OpenCorporates adapter is documented but not implemented.")
    return []


# ---------------------------------------------------------------------------
# Stub fixture used when no live provider returns anything
# ---------------------------------------------------------------------------

def _stub_legal_events(entity: dict[str, Any]) -> list[dict[str, Any]]:
    """Deterministic, clearly-labelled stub events.

    The intent is *not* to fabricate litigation but to give the UI a
    deterministic shape to render while documenting what the live providers
    would emit. Every stub row is flagged with ``source_type='stub_fixture'``
    so the dossier can show "Awaiting live legal feed" guidance and never
    presents stubs as verified facts.
    """

    company = _clean_text(entity.get("company") or entity.get("name") or "Unknown entity") or "Unknown entity"
    country = _clean_text(entity.get("country")) or "Unknown jurisdiction"
    return [
        {
            "case_title": f"Sample regulatory inquiry — {company}",
            "parties": [company, f"{country} Mining Regulator"],
            "role": "respondent",
            "court": f"{country} Administrative Court",
            "jurisdiction": country,
            "filed_date": "2024-03-15",
            "status": "pending",
            "summary": (
                "Stub fixture (no legal-intel API key configured). When CourtListener, PACER, "
                "or a KYB provider key is set, real cases will replace this placeholder."
            ),
            "source_name": "Stub fixture (no API key)",
            "source_url": None,
            "source_type": "stub_fixture",
            "discovered_by": "stub",
            "confidence": 0.2,
        },
        {
            "case_title": f"Sample commercial dispute filed by {company}",
            "parties": [company, "Counterparty Holdings Ltd"],
            "role": "plaintiff",
            "court": f"{country} Commercial Court",
            "jurisdiction": country,
            "filed_date": "2023-11-02",
            "status": "settled",
            "summary": (
                "Stub fixture (no legal-intel API key configured). Replace by configuring a "
                "litigation provider — see services/legal_intel.py for the documented adapters."
            ),
            "source_name": "Stub fixture (no API key)",
            "source_url": None,
            "source_type": "stub_fixture",
            "discovered_by": "stub",
            "confidence": 0.2,
        },
    ]


# ---------------------------------------------------------------------------
# Public collection entry point
# ---------------------------------------------------------------------------

def collect_legal_events(
    *,
    entity_kind: str,
    entity_id: str,
    entity: dict[str, Any],
    ai_extracted_events: Optional[list[dict[str, Any]]] = None,
) -> list[dict[str, Any]]:
    """Combine live adapters + AI extraction + stub fallback.

    Args:
        entity_kind: 'license' | 'company' | ...
        entity_id:   primary key in our DB.
        entity:      dict with at least ``company``/``name`` and ``country``.
        ai_extracted_events: optional events normalised from the LLM step.

    Returns normalised events ready for ``upsert_legal_events``.
    """

    company = _clean_text(entity.get("company") or entity.get("name") or "")
    country = _clean_text(entity.get("country"))
    if not company:
        return []

    raw_events: list[dict[str, Any]] = []

    raw_events.extend(fetch_courtlistener_events(company_name=company, country=country))
    raw_events.extend(fetch_pacer_events(company_name=company, country=country))
    raw_events.extend(fetch_kyb_provider_events(company_name=company, country=country))
    raw_events.extend(fetch_opensanctions_adverse_events(company_name=company, country=country))
    raw_events.extend(fetch_opencorporates_filings(company_name=company, country=country))

    if ai_extracted_events:
        raw_events.extend(ai_extracted_events)

    if not raw_events:
        raw_events.extend(_stub_legal_events(entity))

    return normalize_legal_events(
        entity_kind=entity_kind,
        entity_id=entity_id,
        events=raw_events,
    )


# ---------------------------------------------------------------------------
# Persistence
# ---------------------------------------------------------------------------

def _cursor_kwargs() -> dict[str, Any]:
    if RealDictCursor is None:
        return {}
    return {"cursor_factory": RealDictCursor}


def upsert_legal_events(conn: Any, events: list[dict[str, Any]]) -> int:
    """Upsert events by fingerprint. Returns the number of rows written."""
    if not events:
        return 0
    with conn.cursor() as cur:
        for event in events:
            cur.execute(
                """
                INSERT INTO legal_events (
                    id,
                    fingerprint,
                    entity_kind,
                    entity_id,
                    case_title,
                    parties,
                    role,
                    court,
                    jurisdiction,
                    filed_date,
                    status,
                    summary,
                    source_name,
                    source_url,
                    source_type,
                    discovered_by,
                    confidence_score,
                    raw_payload,
                    last_seen_at,
                    created_at,
                    updated_at
                )
                VALUES (
                    %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                )
                ON CONFLICT (fingerprint) DO UPDATE SET
                    case_title = EXCLUDED.case_title,
                    parties = EXCLUDED.parties,
                    role = EXCLUDED.role,
                    court = EXCLUDED.court,
                    jurisdiction = EXCLUDED.jurisdiction,
                    filed_date = EXCLUDED.filed_date,
                    status = EXCLUDED.status,
                    summary = EXCLUDED.summary,
                    source_name = EXCLUDED.source_name,
                    source_url = EXCLUDED.source_url,
                    source_type = EXCLUDED.source_type,
                    discovered_by = EXCLUDED.discovered_by,
                    confidence_score = EXCLUDED.confidence_score,
                    raw_payload = EXCLUDED.raw_payload,
                    last_seen_at = CURRENT_TIMESTAMP,
                    updated_at = CURRENT_TIMESTAMP
                """,
                (
                    event["id"],
                    event["fingerprint"],
                    event["entity_kind"],
                    event["entity_id"],
                    event.get("case_title"),
                    event.get("parties"),
                    event.get("role"),
                    event.get("court"),
                    event.get("jurisdiction"),
                    event.get("filed_date"),
                    event.get("status"),
                    event.get("summary"),
                    event.get("source_name"),
                    event.get("source_url"),
                    event.get("source_type"),
                    event.get("discovered_by"),
                    event.get("confidence_score"),
                    Json(event.get("raw_payload") or {}),
                ),
            )
    return len(events)


def list_legal_events(conn: Any, *, entity_kind: str, entity_id: str) -> list[dict[str, Any]]:
    cursor_kwargs = _cursor_kwargs()
    with conn.cursor(**cursor_kwargs) as cur:
        cur.execute(
            """
            SELECT
                id,
                fingerprint,
                entity_kind,
                entity_id,
                case_title,
                parties,
                role,
                court,
                jurisdiction,
                filed_date,
                status,
                summary,
                source_name,
                source_url,
                source_type,
                discovered_by,
                confidence_score,
                raw_payload,
                last_seen_at,
                created_at,
                updated_at
            FROM legal_events
            WHERE entity_kind = %s
              AND entity_id = %s
            ORDER BY
                CASE role
                    WHEN 'defendant' THEN 0
                    WHEN 'respondent' THEN 1
                    WHEN 'subject' THEN 2
                    WHEN 'plaintiff' THEN 3
                    WHEN 'petitioner' THEN 4
                    WHEN 'third_party' THEN 5
                    ELSE 6
                END,
                filed_date DESC NULLS LAST,
                case_title ASC
            """,
            (entity_kind, entity_id),
        )
        rows = cur.fetchall() or []
    serialized: list[dict[str, Any]] = []
    for row in rows:
        if isinstance(row, dict):
            data = dict(row)
        else:
            # Plain tuple cursor: build a dict by column order matching the SELECT.
            cols = [
                "id",
                "fingerprint",
                "entity_kind",
                "entity_id",
                "case_title",
                "parties",
                "role",
                "court",
                "jurisdiction",
                "filed_date",
                "status",
                "summary",
                "source_name",
                "source_url",
                "source_type",
                "discovered_by",
                "confidence_score",
                "raw_payload",
                "last_seen_at",
                "created_at",
                "updated_at",
            ]
            data = dict(zip(cols, row))
        raw_payload = data.get("raw_payload")
        if isinstance(raw_payload, str):
            try:
                data["raw_payload"] = json.loads(raw_payload)
            except (TypeError, ValueError):
                data["raw_payload"] = None
        serialized.append(data)
    return serialized


def serialize_legal_event(row: dict[str, Any]) -> dict[str, Any]:
    """Map a DB row to the camelCase JSON shape used by the frontend."""
    filed_date = row.get("filed_date")
    last_seen = row.get("last_seen_at")
    created_at = row.get("created_at")

    def _iso(v: Any) -> Optional[str]:
        if v is None:
            return None
        if isinstance(v, (datetime, date)):
            return v.isoformat()
        return str(v)

    return {
        "id": row.get("id"),
        "fingerprint": row.get("fingerprint"),
        "entityKind": row.get("entity_kind"),
        "entityId": row.get("entity_id"),
        "caseTitle": row.get("case_title"),
        "parties": row.get("parties"),
        "role": row.get("role"),
        "court": row.get("court"),
        "jurisdiction": row.get("jurisdiction"),
        "filedDate": _iso(filed_date),
        "status": row.get("status"),
        "summary": row.get("summary"),
        "sourceName": row.get("source_name"),
        "sourceUrl": row.get("source_url"),
        "sourceType": row.get("source_type"),
        "discoveredBy": row.get("discovered_by"),
        "confidenceScore": row.get("confidence_score"),
        "lastSeenAt": _iso(last_seen),
        "createdAt": _iso(created_at),
    }
