from __future__ import annotations

import json
import math
import os
import re
import time
from functools import lru_cache
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlencode
from urllib.request import Request, urlopen

try:
    from backend.country_borders import get_country_borders_geojson
except ImportError:
    from country_borders import get_country_borders_geojson

try:
    from backend.services.maritime_intel import find_nearest_ports
except ImportError:
    from services.maritime_intel import find_nearest_ports


STORAGE_TERMINALS_LAYER_ID = "storage_terminals"
OVERPASS_TIMEOUT_SECONDS = int(os.getenv("STORAGE_OVERPASS_TIMEOUT_SECONDS", "120"))
OVERPASS_QUERY_TIMEOUT_SECONDS = int(os.getenv("STORAGE_OVERPASS_QUERY_TIMEOUT_SECONDS", "90"))
OVERPASS_RETRY_ATTEMPTS = int(os.getenv("STORAGE_OVERPASS_RETRY_ATTEMPTS", "3"))
OVERPASS_RETRY_DELAY_SECONDS = float(os.getenv("STORAGE_OVERPASS_RETRY_DELAY_SECONDS", "4"))
STORAGE_SKIP_LIVE_OVERPASS = (os.getenv("STORAGE_SKIP_LIVE_OVERPASS") or "").strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
}
STORAGE_CACHE_TTL_SECONDS = 60 * 60 * 12
STORAGE_REFERENCE_ENRICH_MAX = int(os.getenv("STORAGE_REFERENCE_ENRICH_MAX", "2500"))
MAX_NEARBY_PORT_DISTANCE_KM = 250.0
SITE_CONTEXT_MAX_DISTANCE_KM = 2.0
SITE_POLYGON_BUFFER_DEG = 0.0015
MAX_TILE_WORKERS = int(os.getenv("STORAGE_OVERPASS_TILE_WORKERS", "3"))
BULK_SEED_PATH = Path(__file__).resolve().parents[1] / "data" / "oil_terminals_seed_bulk.json"
DEFAULT_OVERPASS_URLS: tuple[str, ...] = (
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass-api.de/api/interpreter",
)

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
PETROLEUM_SUBSTANCE_RE = re.compile(
    r"(oil|petroleum|diesel|gasoline|petrol|fuel|crude|lng|lpg|jet|kerosene|naphtha|refined)",
    re.I,
)
NON_PETROLEUM_TANK_RE = re.compile(
    r"(cooling|chiller|hvac|generator|sewage|wastewater|potable|fire\s*suppression|"
    r"data\s*center|server\s*room|air\s*conditioning|district\s*heating|solar|"
    r"rainwater|stormwater|water\s*tank|heat\s*pump)",
    re.I,
)
WEAK_SUBSTANCE_ONLY_VALUES = frozenset({"fuel", "gas", "oil", "water"})
MIN_DB_COUNTRIES_FOR_GLOBAL_SNAPSHOT = 4
MIN_DB_FEATURES_FOR_GLOBAL_SNAPSHOT = 10
# Normalized map entities below this with a large persisted DB → offline bulk seed.
MIN_NORMALIZED_ENTITIES_FOR_GLOBAL_LAYER = int(
    os.getenv("STORAGE_MIN_NORMALIZED_ENTITIES", "500")
)


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


def _petroleum_tag_haystack(tags: dict[str, Any]) -> str:
    return " | ".join(
        _clean_text(tags.get(key))
        for key in (
            "substance",
            "content",
            "product",
            "products",
            "storage_tank",
            "industrial",
            "description",
        )
    ).lower()


def _has_petroleum_substance(tags: dict[str, Any]) -> bool:
    return bool(PETROLEUM_SUBSTANCE_RE.search(_petroleum_tag_haystack(tags)))


def _is_excluded_non_petroleum_tank(tags: dict[str, Any]) -> bool:
    haystack = f"{_petroleum_tag_haystack(tags)} | {_identity_tag_haystack(tags)}"
    return bool(NON_PETROLEUM_TANK_RE.search(haystack))


def _has_storage_tank_identity(tags: dict[str, Any]) -> bool:
    if _clean_text(tags.get("name")) or _clean_text(tags.get("name:en")):
        return True
    if _clean_text(tags.get("operator")) or _clean_text(tags.get("owner")):
        return True
    industrial = _normalize_token(tags.get("industrial"))
    return industrial in {"oil", "gas", "petroleum terminal", "tank farm", "fuel", "refinery"}


def _is_weak_substance_only_storage_tank(tags: dict[str, Any]) -> bool:
    """Reject lone man_made=storage_tank rows tagged only with generic fuel/oil/gas substance."""
    if _has_storage_tank_identity(tags):
        return False
    for key in ("substance", "content", "product", "products"):
        value = _clean_text(tags.get(key)).lower()
        if not value:
            continue
        if value in WEAK_SUBSTANCE_ONLY_VALUES:
            return True
        if PETROLEUM_SUBSTANCE_RE.search(value) and len(value.split()) <= 2:
            return True
    return False


def _identity_tag_haystack(tags: dict[str, Any]) -> str:
    return " ".join(
        _clean_text(tags.get(key))
        for key in ("name", "name:en", "operator", "owner", "brand", "description")
    ).lower()


def _has_petroleum_identity(tags: dict[str, Any]) -> bool:
    haystack = _identity_tag_haystack(tags)
    if PETROLEUM_SUBSTANCE_RE.search(haystack):
        return True
    if KEYWORD_RE.search(haystack):
        return True
    industrial = _normalize_token(tags.get("industrial"))
    return industrial in {"oil", "gas", "refinery", "petroleum terminal", "tank farm", "fuel"}


def _extract_operator_owner(tags: dict[str, Any]) -> tuple[Optional[str], Optional[str]]:
    operator = _clean_text(tags.get("operator")) or None
    owner = _clean_text(tags.get("owner")) or None
    return operator, owner


def _substance_from_tags(tags: dict[str, Any]) -> Optional[str]:
    for key in ("substance", "content", "product", "products"):
        value = _clean_text(tags.get(key))
        if value:
            return value
    return None


