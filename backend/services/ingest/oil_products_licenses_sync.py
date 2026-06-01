"""
Downstream petroleum products marketing / fuel wholesale licence ingest
======================================================================
Sources (POC):
  1. Curated seed — ``data/oil_products_licenses_seed.json`` with named fuel
     marketers and petroleum products licensees in Gulf, West Africa, US, Mexico.
     Each row links to a public company site or regulator category (NPA Ghana,
     NMDPRA Nigeria, etc.). source_kind=curated_reference.
  2. Optional future API hooks — none required for POC; state US dealer registries
     vary and are not unified in a free national API.

Entity subtype ``fuel_marketer`` distinguishes these from refineries and upstream fields.
"""

from __future__ import annotations

import json
import re
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

REPO_ROOT = Path(__file__).resolve().parents[3]
SEED_PATH = REPO_ROOT / "data" / "oil_products_licenses_seed.json"

SOURCE_ID = "oil_products_licenses_curated"
SOURCE_NAME = "Curated downstream petroleum products marketing licensees"
ENTITY_SUBTYPE = "fuel_marketer"
SECTOR = "oil_and_gas"
EXTERNAL_ID_PREFIX = "oil_products_lic_"

# Canonical commodity labels for map filters and dossier display.
_COMMODITY_ALIASES: dict[str, str] = {
    "crude": "Crude Oil",
    "crude oil": "Crude Oil",
    "maya": "Maya Crude",
    "maya crude": "Maya Crude",
    "diesel": "Diesel",
    "gasoil": "Diesel",
    "gas oil": "Diesel",
    "gasoline": "Gasoline",
    "petrol": "Gasoline",
    "motor spirit": "Gasoline",
    "kerosene": "Kerosene",
    "jet fuel": "Jet fuel",
    "jet": "Jet fuel",
    "lpg": "LPG",
    "refined products": "Refined Products",
    "refined product": "Refined Products",
    "lubricants": "Lubricants",
}


@dataclass
class OilProductsLicenseEntity:
    company: str
    country: str
    region: str
    lat: float
    lng: float
    commodity: str
    license_type: str
    status: str
    source_record_url: Optional[str] = None
    entity_subtype: str = ENTITY_SUBTYPE


def normalize_commodity(raw: str) -> str:
    """Normalize commodity text to stable display labels (supports comma-separated lists)."""
    text = (raw or "").strip()
    if not text:
        return "Refined Products"

    parts = [p.strip() for p in re.split(r"[,;/|]+", text) if p.strip()]
    if not parts:
        parts = [text]

    normalized: list[str] = []
    seen: set[str] = set()
    for part in parts:
        key = part.lower()
        label = _COMMODITY_ALIASES.get(key)
        if not label:
            # Partial match for compound strings like "Gasoline, Diesel"
            for alias, canonical in _COMMODITY_ALIASES.items():
                if alias in key:
                    label = canonical
                    break
        label = label or part.strip().title()
        if label.lower() not in seen:
            seen.add(label.lower())
            normalized.append(label)

    return ", ".join(normalized) if normalized else "Refined Products"


