from __future__ import annotations

import json
import math
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlencode
from urllib.request import Request, urlopen

try:
    from backend.country_borders import COUNTRY_BORDERS_PATH
except ImportError:
    from country_borders import COUNTRY_BORDERS_PATH

try:
    from backend.services.maritime_intel import find_nearest_ports
except ImportError:
    from services.maritime_intel import find_nearest_ports


STORAGE_TERMINALS_LAYER_ID = "storage_terminals"
OVERPASS_TIMEOUT_SECONDS = int(os.getenv("STORAGE_OVERPASS_TIMEOUT_SECONDS", "90"))
STORAGE_CACHE_TTL_SECONDS = 60 * 60 * 12
MAX_NEARBY_PORT_DISTANCE_KM = 250.0
MAX_TILE_WORKERS = 5

WORLD_TILES: tuple[tuple[str, tuple[float, float, float, float]], ...] = (
    ("north_america_west", (7.0, -170.0, 72.0, -95.0)),
    ("north_america_east", (7.0, -95.0, 72.0, -50.0)),
    ("south_america", (-56.0, -82.0, 13.0, -34.0)),
    ("europe", (34.0, -12.0, 72.0, 40.0)),
    ("mena", (12.0, -18.0, 38.0, 64.0)),
    ("sub_saharan_africa", (-35.0, -20.0, 18.0, 55.0)),
    ("russia_central_asia", (36.0, 40.0, 78.0, 110.0)),
    ("south_asia", (5.0, 64.0, 36.0, 92.0)),
    ("east_asia", (18.0, 92.0, 55.0, 150.0)),
    ("southeast_asia", (-12.0, 92.0, 24.0, 141.0)),
    ("oceania", (-50.0, 110.0, 5.0, 180.0)),
)

KEYWORD_RE = re.compile(r"(terminal|tank\s*farm|tankfarm|depot|storage)", re.I)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clean_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return " ".join(value.split()).strip()
    return str(value).strip()


def _normalize_token(value: Any) -> str:
    text = _clean_text(value).lower()
    if not text:
        return ""
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return " ".join(text.split())


def _safe_float(value: Any) -> Optional[float]:
    try:
        if value in (None, "", "null"):
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _parse_capacity_text(tags: dict[str, Any]) -> Optional[str]:
    for key in (
        "capacity",
        "capacity:oil",
        "capacity:gas",
        "capacity:petroleum",
        "capacity:lng",
        "storage_capacity",
        "storage_capacity:oil",
        "storage_capacity:gas",
    ):
        value = _clean_text(tags.get(key))
        if value:
            return value
    return None


def _commodity_hints_from_tags(tags: dict[str, Any]) -> list[str]:
    candidates = " | ".join(
        _clean_text(tags.get(key))
        for key in (
            "product",
            "products",
            "substance",
            "content",
            "industrial",
            "name",
            "description",
        )
    ).lower()
    hints: list[str] = []
    for label, patterns in (
        ("lng", ("lng", "liquefied natural gas")),
        ("lpg", ("lpg", "liquefied petroleum gas", "propane", "butane")),
        ("gas", ("natural gas", "gas")),
        ("crude_oil", ("crude", "crude oil")),
        ("refined_products", ("diesel", "gasoline", "petrol", "jet", "fuel oil", "refined")),
        ("petroleum", ("petroleum", "oil")),
        ("chemicals", ("chemical", "petrochemical")),
    ):
        if any(pattern in candidates for pattern in patterns):
            hints.append(label)
    if not hints:
        industrial = _clean_text(tags.get("industrial")).lower()
        if industrial == "gas":
            hints.append("gas")
        elif industrial in {"oil", "petroleum_terminal", "tank_farm"}:
            hints.append("petroleum")
    return hints