def infer_terminal_subtype(tags: dict[str, Any]) -> tuple[str, float, str]:
    industrial = _normalize_token(tags.get("industrial"))
    man_made = _normalize_token(tags.get("man_made"))
    name = _clean_text(tags.get("name"))
    operator = _clean_text(tags.get("operator"))
    owner = _clean_text(tags.get("owner"))
    description = _clean_text(tags.get("description"))
    haystack = " ".join(part for part in (name, operator, owner, description) if part).lower()

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
    if industrial == "fuel":
        return (
            "fuel_depot",
            0.82,
            "Explicit OSM fuel depot (industrial=fuel).",
        )
    if man_made == "storage tank":
        if _is_excluded_non_petroleum_tank(tags):
            return ("", 0.0, "")
        if _is_weak_substance_only_storage_tank(tags):
            return ("", 0.0, "")
        if _has_petroleum_substance(tags):
            if operator or owner or name:
                return (
                    "storage_tank",
                    0.72,
                    "Mapped petroleum storage tank with operator, owner, or site name context.",
                )
            return ("", 0.0, "")
        if KEYWORD_RE.search(haystack) and (operator or owner or name):
            return (
                "storage_tank",
                0.62,
                "Storage tank name/description suggests petroleum storage, but substance tags are missing.",
            )
    if man_made == "silo" and _has_petroleum_substance(tags):
        return (
            "storage_tank",
            0.6,
            "Oil/petroleum silo mapped in OpenStreetMap.",
        )
    if "tank farm" in haystack or "tankfarm" in haystack:
        return (
            "tank_farm",
            0.78,
            "Facility name/description suggests a tank farm, but the terminal tag is not explicit.",
        )
    if "fuel depot" in haystack or "petroleum depot" in haystack:
        return (
            "fuel_depot",
            0.7,
            "Facility name/description suggests a fuel depot, but industrial=fuel is not explicit.",
        )
    if industrial == "refinery":
        return (
            "storage_terminal",
            0.88,
            "Explicit OSM refinery industrial site (industrial=refinery).",
        )
    if industrial == "oil" and (name or operator or owner or _has_petroleum_substance(tags)):
        return (
            "storage_terminal",
            0.76,
            "OSM industrial=oil site with petroleum identity or substance tags.",
        )
    if industrial in {"oil", "gas"} and KEYWORD_RE.search(haystack):
        return (
            "storage_terminal",
            0.68,
            "Oil/gas industrial site with storage-terminal keywords in the mapped name/description.",
        )
    landuse = _normalize_token(tags.get("landuse"))
    if landuse == "industrial" and _has_petroleum_identity(tags):
        if industrial in {"oil", "gas", "refinery", "petroleum terminal", "tank farm", "fuel"}:
            return (
                "storage_terminal",
                0.82,
                "Industrial landuse polygon with explicit petroleum industrial tagging.",
            )
        if _has_petroleum_substance(tags):
            return (
                "storage_terminal",
                0.74,
                "Industrial landuse polygon with petroleum substance/product tags.",
            )
        return (
            "storage_terminal",
            0.7,
            "Named industrial landuse polygon with petroleum identity in OSM tags.",
        )
    return (
        "",
        0.0,
        "",
    )


def _format_license_type(subtype: str) -> str:
    if subtype == "tank_farm":
        return "Tank Farm"
    if subtype == "fuel_depot":
        return "Fuel Depot"
    if subtype == "storage_tank":
        return "Storage Tank"
    return "Storage Terminal"


def _display_name(tags: dict[str, Any], subtype: str) -> Optional[str]:
    name = _clean_text(tags.get("name:en")) or _clean_text(tags.get("name"))
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

    payload, _ = get_country_borders_geojson()
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
    """Country lookup cached on ~1.1 km grid — list builds call this tens of thousands of times."""
    return _resolve_country_cached(round(lat, 2), round(lng, 2))


@lru_cache(maxsize=65536)
def _resolve_country_cached(lat: float, lng: float) -> tuple[str, str]:
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
        *DEFAULT_OVERPASS_URLS,
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
    petroleum_substance = "^(oil|petroleum|diesel|gasoline|fuel|crude|lng|lpg|jet|kerosene|naphtha|refined)"
    return f"""
[out:json][timeout:{OVERPASS_QUERY_TIMEOUT_SECONDS}];
(
  nwr["industrial"="petroleum_terminal"]({bbox_text});
  nwr["industrial"="tank_farm"]({bbox_text});
  nwr["industrial"="fuel"]({bbox_text});
  nwr["industrial"~"^(oil|gas)$"]["name"~"(terminal|tank\\s*farm|tankfarm|depot|storage)",i]({bbox_text});
  nwr["man_made"="storage_tank"]["substance"~"{petroleum_substance}",i]({bbox_text});
  nwr["man_made"="storage_tank"]["product"~"{petroleum_substance}",i]({bbox_text});
  nwr["man_made"="storage_tank"]["content"~"{petroleum_substance}",i]({bbox_text});
  nwr["man_made"="silo"]["substance"~"{petroleum_substance}",i]({bbox_text});
  nwr["man_made"="silo"]["product"~"{petroleum_substance}",i]({bbox_text});
  nwr["industrial"="oil"]({bbox_text});
  nwr["industrial"="refinery"]({bbox_text});
  nwr["landuse"="industrial"]["industrial"~"^(oil|gas|refinery)$"]({bbox_text});
  nwr["landuse"="industrial"]["substance"~"{petroleum_substance}",i]({bbox_text});
  nwr["landuse"="industrial"]["content"~"{petroleum_substance}",i]({bbox_text});
  nwr["landuse"="industrial"]["name"~"(oil|petroleum|refinery|terminal|tank\\s*farm|tankfarm|depot|storage|adnoc|aramco|petrochemical)",i]({bbox_text});
  nwr["landuse"="industrial"]["owner"~"(oil|petroleum|refinery|terminal|tank\\s*farm|tankfarm|depot|storage|adnoc|aramco|petrochemical|shell|bp|exxon|chevron|total)",i]({bbox_text});
  nwr["landuse"="industrial"]["brand"~"(oil|petroleum|shell|bp|adnoc|aramco|total)",i]({bbox_text});
  nwr["man_made"="works"]["industrial"~"^(oil|refinery|petrochemical|gas)$"]({bbox_text});
  nwr["industrial"="petrochemical"]({bbox_text});
  nwr["industrial"="petroleum"]({bbox_text});
  nwr["man_made"="storage_tank"]["operator"~"(oil|petroleum|terminal|adnoc|aramco|shell|bp|vopak|storage)",i]({bbox_text});
  nwr["man_made"="storage_tank"]["owner"~"(oil|petroleum|terminal|adnoc|aramco|shell|bp|vopak|storage)",i]({bbox_text});
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
        for attempt in range(max(1, OVERPASS_RETRY_ATTEMPTS)):
            req = Request(overpass_url, data=body, headers=headers)
            try:
                with urlopen(req, timeout=OVERPASS_TIMEOUT_SECONDS) as response:
                    payload = json.load(response)
                return payload.get("elements", []) if isinstance(payload, dict) else []
            except Exception as exc:
                errors.append(f"{overpass_url}#{attempt + 1}: {exc}")
                if attempt + 1 < OVERPASS_RETRY_ATTEMPTS:
                    time.sleep(OVERPASS_RETRY_DELAY_SECONDS * (attempt + 1))
    if errors:
        raise RuntimeError("; ".join(errors))
    return []


def _element_geometry_bounds(element: dict[str, Any]) -> Optional[dict[str, float]]:
    geometry = element.get("geometry") or []
    if not isinstance(geometry, list) or len(geometry) < 3:
        return None
    lats = [float(pt["lat"]) for pt in geometry if isinstance(pt, dict) and pt.get("lat") is not None]
    lngs = [float(pt["lon"]) for pt in geometry if isinstance(pt, dict) and pt.get("lon") is not None]
    if not lats or not lngs:
        return None
    return {
        "south": min(lats),
        "north": max(lats),
        "west": min(lngs),
        "east": max(lngs),
    }


def _geojson_centroid_and_bounds(
    geom_json: dict[str, Any],
) -> tuple[Optional[float], Optional[float], Optional[dict[str, float]]]:
    gtype = geom_json.get("type")
    coords = geom_json.get("coordinates")
    if not gtype or coords is None:
        return None, None, None

    points: list[tuple[float, float]] = []

    def collect_ring(ring: Any) -> None:
        if not isinstance(ring, list):
            return
        for coord in ring:
            if isinstance(coord, list) and len(coord) >= 2:
                points.append((float(coord[0]), float(coord[1])))

    if gtype == "Point" and isinstance(coords, list) and len(coords) >= 2:
        lng, lat = float(coords[0]), float(coords[1])
        return lat, lng, {"south": lat, "north": lat, "west": lng, "east": lng}
    if gtype == "Polygon":
        collect_ring((coords or [None])[0])
    elif gtype == "MultiPolygon":
        for polygon in coords or []:
            if isinstance(polygon, list) and polygon:
                collect_ring(polygon[0])
    if not points:
        return None, None, None
    lngs = [pt[0] for pt in points]
    lats = [pt[1] for pt in points]
    bounds = {"south": min(lats), "north": max(lats), "west": min(lngs), "east": max(lngs)}
    return sum(lats) / len(lats), sum(lngs) / len(lngs), bounds


def _element_from_db_row(
    osm_type: str,
    osm_id: int,
    tags: dict[str, Any],
    geom_json: dict[str, Any],
    *,
    lat: Optional[float] = None,
    lng: Optional[float] = None,
    bounds: Optional[dict[str, float]] = None,
) -> Optional[dict[str, Any]]:
    if lat is None or lng is None:
        lat, lng, bounds = _geojson_centroid_and_bounds(geom_json)
    if lat is None or lng is None:
        return None
    element: dict[str, Any] = {
        "type": osm_type,
        "id": osm_id,
        "tags": tags,
        "lat": lat,
        "lon": lng,
        "fromPetroleumOsmLayer": True,
    }
    if bounds and (bounds["north"] - bounds["south"] > 0.0005 or bounds["east"] - bounds["west"] > 0.0005):
        element["siteBounds"] = bounds
    return element


def _load_bulk_osm_seed_elements() -> list[dict[str, Any]]:
    if not BULK_SEED_PATH.is_file():
        return []
    try:
        payload = json.loads(BULK_SEED_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    rows = payload.get("entities") if isinstance(payload, dict) else None
    if not isinstance(rows, list):
        return []
    elements: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        osm_type = row.get("osm_type")
        osm_id = row.get("osm_id")
        lat = _safe_float(row.get("lat"))
        lng = _safe_float(row.get("lng"))
        if not osm_type or osm_id is None or lat is None or lng is None:
            continue
        elements.append(
            {
                "type": osm_type,
                "id": int(osm_id),
                "lat": lat,
                "lon": lng,
                "tags": row.get("tags") if isinstance(row.get("tags"), dict) else {},
            }
        )
    return elements


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
                SELECT osm_type, osm_id, tags, ST_AsGeoJSON(geom)::json AS geom_json,
                       ST_Y(ST_Centroid(geom)) AS lat,
                       ST_X(ST_Centroid(geom)) AS lon,
                       ST_YMin(geom) AS south,
                       ST_XMin(geom) AS west,
                       ST_YMax(geom) AS north,
                       ST_XMax(geom) AS east
                FROM petroleum_osm_features
                WHERE layer_id = %s
                ORDER BY osm_id;
                """,
                (STORAGE_TERMINALS_LAYER_ID,),
            )
            rows = cur.fetchall()
        elements: list[dict[str, Any]] = []
        for osm_type, osm_id, tags_raw, geom_json, lat, lon, south, west, north, east in rows:
            tags = tags_raw if isinstance(tags_raw, dict) else {}
            if isinstance(tags_raw, str):
                try:
                    tags = json.loads(tags_raw)
                except json.JSONDecodeError:
                    tags = {}
            geom = geom_json if isinstance(geom_json, dict) else json.loads(geom_json or "{}")
            bounds = None
            if all(value is not None for value in (south, west, north, east)):
                bounds = {
                    "south": float(south),
                    "west": float(west),
                    "north": float(north),
                    "east": float(east),
                }
            element = _element_from_db_row(
                str(osm_type),
                int(osm_id),
                tags,
                geom,
                lat=float(lat) if lat is not None else None,
                lng=float(lon) if lon is not None else None,
                bounds=bounds,
            )
            if element:
                elements.append(element)
        return elements, fetched_at if isinstance(fetched_at, str) else None
    finally:
        conn.close()


