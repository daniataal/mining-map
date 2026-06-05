"""
Commercial intelligence around a storage terminal: port-authority tenants + nearby GEM assets.

Honest tier: leads for outreach — not verified tank lessors or lease parties.
"""

from __future__ import annotations

import json
import math
from typing import Any, Optional

try:
    from backend.services.port_authority_directory import (
        CATEGORY_LABELS,
        DISCLAIMER as PORT_DISCLAIMER,
        get_directory_by_locode,
        load_port_directories,
    )
except ImportError:
    from services.port_authority_directory import (  # type: ignore
        CATEGORY_LABELS,
        DISCLAIMER as PORT_DISCLAIMER,
        get_directory_by_locode,
        load_port_directories,
    )

DEFAULT_PORT_MATCH_KM = 45.0
DEFAULT_GEM_PLANT_KM = 18.0
DEFAULT_GEM_PIPELINE_KM = 8.0
DEFAULT_EXTRACTION_KM = 25.0
DEFAULT_GEM_LNG_KM = 25.0
TANK_TENANT_CATEGORIES = frozenset(
    {"tank_storage_and_refineries", "bunker_suppliers"},
)


def _haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(a)))


def _entity_lat_lng(entity: dict[str, Any]) -> tuple[Optional[float], Optional[float]]:
    lat = entity.get("lat")
    lng = entity.get("lng")
    if lat is None or lng is None:
        return None, None
    try:
        lat_f, lng_f = float(lat), float(lng)
    except (TypeError, ValueError):
        return None, None
    if not (-90 <= lat_f <= 90) or not (-180 <= lng_f <= 180):
        return None, None
    if lat_f == 0.0 and lng_f == 0.0:
        return None, None
    return lat_f, lng_f


def _resolve_port_directory(
    entity: dict[str, Any],
    *,
    max_port_km: float = DEFAULT_PORT_MATCH_KM,
) -> tuple[Optional[dict[str, Any]], Optional[float]]:
    locode = str(entity.get("locode") or "").strip().upper()
    if locode:
        directory = get_directory_by_locode(locode)
        if directory:
            return directory, 0.0

    lat, lng = _entity_lat_lng(entity)
    if lat is None or lng is None:
        return None, None

    best: Optional[dict[str, Any]] = None
    best_km: Optional[float] = None
    for port in load_port_directories().get("ports") or []:
        if not isinstance(port, dict):
            continue
        plat, plng = port.get("lat"), port.get("lng")
        if plat is None or plng is None:
            continue
        km = _haversine_km(lat, lng, float(plat), float(plng))
        if km > max_port_km:
            continue
        if best_km is None or km < best_km:
            best_km = km
            code = str(port.get("locode") or "").upper()
            best = get_directory_by_locode(code) if code else None
    return best, best_km


def _tenants_for_terminal(
    entity: dict[str, Any],
    directory: Optional[dict[str, Any]],
) -> list[dict[str, Any]]:
    terminal_id = str(entity.get("id") or "").strip()
    hub_match: list[dict[str, Any]] = []
    port_tenants: list[dict[str, Any]] = []

    if directory:
        for tenant in directory.get("tenants") or []:
            if not isinstance(tenant, dict) or not tenant.get("name"):
                continue
            ext = str(tenant.get("curated_storage_external_id") or "").strip()
            if terminal_id and ext and ext == terminal_id:
                hub_match.append(
                    {
                        "name": tenant.get("name"),
                        "role": "port_listed_tenant",
                        "category": tenant.get("category"),
                        "category_label": tenant.get("category_label"),
                        "source": "port_authority_curated",
                        "source_label": "Port authority (linked hub)",
                        "distance_km": 0.0,
                        "storage_operator": tenant.get("storage_operator"),
                        "capacity_text": tenant.get("capacity_text"),
                    }
                )
            cat = str(tenant.get("category") or "")
            if cat in TANK_TENANT_CATEGORIES:
                port_tenants.append(tenant)

    # Prefer tank-storage categories; cap list size
    leads: list[dict[str, Any]] = list(hub_match)
    seen = {str(l.get("name") or "").lower() for l in leads}
    for tenant in port_tenants:
        name = str(tenant.get("name") or "").strip()
        if not name or name.lower() in seen:
            continue
        seen.add(name.lower())
        leads.append(
            {
                "name": name,
                "role": "port_tenant",
                "category": tenant.get("category"),
                "category_label": tenant.get("category_label")
                or CATEGORY_LABELS.get(str(tenant.get("category") or ""), ""),
                "source": "port_authority_curated",
                "source_label": "Port authority directory",
                "distance_km": None,
                "storage_operator": tenant.get("storage_operator"),
                "capacity_text": tenant.get("capacity_text"),
            }
        )
        if len(leads) >= 14:
            break
    return leads