def infer_terminal_subtype(tags: dict[str, Any]) -> tuple[str, float, str]:
    industrial = _normalize_token(tags.get("industrial"))
    name = _clean_text(tags.get("name"))
    operator = _clean_text(tags.get("operator"))
    description = _clean_text(tags.get("description"))
    haystack = " ".join(part for part in (name, operator, description) if part).lower()

    if industrial == "petroleum terminal":
        return (
            "storage_terminal",
            0.94,
            "Explicit OSM facility tag industrial=petroleum_terminal.",
        )
    if industrial == "tank farm":
        return (
            "tank_farm",
            0.9,
            "Explicit OSM facility tag industrial=tank_farm.",
        )
    if "tank farm" in haystack or "tankfarm" in haystack:
        return (
            "tank_farm",
            0.78,
            "Facility name/description suggests a tank farm, but the terminal tag is not explicit.",
        )
    if industrial in {"oil", "gas"} and KEYWORD_RE.search(haystack):
        return (
            "storage_terminal",
            0.68,
            "Oil/gas industrial site with storage-terminal keywords in the mapped name/description.",
        )
    return (
        "",
        0.0,
        "",
    )


def _format_license_type(subtype: str) -> str:
    if subtype == "tank_farm":
        return "Tank Farm"
    return "Storage Terminal"


def _display_name(tags: dict[str, Any], subtype: str) -> Optional[str]:
    name = _clean_text(tags.get("name"))
    if name:
        return name
    operator = _clean_text(tags.get("operator"))
    if operator:
        suffix = "Tank Farm" if subtype == "tank_farm" else "Storage Terminal"
        return f"{operator} {suffix}"
    return None


def _region_from_tags(tags: dict[str, Any]) -> str:
    parts: list[str] = []
    for key in ("addr:city", "addr:state", "is_in:state", "state", "province", "addr:province"):
        value = _clean_text(tags.get(key))
        if value and value.lower() not in {part.lower() for part in parts}:
            parts.append(value)
    return " | ".join(parts)


def _build_osm_object_url(element_type: str, osm_id: int) -> str:
    return f"https://www.openstreetmap.org/{element_type}/{osm_id}"


@dataclass(frozen=True)
class CountryFeature:
    name: str
    iso2: str
    bbox: tuple[float, float, float, float]
    polygons: list[list[list[tuple[float, float]]]]


_country_feature_cache: list[CountryFeature] | None = None
_storage_cache: dict[str, Any] = {"loaded_at": 0.0, "response": None}


def _ring_bbox(ring: list[tuple[float, float]]) -> tuple[float, float, float, float]:
    xs = [point[0] for point in ring]
    ys = [point[1] for point in ring]
    return min(xs), min(ys), max(xs), max(ys)


def _polygon_bbox(polygon: list[list[tuple[float, float]]]) -> tuple[float, float, float, float]:
    min_x = math.inf
    min_y = math.inf
    max_x = -math.inf
    max_y = -math.inf
    for ring in polygon:
        if not ring:
            continue
        ring_min_x, ring_min_y, ring_max_x, ring_max_y = _ring_bbox(ring)
        min_x = min(min_x, ring_min_x)
        min_y = min(min_y, ring_min_y)
        max_x = max(max_x, ring_max_x)
        max_y = max(max_y, ring_max_y)
    return min_x, min_y, max_x, max_y


def _point_in_ring(lng: float, lat: float, ring: list[tuple[float, float]]) -> bool:
    inside = False
    if len(ring) < 3:
        return False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        intersects = ((yi > lat) != (yj > lat)) and (
            lng < (xj - xi) * (lat - yi) / ((yj - yi) or 1e-12) + xi
        )
        if intersects:
            inside = not inside
        j = i
    return inside


def _point_in_polygon(lng: float, lat: float, polygon: list[list[tuple[float, float]]]) -> bool:
    if not polygon:
        return False
    outer = polygon[0]
    if not _point_in_ring(lng, lat, outer):
        return False
    for hole in polygon[1:]:
        if _point_in_ring(lng, lat, hole):
            return False
    return True


def _extract_country_name(properties: dict[str, Any]) -> str:
    for key in ("ADMIN", "name", "NAME", "formal_en"):
        value = _clean_text(properties.get(key))
        if value:
            return value
    return "Unknown"


def _extract_country_iso2(properties: dict[str, Any]) -> str:
    for key in ("ISO_A2", "iso_a2", "ISO2", "iso2"):
        value = _clean_text(properties.get(key)).upper()
        if len(value) == 2:
            return value
    return ""


