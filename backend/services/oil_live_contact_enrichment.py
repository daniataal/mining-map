"""Batch contact enrichment for oil-live companies linked to supplier licenses."""
from __future__ import annotations

from typing import Any


def _oil_company_contact_candidates(cur: Any, limit: int) -> list[dict[str, Any]]:
    cur.execute(
        """
        SELECT c.id::text AS company_id, c.name, c.supplier_id::text AS supplier_id,
               COALESCE((
                 SELECT COUNT(*)::int FROM oil_company_contacts cc WHERE cc.company_id = c.id
               ), 0) AS contact_count,
               COALESCE((
                 SELECT COUNT(*)::int FROM meridian_cargo_records m
                 WHERE m.shipper_company_id = c.id OR m.consignee_company_id = c.id
               ), 0) AS mcr_count
        FROM oil_companies c
        WHERE c.supplier_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM oil_company_contacts cc WHERE cc.company_id = c.id
          )
        ORDER BY mcr_count DESC, c.confidence DESC NULLS LAST, c.name
        LIMIT %s
        """,
        (max(1, min(int(limit), 100)),),
    )
    rows = cur.fetchall()
    out: list[dict[str, Any]] = []
    for row in rows:
        if hasattr(row, "keys"):
            out.append(dict(row))
        else:
            out.append(
                {
                    "company_id": row[0],
                    "name": row[1],
                    "supplier_id": row[2],
                    "contact_count": row[3],
                    "mcr_count": row[4],
                }
            )
    return out


def run_oil_live_contact_enrichment_batch(conn: Any, *, limit: int = 50) -> dict[str, Any]:
    """Enrich top N oil companies missing contacts via license-linked supplier rows."""
    try:
        from backend.services.agent_intelligence import run_contact_enrichment
    except ImportError:
        from services.agent_intelligence import run_contact_enrichment  # type: ignore[no-redef]

    limit = max(1, min(int(limit), 100))
    cur = conn.cursor()
    try:
        candidates = _oil_company_contact_candidates(cur, limit)
    finally:
        cur.close()

    results: list[dict[str, Any]] = []
    enriched = 0
    skipped = 0

    for row in candidates:
        supplier_id = (row.get("supplier_id") or "").strip()
        company_id = row.get("company_id")
        if not supplier_id:
            skipped += 1
            results.append(
                {
                    "company_id": company_id,
                    "name": row.get("name"),
                    "status": "skipped",
                    "reason": "no_supplier_id",
                }
            )
            continue
        try:
            job = run_contact_enrichment(
                conn,
                entity_id=supplier_id,
                entity_kind="license",
                force_refresh=False,
            )
            contacts = job.get("contacts") or []
            if contacts:
                enriched += 1
            results.append(
                {
                    "company_id": company_id,
                    "name": row.get("name"),
                    "supplier_id": supplier_id,
                    "status": "ok",
                    "contacts_found": len(contacts),
                    "mcr_count": row.get("mcr_count"),
                }
            )
        except Exception as exc:
            results.append(
                {
                    "company_id": company_id,
                    "name": row.get("name"),
                    "supplier_id": supplier_id,
                    "status": "error",
                    "error": str(exc)[:500],
                }
            )

    return {
        "status": "ok",
        "requested_limit": limit,
        "candidates": len(candidates),
        "enriched": enriched,
        "skipped": skipped,
        "results": results,
        "note": (
            "Contact agent requires supplier_id (Save to Suppliers). "
            "Set GOOGLE_CSE_API_KEY+GOOGLE_CSE_CX or SERPAPI_API_KEY for web discovery."
        ),
    }
