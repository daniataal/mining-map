"""Curated major global petroleum storage terminals (reference layer).

Loads ``data/storage_terminals_seed.json`` — named tank farms and oil storage
hubs with operator hints from public company/regulator pages. source_kind=curated_reference.
Complements sparse OpenStreetMap coverage; not an audited capacity registry.
"""

from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

try:
    from backend.services.maritime_intel import find_nearest_ports
except ImportError:
    from services.maritime_intel import find_nearest_ports

try:
    from backend.services.storage_terminals import (
        MAX_NEARBY_PORT_DISTANCE_KM,
        _commodity_hints_from_tags,
        _format_license_type,
        _now_iso,
        resolve_country,
    )
except ImportError:
    from services.storage_terminals import (  # type: ignore
        MAX_NEARBY_PORT_DISTANCE_KM,
        _commodity_hints_from_tags,
        _format_license_type,
        _now_iso,
        resolve_country,
    )


REPO_ROOT = Path(__file__).resolve().parents[2]
SEED_PATH = REPO_ROOT / "data" / "storage_terminals_seed.json"

SOURCE_ID = "storage_terminals_curated"
SOURCE_NAME = "Curated major global petroleum storage terminals"
EXTERNAL_ID_PREFIX = "curated_storage_"


@dataclass
class CuratedStorageTerminal:
    name: str
    country: str
    region: str
    lat: float
    lng: float
    entity_subtype: str = "storage_terminal"
    operator: Optional[str] = None
    owner: Optional[str] = None
    commodity: str = "petroleum"
    capacity_text: Optional[str] = None
    source_record_url: Optional[str] = None
    notes: Optional[str] = None


def _slug(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", (text or "").lower()).strip("_")
    return slug[:72] or "unknown"


def _external_id(name: str, country: str) -> str:
    return f"{EXTERNAL_ID_PREFIX}{_slug(name)}_{_slug(country)}"


def load_seed_records(path: Optional[Path] = None) -> list[CuratedStorageTerminal]:
    seed_path = path or SEED_PATH
    if not seed_path.is_file():
        return []

    payload = json.loads(seed_path.read_text(encoding="utf-8"))
    rows = payload.get("entities") if isinstance(payload, dict) else None
    if not isinstance(rows, list):
        raise ValueError("Seed file must contain an 'entities' array")

    records: list[CuratedStorageTerminal] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        name = str(row.get("name") or row.get("company") or "").strip()
        country = str(row.get("country") or "").strip()
        lat = row.get("lat")
        lng = row.get("lng")
        if not name or not country or lat is None or lng is None:
            continue
        records.append(
            CuratedStorageTerminal(
                name=name,
                country=country,
                region=str(row.get("region") or country).strip(),
                lat=float(lat),
                lng=float(lng),
                entity_subtype=str(row.get("entity_subtype") or "storage_terminal").strip(),
                operator=(str(row.get("operator")).strip() if row.get("operator") else None),
                owner=(str(row.get("owner")).strip() if row.get("owner") else None),
                commodity=str(row.get("commodity") or "petroleum").strip(),
                capacity_text=(str(row.get("capacity_text")).strip() if row.get("capacity_text") else None),
                source_record_url=(str(row.get("source_record_url")).strip() if row.get("source_record_url") else None),
                notes=(str(row.get("notes")).strip() if row.get("notes") else None),
            )
        )
    return records


def normalize_curated_terminal(record: CuratedStorageTerminal, fetched_at: str) -> dict[str, Any]:
    subtype = record.entity_subtype or "storage_terminal"
    country, country_iso2 = resolve_country(record.lat, record.lng)
    if country == "Unknown" and record.country:
        country = record.country

    commodity_hints = _commodity_hints_from_tags({"product": record.commodity, "industrial": subtype})
    if not commodity_hints:
        commodity_hints = ["petroleum"]

    nearest_port = None
    if country_iso2:
        nearest_ports = find_nearest_ports(
            country_iso2=country_iso2,
            lat=record.lat,
            lng=record.lng,
            limit=1,
        )
        if nearest_ports:
            port = dict(nearest_ports[0])
            if port.get("distance_km") is not None and float(port["distance_km"]) <= MAX_NEARBY_PORT_DISTANCE_KM:
                nearest_port = port

    confidence = 0.62
    if record.operator:
        confidence += 0.05
    if record.source_record_url:
        confidence += 0.03
    if record.capacity_text:
        confidence += 0.02
    confidence = min(0.78, confidence)

    facility_name = record.name
    operator = record.operator
    owner = record.owner
    confidence_note = (
        "Curated reference point for a major petroleum storage hub from public operator/regulator pages. "
        "Coordinates are approximate hub centroids — verify before operational use."
    )
    if record.notes:
        confidence_note = f"{confidence_note} {record.notes}"

    evidence = [
        {
            "id": f"{_external_id(record.name, record.country)}:curated",
            "title": f"Curated reference: {record.name}",
            "url": record.source_record_url,
            "source_label": "Curated reference",
            "evidence_type": "curated_reference",
            "confidence": round(confidence, 2),
            "summary": confidence_note,
        }
    ]
    if nearest_port:
        evidence.append(
            {
                "id": f"{_external_id(record.name, record.country)}:port",
                "title": f"Nearest port context: {nearest_port['name']}",
                "url": nearest_port.get("source_url"),
                "source_label": nearest_port.get("source_label") or "UN/LOCODE",
                "evidence_type": "nearby_port",
                "confidence": float(nearest_port.get("confidence") or 0.0),
                "summary": (
                    f"{nearest_port['name']} is {nearest_port.get('distance_km')} km away."
                    if nearest_port.get("distance_km") is not None
                    else "Nearest port context derived from UN/LOCODE."
                ),
            }
        )

    return {
        "id": _external_id(record.name, record.country),
        "company": facility_name,
        "licenseType": _format_license_type(subtype),
        "commodity": record.commodity,
        "status": "Curated reference",
        "date": None,
        "country": country,
        "region": record.region or country,
        "sector": "oil_and_gas",
        "lat": record.lat,
        "lng": record.lng,
        "recordOrigin": "curated_reference",
        "sourceId": SOURCE_ID,
        "sourceName": SOURCE_NAME,
        "sourceUrl": record.source_record_url,
        "sourceRecordUrl": record.source_record_url,
        "sourceUpdatedAt": fetched_at,
        "lastSyncedAt": fetched_at,
        "sourceKind": "curated_reference",
        "entityKind": "storage_terminal",
        "entitySubtype": subtype,
        "operatorName": operator,
        "ownerName": owner,
        "substanceText": record.commodity,
        "commodityHints": commodity_hints,
        "capacityText": record.capacity_text,
        "confidenceScore": round(confidence, 2),
        "confidenceNote": confidence_note,
        "sourceLabels": ["Curated reference", "UN/LOCODE"] if nearest_port else ["Curated reference"],
        "nearbyPort": nearest_port,
        "evidenceCount": len(evidence),
        "evidence": evidence,
        "enrichmentNote": record.notes,
    }


def load_curated_storage_terminals(fetched_at: Optional[str] = None) -> list[dict[str, Any]]:
    ts = fetched_at or _now_iso()
    return [
        normalize_curated_terminal(record, ts)
        for record in load_seed_records()
    ]


def _haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    radius_km = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lng2 - lng1)
    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    return 2 * radius_km * math.asin(min(1.0, math.sqrt(a)))


