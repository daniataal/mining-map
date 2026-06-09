"""
Supplier enrichment — index licensed bunker/fuel suppliers into oil_companies + contacts.

Transitional Python write path: prefer Go graphsync.IndexBunkerFuelSuppliers when
OIL_GRAPH_SYNC_GO_BUNKER_FUEL_SUPPLIERS=true. Read path is Go GET /api/suppliers/nearby.
"""

from __future__ import annotations

import json
from typing import Any, Optional

try:
    from backend.services.bunker_fuel_suppliers_seed import iter_supplier_records, load_bunker_fuel_suppliers
    from backend.services.oil_live_graph_sync import _upsert_company
except ImportError:
    from services.bunker_fuel_suppliers_seed import iter_supplier_records, load_bunker_fuel_suppliers  # type: ignore
    from services.oil_live_graph_sync import _upsert_company  # type: ignore


def _upsert_company_contact(
    cur: Any,
    *,
    company_id: str,
    contact_type: str,
    value: str,
    label: str,
    source_url: Optional[str] = None,
) -> bool:
    value = (value or "").strip()
    if not value:
        return False
    cur.execute(
        """
        SELECT id FROM oil_company_contacts
        WHERE company_id = %s::uuid
          AND contact_type = %s
          AND value = %s
        LIMIT 1
        """,
        (company_id, contact_type, value),
    )
    if cur.fetchone():
        return False
    cur.execute(
        """
        INSERT INTO oil_company_contacts (
            company_id, contact_type, contact_scope, label, value, source_type, notes
        )
        VALUES (%s::uuid, %s, 'public_business', %s, %s, 'official_open_data', %s)
        """,
        (company_id, contact_type, label, value, source_url),
    )
    return True


