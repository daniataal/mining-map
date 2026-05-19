from __future__ import annotations

import gzip
import hashlib
import json
import math
import os
import re
import time
from datetime import datetime, timezone
from typing import Any, Callable, Optional
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

try:
    import mapbox_vector_tile
except ImportError:  # pragma: no cover
    mapbox_vector_tile = None  # type: ignore


REQUEST_TIMEOUT_SECONDS = 20
LAYER_CACHE_TTL_SECONDS = 60 * 60
MAX_TILES_PER_REQUEST = 36
MIN_FETCH_ZOOM = 3
MAX_FETCH_ZOOM = 7

# Public read token embedded in roqueleal/oilmap (Mapbox tilesets are public).
# Prefer MAPBOX_ACCESS_TOKEN in production for rate limits and policy compliance.
# Default token is empty to comply with security policies.
# Set MAPBOX_ACCESS_TOKEN in your .env or environment.
_DEFAULT_MAPBOX_TOKEN = ""

# Oilmap-compatible Mapbox vector tilesets (public, not GPL — integration reimplemented here).
# See https://github.com/roqueleal/oilmap — data hosted on Mapbox by the oilmap project.
_TILESET_EXPLORATION = "roqueleal.21napvx3"
_TILESET_BIDS_A = "roqueleal.81l8bs38"
_TILESET_BIDS_B = "roqueleal.bp2fwmg3"
_TILESET_REFINERIES = "roqueleal.dmocqipn"
_TILESET_OIL_PIPELINES = "roqueleal.2wamib8r"
_TILESET_GAS_PIPELINES = "roqueleal.2g4snl58"

_EXPLORATION_SOURCE_LAYER = "100419-547uem"
_BIDS_SOURCE_LAYERS = ("BID_ROUNDS-b3exu7", "bid2-2rzrh8")
_OIL_PIPELINE_LAYER = "global_oil_pipelines_7z9-dvrjxe"
_GAS_PIPELINE_LAYER = "natural_gas_pipelines_j96-44dhf7"
_REFINERIES_LAYER = "REFINERIES-dtgbkt"

_layer_cache: dict[str, Any] = {"entries": {}}