def _normalize_name(value: str) -> str:
    text = re.sub(r"[^a-z0-9]+", " ", (value or "").lower()).strip()
    return " ".join(text.split())


def _names_overlap(a: str, b: str) -> bool:
    left = _normalize_name(a)
    right = _normalize_name(b)
    if not left or not right:
        return False
    if left == right or left in right or right in left:
        return True
    left_tokens = set(left.split())
    right_tokens = set(right.split())
    if len(left_tokens) >= 2 and len(right_tokens) >= 2:
        overlap = left_tokens & right_tokens
        if len(overlap) >= min(2, len(left_tokens), len(right_tokens)):
            return True
    return False


def drop_curated_near_osm_duplicates(
    entities: list[dict[str, Any]],
    *,
    distance_km: float = 4.0,
) -> list[dict[str, Any]]:
    """Prefer OSM when a curated hub sits on top of an already-mapped terminal."""
    osm_points = [
        entity
        for entity in entities
        if str(entity.get("id", "")).startswith("osm:")
        and entity.get("lat") is not None
        and entity.get("lng") is not None
    ]
    if not osm_points:
        return entities

    kept: list[dict[str, Any]] = []
    for entity in entities:
        if entity.get("sourceKind") != "curated_reference":
            kept.append(entity)
            continue
        lat = float(entity["lat"])
        lng = float(entity["lng"])
        name = str(entity.get("company") or "")
        duplicate = False
        for osm in osm_points:
            if _haversine_km(lat, lng, float(osm["lat"]), float(osm["lng"])) > distance_km:
                continue
            if _names_overlap(name, str(osm.get("company") or "")):
                duplicate = True
                break
        if not duplicate:
            kept.append(entity)
    return kept
