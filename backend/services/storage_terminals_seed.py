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


try:
    from backend.services.repo_data_paths import repo_data_file
except ImportError:
    from services.repo_data_paths import repo_data_file  # type: ignore

SEED_PATH = repo_data_file("storage_terminals_seed.json")

SOURCE_ID = "storage_terminals_curated"
SOURCE_NAME = "Curated major global petroleum storage terminals"
EXTERNAL_ID_PREFIX = "curated_storage_"

# Fujairah International Airport (OMF/FJR) — curated FOIZ hubs must not sit on the airfield.
_FUJAIRAH_AIRPORT_LAT = 25.1122
_FUJAIRAH_AIRPORT_LNG = 56.3240
_FUJAIRAH_AIRPORT_EXCLUSION_KM = 2.5
_FUJAIRAH_FOIZ_HUB_LAT = 25.131
_FUJAIRAH_FOIZ_HUB_LNG = 56.345


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
    eia_padd: Optional[str] = None
    retain_near_osm: bool = False


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
                eia_padd=(str(row.get("eia_padd")).strip().upper() if row.get("eia_padd") else None),
                retain_near_osm=bool(row.get("retain_near_osm")),
            )
        )
    return records


def _nudge_fujairah_off_airport(
    record: CuratedStorageTerminal,
    lat: float,
    lng: float,
) -> tuple[float, float, bool, Optional[str]]:
    region_lower = (record.region or "").lower()
    if "fujairah" not in region_lower and record.country != "United Arab Emirates":
        return lat, lng, False, None
    dist_km = _haversine_km(lat, lng, _FUJAIRAH_AIRPORT_LAT, _FUJAIRAH_AIRPORT_LNG)
    if dist_km >= _FUJAIRAH_AIRPORT_EXCLUSION_KM:
        return lat, lng, False, None
    # #region agent log
    try:
        import json as _json
        import time as _time

        _log_path = "/workspace/.cursor/debug-7419a2.log"
        if not __import__("os").path.isdir("/workspace/.cursor"):
            _log_path = str(Path(__file__).resolve().parents[2] / ".cursor" / "debug-7419a2.log")
        with open(_log_path, "a", encoding="utf-8") as _f:
            _f.write(
                _json.dumps(
                    {
                        "sessionId": "7419a2",
                        "hypothesisId": "A",
                        "location": "storage_terminals_seed.py:_nudge_fujairah_off_airport",
                        "message": "fujairah_airport_vicinity_nudge",
                        "data": {
                            "name": record.name,
                            "from_lat": lat,
                            "from_lng": lng,
                            "dist_airport_km": round(dist_km, 3),
                            "to_lat": _FUJAIRAH_FOIZ_HUB_LAT,
                            "to_lng": _FUJAIRAH_FOIZ_HUB_LNG,
                        },
                        "timestamp": int(_time.time() * 1000),
                    },
                    default=str,
                )
                + "\n"
            )
    except OSError:
        pass
    # #endregion
    return _FUJAIRAH_FOIZ_HUB_LAT, _FUJAIRAH_FOIZ_HUB_LNG, True, "fujairah_foiz_centroid_nudge"


def normalize_curated_terminal(record: CuratedStorageTerminal, fetched_at: str) -> dict[str, Any]:
    subtype = record.entity_subtype or "storage_terminal"
    lat, lng = record.lat, record.lng
    lat, lng, geo_approximated, geo_source = _nudge_fujairah_off_airport(record, lat, lng)
    country, country_iso2 = resolve_country(lat, lng)
    if country == "Unknown" and record.country:
        country = record.country

    commodity_hints = _commodity_hints_from_tags({"product": record.commodity, "industrial": subtype})
    if not commodity_hints:
        commodity_hints = ["petroleum"]

    nearest_port = None
    if country_iso2:
        nearest_ports = find_nearest_ports(
            country_iso2=country_iso2,
            lat=lat,
            lng=lng,
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
    if geo_approximated:
        confidence_note = (
            f"{confidence_note} Coordinates adjusted off Fujairah airport vicinity to FOIZ tank-terminal cluster."
        )

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
        "lat": lat,
        "lng": lng,
        "geoApproximated": geo_approximated,
        "geoSource": geo_source,
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
        "retainNearOsm": record.retain_near_osm,
    }


