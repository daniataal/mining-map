"""Curated port authority major-customer directories (public marketing pages)."""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

try:
    from backend.services.repo_data_paths import repo_data_file
except ImportError:
    from services.repo_data_paths import repo_data_file  # type: ignore

DIRECTORY_PATH = repo_data_file("port_authority_directories.json")

CATEGORY_LABELS: dict[str, str] = {
    "tank_storage_and_refineries": "Tank storage companies & refineries",
    "bunker_suppliers": "Licensed bunker suppliers",
    "shipping_agents": "Agents & service providers",
    "aggregate_exporters": "Aggregate exporters",
    "other": "Other",
}

DISCLAIMER = (
    "Public port authority customer list — not verified tank capacity, berth contract, or ownership; "
    "confirm before deals."
)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_company_name(name: str) -> str:
    text = re.sub(r"[^a-z0-9]+", " ", (name or "").lower()).strip()
    return " ".join(text.split())


def _slug(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", (text or "").lower()).strip("_")
    return slug[:72] or "unknown"


def load_port_directories(path: Optional[Path] = None) -> dict[str, Any]:
    seed_path = path or DIRECTORY_PATH
    if not seed_path.is_file():
        return {"meta": {}, "ports": []}
    payload = json.loads(seed_path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("port_authority_directories.json must be a JSON object")
    return payload


def _curated_hub_index(fetched_at: Optional[str] = None) -> dict[str, dict[str, Any]]:
    """Map curated_storage external_id → normalized storage hub entity."""
    try:
        from backend.services.storage_terminals_seed import load_curated_storage_terminals
    except ImportError:
        from services.storage_terminals_seed import load_curated_storage_terminals  # type: ignore

    return {str(hub["id"]): hub for hub in load_curated_storage_terminals(fetched_at)}


def _enrich_tenant(
    tenant: dict[str, Any],
    port: dict[str, Any],
    *,
    hub_index: Optional[dict[str, dict[str, Any]]] = None,
) -> dict[str, Any]:
    name = str(tenant.get("name") or "").strip()
    category = str(tenant.get("category") or "other").strip()
    source_url = tenant.get("source_url") or port.get("source_url")
    ext_id = tenant.get("curated_storage_external_id")
    hub = (hub_index or {}).get(str(ext_id or "")) if ext_id else None
    return {
        "name": name,
        "normalized_name": _normalize_company_name(name),
        "category": category,
        "category_label": CATEGORY_LABELS.get(category, category.replace("_", " ").title()),
        "role_note": tenant.get("role_note"),
        "source_url": source_url,
        "curated_storage_external_id": ext_id,
        "storage_operator": hub.get("operatorName") if hub else None,
        "capacity_text": hub.get("capacityText") if hub else None,
        "storage_hub_id": ext_id if hub else None,
        "record_origin": "port_authority_curated",
        "evidence_type": "port_authority_page",
    }


def _build_stats(tenants: list[dict[str, Any]]) -> dict[str, Any]:
    by_category: dict[str, int] = {}
    with_storage_link = 0
    for tenant in tenants:
        cat = tenant.get("category") or "other"
        by_category[cat] = by_category.get(cat, 0) + 1
        if tenant.get("curated_storage_external_id"):
            with_storage_link += 1
    return {
        "total_tenants": len(tenants),
        "tenant_count_by_category": by_category,
        "with_storage_hub_link": with_storage_link,
    }


def get_directory_by_locode(locode: str) -> Optional[dict[str, Any]]:
    code = (locode or "").strip().upper()
    if not code:
        return None
    payload = load_port_directories()
    meta = payload.get("meta") if isinstance(payload.get("meta"), dict) else {}
    for port in payload.get("ports") or []:
        if not isinstance(port, dict):
            continue
        if str(port.get("locode") or "").upper() != code:
            continue
        hub_index = _curated_hub_index()
        tenants = [
            _enrich_tenant(t, port, hub_index=hub_index)
            for t in port.get("tenants") or []
            if isinstance(t, dict)
        ]
        tenants = [t for t in tenants if t.get("name")]
        tenants.sort(key=lambda item: (item.get("category") or "", item.get("name") or ""))
        return {
            "locode": code,
            "port_name": port.get("port_name"),
            "port_authority_name": port.get("port_authority_name"),
            "country": port.get("country"),
            "country_iso2": port.get("country_iso2"),
            "lat": port.get("lat"),
            "lng": port.get("lng"),
            "source_url": port.get("source_url"),
            "source_accessed_at": meta.get("source_accessed_at"),
            "record_origin": meta.get("record_origin") or "port_authority_curated",
            "evidence_type": meta.get("evidence_type") or "port_authority_page",
            "disclaimer": meta.get("disclaimer") or DISCLAIMER,
            "categories": [
                {"id": key, "label": label}
                for key, label in CATEGORY_LABELS.items()
            ],
            "tenants": tenants,
            "stats": _build_stats(tenants),
            "data_as_of": _now_iso(),
        }
    return None


def list_directory_coverage() -> dict[str, Any]:
    payload = load_port_directories()
    ports = []
    for port in payload.get("ports") or []:
        if not isinstance(port, dict):
            continue
        locode = str(port.get("locode") or "").upper()
        tenant_count = len([t for t in port.get("tenants") or [] if isinstance(t, dict) and t.get("name")])
        ports.append(
            {
                "locode": locode,
                "port_name": port.get("port_name"),
                "country": port.get("country"),
                "tenant_count": tenant_count,
                "source_url": port.get("source_url"),
            }
        )
    ports.sort(key=lambda item: (-int(item.get("tenant_count") or 0), item.get("locode") or ""))
    return {
        "port_count": len(ports),
        "ports": ports,
        "data_as_of": _now_iso(),
    }


def attach_port_directory_to_entity(entity: dict[str, Any]) -> dict[str, Any]:
    """Merge directory onto a port logistics entity when locode matches."""
    locode = str(entity.get("locode") or "").strip().upper()
    if not locode:
        return entity
    directory = get_directory_by_locode(locode)
    if not directory:
        return entity
    merged = dict(entity)
    merged["portDirectory"] = directory
    limitations = list(merged.get("limitations") or [])
    limitations.append(directory.get("disclaimer") or DISCLAIMER)
    merged["limitations"] = limitations
    evidence = list(merged.get("evidence") or [])
    evidence.append(
        {
            "id": f"port_authority:{locode}",
            "title": f"Port authority directory: {directory.get('port_authority_name') or locode}",
            "url": directory.get("source_url"),
            "source_label": directory.get("port_authority_name") or "Port authority",
            "evidence_type": "port_authority_page",
            "confidence": 0.55,
            "summary": (
                f"{directory.get('stats', {}).get('total_tenants', 0)} tenants listed on public "
                "major-customers page (curated transcription)."
            ),
            "seen_at": directory.get("data_as_of"),
        }
    )
    merged["evidence"] = evidence
    merged["evidenceCount"] = len(evidence)
    return merged


def port_authority_linked_hub_ids() -> set[str]:
    """Curated storage hub IDs referenced from port-authority tenant lists."""
    linked: set[str] = set()
    for port in load_port_directories().get("ports") or []:
        if not isinstance(port, dict):
            continue
        for raw in port.get("tenants") or []:
            if not isinstance(raw, dict):
                continue
            ext_id = str(raw.get("curated_storage_external_id") or "").strip()
            if ext_id:
                linked.add(ext_id)
    return linked


def _partition_port_hubs_inside_osm_cluster(
    entities: list[dict[str, Any]],
    reference_hubs: list[dict[str, Any]],
    locode: str,
    *,
    min_tanks: int = 24,
) -> list[dict[str, Any]]:
    """Spread port-tenant hub anchors inside a dense OSM tank farm (FOIZ has many operators, not one)."""
    loc = locode.upper()
    port_hubs = [h for h in reference_hubs if str(h.get("portAuthorityLocode") or "").upper() == loc]
    if len(port_hubs) < 2:
        return reference_hubs

    port_meta = next(
        (
            p
            for p in (load_port_directories().get("ports") or [])
            if isinstance(p, dict) and str(p.get("locode") or "").upper() == loc
        ),
        None,
    )
    partition_bbox: Optional[tuple[float, float, float, float]] = None
    min_tank_threshold = min_tanks
    if isinstance(port_meta, dict):
        raw_bbox = port_meta.get("osm_partition_bbox")
        if isinstance(raw_bbox, list) and len(raw_bbox) == 4:
            partition_bbox = (float(raw_bbox[0]), float(raw_bbox[1]), float(raw_bbox[2]), float(raw_bbox[3]))
        raw_min = port_meta.get("partition_min_tanks")
        if isinstance(raw_min, (int, float)) and raw_min > 0:
            min_tank_threshold = int(raw_min)

    # Only tanks in this port's tank-farm bbox — never partition using global OSM points.
    port_lat = next((float(h["lat"]) for h in port_hubs if h.get("lat") is not None), None)
    port_lng = next((float(h["lng"]) for h in port_hubs if h.get("lng") is not None), None)
    osm_points: list[tuple[float, float]] = []
    for entity in entities:
        if not str(entity.get("id", "")).startswith("osm:"):
            continue
        if entity.get("lat") is None or entity.get("lng") is None:
            continue
        lat = float(entity["lat"])
        lng = float(entity["lng"])
        if partition_bbox is not None:
            south, west, north, east = partition_bbox
            if not (south <= lat <= north and west <= lng <= east):
                continue
        elif loc == "AEFJR":
            if not (25.05 <= lat <= 25.22 and 56.25 <= lng <= 56.45):
                continue
        elif port_lat is not None and port_lng is not None:
            try:
                from backend.services.storage_terminals_seed import _haversine_km
            except ImportError:
                from services.storage_terminals_seed import _haversine_km  # type: ignore
            if _haversine_km(lat, lng, port_lat, port_lng) > 25.0:
                continue
        osm_points.append((lat, lng))
    if len(osm_points) < min_tank_threshold:
        return reference_hubs

    partition_hubs = [
        h
        for h in port_hubs
        if "foiz" not in str(h.get("id") or "").lower()
        and "oil_industry_zone" not in str(h.get("id") or "").lower()
    ]
    if len(partition_hubs) < 2:
        partition_hubs = list(port_hubs)
    partition_hubs.sort(key=lambda h: float(h["lng"]))

    osm_points.sort(key=lambda item: item[1])
    bucket_count = len(partition_hubs)
    chunk = max(1, len(osm_points) // bucket_count)

    others = [h for h in reference_hubs if str(h.get("portAuthorityLocode") or "").upper() != loc]
    repositioned: list[dict[str, Any]] = []
    for index, hub in enumerate(partition_hubs):
        start = index * chunk
        end = len(osm_points) if index == bucket_count - 1 else min(len(osm_points), (index + 1) * chunk)
        slice_points = osm_points[start:end]
        if not slice_points:
            repositioned.append(hub)
            continue
        lat = sum(point[0] for point in slice_points) / len(slice_points)
        lng = sum(point[1] for point in slice_points) / len(slice_points)
        tenant = str(hub.get("portTenantName") or hub.get("operatorName") or "").strip()
        merged = dict(hub)
        merged["lat"] = lat
        merged["lng"] = lng
        merged["operatorPartitionInferred"] = True
        merged["operatorAssignmentKind"] = "foiz_osm_partition_inferred"
        merged["capacityText"] = None
        merged["operatorAssignmentNote"] = (
            f"Inferred {tenant or 'operator'} zone inside FOIZ from OSM tank layout "
            f"({len(slice_points)} tanks in slice) — port authority lists multiple tenants; "
            "not verified per-tank ownership."
        )
        repositioned.append(merged)

    return others + repositioned


def anchor_port_authority_hubs_to_osm(
    entities: list[dict[str, Any]],
    fetched_at: str,
    *,
    radius_km: float = 4.0,
) -> list[dict[str, Any]]:
    """Attach port-authority operator/capacity to nearby OSM tank geometry (OSM-first, not runway centroids)."""
    try:
        from backend.services.storage_terminals_seed import enrich_osm_from_reference_hubs
    except ImportError:
        from services.storage_terminals_seed import enrich_osm_from_reference_hubs  # type: ignore

    hub_index = _curated_hub_index(fetched_at)
    reference_hubs: list[dict[str, Any]] = []
    for port in load_port_directories().get("ports") or []:
        if not isinstance(port, dict):
            continue
        locode = str(port.get("locode") or "").upper()
        port_name = str(port.get("port_name") or "").strip()
        for raw in port.get("tenants") or []:
            if not isinstance(raw, dict):
                continue
            ext_id = str(raw.get("curated_storage_external_id") or "").strip()
            if not ext_id:
                continue
            hub = hub_index.get(ext_id)
            if not hub:
                continue
            tenant_name = str(raw.get("name") or "").strip()
            ref = dict(hub)
            if ref.get("operatorName"):
                ref["company"] = str(ref["operatorName"]).strip()
            elif tenant_name:
                ref["company"] = tenant_name
            ref["portAuthorityLocode"] = locode
            ref["portAuthorityPortName"] = port_name or None
            ref["portTenantName"] = tenant_name or None
            ref["portTenantCategory"] = raw.get("category")
            reference_hubs.append(ref)

    if not reference_hubs:
        return entities

    for port in load_port_directories().get("ports") or []:
        if not isinstance(port, dict):
            continue
        locode = str(port.get("locode") or "").upper()
        if port.get("osm_partition_bbox") or locode == "AEFJR":
            reference_hubs = _partition_port_hubs_inside_osm_cluster(entities, reference_hubs, locode)

    enriched = enrich_osm_from_reference_hubs(
        entities,
        reference_hubs,
        distance_km=radius_km,
        enrichment_kind="port_authority_curated",
        source_label="Port authority + curated",
        evidence_type="port_authority_osm_anchor",
        summary_prefix="OSM tank geometry enriched from port authority / curated hub",
        confidence_boost=0.16,
        skip_if_enriched=False,
        require_sparse=False,
    )

    osm_enriched_near_hub = 0
    for entity in enriched:
        if str(entity.get("id", "")).startswith("osm:") and entity.get("portAuthorityLocode"):
            osm_enriched_near_hub += 1

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
                        "hypothesisId": "B",
                        "location": "port_authority_directory.py:anchor_port_authority_hubs_to_osm",
                        "message": "osm_anchor_complete",
                        "data": {
                            "reference_hub_count": len(reference_hubs),
                            "radius_km": radius_km,
                            "osm_enriched_with_port_metadata": osm_enriched_near_hub,
                            "fujairah_operators": sorted(
                                {
                                    str(e.get("operatorName") or "")
                                    for e in enriched
                                    if str(e.get("portAuthorityLocode") or "").upper() == "AEFJR"
                                    and e.get("operatorName")
                                }
                            ),
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

    return enriched


def sync_port_authority_tenants_to_companies(cur: Any) -> dict[str, int]:
    """Upsert directory tenant names into oil_companies (graph-sync hook)."""
    try:
        from backend.services.oil_live_graph_sync import _upsert_company
    except ImportError:
        from services.oil_live_graph_sync import _upsert_company  # type: ignore

    payload = load_port_directories()
    indexed = 0
    for port in payload.get("ports") or []:
        if not isinstance(port, dict):
            continue
        country = str(port.get("country") or "").strip()
        locode = str(port.get("locode") or "").upper()
        source_url = port.get("source_url")
        for raw in port.get("tenants") or []:
            if not isinstance(raw, dict):
                continue
            name = str(raw.get("name") or "").strip()
            if not name or len(name) < 2:
                continue
            if "port register" in name.lower() or "port listing" in name.lower():
                continue
            cid = _upsert_company(
                cur,
                name=name,
                country=country,
                company_type="port_tenant",
                source="port_authority_curated",
                confidence=0.55,
                metadata={
                    "port_locode": locode,
                    "port_name": port.get("port_name"),
                    "tenant_category": raw.get("category"),
                    "source_url": raw.get("source_url") or source_url,
                    "curated_storage_external_id": raw.get("curated_storage_external_id"),
                },
            )
            if cid:
                indexed += 1
    return {"port_authority_tenants_indexed": indexed}