def _parse_geojson_rings(raw_coords: Any) -> list[list[tuple[float, float]]]:
    rings: list[list[tuple[float, float]]] = []
    if not isinstance(raw_coords, list):
        return rings
    for ring in raw_coords:
        if not isinstance(ring, list):
            continue
        parsed_ring: list[tuple[float, float]] = []
        for coord in ring:
            if (
                isinstance(coord, list)
                and len(coord) >= 2
                and isinstance(coord[0], (int, float))
                and isinstance(coord[1], (int, float))
            ):
                parsed_ring.append((float(coord[0]), float(coord[1])))
        if parsed_ring:
            rings.append(parsed_ring)
    return rings


def _load_country_features() -> list[CountryFeature]:
    global _country_feature_cache
    if _country_feature_cache is not None:
        return _country_feature_cache

    payload = json.loads(Path(COUNTRY_BORDERS_PATH).read_text(encoding="utf-8"))
    features: list[CountryFeature] = []
    for feature in payload.get("features", []):
        geometry = feature.get("geometry") or {}
        properties = feature.get("properties") or {}
        geometry_type = geometry.get("type")
        polygons: list[list[list[tuple[float, float]]]] = []

        if geometry_type == "Polygon":
            polygon = _parse_geojson_rings(geometry.get("coordinates"))
            if polygon:
                polygons.append(polygon)
        elif geometry_type == "MultiPolygon":
            for raw_polygon in geometry.get("coordinates") or []:
                polygon = _parse_geojson_rings(raw_polygon)
                if polygon:
                    polygons.append(polygon)

        if not polygons:
            continue

        min_x = math.inf
        min_y = math.inf
        max_x = -math.inf
        max_y = -math.inf
        for polygon in polygons:
            poly_min_x, poly_min_y, poly_max_x, poly_max_y = _polygon_bbox(polygon)
            min_x = min(min_x, poly_min_x)
            min_y = min(min_y, poly_min_y)
            max_x = max(max_x, poly_max_x)
            max_y = max(max_y, poly_max_y)

        features.append(
            CountryFeature(
                name=_extract_country_name(properties),
                iso2=_extract_country_iso2(properties),
                bbox=(min_x, min_y, max_x, max_y),
                polygons=polygons,
            )
        )

    _country_feature_cache = features
    return features


def resolve_country(lat: float, lng: float) -> tuple[str, str]:
    for feature in _load_country_features():
        min_x, min_y, max_x, max_y = feature.bbox
        if lng < min_x or lng > max_x or lat < min_y or lat > max_y:
            continue
        for polygon in feature.polygons:
            if _point_in_polygon(lng, lat, polygon):
                return feature.name, feature.iso2
    return "Unknown", ""


def _overpass_urls() -> tuple[str, ...]:
    candidates = [
        os.getenv("STORAGE_OVERPASS_URL", "").strip(),
        os.getenv("OVERPASS_URL", "").strip(),
        "https://overpass.kumi.systems/api/interpreter",
    ]
    if os.getenv("OVERPASS_INCLUDE_DE_FALLBACK", "").strip().lower() in {"1", "true", "yes"}:
        candidates.append("https://overpass-api.de/api/interpreter")
    return tuple(dict.fromkeys(url for url in candidates if url))


def _db_connect():
    import psycopg2

    database_url = os.getenv("DATABASE_URL", "").strip()
    if database_url:
        return psycopg2.connect(database_url, connect_timeout=5)
    return psycopg2.connect(
        host=os.getenv("DB_HOST", "localhost"),
        port=int(os.getenv("DB_PORT", "5432")),
        database=os.getenv("DB_NAME", "mining_db"),
        user=os.getenv("DB_USER", "postgres"),
        password=os.getenv("DB_PASSWORD", "password"),
        connect_timeout=5,
    )


def build_overpass_query(bbox: tuple[float, float, float, float]) -> str:
    south, west, north, east = bbox
    bbox_text = f"{south},{west},{north},{east}"
    return f"""
[out:json][timeout:45];
(
  nwr["industrial"="petroleum_terminal"]({bbox_text});
  nwr["industrial"="tank_farm"]({bbox_text});
  nwr["industrial"~"^(oil|gas)$"]["name"~"(terminal|tank\\s*farm|tankfarm|depot|storage)",i]({bbox_text});
);
out center tags qt;
""".strip()