def trigger_go_bunker_fuel_suppliers_sync() -> dict[str, Any]:
    """Invoke Go IndexBunkerFuelSuppliers via oil-live-intel internal API."""
    import json
    import os
    import urllib.error
    import urllib.request

    base = (os.getenv("OIL_INTEL_API_URL") or "http://oil-live-intel:8095").rstrip("/")
    key = (os.getenv("OIL_INTEL_INTERNAL_KEY") or "oil-intel-dev").strip()
    url = f"{base}/api/oil-live/internal/bunker-fuel-suppliers/sync"
    req = urllib.request.Request(
        url,
        data=b"{}",
        method="POST",
        headers={
            "Content-Type": "application/json",
            "X-Oil-Intel-Internal": key,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=900) as resp:
            body = resp.read().decode("utf-8")
            payload = json.loads(body) if body else {}
            if isinstance(payload, dict):
                payload.setdefault("status", "ok")
            return payload
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        return {"status": "error", "message": detail or f"HTTP {exc.code}"}
    except Exception as exc:
        return {"status": "error", "message": str(exc)}


def sync_bunker_fuel_suppliers_to_companies(cur: Any) -> dict[str, Any]:
    """Legacy graph-sync step (Python). Prefer Go ``IndexBunkerFuelSuppliers`` when
    ``OIL_GRAPH_SYNC_GO_BUNKER_FUEL_SUPPLIERS=true`` — Go adds geocode tiers and
    display_lat/lng for map markers."""
    records = iter_supplier_records()
    indexed = 0
    contacts_written = 0
    skipped = 0

    for row in records:
        name = str(row.get("company_name") or "").strip()
        country = str(row.get("country") or "").strip()
        supplier_type = str(row.get("supplier_type") or "bunker_supplier").strip()
        confidence = float(row.get("confidence_score") or 0.65)
        source_url = row.get("source_url") or row.get("register_source_url")

        company_id = _upsert_company(
            cur,
            name=name,
            country=country,
            company_type=supplier_type,
            source="bunker_fuel_suppliers_curated",
            confidence=confidence,
            metadata={
                "supplier_type": supplier_type,
                "product_types": row.get("product_types") or [],
                "fuels_supplied": row.get("fuels_supplied"),
                "contact_person": row.get("contact_person"),
                "register_address": row.get("address"),
                "port_locode": row.get("locode"),
                "port_name": row.get("port_name"),
                "hub_key": row.get("hub_key"),
                "hub_lat": row.get("hub_lat"),
                "hub_lng": row.get("hub_lng"),
                "license_authority": row.get("license_authority"),
                "register_source_url": row.get("register_source_url"),
                "source_url": source_url,
                "enrichment_tier": "regulator_curated",
                "notes": row.get("notes"),
            },
        )
        if not company_id:
            skipped += 1
            continue
        indexed += 1

        website = str(row.get("website") or "").strip()
        if website:
            cur.execute(
                """
                UPDATE oil_companies
                SET website = COALESCE(NULLIF(website, ''), %s),
                    updated_at = now()
                WHERE id = %s::uuid AND (website IS NULL OR website = '')
                """,
                (website, company_id),
            )

        for field, ctype in (("phone", "phone"), ("email", "email"), ("address", "address")):
            val = str(row.get(field) or "").strip()
            if val and _upsert_company_contact(
                cur,
                company_id=company_id,
                contact_type=ctype,
                value=val,
                label=f"{row.get('license_authority') or 'Bunker register'} ({ctype})",
                source_url=str(source_url) if source_url else None,
            ):
                contacts_written += 1

    return {
        "suppliers_indexed": indexed,
        "contacts_written": contacts_written,
        "records_skipped": skipped,
        "seed_hubs": len(load_bunker_fuel_suppliers().get("hubs") or []),
    }


def query_nearby_suppliers(
    conn: Any,
    *,
    locode: Optional[str] = None,
    south: Optional[float] = None,
    west: Optional[float] = None,
    north: Optional[float] = None,
    east: Optional[float] = None,
    limit: int = 40,
) -> list[dict[str, Any]]:
    """Return oil_companies indexed as bunker/fuel suppliers near a hub or bbox."""
    limit = max(1, min(int(limit or 40), 100))
    clauses = [
        "company_type IN ('bunker_supplier', 'fuel_wholesaler', 'fuel_importer', 'refinery_marketer', 'trader', 'port_tenant')",
        "confidence >= 0.45",
    ]
    params: list[Any] = []

    if locode:
        clauses.append("metadata->>'port_locode' = %s")
        params.append(locode.strip().upper())
    elif all(v is not None for v in (south, west, north, east)):
        clauses.append(
            "(metadata->>'hub_lat')::float BETWEEN %s AND %s "
            "AND (metadata->>'hub_lng')::float BETWEEN %s AND %s"
        )
        params.extend([south, north, west, east])

    where = " AND ".join(clauses)
    params.append(limit)

    with conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT
                id::text,
                name,
                country,
                company_type,
                website,
                confidence,
                supplier_status,
                metadata
            FROM oil_companies
            WHERE {where}
            ORDER BY confidence DESC, name ASC
            LIMIT %s
            """,
            tuple(params),
        )
        rows = cur.fetchall()

    out: list[dict[str, Any]] = []
    for row in rows:
        if isinstance(row, dict):
            meta = row.get("metadata") or {}
            if isinstance(meta, str):
                try:
                    meta = json.loads(meta)
                except json.JSONDecodeError:
                    meta = {}
            out.append(_shape_nearby_supplier(row, meta))
        else:
            meta_raw = row[7]
            meta = meta_raw if isinstance(meta_raw, dict) else {}
            if isinstance(meta_raw, str):
                try:
                    meta = json.loads(meta_raw)
                except json.JSONDecodeError:
                    meta = {}
            out.append(
                _shape_nearby_supplier(
                    {
                        "id": row[0],
                        "name": row[1],
                        "country": row[2],
                        "company_type": row[3],
                        "website": row[4],
                        "confidence": row[5],
                        "supplier_status": row[6],
                    },
                    meta,
                )
            )
    return out


def _shape_nearby_supplier(row: dict[str, Any], meta: dict[str, Any]) -> dict[str, Any]:
    tier = meta.get("geocode_tier")
    disclaimer = meta.get("geocode_disclaimer") or _geocode_disclaimer(tier)
    lat = meta.get("display_lat")
    lng = meta.get("display_lng")
    out = {
        "id": row.get("id"),
        "name": row.get("name"),
        "country": row.get("country"),
        "company_type": row.get("company_type"),
        "website": row.get("website"),
        "confidence": float(row.get("confidence") or 0),
        "supplier_status": row.get("supplier_status"),
        "port_locode": meta.get("port_locode"),
        "port_name": meta.get("port_name"),
        "product_types": meta.get("product_types") or [],
        "fuels_supplied": meta.get("fuels_supplied"),
        "contact_person": meta.get("contact_person"),
        "address": meta.get("register_address"),
        "license_authority": meta.get("license_authority"),
        "source_url": meta.get("source_url") or meta.get("register_source_url"),
        "enrichment_tier": meta.get("enrichment_tier"),
        "geocode_tier": tier,
        "geocode_disclaimer": disclaimer,
    }
    if lat is not None and lng is not None:
        try:
            out["lat"] = float(lat)
            out["lng"] = float(lng)
        except (TypeError, ValueError):
            pass
    return out


def _geocode_disclaimer(tier: Any) -> Optional[str]:
    mapping = {
        "register_address_geocoded": "Marker from official register address; verify before site visit",
        "osm_facility_match": "Marker matched to OSM petroleum facility near port; not confirmed office",
        "port_hub_anchor": "Port licensed supplier; marker is hub anchor (no published office address on register)",
    }
    if tier is None:
        return None
    return mapping.get(str(tier))