def load_curated_storage_terminals(fetched_at: Optional[str] = None) -> list[dict[str, Any]]:
    ts = fetched_at or _now_iso()
    records = load_seed_records()
    entities = [normalize_curated_terminal(record, ts) for record in records]
    # #region agent log
    try:
        import json as _json
        import time as _time

        _log_path = "/workspace/.cursor/debug-7419a2.log"
        if not __import__("os").path.isdir("/workspace/.cursor"):
            _log_path = str(Path(__file__).resolve().parents[2] / ".cursor" / "debug-7419a2.log")
        _payload = {
            "sessionId": "7419a2",
            "hypothesisId": "A",
            "location": "storage_terminals_seed.py:load_curated_storage_terminals",
            "message": "curated_seed_load",
            "data": {
                "seed_path": str(SEED_PATH),
                "seed_exists": SEED_PATH.is_file(),
                "record_count": len(records),
                "entity_count": len(entities),
                "uae_count": sum(
                    1 for e in entities if "United Arab Emirates" in str(e.get("country") or "")
                ),
                "fujairah_count": sum(
                    1
                    for e in entities
                    if e.get("lat") is not None
                    and 25.0 <= float(e["lat"]) <= 25.25
                    and e.get("lng") is not None
                    and 56.2 <= float(e["lng"]) <= 56.5
                ),
            },
            "timestamp": int(_time.time() * 1000),
        }
        with open(_log_path, "a", encoding="utf-8") as _f:
            _f.write(_json.dumps(_payload, default=str) + "\n")
    except OSError:
        pass
    # #endregion
    return entities


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


GENERIC_OSM_STORAGE_NAMES = {
    "unnamed storage terminal",
    "unnamed storage tank",
    "storage tank",
    "storage terminal",
}


def _is_generic_osm_storage_name(value: Any) -> bool:
    normalized = (str(value or "").strip().lower())
    if not normalized:
        return True
    if normalized in GENERIC_OSM_STORAGE_NAMES:
        return True
    return normalized.startswith("unnamed storage")


def _is_sparse_osm_entity(entity: dict[str, Any]) -> bool:
    if not str(entity.get("id", "")).startswith("osm:"):
        return False
    company = str(entity.get("company") or "")
    missing_operator = not str(entity.get("operatorName") or "").strip()
    missing_owner = not str(entity.get("ownerName") or "").strip()
    missing_capacity = not str(entity.get("capacityText") or "").strip()
    generic_name = _is_generic_osm_storage_name(company)
    unknown_country = not str(entity.get("country") or "").strip() or str(entity.get("country")) == "Unknown"
    return generic_name or missing_operator or missing_owner or missing_capacity or unknown_country


