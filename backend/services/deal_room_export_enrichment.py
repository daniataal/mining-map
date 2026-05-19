"""Fuzzy-match USAspending awards and EU TED notices for deal room exports."""

from __future__ import annotations

import re
from typing import Any, Optional


def _clean_text(value: Optional[str]) -> str:
    if not value:
        return ""
    return re.sub(r"\s+", " ", str(value).strip())


def _normalize_name(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.lower())


def names_match(company: str, candidate: str) -> bool:
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
    if len(norm_a) >= 4 and len(norm_b) >= 4 and (norm_a in norm_b or norm_b in norm_a):
        return True
    return False


def collect_party_names(room: dict[str, Any], entity: dict[str, Any]) -> list[str]:
    """Gather company/party strings from deal room title, entity, and evidence."""
    names: list[str] = []
    for raw in (
        entity.get("company"),
        entity.get("name"),
        room.get("title"),
    ):
        text = _clean_text(raw if isinstance(raw, str) else None)
        if text and text not in names:
            names.append(text)

    evidence = room.get("evidence") if isinstance(room.get("evidence"), dict) else {}
    ent = evidence.get("entity") if isinstance(evidence.get("entity"), dict) else {}
    for key in ("company", "name"):
        text = _clean_text(ent.get(key) if isinstance(ent.get(key), str) else None)
        if text and text not in names:
            names.append(text)

    agent_outputs = evidence.get("agentOutputs") if isinstance(evidence.get("agentOutputs"), dict) else {}
    for output in agent_outputs.values():
        if not isinstance(output, dict):
            continue
        for key in ("company", "legal_name", "recipient_name"):
            text = _clean_text(output.get(key) if isinstance(output.get(key), str) else None)
            if text and text not in names:
                names.append(text)
        parties = output.get("parties") or output.get("counterparties")
        if isinstance(parties, list):
            for party in parties[:12]:
                if isinstance(party, str):
                    text = _clean_text(party)
                elif isinstance(party, dict):
                    text = _clean_text(party.get("name") or party.get("company"))
                else:
                    text = ""
                if text and text not in names:
                    names.append(text)
    return names[:8]


def enrich_deal_room_export(conn: Any, *, room: dict[str, Any], entity: dict[str, Any], limit: int = 25) -> dict[str, Any]:
    """Return relatedUsaAwards and relatedEuNotices for export package."""
    parties = collect_party_names(room, entity)
    country = _clean_text(entity.get("country") if isinstance(entity.get("country"), str) else None) or None

    usa_awards: list[dict[str, Any]] = []
    eu_notices: list[dict[str, Any]] = []
    warnings: list[str] = []
    seen_award: set[str] = set()
    seen_notice: set[str] = set()

    if not parties:
        return {
            "partyNamesQueried": [],
            "relatedUsaAwards": [],
            "relatedEuNotices": [],
            "relatedProcurementWarnings": ["No company or party names available for procurement matching."],
        }

    try:
        from backend.services.gov_procurement_store import (
            ensure_gov_procurement_tables,
            list_awards_for_company,
        )
    except ImportError:
        from services.gov_procurement_store import (  # type: ignore[no-redef]
            ensure_gov_procurement_tables,
            list_awards_for_company,
        )

    try:
        from backend.services.eu_procurement_intel import collect_eu_procurement_for_company
    except ImportError:
        from services.eu_procurement_intel import collect_eu_procurement_for_company  # type: ignore[no-redef]

    ensure_gov_procurement_tables(conn)

    per_party = max(5, limit // max(len(parties), 1))
    for name in parties:
        try:
            rows = list_awards_for_company(conn, name, limit=per_party)
            for row in rows:
                if not isinstance(row, dict):
                    continue
                recipient = str(row.get("recipient_name") or "")
                if recipient and not names_match(name, recipient):
                    continue
                aid = str(row.get("award_id") or row.get("id") or "")
                if aid and aid in seen_award:
                    continue
                if aid:
                    seen_award.add(aid)
                usa_awards.append(row)
                if len(usa_awards) >= limit:
                    break
        except Exception as exc:
            warnings.append(f"USAspending lookup failed for '{name}': {exc}")
        if len(usa_awards) >= limit:
            break

    for name in parties:
        try:
            payload = collect_eu_procurement_for_company(
                conn, company_name=name, country=country, limit=per_party
            )
            for notice in payload.get("notices") or []:
                if not isinstance(notice, dict):
                    continue
                nd = str(notice.get("notice_id") or notice.get("id") or "")
                if nd and nd in seen_notice:
                    continue
                if nd:
                    seen_notice.add(nd)
                eu_notices.append(notice)
                if len(eu_notices) >= limit:
                    break
        except Exception as exc:
            warnings.append(f"EU TED lookup failed for '{name}': {exc}")
        if len(eu_notices) >= limit:
            break

    return {
        "partyNamesQueried": parties,
        "relatedUsaAwards": usa_awards[:limit],
        "relatedEuNotices": eu_notices[:limit],
        "relatedProcurementWarnings": warnings,
    }