def _should_load_bulk_seed(db_elements: list[dict[str, Any]], osm_entity_count: int) -> bool:
    if db_elements and osm_entity_count < MIN_NORMALIZED_ENTITIES_FOR_GLOBAL_LAYER:
        if len(db_elements) >= MIN_DB_FEATURES_FOR_GLOBAL_SNAPSHOT:
            return True
    if osm_entity_count >= MIN_DB_FEATURES_FOR_GLOBAL_SNAPSHOT and db_elements:
        return not _db_snapshot_is_globally_complete(db_elements)
    return osm_entity_count < MIN_DB_FEATURES_FOR_GLOBAL_SNAPSHOT


def _append_bulk_seed_entities(
    all_entities: list[dict[str, Any]],
    fetched_at: str,
    data_source: str,
    warnings: list[str],
) -> tuple[str, int]:
    bulk_elements = _load_bulk_osm_seed_elements()
    if not bulk_elements:
        return data_source, 0
    existing_ids = {entity.get("id") for entity in all_entities}
    bulk_added = 0
    for element in bulk_elements:
        normalized = normalize_storage_terminal(element, fetched_at)
        if normalized and normalized["id"] not in existing_ids:
            normalized["sourceId"] = "osm_bulk_seed_storage_terminals"
            normalized["sourceName"] = "OpenStreetMap (offline bulk seed)"
            all_entities.append(normalized)
            existing_ids.add(normalized["id"])
            bulk_added += 1
    if bulk_added:
        if data_source in {"bulk_seed", "database"}:
            data_source = "bulk_seed" if data_source == "bulk_seed" else f"{data_source}+bulk_seed"
        else:
            data_source = f"{data_source}+bulk_seed" if data_source != "overpass" else "bulk_seed"
        warnings.append(
            f"Loaded {bulk_added} storage terminals from offline OSM bulk seed fallback."
        )
    return data_source, bulk_added


def _load_db_snapshot_entities(
    db_elements: list[dict[str, Any]],
    fetched_at: str,
) -> list[dict[str, Any]]:
    entities: list[dict[str, Any]] = []
    for element in db_elements:
        normalized = normalize_storage_terminal(element, fetched_at, trust_petroleum_layer=True)
        if normalized:
            normalized["sourceId"] = "osm_petroleum_db_storage_terminals"
            normalized["sourceName"] = "OpenStreetMap (persisted snapshot)"
            entities.append(normalized)
    return entities


def _entity_site_label(entity: dict[str, Any]) -> Optional[str]:
    company = _clean_text(entity.get("company"))
    if company and company != "Unnamed Storage Terminal":
        return company
    operator = _clean_text(entity.get("operatorName"))
    if operator:
        return operator
    owner = _clean_text(entity.get("ownerName"))
    return owner or None


def _is_named_site_entity(entity: dict[str, Any]) -> bool:
    subtype = entity.get("entitySubtype") or ""
    if subtype not in {"storage_terminal", "tank_farm", "fuel_depot"}:
        return False
    return bool(_entity_site_label(entity))


def _is_orphan_storage_tank(entity: dict[str, Any]) -> bool:
    if entity.get("entitySubtype") != "storage_tank":
        return False
    if entity.get("operatorName") or entity.get("ownerName"):
        return False
    company = _clean_text(entity.get("company"))
    return not company or company == "Unnamed Storage Terminal"


def _haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    radius_km = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lng2 - lng1)
    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    return 2 * radius_km * math.asin(min(1.0, math.sqrt(a)))


def _point_in_site_bounds(lat: float, lng: float, bounds: dict[str, float]) -> bool:
    buffer_deg = SITE_POLYGON_BUFFER_DEG
    return (
        float(bounds["south"]) - buffer_deg <= lat <= float(bounds["north"]) + buffer_deg
        and float(bounds["west"]) - buffer_deg <= lng <= float(bounds["east"]) + buffer_deg
    )