def _apply_reference_hub_to_sparse_entity(
    entity: dict[str, Any],
    hub: dict[str, Any],
    *,
    distance_km: float,
    enrichment_kind: str,
    source_label: str,
    evidence_type: str,
    summary_prefix: str,
    confidence_boost: float = 0.14,
    max_confidence: float = 0.84,
) -> dict[str, Any]:
    updated = dict(entity)
    hub_name = str(hub.get("company") or "").strip()

    if not str(updated.get("operatorName") or "").strip() and hub.get("operatorName"):
        updated["operatorName"] = hub["operatorName"]
    if not str(updated.get("ownerName") or "").strip() and hub.get("ownerName"):
        updated["ownerName"] = hub["ownerName"]
    if not str(updated.get("capacityText") or "").strip() and hub.get("capacityText"):
        updated["capacityText"] = hub["capacityText"]
    if not str(updated.get("substanceText") or "").strip() and hub.get("substanceText"):
        updated["substanceText"] = hub["substanceText"]
    if hub.get("commodityHints") and not updated.get("commodityHints"):
        updated["commodityHints"] = list(hub["commodityHints"])
    if (not str(updated.get("country") or "").strip() or str(updated.get("country")) == "Unknown") and hub.get(
        "country"
    ):
        updated["country"] = hub["country"]
    if (
        not str(updated.get("region") or "").strip()
        or str(updated.get("region")) == "Unknown"
        or str(updated.get("region")) == str(updated.get("country"))
    ) and hub.get("region"):
        updated["region"] = hub["region"]
    if not updated.get("nearbyPort") and hub.get("nearbyPort"):
        updated["nearbyPort"] = hub["nearbyPort"]
    if hub_name and _is_generic_osm_storage_name(updated.get("company")):
        updated["siteContextName"] = hub_name
        updated["siteContextInferred"] = False
        updated["siteContextSource"] = hub.get("id")
    operator_label = str(hub.get("operatorName") or hub_name or "").strip()
    if operator_label and _is_generic_osm_storage_name(updated.get("company")):
        updated["company"] = operator_label
    for port_field in (
        "portAuthorityLocode",
        "portAuthorityPortName",
        "portTenantName",
        "portTenantCategory",
    ):
        if hub.get(port_field) and not updated.get(port_field):
            updated[port_field] = hub[port_field]
    if hub.get("operatorAssignmentKind"):
        updated["operatorAssignmentKind"] = hub["operatorAssignmentKind"]
    if hub.get("operatorPartitionInferred"):
        updated["operatorPartitionInferred"] = True
    if hub.get("operatorAssignmentNote"):
        updated["operatorAssignmentNote"] = hub["operatorAssignmentNote"]

    if hub.get("operatorPartitionInferred") and distance_km > 1.5:
        updated.pop("capacityText", None)

    if not updated.get("curatedEnrichmentSourceId"):
        updated["curatedEnrichmentSourceId"] = hub.get("id")
        updated["curatedEnrichmentSourceName"] = hub_name or None
        updated["curatedEnrichmentDistanceKm"] = round(distance_km, 2)
        updated["referenceEnrichmentKind"] = enrichment_kind
        if hub.get("sourceRecordUrl"):
            updated["enrichmentSourceUrl"] = hub["sourceRecordUrl"]
    if hub.get("enrichmentNote"):
        prior_note = str(updated.get("enrichmentNote") or "").strip()
        note = str(hub["enrichmentNote"]).strip()
        updated["enrichmentNote"] = f"{prior_note} {note}".strip() if prior_note else note

    if hub.get("operatorPartitionInferred"):
        enrichment_note = str(hub.get("operatorAssignmentNote") or summary_prefix)
        enrichment_note = f"{enrichment_note} (~{distance_km:.1f} km to zone centroid)."
    else:
        enrichment_note = (
            f"{summary_prefix} ({hub_name or hub.get('id')}, ~{distance_km:.1f} km). "
            "Verify operator/capacity before commercial use."
        )
    prior_confidence_note = str(updated.get("confidenceNote") or "").strip()
    updated["confidenceNote"] = (
        f"{prior_confidence_note} {enrichment_note}".strip() if prior_confidence_note else enrichment_note
    )
    updated["confidenceScore"] = min(
        max_confidence,
        float(updated.get("confidenceScore") or 0.5) + confidence_boost,
    )

    labels = list(updated.get("sourceLabels") or [])
    if source_label not in labels:
        labels.append(source_label)
    updated["sourceLabels"] = labels

    evidence = list(updated.get("evidence") or [])
    evidence.append(
        {
            "id": f"{updated.get('id')}:{evidence_type}",
            "title": f"{source_label} enrichment: {hub_name or 'storage reference'}",
            "url": hub.get("sourceRecordUrl"),
            "source_label": source_label,
            "evidence_type": evidence_type,
            "confidence": round(float(updated.get("confidenceScore") or 0.0), 2),
            "summary": enrichment_note,
        }
    )
    updated["evidence"] = evidence
    updated["evidenceCount"] = len(evidence)
    return updated


def enrich_osm_from_reference_hubs(
    entities: list[dict[str, Any]],
    reference_hubs: list[dict[str, Any]],
    *,
    distance_km: float = 4.0,
    enrichment_kind: str = "curated_reference",
    source_label: str = "Curated reference",
    evidence_type: str = "curated_enrichment",
    summary_prefix: str = "Sparse OSM geometry enriched from curated reference hub",
    confidence_boost: float = 0.14,
    skip_if_enriched: bool = False,
    require_sparse: bool = True,
) -> list[dict[str, Any]]:
    """Fill OSM tank nodes from nearby reference hub rows (sparse-only by default)."""
    hubs = [
        hub
        for hub in reference_hubs
        if hub.get("lat") is not None and hub.get("lng") is not None
    ]
    if not hubs:
        return entities

    skip_kinds = {"curated_reference", "oil_terminal_reference", "government_open"}
    if not require_sparse:
        by_id = {str(entity.get("id") or ""): entity for entity in entities}
        for entity_id, entity in list(by_id.items()):
            if entity.get("sourceKind") in skip_kinds:
                continue
            if not str(entity_id).startswith("osm:"):
                continue
            if skip_if_enriched and entity.get("curatedEnrichmentSourceId"):
                continue
            lat = float(entity["lat"])
            lng = float(entity["lng"])
            best_hub: Optional[dict[str, Any]] = None
            best_dist = distance_km + 1.0
            for hub in hubs:
                dist = _haversine_km(lat, lng, float(hub["lat"]), float(hub["lng"]))
                if dist <= distance_km and dist < best_dist:
                    best_dist = dist
                    best_hub = hub
            if best_hub is None:
                continue
            by_id[entity_id] = _apply_reference_hub_to_sparse_entity(
                entity,
                best_hub,
                distance_km=best_dist,
                enrichment_kind=enrichment_kind,
                source_label=source_label,
                evidence_type=evidence_type,
                summary_prefix=summary_prefix,
                confidence_boost=confidence_boost,
            )
        return list(by_id.values())

    enriched: list[dict[str, Any]] = []
    for entity in entities:
        if entity.get("sourceKind") in skip_kinds:
            enriched.append(entity)
            continue
        if require_sparse and not _is_sparse_osm_entity(entity):
            enriched.append(entity)
            continue
        if skip_if_enriched and entity.get("curatedEnrichmentSourceId"):
            enriched.append(entity)
            continue

        lat = float(entity["lat"])
        lng = float(entity["lng"])
        best_hub: Optional[dict[str, Any]] = None
        best_dist = distance_km + 1.0
        for candidate in hubs:
            dist = _haversine_km(lat, lng, float(candidate["lat"]), float(candidate["lng"]))
            if dist <= distance_km and dist < best_dist:
                best_dist = dist
                best_hub = candidate

        if best_hub is None:
            enriched.append(entity)
            continue

        enriched.append(
            _apply_reference_hub_to_sparse_entity(
                entity,
                best_hub,
                distance_km=best_dist,
                enrichment_kind=enrichment_kind,
                source_label=source_label,
                evidence_type=evidence_type,
                summary_prefix=summary_prefix,
                confidence_boost=confidence_boost,
            )
        )

    return enriched