def fetch_overpass_elements(bbox: tuple[float, float, float, float]) -> list[dict[str, Any]]:
    body = urlencode({"data": build_overpass_query(bbox)}).encode("utf-8")
    headers = {
        "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
        "User-Agent": "mining-map-storage-terminals/1.0",
    }
    errors: list[str] = []
    for overpass_url in _overpass_urls():
        req = Request(overpass_url, data=body, headers=headers)
        try:
            with urlopen(req, timeout=OVERPASS_TIMEOUT_SECONDS) as response:
                payload = json.load(response)
            return payload.get("elements", []) if isinstance(payload, dict) else []
        except Exception as exc:
            errors.append(f"{overpass_url}: {exc}")
    if errors:
        raise RuntimeError("; ".join(errors))
    return []


def _element_from_db_row(
    osm_type: str,
    osm_id: int,
    tags: dict[str, Any],
    geom_json: dict[str, Any],
) -> Optional[dict[str, Any]]:
    geom_type = geom_json.get("type")
    coords = geom_json.get("coordinates")
    lat = lng = None
    if geom_type == "Point" and isinstance(coords, list) and len(coords) >= 2:
        lng, lat = float(coords[0]), float(coords[1])
    if lat is None or lng is None:
        return None
    return {
        "type": osm_type,
        "id": osm_id,
        "tags": tags,
        "lat": lat,
        "lon": lng,
    }


