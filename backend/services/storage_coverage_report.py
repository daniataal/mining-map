"""Global petroleum storage coverage inventory and gap-candidate queue."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

try:
    from backend.services.repo_data_paths import repo_data_file
    from backend.services.storage_terminals import WORLD_TILES
    from backend.services.storage_terminals_seed import _haversine_km, load_seed_records
except ImportError:
    from services.repo_data_paths import repo_data_file  # type: ignore
    from services.storage_terminals import WORLD_TILES  # type: ignore
    from services.storage_terminals_seed import _haversine_km, load_seed_records  # type: ignore

ORPHAN_COMPANY = "Unnamed Storage Terminal"
GAP_PORT_RADIUS_KM = 8.0
GAP_MIN_OSM_AT_PORT = 5
CURATED_GAP_OSM_RADIUS_KM = 2.0
CURATED_GAP_MAX_OSM = 2

COVERAGE_DIR = repo_data_file("coverage")
GAP_QUEUE_PATH = COVERAGE_DIR / "storage_gap_queue.json"


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _entity_country(entity: dict[str, Any]) -> str:
    return str(entity.get("country") or "Unknown").strip() or "Unknown"


def _is_osm_entity(entity: dict[str, Any]) -> bool:
    return str(entity.get("id", "")).startswith("osm:")


def _is_curated_entity(entity: dict[str, Any]) -> bool:
    return entity.get("sourceKind") == "curated_reference"


def _entity_in_tile(lat: float, lng: float, tile_bbox: tuple[float, float, float, float]) -> bool:
    south, west, north, east = tile_bbox
    return south <= lat <= north and west <= lng <= east


def _count_osm_within_km(
    lat: float,
    lng: float,
    osm_points: list[tuple[float, float]],
    radius_km: float,
) -> int:
    return sum(1 for o_lat, o_lng in osm_points if _haversine_km(lat, lng, o_lat, o_lng) <= radius_km)


def _load_port_hubs() -> list[dict[str, Any]]:
    try:
        from backend.services.port_authority_directory import load_port_directories
    except ImportError:
        from services.port_authority_directory import load_port_directories  # type: ignore

    ports: list[dict[str, Any]] = []
    for port in load_port_directories().get("ports") or []:
        if not isinstance(port, dict):
            continue
        lat = port.get("lat")
        lng = port.get("lng")
        if lat is None or lng is None:
            continue
        ports.append(
            {
                "locode": str(port.get("locode") or "").upper(),
                "port_name": str(port.get("port_name") or "").strip(),
                "country": str(port.get("country") or "").strip(),
                "lat": float(lat),
                "lng": float(lng),
                "source_url": port.get("source_url"),
            }
        )
    return ports


def build_storage_coverage_report(entities: list[dict[str, Any]]) -> dict[str, Any]:
    """Summarize merged storage entities by country/tile and emit gap candidates."""
    osm_points: list[tuple[float, float]] = []
    curated_entities: list[dict[str, Any]] = []
    by_country: dict[str, dict[str, Any]] = {}

    for entity in entities:
        lat = entity.get("lat")
        lng = entity.get("lng")
        if lat is None or lng is None:
            continue
        lat_f, lng_f = float(lat), float(lng)
        country = _entity_country(entity)
        bucket = by_country.setdefault(
            country,
            {
                "country": country,
                "total": 0,
                "osm": 0,
                "curated": 0,
                "with_operator": 0,
                "orphan_osm": 0,
            },
        )
        bucket["total"] += 1
        if _is_osm_entity(entity):
            bucket["osm"] += 1
            osm_points.append((lat_f, lng_f))
            if str(entity.get("company") or "").strip() in {ORPHAN_COMPANY, ""}:
                bucket["orphan_osm"] += 1
        if _is_curated_entity(entity):
            bucket["curated"] += 1
            curated_entities.append(entity)
        if str(entity.get("operatorName") or "").strip():
            bucket["with_operator"] += 1

    for bucket in by_country.values():
        total = bucket["total"] or 1
        bucket["operator_rate"] = round(bucket["with_operator"] / total, 3)
        if bucket["osm"]:
            bucket["orphan_osm_rate"] = round(bucket["orphan_osm"] / bucket["osm"], 3)

    by_tile: list[dict[str, Any]] = []
    for tile_name, tile_bbox in WORLD_TILES:
        tile_osm = 0
        tile_curated = 0
        tile_with_operator = 0
        tile_total = 0
        for entity in entities:
            lat = entity.get("lat")
            lng = entity.get("lng")
            if lat is None or lng is None:
                continue
            if not _entity_in_tile(float(lat), float(lng), tile_bbox):
                continue
            tile_total += 1
            if _is_osm_entity(entity):
                tile_osm += 1
            if _is_curated_entity(entity):
                tile_curated += 1
            if str(entity.get("operatorName") or "").strip():
                tile_with_operator += 1
        by_tile.append(
            {
                "tile": tile_name,
                "bbox": list(tile_bbox),
                "total": tile_total,
                "osm": tile_osm,
                "curated": tile_curated,
                "with_operator": tile_with_operator,
            }
        )

    gap_candidates: list[dict[str, Any]] = []

    for port in _load_port_hubs():
        osm_near = _count_osm_within_km(port["lat"], port["lng"], osm_points, GAP_PORT_RADIUS_KM)
        if osm_near < GAP_MIN_OSM_AT_PORT:
            gap_candidates.append(
                {
                    "kind": "port_sparse_osm",
                    "priority": "P0",
                    "locode": port["locode"],
                    "name": port["port_name"],
                    "country": port["country"],
                    "lat": port["lat"],
                    "lng": port["lng"],
                    "osm_within_8km": osm_near,
                    "recommended_action": "port_directory_and_curated_gap_fill",
                    "source_url": port.get("source_url"),
                }
            )

    for entity in curated_entities:
        lat = float(entity["lat"])
        lng = float(entity["lng"])
        osm_2km = _count_osm_within_km(lat, lng, osm_points, CURATED_GAP_OSM_RADIUS_KM)
        if osm_2km <= CURATED_GAP_MAX_OSM and entity.get("retainNearOsm"):
            gap_candidates.append(
                {
                    "kind": "curated_gap_fill",
                    "priority": "P0",
                    "id": entity.get("id"),
                    "name": entity.get("company"),
                    "country": _entity_country(entity),
                    "lat": lat,
                    "lng": lng,
                    "osm_within_2km": osm_2km,
                    "retain_near_osm": True,
                    "recommended_action": "keep_curated_run_regional_osm_sync",
                }
            )

    try:
        from backend.services.storage_terminals_seed import normalize_curated_terminal
    except ImportError:
        from services.storage_terminals_seed import normalize_curated_terminal  # type: ignore

    ts = _now_iso()
    curated_ids_in_feed = {str(e.get("id") or "") for e in curated_entities}
    for record in load_seed_records():
        normalized = normalize_curated_terminal(record, ts)
        if str(normalized.get("id") or "") in curated_ids_in_feed:
            continue
        lat, lng = record.lat, record.lng
        osm_near = _count_osm_within_km(lat, lng, osm_points, GAP_PORT_RADIUS_KM)
        if osm_near < GAP_MIN_OSM_AT_PORT:
            gap_candidates.append(
                {
                    "kind": "seed_not_in_feed",
                    "priority": "P1",
                    "name": record.name,
                    "country": record.country,
                    "lat": lat,
                    "lng": lng,
                    "osm_within_8km": osm_near,
                    "retain_near_osm": record.retain_near_osm,
                    "recommended_action": "verify_merge_pipeline_and_retain_near_osm",
                }
            )

    for bucket in by_country.values():
        if bucket["osm"] >= 20 and bucket.get("operator_rate", 1.0) < 0.25:
            gap_candidates.append(
                {
                    "kind": "enrichment_gap",
                    "priority": "P1",
                    "country": bucket["country"],
                    "osm": bucket["osm"],
                    "operator_rate": bucket["operator_rate"],
                    "recommended_action": "run_graph_sync_and_port_directory_enrichment",
                }
            )

    gap_candidates.sort(key=lambda row: (row.get("priority", "P9"), row.get("country", ""), row.get("name", "")))

    totals = {
        "entities": len(entities),
        "osm": sum(1 for e in entities if _is_osm_entity(e)),
        "curated": sum(1 for e in entities if _is_curated_entity(e)),
        "with_operator": sum(1 for e in entities if str(e.get("operatorName") or "").strip()),
        "countries": len(by_country),
    }

    return {
        "generated_at": _now_iso(),
        "totals": totals,
        "by_country": sorted(by_country.values(), key=lambda row: -row["total"])[:80],
        "by_tile": by_tile,
        "gap_candidates": gap_candidates[:200],
        "gap_candidate_count": len(gap_candidates),
    }


def write_gap_queue(report: dict[str, Any], path: Optional[Path] = None) -> Path:
    """Write regional sync queue from port/curated gap candidates."""
    out = path or GAP_QUEUE_PATH
    out.parent.mkdir(parents=True, exist_ok=True)
    tiles_by_name = {name: bbox for name, bbox in WORLD_TILES}
    regional_tiles: dict[str, list[float]] = {}
    tile_names: set[str] = set()

    for candidate in report.get("gap_candidates") or []:
        if candidate.get("kind") not in {"port_sparse_osm", "curated_gap_fill"}:
            continue
        lat = candidate.get("lat")
        lng = candidate.get("lng")
        if lat is None or lng is None:
            continue
        for tile_name, tile_bbox in WORLD_TILES:
            if _entity_in_tile(float(lat), float(lng), tile_bbox):
                tile_names.add(tile_name)
                regional_tiles[tile_name] = list(tile_bbox)
                break

    payload = {
        "updated_at": _now_iso(),
        "source": "storage_coverage_report",
        "tiles": [{"tile": name, "bbox": regional_tiles[name]} for name in sorted(tile_names)],
        "layer_ids": ["storage_terminals", "pipelines", "refineries"],
        "candidates": (report.get("gap_candidates") or [])[:50],
    }
    out.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return out


def write_coverage_audit(report: dict[str, Any], path: Optional[Path] = None) -> Path:
    out = path or (COVERAGE_DIR / f"storage_audit_{datetime.now(timezone.utc).strftime('%Y-%m')}.json")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2), encoding="utf-8")
    return out


def build_report_from_storage_feed(*, force_refresh: bool = False) -> dict[str, Any]:
    try:
        from backend.services.storage_terminals import get_storage_terminals
    except ImportError:
        from services.storage_terminals import get_storage_terminals  # type: ignore

    payload = get_storage_terminals(force_refresh=force_refresh)
    entities = payload.get("entities") or []
    report = build_storage_coverage_report(entities)
    report["data_source"] = payload.get("data_source")
    report["data_as_of"] = payload.get("data_as_of")
    return report