def enrich_osm_from_curated_reference(
    entities: list[dict[str, Any]],
    *,
    distance_km: float = 4.0,
) -> list[dict[str, Any]]:
    """Fill sparse OSM tank nodes from nearby curated major-hub reference rows."""
    curated = [
        entity
        for entity in entities
        if entity.get("sourceKind") == "curated_reference"
        and entity.get("lat") is not None
        and entity.get("lng") is not None
    ]
    return enrich_osm_from_reference_hubs(
        entities,
        curated,
        distance_km=distance_km,
        enrichment_kind="curated_reference",
        source_label="Curated reference",
        evidence_type="curated_enrichment",
        summary_prefix="Sparse OSM geometry enriched from curated reference hub",
        confidence_boost=0.14,
        skip_if_enriched=False,
    )


def enrich_osm_from_oil_terminal_reference(
    entities: list[dict[str, Any]],
    oil_terminal_hubs: list[dict[str, Any]],
    *,
    distance_km: float = 4.0,
) -> list[dict[str, Any]]:
    """Second-pass enrichment from persisted oil_terminals Postgres rows."""
    return enrich_osm_from_reference_hubs(
        entities,
        oil_terminal_hubs,
        distance_km=distance_km,
        enrichment_kind="oil_terminal_reference",
        source_label="oil_terminals DB",
        evidence_type="oil_terminal_enrichment",
        summary_prefix="Sparse OSM geometry enriched from oil_terminals Postgres reference",
        confidence_boost=0.1,
        skip_if_enriched=False,
    )


def drop_curated_when_osm_present_nearby(
    entities: list[dict[str, Any]],
    *,
    distance_km: float = 8.0,
    drop_radius_km: float = 2.0,
    dense_osm_count: int = 3,
) -> list[dict[str, Any]]:
    """Remove curated centroids when dense OSM tank geometry exists at the same site (OSM-first map).

    A single distant OSM cluster (e.g. adjacent tank farm 3–8 km away) must not suppress a
    separate curated gap-fill hub — use ``retain_near_osm`` or rely on the 2 km / ≥3 tanks rule.
    """
    _ = distance_km  # legacy kwarg; dense check uses drop_radius_km
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
        if entity.get("retainNearOsm"):
            kept.append(entity)
            continue
        lat = float(entity["lat"])
        lng = float(entity["lng"])
        nearby_dense = sum(
            1
            for osm in osm_points
            if _haversine_km(lat, lng, float(osm["lat"]), float(osm["lng"])) <= drop_radius_km
        )
        if nearby_dense >= dense_osm_count:
            continue
        kept.append(entity)
    return kept


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
        if entity.get("retainNearOsm"):
            kept.append(entity)
            continue
        lat = float(entity["lat"])
        lng = float(entity["lng"])
        name = str(entity.get("company") or "")
        curated_id = str(entity.get("id") or "")
        duplicate = False
        for osm in osm_points:
            if _haversine_km(lat, lng, float(osm["lat"]), float(osm["lng"])) > distance_km:
                continue
            if osm.get("curatedEnrichmentSourceId") == curated_id:
                duplicate = True
                break
            if _names_overlap(name, str(osm.get("company") or "")):
                duplicate = True
                break
        if not duplicate:
            kept.append(entity)
    return kept