def _load_storage_terminals_from_db() -> tuple[list[dict[str, Any]], Optional[str]]:
    try:
        from backend.services.petroleum_osm_store import ensure_petroleum_osm_tables, layer_feature_stats
    except ImportError:
        from services.petroleum_osm_store import ensure_petroleum_osm_tables, layer_feature_stats

    conn = _db_connect()
    try:
        ensure_petroleum_osm_tables(conn)
        stats = layer_feature_stats(conn, STORAGE_TERMINALS_LAYER_ID)
        if int(stats.get("feature_count") or 0) <= 0:
            return [], None
        fetched_at = stats.get("last_fetched_at")
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT osm_type, osm_id, tags, ST_AsGeoJSON(geom)::json
                FROM petroleum_osm_features
                WHERE layer_id = %s
                ORDER BY osm_id;
                """,
                (STORAGE_TERMINALS_LAYER_ID,),
            )
            rows = cur.fetchall()
        elements: list[dict[str, Any]] = []
        for osm_type, osm_id, tags_raw, geom_json in rows:
            tags = tags_raw if isinstance(tags_raw, dict) else {}
            if isinstance(tags_raw, str):
                try:
                    tags = json.loads(tags_raw)
                except json.JSONDecodeError:
                    tags = {}
            geom = geom_json if isinstance(geom_json, dict) else json.loads(geom_json or "{}")
            element = _element_from_db_row(str(osm_type), int(osm_id), tags, geom)
            if element:
                elements.append(element)
        return elements, fetched_at if isinstance(fetched_at, str) else None
    finally:
        conn.close()


def _should_cache_storage_response(entities: list[dict[str, Any]], warnings: list[str]) -> bool:
    if entities:
        return True
    if warnings and len(warnings) >= len(WORLD_TILES):
        return False
    return True


def normalize_storage_terminal(element: dict[str, Any], fetched_at: str) -> Optional[dict[str, Any]]:
    tags = element.get("tags") or {}
    subtype, confidence, confidence_note = infer_terminal_subtype(tags)
    if not subtype:
        return None

    lat = _safe_float(element.get("lat"))
    lng = _safe_float(element.get("lon"))
    if lat is None or lng is None:
        center = element.get("center") or {}
        lat = _safe_float(center.get("lat"))
        lng = _safe_float(center.get("lon"))
    if lat is None or lng is None:
        return None

    display_name = _display_name(tags, subtype)
    capacity_text = _parse_capacity_text(tags)
    operator = _clean_text(tags.get("operator")) or None
    commodity_hints = _commodity_hints_from_tags(tags)

    if not display_name and not operator and not capacity_text:
        return None

    country, country_iso2 = resolve_country(lat, lng)
    region = _region_from_tags(tags)

    nearest_port = None
    nearest_ports = (
        find_nearest_ports(country_iso2=country_iso2, lat=lat, lng=lng, limit=1)
        if country_iso2
        else []
    )
    if nearest_ports:
        port = dict(nearest_ports[0])
        if port.get("distance_km") is not None and float(port["distance_km"]) <= MAX_NEARBY_PORT_DISTANCE_KM:
            nearest_port = port

    if subtype == "storage_terminal" and nearest_port:
        confidence = min(0.98, confidence + 0.03)
    if capacity_text:
        confidence = min(0.98, confidence + 0.01)
    if operator:
        confidence = min(0.98, confidence + 0.01)

    facility_name = display_name or "Unnamed Storage Terminal"
    evidence = [
        {
            "id": f"osm:{element.get('type')}:{element.get('id')}:facility",
            "title": f"OSM mapped as {tags.get('industrial') or subtype}",
            "url": _build_osm_object_url(str(element.get("type")), int(element.get("id"))),
            "source_label": "OpenStreetMap",
            "evidence_type": "osm_tag",
            "confidence": round(confidence, 2),
            "summary": confidence_note,
        }
    ]
    if nearest_port:
        evidence.append(
            {
                "id": f"osm:{element.get('type')}:{element.get('id')}:port",
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
        "id": f"osm:{element.get('type')}:{element.get('id')}",
        "company": facility_name,
        "licenseType": _format_license_type(subtype),
        "commodity": ", ".join(commodity_hints) if commodity_hints else "petroleum",
        "status": "Mapped open infrastructure",
        "date": None,
        "country": country,
        "region": region or country,
        "sector": "oil_and_gas",
        "lat": lat,
        "lng": lng,
        "recordOrigin": "open_data",
        "sourceId": "osm_overpass_storage_terminals",
        "sourceName": "OpenStreetMap via Overpass",
        "sourceUrl": _overpass_urls()[0] if _overpass_urls() else "",
        "sourceRecordUrl": _build_osm_object_url(str(element.get("type")), int(element.get("id"))),
        "sourceUpdatedAt": fetched_at,
        "lastSyncedAt": fetched_at,
        "entityKind": "storage_terminal",
        "entitySubtype": subtype,
        "operatorName": operator,
        "commodityHints": commodity_hints,
        "capacityText": capacity_text,
        "confidenceScore": round(confidence, 2),
        "confidenceNote": confidence_note,
        "sourceLabels": ["OpenStreetMap", "Overpass", "UN/LOCODE"],
        "nearbyPort": nearest_port,
        "evidenceCount": len(evidence),
        "evidence": evidence,
        "rawPayload": {
            "osm_type": element.get("type"),
            "osm_id": element.get("id"),
            "tags": tags,
        },
    }


def _dedupe_entities(entities: list[dict[str, Any]]) -> list[dict[str, Any]]:
    deduped: dict[str, dict[str, Any]] = {}
    for entity in entities:
        existing = deduped.get(entity["id"])
        if existing is None or float(entity.get("confidenceScore") or 0.0) > float(existing.get("confidenceScore") or 0.0):
            deduped[entity["id"]] = entity
    return list(deduped.values())


def _summary_entity(entity: dict[str, Any]) -> dict[str, Any]:
    summary = dict(entity)
    summary.pop("evidence", None)
    summary.pop("rawPayload", None)
    return summary


def _build_stats(entities: list[dict[str, Any]]) -> dict[str, Any]:
    countries = {entity["country"] for entity in entities if _clean_text(entity.get("country")) and entity["country"] != "Unknown"}
    by_subtype: dict[str, int] = {}
    by_country: dict[str, int] = {}
    high_confidence = 0
    with_operator = 0
    with_capacity = 0
    with_nearby_port = 0
    for entity in entities:
        subtype = entity.get("entitySubtype") or "unknown"
        by_subtype[subtype] = by_subtype.get(subtype, 0) + 1
        country = entity.get("country") or "Unknown"
        by_country[country] = by_country.get(country, 0) + 1
        if float(entity.get("confidenceScore") or 0.0) >= 0.8:
            high_confidence += 1
        if entity.get("operatorName"):
            with_operator += 1
        if entity.get("capacityText"):
            with_capacity += 1
        if entity.get("nearbyPort"):
            with_nearby_port += 1

    top_countries = [
        {"country": country, "count": count}
        for country, count in sorted(by_country.items(), key=lambda item: (-item[1], item[0]))[:10]
    ]
    return {
        "total": len(entities),
        "countries": len(countries),
        "with_operator": with_operator,
        "with_capacity": with_capacity,
        "with_nearby_port": with_nearby_port,
        "high_confidence": high_confidence,
        "by_subtype": by_subtype,
        "top_countries": top_countries,
    }


def _fresh_cache() -> Optional[dict[str, Any]]:
    age = time.time() - float(_storage_cache.get("loaded_at") or 0.0)
    if _storage_cache.get("response") and age < STORAGE_CACHE_TTL_SECONDS:
        return dict(_storage_cache["response"])
    return None


def get_storage_terminals(force_refresh: bool = False) -> dict[str, Any]:
    if force_refresh:
        _storage_cache["loaded_at"] = 0.0
        _storage_cache["response"] = None
    else:
        cached = _fresh_cache()
        if cached is not None:
            return {
                **cached,
                "entities": [_summary_entity(entity) for entity in cached.get("entities", [])],
                "cached": True,
            }

    fetched_at = _now_iso()
    warnings: list[str] = []
    all_entities: list[dict[str, Any]] = []
    data_source = "overpass"

    if not force_refresh:
        db_elements, db_fetched_at = _load_storage_terminals_from_db()
        if db_elements:
            data_source = "database"
            fetched_at = db_fetched_at or fetched_at
            for element in db_elements:
                normalized = normalize_storage_terminal(element, fetched_at)
                if normalized:
                    normalized["sourceId"] = "osm_petroleum_db_storage_terminals"
                    normalized["sourceName"] = "OpenStreetMap (persisted snapshot)"
                    all_entities.append(normalized)

    if not all_entities:
        with ThreadPoolExecutor(max_workers=min(MAX_TILE_WORKERS, len(WORLD_TILES))) as executor:
            futures = {
                executor.submit(fetch_overpass_elements, bbox): tile_name
                for tile_name, bbox in WORLD_TILES
            }
            for future in as_completed(futures):
                tile_name = futures[future]
                try:
                    elements = future.result()
                    for element in elements:
                        normalized = normalize_storage_terminal(element, fetched_at)
                        if normalized:
                            all_entities.append(normalized)
                except Exception as exc:
                    warnings.append(f"{tile_name}: {exc}")

    entities = _dedupe_entities(all_entities)
    entities.sort(
        key=lambda item: (
            -(float(item.get("confidenceScore") or 0.0)),
            _clean_text(item.get("country")),
            _clean_text(item.get("company")),
        )
    )

    response = {
        "entities": entities,
        "source_labels": ["OpenStreetMap", "Overpass", "UN/LOCODE"],
        "data_source": data_source,
        "data_as_of": fetched_at,
        "coverage_note": (
            "Global coverage is live from OpenStreetMap/Overpass, but only where mappers explicitly tag petroleum terminals, tank farms, "
            "or clearly named oil/gas storage facilities. This is useful open infrastructure context, not an official global storage registry."
        ),
        "limitations": [
            "Primary global source is OpenStreetMap via Overpass; coverage varies by country and mapper activity.",
            "Individual man_made=storage_tank objects are intentionally not treated as standalone terminals unless the site itself is mapped as a facility.",
            "Nearby port context comes from UN/LOCODE and is heuristic logistics context, not proof of ownership, throughput, or berth access.",
            "Capacity appears only when the open tags publish a storage value; no global open source provides consistent audited tank capacity coverage here.",
        ]
        + warnings,
        "stats": _build_stats(entities),
    }

    if _should_cache_storage_response(entities, warnings):
        _storage_cache["loaded_at"] = time.time()
        _storage_cache["response"] = response
    return {
        **response,
        "entities": [_summary_entity(entity) for entity in entities],
    }


def get_storage_terminal_details(terminal_id: str) -> Optional[dict[str, Any]]:
    cached = _fresh_cache()
    if cached is None:
        get_storage_terminals(force_refresh=False)
        cached = _fresh_cache()
    if cached is None:
        return None
    for entity in cached.get("entities", []):
        if entity.get("id") == terminal_id:
            return entity
    return None