def _summarize_gem_tags(tags: dict[str, Any], *, kind: str) -> dict[str, Any]:
    return {
        "kind": kind,
        "name": tags.get("name") or tags.get("plant_name") or tags.get("project_id"),
        "status": tags.get("status"),
        "fuel": tags.get("fuel") or tags.get("fuel_group"),
        "capacity_text": tags.get("capacity_text"),
        "operator": tags.get("operator") or tags.get("Operator(s)"),
        "owner": tags.get("owner") or tags.get("Owner(s)"),
        "parent": tags.get("Parent(s)"),
        "primary_counterparty": tags.get("primary_counterparty"),
        "captive_industry_type": tags.get("captive_industry_type"),
        "wiki_url": tags.get("wiki_url"),
        "source_id": tags.get("source_id"),
    }


def _nearby_gem_plants(conn: Any, lat: float, lng: float, *, radius_km: float, limit: int) -> list[dict[str, Any]]:
    try:
        from backend.services.gem_plant_units import ensure_gem_plant_tables
    except ImportError:
        from services.gem_plant_units import ensure_gem_plant_tables  # type: ignore

    ensure_gem_plant_tables(conn)
    radius_m = radius_km * 1000.0
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT unit_key, tags,
                   ST_Distance(
                       geom::geography,
                       ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography
                   ) AS dist_m
            FROM gem_plant_units
            WHERE ST_DWithin(
                geom::geography,
                ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography,
                %s
            )
            ORDER BY dist_m
            LIMIT %s;
            """,
            (lng, lat, lng, lat, radius_m, limit),
        )
        rows = cur.fetchall()

    out: list[dict[str, Any]] = []
    for unit_key, tags_raw, dist_m in rows:
        tags = tags_raw if isinstance(tags_raw, dict) else json.loads(tags_raw or "{}")
        summary = _summarize_gem_tags(tags, kind="gem_plant")
        summary["id"] = unit_key
        summary["distance_km"] = round(float(dist_m or 0) / 1000.0, 2)
        summary["source_label"] = "GEM GOGPT"
        out.append(summary)
    return out


def _nearby_gem_lng_terminals(
    conn: Any, lat: float, lng: float, *, radius_km: float, limit: int
) -> list[dict[str, Any]]:
    try:
        from backend.services.gem_lng_terminals import ensure_gem_lng_tables
    except ImportError:
        from services.gem_lng_terminals import ensure_gem_lng_tables  # type: ignore

    ensure_gem_lng_tables(conn)
    radius_m = radius_km * 1000.0
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT terminal_key, tags,
                   ST_Distance(
                       geom::geography,
                       ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography
                   ) AS dist_m
            FROM gem_lng_terminals
            WHERE ST_DWithin(
                geom::geography,
                ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography,
                %s
            )
            ORDER BY dist_m
            LIMIT %s;
            """,
            (lng, lat, lng, lat, radius_m, limit),
        )
        rows = cur.fetchall()

    out: list[dict[str, Any]] = []
    for terminal_key, tags_raw, dist_m in rows:
        tags = tags_raw if isinstance(tags_raw, dict) else json.loads(tags_raw or "{}")
        summary = _summarize_gem_tags(tags, kind="gem_lng")
        summary["id"] = terminal_key
        summary["distance_km"] = round(float(dist_m or 0) / 1000.0, 2)
        summary["source_label"] = "GEM GGIT LNG"
        summary["terminal_type"] = tags.get("terminal_type")
        out.append(summary)
    return out