def _find_containing_named_site(
    lat: float,
    lng: float,
    sites: list[dict[str, Any]],
) -> Optional[dict[str, Any]]:
    for site in sites:
        bounds = site.get("siteBounds")
        if isinstance(bounds, dict) and _point_in_site_bounds(lat, lng, bounds):
            return site
    return None


def _find_nearest_named_site(
    lat: float,
    lng: float,
    country: str,
    sites: list[dict[str, Any]],
) -> tuple[Optional[dict[str, Any]], float]:
    best_site: Optional[dict[str, Any]] = None
    best_dist = SITE_CONTEXT_MAX_DISTANCE_KM + 1.0

    def consider(candidates: list[dict[str, Any]]) -> None:
        nonlocal best_site, best_dist
        for site in candidates:
            site_lat = _safe_float(site.get("lat"))
            site_lng = _safe_float(site.get("lng"))
            if site_lat is None or site_lng is None:
                continue
            dist = _haversine_km(lat, lng, site_lat, site_lng)
            if dist <= SITE_CONTEXT_MAX_DISTANCE_KM and dist < best_dist:
                best_dist = dist
                best_site = site

    if country and country != "Unknown":
        same_country = [site for site in sites if site.get("country") == country]
        consider(same_country)
        if best_site is not None:
            return best_site, best_dist
    consider(sites)
    if best_site is None:
        return None, best_dist
    return best_site, best_dist


def _enrich_orphan_tanks_with_site_context(entities: list[dict[str, Any]]) -> list[dict[str, Any]]:
    sites = [entity for entity in entities if _is_named_site_entity(entity)]
    if not sites:
        return entities

    enriched: list[dict[str, Any]] = []
    for entity in entities:
        if not _is_orphan_storage_tank(entity):
            enriched.append(entity)
            continue

        lat = _safe_float(entity.get("lat"))
        lng = _safe_float(entity.get("lng"))
        if lat is None or lng is None:
            enriched.append(entity)
            continue

        containing_site = _find_containing_named_site(lat, lng, sites)
        if containing_site is not None:
            site_name = _entity_site_label(containing_site)
            if site_name:
                updated = dict(entity)
                updated["siteContextName"] = site_name
                updated["siteContextSource"] = containing_site.get("id")
                updated["siteContextInferred"] = False
                if not str(updated.get("operatorName") or "").strip() and containing_site.get("operatorName"):
                    updated["operatorName"] = containing_site["operatorName"]
                if not str(updated.get("ownerName") or "").strip() and containing_site.get("ownerName"):
                    updated["ownerName"] = containing_site["ownerName"]
                context_note = (
                    f"Tank node lies within mapped industrial site polygon: {site_name}. "
                    "Operator/owner copied from parent OSM site when tank node lacks tags."
                )
                prior_note = _clean_text(updated.get("confidenceNote"))
                updated["confidenceNote"] = f"{prior_note} {context_note}".strip() if prior_note else context_note
                evidence = list(updated.get("evidence") or [])
                evidence.append(
                    {
                        "id": f"{updated.get('id')}:site_polygon",
                        "title": f"Industrial site polygon: {site_name}",
                        "url": containing_site.get("sourceRecordUrl"),
                        "source_label": "OpenStreetMap (site polygon)",
                        "evidence_type": "osm_site_polygon",
                        "confidence": 0.72,
                        "summary": context_note,
                    }
                )
                updated["evidence"] = evidence
                updated["evidenceCount"] = len(evidence)
                enriched.append(updated)
                continue

        nearest_site, distance_km = _find_nearest_named_site(
            lat,
            lng,
            _clean_text(entity.get("country")),
            sites,
        )
        if nearest_site is None:
            enriched.append(entity)
            continue

        site_name = _entity_site_label(nearest_site)
        if not site_name:
            enriched.append(entity)
            continue

        updated = dict(entity)
        updated["siteContextName"] = site_name
        updated["siteContextSource"] = nearest_site.get("id")
        updated["siteContextInferred"] = True
        context_note = (
            f"Inferred nearby site context: {site_name} (~{distance_km:.1f} km). "
            "Individual tank name not tagged in OSM."
        )
        prior_note = _clean_text(updated.get("confidenceNote"))
        updated["confidenceNote"] = f"{prior_note} {context_note}".strip() if prior_note else context_note

        evidence = list(updated.get("evidence") or [])
        evidence.append(
            {
                "id": f"{updated.get('id')}:site_context",
                "title": f"Nearby site context: {site_name}",
                "url": nearest_site.get("sourceRecordUrl"),
                "source_label": "OpenStreetMap (inferred proximity)",
                "evidence_type": "inferred_site_context",
                "confidence": 0.45,
                "summary": context_note,
            }
        )
        updated["evidence"] = evidence
        updated["evidenceCount"] = len(evidence)
        enriched.append(updated)

    return enriched


def _db_snapshot_is_globally_complete(elements: list[dict[str, Any]]) -> bool:
    """Reject tiny regional DB snapshots that would hide live global Overpass coverage."""
    if len(elements) < MIN_DB_FEATURES_FOR_GLOBAL_SNAPSHOT:
        return False
    countries: set[str] = set()
    for element in elements:
        lat = _safe_float(element.get("lat"))
        lng = _safe_float(element.get("lon"))
        if lat is None or lng is None:
            continue
        country, _ = resolve_country(lat, lng)
        if country != "Unknown":
            countries.add(country)
    return len(countries) >= MIN_DB_COUNTRIES_FOR_GLOBAL_SNAPSHOT