def _slug(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", (text or "").lower()).strip("_")
    return slug[:60] or "unknown"


def _external_id(company: str, country: str) -> str:
    return f"{EXTERNAL_ID_PREFIX}{_slug(company)}_{_slug(country)}"


def load_seed_entities(path: Optional[Path] = None) -> list[OilProductsLicenseEntity]:
    seed_path = path or SEED_PATH
    if not seed_path.is_file():
        raise FileNotFoundError(f"Oil products licence seed not found: {seed_path}")

    payload = json.loads(seed_path.read_text(encoding="utf-8"))
    rows = payload.get("entities") if isinstance(payload, dict) else None
    if not isinstance(rows, list):
        raise ValueError("Seed file must contain an 'entities' array")

    entities: list[OilProductsLicenseEntity] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        company = str(row.get("company") or "").strip()
        country = str(row.get("country") or "").strip()
        if not company or not country:
            continue
        try:
            lat = float(row["lat"])
            lng = float(row["lng"])
        except (KeyError, TypeError, ValueError):
            continue
        entities.append(
            OilProductsLicenseEntity(
                company=company,
                country=country,
                region=str(row.get("region") or "").strip(),
                lat=lat,
                lng=lng,
                commodity=normalize_commodity(str(row.get("commodity") or "")),
                license_type=str(row.get("license_type") or "Petroleum products marketing").strip(),
                status=str(row.get("status") or "Active").strip(),
                source_record_url=(str(row.get("source_record_url")).strip() or None)
                if row.get("source_record_url")
                else None,
            )
        )
    return entities


def seed_oil_products_licenses(conn: Any, entities: Optional[list[OilProductsLicenseEntity]] = None) -> int:
    """Upsert curated downstream marketing rows into licenses. Returns rows written."""
    entities = entities if entities is not None else load_seed_entities()
    written = 0

    with conn.cursor() as cur:
        for entity in entities:
            external_id = _external_id(entity.company, entity.country)
            try:
                cur.execute(
                    """
                    INSERT INTO licenses (
                        id, company, country, region, lat, lng,
                        commodity, license_type, status,
                        sector, record_origin, source_kind, source_id, source_name,
                        external_id, source_record_url,
                        last_synced_at, entity_kind, entity_subtype,
                        confidence_score, confidence_note
                    ) VALUES (
                        %s, %s, %s, %s, %s, %s,
                        %s, %s, %s,
                        %s, %s, %s, %s, %s,
                        %s, %s,
                        NOW(), %s, %s,
                        %s, %s
                    )
                    ON CONFLICT (external_id) DO UPDATE SET
                        company          = EXCLUDED.company,
                        country          = EXCLUDED.country,
                        region           = EXCLUDED.region,
                        lat              = EXCLUDED.lat,
                        lng              = EXCLUDED.lng,
                        commodity        = EXCLUDED.commodity,
                        license_type     = EXCLUDED.license_type,
                        status           = EXCLUDED.status,
                        sector           = EXCLUDED.sector,
                        record_origin    = EXCLUDED.record_origin,
                        source_kind      = EXCLUDED.source_kind,
                        source_id        = EXCLUDED.source_id,
                        source_name      = EXCLUDED.source_name,
                        source_record_url = EXCLUDED.source_record_url,
                        last_synced_at   = NOW(),
                        entity_subtype   = EXCLUDED.entity_subtype,
                        confidence_score = EXCLUDED.confidence_score,
                        confidence_note  = EXCLUDED.confidence_note
                    WHERE licenses.manually_edited IS NOT TRUE
                    """,
                    (
                        str(uuid.uuid4()),
                        entity.company,
                        entity.country,
                        entity.region,
                        entity.lat,
                        entity.lng,
                        entity.commodity,
                        entity.license_type,
                        entity.status,
                        SECTOR,
                        "curated_reference",
                        "curated_reference",
                        SOURCE_ID,
                        SOURCE_NAME,
                        external_id,
                        entity.source_record_url,
                        "license",
                        entity.entity_subtype,
                        0.68,
                        "Curated downstream fuel/products marketing reference; verify active licence with national regulator before execution.",
                    ),
                )
                written += 1
            except Exception as exc:
                print(f"[OilProductsLic] Failed to upsert {entity.company}: {exc}")
                conn.rollback()
                continue

    conn.commit()
    return written


def sync_oil_products_licenses(conn: Any) -> dict[str, Any]:
    """Main entry: load seed JSON and upsert into licenses."""
    print("[OilProductsLic] Starting oil products marketing licence sync...")
    t0 = time.time()
    entities = load_seed_entities()
    written = seed_oil_products_licenses(conn, entities)
    elapsed = time.time() - t0
    print(f"[OilProductsLic] Sync complete. {written} entities upserted in {elapsed:.1f}s.")
    return {
        "entities_written": written,
        "seed_count": len(entities),
        "source_id": SOURCE_ID,
        "elapsed_s": round(elapsed, 2),
    }