def _nearby_gem_pipelines(
    conn: Any, lat: float, lng: float, *, radius_km: float, limit: int
) -> list[dict[str, Any]]:
    try:
        from backend.services.gem_pipeline_segments import ensure_gem_pipeline_tables
    except ImportError:
        from services.gem_pipeline_segments import ensure_gem_pipeline_tables  # type: ignore

    ensure_gem_pipeline_tables(conn)
    radius_m = radius_km * 1000.0
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT segment_key, tags,
                   ST_Distance(
                       geom::geography,
                       ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography
                   ) AS dist_m
            FROM gem_pipeline_segments
            WHERE ST_DWithin(
                geom::geography,
                ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography,
                %s
            )
            ORDER BY dist_m
            LIMIT %s;
            """,
            (lng, lat, lng, lat, radius_m, limit),
        )
        rows = cur.fetchall()

    out: list[dict[str, Any]] = []
    for segment_key, tags_raw, dist_m in rows:
        tags = tags_raw if isinstance(tags_raw, dict) else json.loads(tags_raw or "{}")
        summary = _summarize_gem_tags(tags, kind="gem_pipeline")
        summary["id"] = segment_key
        summary["distance_km"] = round(float(dist_m or 0) / 1000.0, 2)
        summary["source_label"] = "GEM GOIT"
        out.append(summary)
    return out


def _nearby_extraction_fields(
    conn: Any, lat: float, lng: float, *, radius_km: float, limit: int
) -> list[dict[str, Any]]:
    # Bbox prefilter then haversine (licenses use lat/lng columns, not PostGIS geom).
    delta = radius_km / 111.0
    south, north = lat - delta, lat + delta
    west, east = lng - delta, lng + delta
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, company, country, region, status, lat, lng, source_id
            FROM licenses
            WHERE sector = 'oil_and_gas'
              AND lat IS NOT NULL AND lng IS NOT NULL
              AND lat BETWEEN %s AND %s
              AND lng BETWEEN %s AND %s
            LIMIT 80;
            """,
            (south, north, west, east),
        )
        rows = cur.fetchall()

    candidates: list[tuple[float, dict[str, Any]]] = []
    for row in rows:
        rid, company, country, region, status, rlat, rlng, source_id = row
        if rlat is None or rlng is None:
            continue
        km = _haversine_km(lat, lng, float(rlat), float(rlng))
        if km > radius_km:
            continue
        candidates.append(
            (
                km,
                {
                    "kind": "extraction_field",
                    "id": rid,
                    "name": company,
                    "country": country,
                    "region": region,
                    "status": status,
                    "distance_km": round(km, 2),
                    "source_id": source_id,
                    "source_label": "GEM extraction"
                    if str(source_id or "").startswith("gem_")
                    else "Open data field",
                },
            )
        )
    candidates.sort(key=lambda item: item[0])
    return [item[1] for item in candidates[:limit]]


def build_storage_terminal_commercial_intel(
    conn: Any,
    entity: dict[str, Any],
) -> dict[str, Any]:
    lat, lng = _entity_lat_lng(entity)
    directory, port_km = _resolve_port_directory(entity)
    port_tenants = _tenants_for_terminal(entity, directory)

    limitations = [
        "Counterparty leads from public/open data — not verified tank lessors or berth contracts.",
        PORT_DISCLAIMER,
    ]

    intel: dict[str, Any] = {
        "portDirectory": None,
        "portMatchDistanceKm": port_km,
        "portTenants": port_tenants,
        "nearbyGemPlants": [],
        "nearbyGemLngTerminals": [],
        "nearbyGemPipelines": [],
        "nearbyExtractionFields": [],
        "limitations": limitations,
    }

    if directory:
        intel["portDirectory"] = {
            "locode": directory.get("locode"),
            "portName": directory.get("port_name"),
            "portAuthorityName": directory.get("port_authority_name"),
            "country": directory.get("country"),
            "sourceUrl": directory.get("source_url"),
            "tenantCount": (directory.get("stats") or {}).get("total_tenants"),
        }

    if lat is None or lng is None:
        limitations.append("No coordinates — nearby GEM spatial match skipped.")
        return intel

    try:
        intel["nearbyGemPlants"] = _nearby_gem_plants(
            conn, lat, lng, radius_km=DEFAULT_GEM_PLANT_KM, limit=6
        )
    except Exception:
        pass
    try:
        intel["nearbyGemPipelines"] = _nearby_gem_pipelines(
            conn, lat, lng, radius_km=DEFAULT_GEM_PIPELINE_KM, limit=4
        )
    except Exception:
        pass
    try:
        intel["nearbyGemLngTerminals"] = _nearby_gem_lng_terminals(
            conn, lat, lng, radius_km=DEFAULT_GEM_LNG_KM, limit=4
        )
    except Exception:
        pass
    try:
        intel["nearbyExtractionFields"] = _nearby_extraction_fields(
            conn, lat, lng, radius_km=DEFAULT_EXTRACTION_KM, limit=5
        )
    except Exception:
        pass

    return intel


def attach_storage_terminal_commercial_intel(
    conn: Any,
    entity: dict[str, Any],
) -> dict[str, Any]:
    merged = dict(entity)
    merged["commercialIntel"] = build_storage_terminal_commercial_intel(conn, entity)
    return merged