CatalogLayer = dict[str, Any]
FeatureFilter = Callable[[dict[str, Any]], bool]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _mapbox_disabled() -> bool:
    return os.getenv("PETROLEUM_DISABLE_MAPBOX", "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def _mapbox_token() -> str:
    if _mapbox_disabled():
        return ""
    return (
        os.getenv("MAPBOX_ACCESS_TOKEN", "").strip()
        or os.getenv("OILMAP_MAPBOX_TOKEN", "").strip()
        or _DEFAULT_MAPBOX_TOKEN
    )


def _clean_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return " ".join(value.split()).strip()
    return str(value).strip()


def _normalize_bbox(
    bbox: Optional[tuple[float, float, float, float]],
) -> Optional[tuple[float, float, float, float]]:
    if bbox is None:
        return None
    try:
        south, west, north, east = (float(part) for part in bbox)
    except (TypeError, ValueError):
        return None
    south = max(-85.0, min(85.0, south))
    north = max(-85.0, min(85.0, north))
    west = max(-180.0, min(180.0, west))
    east = max(-180.0, min(180.0, east))
    if north <= south or east <= west:
        return None
    return (south, west, north, east)


def _pick_zoom(requested: Optional[int], bbox: tuple[float, float, float, float]) -> int:
    if requested is not None:
        try:
            zoom = int(requested)
        except (TypeError, ValueError):
            zoom = 5
    else:
        south, west, north, east = bbox
        span = max(abs(north - south), abs(east - west))
        if span > 80:
            zoom = 3
        elif span > 35:
            zoom = 4
        elif span > 12:
            zoom = 5
        elif span > 4:
            zoom = 6
        else:
            zoom = 7
    return max(MIN_FETCH_ZOOM, min(MAX_FETCH_ZOOM, zoom))


def _lon_to_tile_x(lon: float, zoom: int) -> int:
    return int((lon + 180.0) / 360.0 * (2**zoom))


def _lat_to_tile_y(lat: float, zoom: int) -> int:
    lat_rad = math.radians(max(-85.05112878, min(85.05112878, lat)))
    return int((1.0 - math.log(math.tan(lat_rad) + 1.0 / math.cos(lat_rad)) / math.pi) / 2.0 * (2**zoom))


def _tiles_for_bbox(bbox: tuple[float, float, float, float], zoom: int) -> list[tuple[int, int, int]]:
    south, west, north, east = bbox
    x_min = _lon_to_tile_x(west, zoom)
    x_max = _lon_to_tile_x(east, zoom)
    y_min = _lat_to_tile_y(north, zoom)
    y_max = _lat_to_tile_y(south, zoom)
    tiles: list[tuple[int, int, int]] = []
    for x in range(x_min, x_max + 1):
        for y in range(y_min, y_max + 1):
            tiles.append((zoom, x, y))
            if len(tiles) >= MAX_TILES_PER_REQUEST:
                return tiles
    return tiles


def _mvt_to_lnglat(z: int, x: int, y: int, px: float, py: float, extent: int = 4096) -> tuple[float, float]:
    n = 2**z
    lng = (x + px / extent) / n * 360.0 - 180.0
    lat_rad = math.atan(math.sinh(math.pi * (1.0 - 2.0 * (y + py / extent) / n)))
    lat = math.degrees(lat_rad)
    return lng, lat


def _transform_geometry(z: int, x: int, y: int, geometry: dict[str, Any], extent: int = 4096) -> dict[str, Any]:
    gtype = geometry.get("type")
    coords = geometry.get("coordinates")
    if not gtype or coords is None:
        return geometry

    def point(pair: list[float]) -> list[float]:
        lng, lat = _mvt_to_lnglat(z, x, y, pair[0], pair[1], extent)
        return [lng, lat]

    if gtype == "Point":
        return {"type": "Point", "coordinates": point(coords)}
    if gtype == "LineString":
        return {"type": "LineString", "coordinates": [point(pair) for pair in coords]}
    if gtype == "Polygon":
        return {
            "type": "Polygon",
            "coordinates": [[point(pair) for pair in ring] for ring in coords],
        }
    if gtype == "MultiLineString":
        return {
            "type": "MultiLineString",
            "coordinates": [[point(pair) for pair in line] for line in coords],
        }
    if gtype == "MultiPolygon":
        return {
            "type": "MultiPolygon",
            "coordinates": [
                [[point(pair) for pair in ring] for ring in polygon] for polygon in coords
            ],
        }
    return geometry


def _fetch_tile_pbf(tileset_id: str, z: int, x: int, y: int) -> bytes:
    query = urlencode({"access_token": _mapbox_token()})
    url = f"https://api.mapbox.com/v4/{tileset_id}/{z}/{x}/{y}.vector.pbf?{query}"
    request = Request(url, headers={"Accept-Encoding": "gzip"})
    with urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
        raw = response.read()
    if raw[:2] == b"\x1f\x8b":
        return gzip.decompress(raw)
    return raw


def _decode_tile_layers(tileset_id: str, z: int, x: int, y: int) -> dict[str, Any]:
    if mapbox_vector_tile is None:
        raise RuntimeError(
            "mapbox-vector-tile is required for petroleum infrastructure layers. "
            "Install backend requirements (pip install mapbox-vector-tile)."
        )
    pbf = _fetch_tile_pbf(tileset_id, z, x, y)
    return mapbox_vector_tile.decode(pbf)


def _feature_id(properties: dict[str, Any], geometry: dict[str, Any]) -> str:
    digest = hashlib.sha1(
        json.dumps({"p": properties, "g": geometry}, sort_keys=True, default=str).encode("utf-8")
    ).hexdigest()[:16]
    return digest


def _is_exploration(props: dict[str, Any]) -> bool:
    text = _clean_text(props.get("Type") or props.get("TYPE")).upper()
    return "EXPLORATION" in text


def _is_production(props: dict[str, Any]) -> bool:
    text = _clean_text(props.get("Type") or props.get("TYPE")).upper()
    return "PRODUCTION" in text


def _normalize_feature(
    raw: dict[str, Any],
    z: int,
    x: int,
    y: int,
    layer_name: str,
    extent: int = 4096,
) -> Optional[dict[str, Any]]:
    geometry = raw.get("geometry")
    if not geometry:
        return None
    properties = dict(raw.get("properties") or {})
    properties["source_layer"] = layer_name
    geo = _transform_geometry(z, x, y, geometry, extent)
    return {
        "type": "Feature",
        "id": raw.get("id") or _feature_id(properties, geo),
        "geometry": geo,
        "properties": properties,
    }


def _collect_from_tileset(
    tileset_id: str,
    source_layers: tuple[str, ...],
    tiles: list[tuple[int, int, int]],
    feature_filter: Optional[FeatureFilter] = None,
) -> list[dict[str, Any]]:
    features: list[dict[str, Any]] = []
    seen: set[str] = set()
    for z, x, y in tiles:
        try:
            decoded = _decode_tile_layers(tileset_id, z, x, y)
        except (HTTPError, URLError, RuntimeError, ValueError):
            continue
        for layer_name, layer in decoded.items():
            if source_layers and layer_name not in source_layers:
                continue
            extent = int(layer.get("extent") or 4096)
            for raw in layer.get("features") or []:
                props = raw.get("properties") or {}
                if feature_filter and not feature_filter(props):
                    continue
                feature = _normalize_feature(raw, z, x, y, layer_name, extent)
                if not feature:
                    continue
                fid = str(feature.get("id"))
                if fid in seen:
                    continue
                seen.add(fid)
                features.append(feature)
    return features


def _cache_get(key: str) -> Optional[dict[str, Any]]:
    entry = _layer_cache["entries"].get(key)
    if not entry:
        return None
    if time.time() - entry["loaded_at"] > LAYER_CACHE_TTL_SECONDS:
        _layer_cache["entries"].pop(key, None)
        return None
    return entry["payload"]


def _cache_set(key: str, payload: dict[str, Any]) -> None:
    _layer_cache["entries"][key] = {"loaded_at": time.time(), "payload": payload}


PETROLEUM_LAYER_DEFINITIONS: dict[str, CatalogLayer] = {
    "exploration": {
        "id": "exploration",
        "label": "Exploration blocks",
        "geometry": "polygon",
        "default_visible": True,
        "attribution": "Oilmap-compatible Mapbox tileset (compiled global blocks)",
        "license_note": "Hosted on public Mapbox tilesets by oilmap.xyz; verify redistribution terms for production use.",
    },
    "production": {
        "id": "production",
        "label": "Production fields",
        "geometry": "polygon",
        "default_visible": True,
        "attribution": "Oilmap-compatible Mapbox tileset (compiled global blocks)",
        "license_note": "Hosted on public Mapbox tilesets by oilmap.xyz; verify redistribution terms for production use.",
    },
    "bid_rounds": {
        "id": "bid_rounds",
        "label": "Bid rounds",
        "geometry": "polygon",
        "default_visible": False,
        "attribution": "Oilmap-compatible Mapbox tileset",
        "license_note": "Bid/round announcements compiled in oilmap tilesets.",
    },
    "refineries": {
        "id": "refineries",
        "label": "Refineries",
        "geometry": "point",
        "default_visible": True,
        "attribution": "Oilmap-compatible Mapbox tileset",
        "license_note": "Global refinery points compiled in oilmap tilesets.",
    },
    "oil_pipelines": {
        "id": "oil_pipelines",
        "label": "Oil pipelines",
        "geometry": "line",
        "default_visible": True,
        "attribution": "Oilmap-compatible Mapbox tileset (global oil pipelines)",
        "license_note": "Line geometry includes SOURCE property with upstream reference URLs.",
    },
    "gas_pipelines": {
        "id": "gas_pipelines",
        "label": "Gas pipelines",
        "geometry": "line",
        "default_visible": True,
        "attribution": "Oilmap-compatible Mapbox tileset (natural gas pipelines)",
        "license_note": "Line geometry includes SOURCE property with upstream reference URLs.",
    },
}


def get_petroleum_layer_catalog() -> dict[str, Any]:
    if _mapbox_disabled():
        return {
            "layers": [],
            "mapbox_disabled": True,
            "data_as_of": _now_iso(),
            "source_labels": ["OpenStreetMap (use /api/petroleum/osm-layers)"],
            "limitations": [
                "PETROLEUM_DISABLE_MAPBOX=1 — Mapbox/oilmap vector layers are hidden.",
                "Use OSM petroleum layers (pipelines, refineries) via /api/petroleum/osm-layers instead.",
            ],
            "env": {
                "PETROLEUM_DISABLE_MAPBOX": "Set to 1 to hide Mapbox petroleum layers",
            },
        }
    return {
        "layers": list(PETROLEUM_LAYER_DEFINITIONS.values()),
        "mapbox_disabled": False,
        "data_as_of": _now_iso(),
        "source_labels": [
            "oilmap.xyz Mapbox tilesets (public)",
            "Global Energy Monitor (pipelines alternative)",
        ],
        "limitations": [
            "Vector tiles are fetched for the requested map viewport only (max "
            f"{MAX_TILES_PER_REQUEST} tiles per request).",
            "Exploration/production polygons are compiled global datasets (~2019) — not live government cadastre.",
            "Saudi Arabia, UAE, and other MENA coverage depend on these compiled tilesets plus license sync.",
            "Set MAPBOX_ACCESS_TOKEN to use your own Mapbox token instead of the oilmap public token.",
            "Set PETROLEUM_DISABLE_MAPBOX=1 for OSM-only petroleum map mode.",
        ],
        "env": {
            "MAPBOX_ACCESS_TOKEN": "Optional — Mapbox token for tile fetches",
            "OILMAP_MAPBOX_TOKEN": "Optional alias for MAPBOX_ACCESS_TOKEN",
            "PETROLEUM_DISABLE_MAPBOX": "Set to 1 to hide Mapbox layers (OSM-only mode)",
        },
    }


def get_petroleum_layer_geojson(
    layer_id: str,
    bbox: Optional[tuple[float, float, float, float]] = None,
    zoom: Optional[int] = None,
) -> dict[str, Any]:
    if _mapbox_disabled():
        return {
            "type": "FeatureCollection",
            "features": [],
            "layer_id": layer_id,
            "feature_count": 0,
            "data_as_of": _now_iso(),
            "mapbox_disabled": True,
            "limitations": [
                "PETROLEUM_DISABLE_MAPBOX=1 — Mapbox petroleum layers are disabled.",
                "Use GET /api/petroleum/osm-layers/{pipelines|refineries} for open OSM geometry.",
            ],
        }
    definition = PETROLEUM_LAYER_DEFINITIONS.get(layer_id)
    if not definition:
        raise KeyError(layer_id)

    normalized_bbox = _normalize_bbox(bbox)
    if normalized_bbox is None:
        normalized_bbox = (-60.0, -180.0, 75.0, 180.0)

    z = _pick_zoom(zoom, normalized_bbox)
    tiles = _tiles_for_bbox(normalized_bbox, z)
    cache_key = f"{layer_id}:{z}:{','.join(f'{a}/{b}/{c}' for a, b, c in tiles)}"
    cached = _cache_get(cache_key)
    if cached:
        return cached

    if layer_id == "exploration":
        features = _collect_from_tileset(
            _TILESET_EXPLORATION,
            (_EXPLORATION_SOURCE_LAYER,),
            tiles,
            feature_filter=_is_exploration,
        )
    elif layer_id == "production":
        features = _collect_from_tileset(
            _TILESET_EXPLORATION,
            (_EXPLORATION_SOURCE_LAYER,),
            tiles,
            feature_filter=_is_production,
        )
    elif layer_id == "bid_rounds":
        features = _collect_from_tileset(_TILESET_BIDS_A, _BIDS_SOURCE_LAYERS, tiles)
        extra = _collect_from_tileset(_TILESET_BIDS_B, _BIDS_SOURCE_LAYERS, tiles)
        seen = {str(f.get("id")) for f in features}
        for feature in extra:
            fid = str(feature.get("id"))
            if fid not in seen:
                features.append(feature)
                seen.add(fid)
    elif layer_id == "refineries":
        features = _collect_from_tileset(_TILESET_REFINERIES, (_REFINERIES_LAYER,), tiles)
    elif layer_id == "oil_pipelines":
        features = _collect_from_tileset(_TILESET_OIL_PIPELINES, (_OIL_PIPELINE_LAYER,), tiles)
    elif layer_id == "gas_pipelines":
        features = _collect_from_tileset(_TILESET_GAS_PIPELINES, (_GAS_PIPELINE_LAYER,), tiles)
    else:
        features = []

    payload = {
        "type": "FeatureCollection",
        "features": features,
        "layer_id": layer_id,
        "label": definition["label"],
        "bbox": list(normalized_bbox),
        "zoom": z,
        "tile_count": len(tiles),
        "feature_count": len(features),
        "data_as_of": _now_iso(),
        "attribution": definition.get("attribution"),
        "license_note": definition.get("license_note"),
        "limitations": [
            f"Returned {len(features)} features from {len(tiles)} vector tiles at z={z}.",
            "Pan/zoom to load more detail (higher zoom uses more tiles, capped per request).",
        ],
    }
    _cache_set(cache_key, payload)
    return payload