def normalize_storage_terminal(
    element: dict[str, Any],
    fetched_at: str,
    *,
    include_nearby_port: bool = False,
    trust_petroleum_layer: bool = False,
) -> Optional[dict[str, Any]]:
    tags = element.get("tags") or {}
    trust_layer = trust_petroleum_layer or bool(element.get("fromPetroleumOsmLayer"))
    subtype, confidence, confidence_note = infer_terminal_subtype(tags)
    if not subtype and trust_layer:
        has_storage_tag_keys = any(
            tags.get(key)
            for key in (
                "man_made",
                "industrial",
                "landuse",
                "product",
                "substance",
                "operator",
                "owner",
            )
        )
        if not has_storage_tag_keys:
            subtype = "storage_tank"
            confidence = 0.55
            confidence_note = (
                "Mapped in petroleum_osm storage layer; OSM tags were reduced in the DB snapshot. "
                "Use satellite/OSM for exact tank identity — operator may come from port/curated enrichment."
            )
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

    site_bounds = element.get("siteBounds") if isinstance(element.get("siteBounds"), dict) else None
    if site_bounds is None:
        site_bounds = _element_geometry_bounds(element)

    display_name = _display_name(tags, subtype)
    capacity_text = _parse_capacity_text(tags)
    operator, owner = _extract_operator_owner(tags)
    substance_text = _substance_from_tags(tags)
    commodity_hints = _commodity_hints_from_tags(tags)

    if not display_name and not operator and not owner and not capacity_text:
        if subtype not in {"storage_tank", "fuel_depot"} or confidence < 0.55:
            return None

    country, country_iso2 = resolve_country(lat, lng)
    region = _region_from_tags(tags)

    nearest_port = None
    nearest_ports: list[dict[str, Any]] = []
    if include_nearby_port and country_iso2:
        nearest_ports = find_nearest_ports(country_iso2=country_iso2, lat=lat, lng=lng, limit=1)
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
    if owner and not operator:
        confidence = min(0.96, confidence + 0.005)

    facility_name = display_name or operator or owner or "Unnamed Storage Terminal"
    evidence = [
        {
            "id": f"osm:{element.get('type')}:{element.get('id')}:facility",
            "title": f"OSM mapped as {tags.get('industrial') or tags.get('man_made') or subtype}",
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

    result: dict[str, Any] = {
        "id": f"osm:{element.get('type')}:{element.get('id')}",
        "company": facility_name,
        "licenseType": _format_license_type(subtype),
        "commodity": ", ".join(commodity_hints) if commodity_hints else (substance_text or "petroleum"),
        "status": (
            "Unverified OSM tank node"
            if subtype == "storage_tank" and confidence < 0.7
            else "Mapped open infrastructure"
        ),
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
        "ownerName": owner,
        "substanceText": substance_text,
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
    if site_bounds:
        result["siteBounds"] = site_bounds
    if subtype == "storage_tank" and confidence < 0.7:
        result["coverageState"] = "sparse_osm_node"
        result["confidenceNote"] = (
            f"{confidence_note} Not a verified petroleum terminal — confirm on satellite and OSM tags before use."
        )
    return result


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


def _source_bucket(entity: dict[str, Any]) -> str:
    if entity.get("sourceKind") == "curated_reference" or str(entity.get("id", "")).startswith("curated_storage_"):
        return "curated_reference"
    if str(entity.get("id", "")).startswith("osm:"):
        return "osm"
    return "other"


def _build_stats(entities: list[dict[str, Any]]) -> dict[str, Any]:
    countries = {entity["country"] for entity in entities if _clean_text(entity.get("country")) and entity["country"] != "Unknown"}
    by_subtype: dict[str, int] = {}
    by_country: dict[str, int] = {}
    by_source: dict[str, int] = {}
    high_confidence = 0
    with_operator = 0
    with_owner = 0
    with_capacity = 0
    with_nearby_port = 0
    with_reference_enrichment = 0
    for entity in entities:
        subtype = entity.get("entitySubtype") or "unknown"
        by_subtype[subtype] = by_subtype.get(subtype, 0) + 1
        country = entity.get("country") or "Unknown"
        by_country[country] = by_country.get(country, 0) + 1
        source_bucket = _source_bucket(entity)
        by_source[source_bucket] = by_source.get(source_bucket, 0) + 1
        if float(entity.get("confidenceScore") or 0.0) >= 0.8:
            high_confidence += 1
        if entity.get("operatorName"):
            with_operator += 1
        if entity.get("ownerName"):
            with_owner += 1
        if entity.get("capacityText"):
            with_capacity += 1
        if entity.get("nearbyPort"):
            with_nearby_port += 1
        if entity.get("curatedEnrichmentSourceId"):
            with_reference_enrichment += 1

    top_countries = [
        {"country": country, "count": count}
        for country, count in sorted(by_country.items(), key=lambda item: (-item[1], item[0]))[:10]
    ]
    return {
        "total": len(entities),
        "countries": len(countries),
        "with_operator": with_operator,
        "with_owner": with_owner,
        "with_capacity": with_capacity,
        "with_nearby_port": with_nearby_port,
        "with_reference_enrichment": with_reference_enrichment,
        "high_confidence": high_confidence,
        "by_subtype": by_subtype,
        "by_source": by_source,
        "top_countries": top_countries,
    }


def _fresh_cache() -> Optional[dict[str, Any]]:
    age = time.time() - float(_storage_cache.get("loaded_at") or 0.0)
    if _storage_cache.get("response") and age < STORAGE_CACHE_TTL_SECONDS:
        return dict(_storage_cache["response"])
    return None


def _debug_log_storage(hypothesis_id: str, message: str, data: dict[str, Any]) -> None:
    # #region agent log
    try:
        import json as _json

        payload = {
            "sessionId": "7419a2",
            "hypothesisId": hypothesis_id,
            "location": "storage_terminals.py:get_storage_terminals",
            "message": message,
            "data": data,
            "timestamp": int(time.time() * 1000),
        }
        _log_path = os.getenv(
            "DEBUG_LOG_PATH",
            "/Users/daniatallah/Gold Project /mining-map/.cursor/debug-7419a2.log",
        )
        with open(_log_path, "a", encoding="utf-8") as _f:
            _f.write(_json.dumps(payload, default=str) + "\n")
    except OSError:
        pass
    # #endregion


STORAGE_VIEWPORT_DEFAULT_LIMIT = int(os.getenv("STORAGE_VIEWPORT_DEFAULT_LIMIT", "2000"))
STORAGE_VIEWPORT_MAX_LIMIT = int(os.getenv("STORAGE_VIEWPORT_MAX_LIMIT", "5000"))


def _parse_storage_bbox(
    south: Optional[float],
    west: Optional[float],
    north: Optional[float],
    east: Optional[float],
) -> Optional[tuple[float, float, float, float]]:
    if south is None and west is None and north is None and east is None:
        return None
    if south is None or west is None or north is None or east is None:
        raise ValueError("bbox requires all of south, west, north, east")
    bbox = (float(south), float(west), float(north), float(east))
    if bbox[0] >= bbox[2] or bbox[1] >= bbox[3]:
        raise ValueError("invalid bbox: south must be < north and west must be < east")
    return bbox


def _entity_in_bbox(entity: dict[str, Any], bbox: tuple[float, float, float, float]) -> bool:
    lat = entity.get("lat")
    lng = entity.get("lng")
    if lat is None or lng is None:
        return False
    south, west, north, east = bbox
    return south <= float(lat) <= north and west <= float(lng) <= east


def _apply_viewport_filter(
    entities: list[dict[str, Any]],
    *,
    bbox: Optional[tuple[float, float, float, float]],
    limit: Optional[int],
) -> tuple[list[dict[str, Any]], bool]:
    if bbox is None:
        return entities, False
    filtered = [entity for entity in entities if _entity_in_bbox(entity, bbox)]
    coverage_gap = len(filtered) == 0
    cap = limit if limit is not None else STORAGE_VIEWPORT_DEFAULT_LIMIT
    cap = min(max(1, cap), STORAGE_VIEWPORT_MAX_LIMIT)
    if len(filtered) > cap:
        filtered = filtered[:cap]
    return filtered, coverage_gap


def _package_storage_response(
    response: dict[str, Any],
    entities: list[dict[str, Any]],
    *,
    bbox: Optional[tuple[float, float, float, float]] = None,
    limit: Optional[int] = None,
    cached: bool = False,
) -> dict[str, Any]:
    viewport_entities, coverage_gap = _apply_viewport_filter(entities, bbox=bbox, limit=limit)
    try:
        from backend.services.storage_terminal_display import overlay_materialized_on_entities
    except ImportError:
        from services.storage_terminal_display import overlay_materialized_on_entities  # type: ignore

    viewport_entities = overlay_materialized_on_entities(
        viewport_entities, bbox=bbox, summary=True
    )
    out = dict(response)
    out["entities"] = [_summary_entity(entity) if not entity.get("displayReady") else entity for entity in viewport_entities]
    if cached:
        out["cached"] = True
    if bbox is not None:
        out["viewport_bbox"] = list(bbox)
        out["coverage_gap"] = coverage_gap
        if coverage_gap:
            limitations = list(out.get("limitations") or [])
            limitations.append(
                "No storage terminals in this map viewport — may be an OSM mapping gap or zoom outside "
                "petroleum infrastructure. Pan to a known hub or see GET /api/storage/coverage/report."
            )
            out["limitations"] = limitations
        out["stats"] = _build_stats(viewport_entities)
    return out


def get_storage_terminals(
    force_refresh: bool = False,
    *,
    bbox: Optional[tuple[float, float, float, float]] = None,
    limit: Optional[int] = None,
) -> dict[str, Any]:
    _t0 = time.perf_counter()
    _debug_log_storage(
        "C",
        "storage_request_start",
        {"force_refresh": force_refresh, "skip_live_overpass": STORAGE_SKIP_LIVE_OVERPASS},
    )
    previous_cache = dict(_storage_cache["response"]) if _storage_cache.get("response") else None
    previous_loaded_at = float(_storage_cache.get("loaded_at") or 0.0)

    if not force_refresh:
        cached = _fresh_cache()
        if cached is not None:
            entities = cached.get("entities", [])
            _debug_log_storage(
                "D",
                "storage_memory_cache_hit",
                {
                    "elapsed_ms": int((time.perf_counter() - _t0) * 1000),
                    "entity_count": len(entities),
                },
            )
            return _package_storage_response(
                cached,
                entities,
                bbox=bbox,
                limit=limit,
                cached=True,
            )

    fetched_at = _now_iso()
    warnings: list[str] = []
    all_entities: list[dict[str, Any]] = []
    data_source = "overpass"
    db_elements: list[dict[str, Any]] = []
    db_fetched_at: Optional[str] = None
    osm_entity_count = 0
    use_db_only = False

    db_elements, db_fetched_at = _load_storage_terminals_from_db()
    _debug_log_storage(
        "B",
        "storage_db_loaded",
        {
            "elapsed_ms": int((time.perf_counter() - _t0) * 1000),
            "db_element_count": len(db_elements),
        },
    )

    # force_refresh only busts the in-memory cache — never force live Overpass when skipped.
    use_db_only = bool(db_elements) and (
        _db_snapshot_is_globally_complete(db_elements)
        or STORAGE_SKIP_LIVE_OVERPASS
    )

    if use_db_only:
        data_source = "database"
        fetched_at = db_fetched_at or fetched_at
        for element in db_elements:
            normalized = normalize_storage_terminal(element, fetched_at, trust_petroleum_layer=True)
            if normalized:
                normalized["sourceId"] = "osm_petroleum_db_storage_terminals"
                normalized["sourceName"] = "OpenStreetMap (persisted snapshot)"
                all_entities.append(normalized)
        osm_entity_count = len(all_entities)
        _debug_log_storage(
            "B",
            "storage_db_normalized",
            {
                "elapsed_ms": int((time.perf_counter() - _t0) * 1000),
                "osm_entity_count": osm_entity_count,
                "use_db_only": use_db_only,
            },
        )
    elif STORAGE_SKIP_LIVE_OVERPASS:
        data_source = "bulk_seed"
        warnings.append(
            "Live Overpass skipped (STORAGE_SKIP_LIVE_OVERPASS) — using petroleum_osm_features, bulk seed, and curated reference."
        )
    else:
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

        osm_entity_count = len(
            [entity for entity in all_entities if str(entity.get("id", "")).startswith("osm:")]
        )

        if not osm_entity_count and db_elements:
            data_source = "database"
            fetched_at = db_fetched_at or fetched_at
            warnings.append(
                "Live Overpass returned no normalized storage entities; using persisted petroleum_osm_features snapshot."
            )
            all_entities = _load_db_snapshot_entities(db_elements, fetched_at)
            osm_entity_count = len(all_entities)
        elif db_elements and not use_db_only and osm_entity_count:
            warnings.append(
                "Persisted petroleum_osm_features snapshot was regional/incomplete; refreshed from live Overpass world tiles."
            )

        if _should_load_bulk_seed(db_elements, osm_entity_count):
            data_source, bulk_added = _append_bulk_seed_entities(
                all_entities, fetched_at, data_source, warnings
            )
            osm_entity_count += bulk_added

    if STORAGE_SKIP_LIVE_OVERPASS and not use_db_only and _should_load_bulk_seed(db_elements, osm_entity_count):
        if db_elements and osm_entity_count == 0:
            data_source = "database"
            fetched_at = db_fetched_at or fetched_at
            all_entities.extend(_load_db_snapshot_entities(db_elements, fetched_at))
            osm_entity_count = len(
                [entity for entity in all_entities if str(entity.get("id", "")).startswith("osm:")]
            )
        if _should_load_bulk_seed(db_elements, osm_entity_count):
            data_source, bulk_added = _append_bulk_seed_entities(
                all_entities, fetched_at, data_source, warnings
            )
            osm_entity_count += bulk_added
    elif STORAGE_SKIP_LIVE_OVERPASS and use_db_only and _should_load_bulk_seed(
        db_elements, osm_entity_count
    ):
        data_source, bulk_added = _append_bulk_seed_entities(
            all_entities, fetched_at, data_source, warnings
        )
        osm_entity_count += bulk_added
        _debug_log_storage(
            "B",
            "storage_bulk_seed_appended",
            {
                "elapsed_ms": int((time.perf_counter() - _t0) * 1000),
                "bulk_added": bulk_added,
                "osm_entity_count": osm_entity_count,
            },
        )

    try:
        from backend.services.storage_terminals_seed import (
            drop_curated_near_osm_duplicates,
            enrich_osm_from_curated_reference,
            enrich_osm_from_oil_terminal_reference,
            load_curated_storage_terminals,
        )
        from backend.services.storage_terminals_gov_seed import (
            enrich_osm_from_government_reference,
            load_government_storage_reference_hubs,
        )
        from backend.services.storage_terminals_oil_db import load_oil_terminal_reference_hubs
    except ImportError:
        from services.storage_terminals_seed import (  # type: ignore
            drop_curated_near_osm_duplicates,
            enrich_osm_from_curated_reference,
            enrich_osm_from_oil_terminal_reference,
            load_curated_storage_terminals,
        )
        from services.storage_terminals_gov_seed import (  # type: ignore
            enrich_osm_from_government_reference,
            load_government_storage_reference_hubs,
        )
        from services.storage_terminals_oil_db import load_oil_terminal_reference_hubs  # type: ignore

    curated_entities = load_curated_storage_terminals(fetched_at)
    _debug_log_storage(
        "A",
        "storage_curated_loaded",
        {
            "curated_count": len(curated_entities),
            "curated_uae": sum(
                1 for e in curated_entities if "United Arab Emirates" in str(e.get("country") or "")
            ),
            "curated_fujairah": sum(
                1
                for e in curated_entities
                if e.get("lat") is not None
                and 25.0 <= float(e["lat"]) <= 25.25
                and e.get("lng") is not None
                and 56.2 <= float(e["lng"]) <= 56.5
            ),
        },
    )
    gov_reference_hubs = load_government_storage_reference_hubs(fetched_at)
    oil_terminal_hubs = load_oil_terminal_reference_hubs()
    if curated_entities:
        all_entities.extend(curated_entities)
        if data_source == "database":
            data_source = "database+curated"
        elif data_source == "overpass":
            data_source = "overpass+curated"
        elif data_source == "bulk_seed":
            data_source = "bulk_seed+curated"

    merged = _dedupe_entities(all_entities)
    _debug_log_storage(
        "B",
        "storage_pre_reference_enrich",
        {
            "elapsed_ms": int((time.perf_counter() - _t0) * 1000),
            "merged_count": len(merged),
            "reference_enrich_max": STORAGE_REFERENCE_ENRICH_MAX,
        },
    )
    if len(merged) <= STORAGE_REFERENCE_ENRICH_MAX:
        merged = enrich_osm_from_curated_reference(merged)
        if gov_reference_hubs:
            merged = enrich_osm_from_government_reference(merged, gov_reference_hubs)
        if oil_terminal_hubs:
            merged = enrich_osm_from_oil_terminal_reference(merged, oil_terminal_hubs)
    else:
        warnings.append(
            f"Skipped global reference-hub enrichment for {len(merged)} entities (cap {STORAGE_REFERENCE_ENRICH_MAX})."
        )
    try:
        from backend.services.port_authority_directory import anchor_port_authority_hubs_to_osm
    except ImportError:
        from services.port_authority_directory import anchor_port_authority_hubs_to_osm  # type: ignore
    merged = anchor_port_authority_hubs_to_osm(merged, fetched_at)
    try:
        from backend.services.storage_terminals_seed import drop_curated_when_osm_present_nearby
    except ImportError:
        from services.storage_terminals_seed import drop_curated_when_osm_present_nearby  # type: ignore
    merged = drop_curated_when_osm_present_nearby(merged, distance_km=8.0)
    merged = drop_curated_near_osm_duplicates(merged)
    _site_enrich_max = int(os.getenv("STORAGE_SITE_CONTEXT_ENRICH_MAX", "2500"))
    _t_enrich = time.perf_counter()
    if len(merged) <= _site_enrich_max:
        entities = _enrich_orphan_tanks_with_site_context(merged)
        _enrich_skipped = False
    else:
        entities = merged
        _enrich_skipped = True
        warnings.append(
            f"Skipped site-context enrichment for {len(merged)} entities (cap {_site_enrich_max})."
        )
    _debug_log_storage(
        "B",
        "storage_site_context_enrich",
        {
            "merged_count": len(merged),
            "enrich_skipped": _enrich_skipped,
            "enrich_cap": _site_enrich_max,
            "enrich_ms": int((time.perf_counter() - _t_enrich) * 1000),
        },
    )
    entities.sort(
        key=lambda item: (
            -(float(item.get("confidenceScore") or 0.0)),
            _clean_text(item.get("country")),
            _clean_text(item.get("company")),
        )
    )

    response = {
        "entities": entities,
        "source_labels": ["OpenStreetMap", "Overpass", "Curated reference", "Government open data", "oil_terminals DB", "UN/LOCODE"],
        "data_source": data_source,
        "data_as_of": fetched_at,
        "coverage_note": (
            "Global coverage merges live OpenStreetMap/Overpass (11 world tiles) with a curated reference seed of ~180 major "
            "petroleum storage hubs worldwide, plus optional oil_terminals Postgres enrichment when graph-sync has populated the DB. "
            "Includes petroleum terminals, tank farms, fuel depots, and tagged petroleum storage tanks/silos — not an official global storage registry."
        ),
        "limitations": [
            "Primary global source is OpenStreetMap via Overpass; coverage varies by country and mapper activity.",
            "Curated reference rows (sourceKind=curated_reference) are approximate hub centroids from public operator pages — not audited tank counts or capacities.",
            "Government open reference rows (EIA/DOE/HSE/public regulator pages) enrich sparse OSM nodes within ~4 km when curated data is absent (evidence_type=government_open_enrichment).",
            "Individual man_made=storage_tank nodes are included with lower confidence when petroleum substance/operator tags exist; they may represent single tanks rather than whole terminals.",
            "Operator and owner on OSM rows come from OSM tags when present; sparse OSM nodes within ~4 km of a curated major-hub reference may inherit operator, capacity, country, and hub context from public operator pages (evidence_type=curated_enrichment). A second pass may fill remaining gaps from oil_terminals Postgres rows when present (evidence_type=oil_terminal_enrichment).",
            "Orphan storage_tank nodes may receive siteContextName/siteContextInferred when a named terminal polygon is within ~2 km — proximity inference only, not ownership proof.",
            "When OSM industrial polygons are available, orphan tanks inside the site bounding box inherit operator/owner from the parent polygon (evidence_type=osm_site_polygon).",
            "Nearby port context comes from UN/LOCODE and is heuristic logistics context, not proof of ownership, throughput, or berth access.",
            "Capacity appears only when the open tags publish a storage value; no global open source provides consistent audited tank capacity coverage here.",
            "If you still see only a small regional cluster (e.g. Rotterdam-only), the backend may be serving a stale in-memory cache or an old regional petroleum_osm DB snapshot — call GET /api/storage/terminals?force_refresh=true or redeploy after petroleum_osm_sync.",
        ]
        + warnings,
        "stats": _build_stats(entities),
    }

    if _should_cache_storage_response(entities, warnings):
        _storage_cache["loaded_at"] = time.time()
        _storage_cache["response"] = response
    elif force_refresh and previous_cache:
        warnings.append(
            "Live refresh failed; serving previous in-memory storage snapshot without overwriting cache."
        )
        stale = dict(previous_cache)
        stale["cached"] = True
        stale["data_source"] = stale.get("data_source", "cache") + "+stale_refresh"
        stale_limitations = list(stale.get("limitations") or [])
        stale_limitations.extend(warnings)
        stale["limitations"] = stale_limitations
        return {
            **stale,
            "entities": [_summary_entity(entity) for entity in stale.get("entities", [])],
        }
    elif force_refresh:
        _storage_cache["loaded_at"] = previous_loaded_at
        _storage_cache["response"] = previous_cache

    _debug_log_storage(
        "B",
        "storage_request_done",
        {
            "elapsed_ms": int((time.perf_counter() - _t0) * 1000),
            "entity_count": len(entities),
            "data_source": data_source,
            "use_db_only": use_db_only,
        },
    )
    return _package_storage_response(response, entities, bbox=bbox, limit=limit)


def _should_cache_storage_response(entities: list[dict[str, Any]], warnings: list[str]) -> bool:
    if entities:
        return True
    if warnings and len(warnings) >= len(WORLD_TILES):
        return False
    return True


def _parse_storage_terminal_osm_id(terminal_id: str) -> Optional[tuple[str, int]]:
    parts = (terminal_id or "").strip().split(":")
    if len(parts) != 3 or parts[0] != "osm":
        return None
    osm_type, osm_id_raw = parts[1], parts[2]
    if osm_type not in {"node", "way", "relation"}:
        return None
    try:
        return osm_type, int(osm_id_raw)
    except (TypeError, ValueError):
        return None


def _load_storage_terminal_element_from_db(terminal_id: str) -> tuple[Optional[dict[str, Any]], Optional[str]]:
    """Load one petroleum_osm_features row for storage_terminals layer."""
    parsed = _parse_storage_terminal_osm_id(terminal_id)
    if not parsed:
        return None, None
    osm_type, osm_id = parsed
    try:
        from backend.services.petroleum_osm_store import ensure_petroleum_osm_tables, layer_feature_stats
    except ImportError:
        from services.petroleum_osm_store import ensure_petroleum_osm_tables, layer_feature_stats

    conn = _db_connect()
    try:
        ensure_petroleum_osm_tables(conn)
        stats = layer_feature_stats(conn, STORAGE_TERMINALS_LAYER_ID)
        fetched_at = stats.get("last_fetched_at")
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT osm_type, osm_id, tags, ST_AsGeoJSON(geom)::json AS geom_json,
                       ST_Y(ST_Centroid(geom)) AS lat,
                       ST_X(ST_Centroid(geom)) AS lon,
                       ST_YMin(geom) AS south,
                       ST_XMin(geom) AS west,
                       ST_YMax(geom) AS north,
                       ST_XMax(geom) AS east
                FROM petroleum_osm_features
                WHERE layer_id = %s AND osm_type = %s AND osm_id = %s
                LIMIT 1;
                """,
                (STORAGE_TERMINALS_LAYER_ID, osm_type, osm_id),
            )
            row = cur.fetchone()
        if not row:
            return None, fetched_at if isinstance(fetched_at, str) else None
        osm_type_db, osm_id_db, tags_raw, geom_json, lat, lon, south, west, north, east = row
        tags = tags_raw if isinstance(tags_raw, dict) else {}
        if isinstance(tags_raw, str):
            try:
                tags = json.loads(tags_raw)
            except json.JSONDecodeError:
                tags = {}
        geom = geom_json if isinstance(geom_json, dict) else json.loads(geom_json or "{}")
        bounds = None
        if all(value is not None for value in (south, west, north, east)):
            bounds = {
                "south": float(south),
                "west": float(west),
                "north": float(north),
                "east": float(east),
            }
        element = _element_from_db_row(
            str(osm_type_db),
            int(osm_id_db),
            tags,
            geom,
            lat=float(lat) if lat is not None else None,
            lng=float(lon) if lon is not None else None,
            bounds=bounds,
        )
        return element, fetched_at if isinstance(fetched_at, str) else None
    finally:
        conn.close()


def _load_storage_terminal_from_curated_or_bulk(
    terminal_id: str,
    fetched_at: str,
) -> Optional[dict[str, Any]]:
    try:
        from backend.services.storage_terminals_seed import load_curated_storage_terminals
    except ImportError:
        from services.storage_terminals_seed import load_curated_storage_terminals  # type: ignore

    for entity in load_curated_storage_terminals(fetched_at):
        if entity.get("id") == terminal_id:
            return dict(entity)

    for element in _load_bulk_osm_seed_elements():
        if f"osm:{element.get('type')}:{element.get('id')}" != terminal_id:
            continue
        normalized = normalize_storage_terminal(element, fetched_at, include_nearby_port=True)
        if normalized:
            normalized["sourceId"] = "osm_bulk_seed_storage_terminals"
            normalized["sourceName"] = "OpenStreetMap (offline bulk seed)"
            return normalized
    return None


def _enrich_storage_entity_for_detail(entity: dict[str, Any], fetched_at: str) -> dict[str, Any]:
    """Per-terminal reference enrichment (not subject to global STORAGE_REFERENCE_ENRICH_MAX)."""
    if entity.get("sourceKind") in {"curated_reference", "government_open", "oil_terminal_reference"}:
        return entity
    if not str(entity.get("id", "")).startswith("osm:"):
        return entity

    try:
        from backend.services.storage_terminals_gov_seed import (
            enrich_osm_from_government_reference,
            load_government_storage_reference_hubs,
        )
        from backend.services.storage_terminals_oil_db import load_oil_terminal_reference_hubs
        from backend.services.storage_terminals_seed import (
            enrich_osm_from_oil_terminal_reference,
            enrich_osm_from_reference_hubs,
            load_curated_storage_terminals,
        )
    except ImportError:
        from services.storage_terminals_gov_seed import (  # type: ignore
            enrich_osm_from_government_reference,
            load_government_storage_reference_hubs,
        )
        from services.storage_terminals_oil_db import load_oil_terminal_reference_hubs  # type: ignore
        from services.storage_terminals_seed import (  # type: ignore
            enrich_osm_from_oil_terminal_reference,
            enrich_osm_from_reference_hubs,
            load_curated_storage_terminals,
        )

    entities = [dict(entity)]
    curated_hubs = [
        hub
        for hub in load_curated_storage_terminals(fetched_at)
        if hub.get("sourceKind") == "curated_reference"
        and hub.get("lat") is not None
        and hub.get("lng") is not None
    ]
    entities = enrich_osm_from_reference_hubs(
        entities,
        curated_hubs,
        distance_km=4.0,
        enrichment_kind="curated_reference",
        source_label="Curated reference",
        evidence_type="curated_enrichment",
        summary_prefix="Sparse OSM geometry enriched from curated reference hub",
        confidence_boost=0.14,
        skip_if_enriched=False,
    )
    gov_hubs = load_government_storage_reference_hubs(fetched_at)
    if gov_hubs:
        entities = enrich_osm_from_government_reference(entities, gov_hubs)
    oil_hubs = load_oil_terminal_reference_hubs()
    if oil_hubs:
        entities = enrich_osm_from_oil_terminal_reference(entities, oil_hubs)
    enriched = entities[0]
    site_enriched = _enrich_orphan_tanks_with_site_context([enriched])
    return site_enriched[0] if site_enriched else enriched


def _resolve_storage_terminal_detail_entity(
    terminal_id: str,
    *,
    write_through: bool = True,
) -> Optional[dict[str, Any]]:
    terminal_id = (terminal_id or "").strip()
    if not terminal_id:
        return None

    try:
        from backend.services.storage_terminal_display import (
            STORAGE_DISPLAY_WRITE_THROUGH,
            load_display_by_id,
            storage_display_read_enabled,
            upsert_storage_terminal_display,
        )
    except ImportError:
        from services.storage_terminal_display import (  # type: ignore
            STORAGE_DISPLAY_WRITE_THROUGH,
            load_display_by_id,
            storage_display_read_enabled,
            upsert_storage_terminal_display,
        )

    if storage_display_read_enabled():
        conn = _db_connect()
        try:
            materialized = load_display_by_id(conn, terminal_id)
            if materialized is not None:
                try:
                    try:
                        from backend.services.storage_terminal_intel import (
                            attach_storage_terminal_commercial_intel,
                        )
                    except ImportError:
                        from services.storage_terminal_intel import (  # type: ignore
                            attach_storage_terminal_commercial_intel,
                        )
                    return attach_storage_terminal_commercial_intel(conn, materialized)
                except Exception:
                    return materialized
        finally:
            conn.close()

    fetched_at = _now_iso()
    entity: Optional[dict[str, Any]] = None

    cached = _fresh_cache()
    if cached is None:
        get_storage_terminals(force_refresh=False)
        cached = _fresh_cache()
    if cached:
        for candidate in cached.get("entities", []):
            if candidate.get("id") == terminal_id:
                entity = dict(candidate)
                break

    if entity is None:
        element, db_fetched_at = _load_storage_terminal_element_from_db(terminal_id)
        if element is not None:
            fetched_at = db_fetched_at or fetched_at
            entity = normalize_storage_terminal(element, fetched_at, include_nearby_port=True)
        if entity is None:
            entity = _load_storage_terminal_from_curated_or_bulk(terminal_id, fetched_at)

    if entity is None:
        return None

    enriched = _enrich_storage_entity_for_detail(entity, fetched_at)
    if write_through and STORAGE_DISPLAY_WRITE_THROUGH and str(enriched.get("id", "")).startswith("osm:"):
        conn = _db_connect()
        try:
            upsert_storage_terminal_display(
                conn,
                terminal_id=str(enriched["id"]),
                display_json=enriched,
            )
            conn.commit()
        except Exception:
            conn.rollback()
        finally:
            conn.close()
        enriched["displayReady"] = True

    lat, lng = enriched.get("lat"), enriched.get("lng")
    if lat is not None and lng is not None:
        try:
            try:
                from backend.services.storage_terminal_intel import attach_storage_terminal_commercial_intel
            except ImportError:
                from services.storage_terminal_intel import attach_storage_terminal_commercial_intel  # type: ignore

            conn = _db_connect()
            try:
                enriched = attach_storage_terminal_commercial_intel(conn, enriched)
            finally:
                conn.close()
        except Exception:
            pass

    return enriched


def get_storage_terminal_details(terminal_id: str) -> Optional[dict[str, Any]]:
    return _resolve_storage_terminal_detail_entity(terminal_id)
