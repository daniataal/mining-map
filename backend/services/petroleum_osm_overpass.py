"""OpenStreetMap petroleum infrastructure via Overpass (free Mapbox alternative).

Layers: pipelines (man_made=pipeline) and refineries (industrial=refinery).
Respects Overpass rate limits via tile chunking and in-memory TTL cache.
"""

from __future__ import annotations

import json
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Any, Optional
from urllib.parse import urlencode
from urllib.request import Request, urlopen

OVERPASS_TIMEOUT_SECONDS = 45
CACHE_TTL_SECONDS = 60 * 60 * 12
MAX_TILE_WORKERS = 4
USER_AGENT = "MeridianMiningMap/1.0 (petroleum-osm; +https://github.com/)"

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

OSM_LAYERS: dict[str, dict[str, Any]] = {
    "pipelines": {
        "label": "Oil/gas pipelines (OSM)",
        "geometry": "line",
        "overpass_filter": 'way["man_made"="pipeline"]',
    },
    "refineries": {
        "label": "Refineries (OSM)",
        "geometry": "point",
        "overpass_filter": 'nwr["industrial"="refinery"]',
    },
    "storage_terminals": {
        "label": "Petroleum storage terminals (OSM)",
        "geometry": "point",
        "overpass_filter": "",
    },
}

_layer_cache: dict[str, dict[str, Any]] = {}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _bbox_key(bbox: tuple[float, float, float, float]) -> str:
    return ",".join(f"{v:.4f}" for v in bbox)


def _overpass_urls() -> tuple[str, ...]:
    candidates = [
        os.getenv("OVERPASS_URL", "").strip(),
        os.getenv("STORAGE_OVERPASS_URL", "").strip(),
        "https://overpass.kumi.systems/api/interpreter",
    ]
    if os.getenv("OVERPASS_INCLUDE_DE_FALLBACK", "").strip().lower() in {"1", "true", "yes"}:
        candidates.append("https://overpass-api.de/api/interpreter")
    return tuple(dict.fromkeys(url for url in candidates if url))


def build_overpass_query(layer_id: str, bbox: tuple[float, float, float, float]) -> str:
    if layer_id == "storage_terminals":
        try:
            from backend.services.storage_terminals import build_overpass_query as build_storage_query
        except ImportError:
            from services.storage_terminals import build_overpass_query as build_storage_query
        return build_storage_query(bbox)

    meta = OSM_LAYERS[layer_id]
    south, west, north, east = bbox
    bbox_text = f"{south},{west},{north},{east}"
    filt = meta["overpass_filter"]
    return f"""
[out:json][timeout:45];
(
  {filt}({bbox_text});
);
out geom qt;
""".strip()


def fetch_overpass_elements(layer_id: str, bbox: tuple[float, float, float, float]) -> list[dict[str, Any]]:
    if layer_id == "storage_terminals":
        try:
            from backend.services.storage_terminals import fetch_overpass_elements as fetch_storage_elements
        except ImportError:
            from services.storage_terminals import fetch_overpass_elements as fetch_storage_elements
        return fetch_storage_elements(bbox)

    body = urlencode({"data": build_overpass_query(layer_id, bbox)}).encode("utf-8")
    headers = {
        "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
        "User-Agent": USER_AGENT,
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


def _element_center(element: dict[str, Any]) -> Optional[tuple[float, float]]:
    lat = element.get("lat")
    lng = element.get("lon")
    if lat is not None and lng is not None:
        return float(lat), float(lng)
    center = element.get("center") or {}
    if center.get("lat") is not None and center.get("lon") is not None:
        return float(center["lat"]), float(center["lon"])
    geometry = element.get("geometry") or []
    if geometry:
        lats = [pt["lat"] for pt in geometry if "lat" in pt]
        lngs = [pt["lon"] for pt in geometry if "lon" in pt]
        if lats and lngs:
            return sum(lats) / len(lats), sum(lngs) / len(lngs)
    return None


def _bbox_intersects(
    bbox: tuple[float, float, float, float],
    south: float,
    west: float,
    north: float,
    east: float,
) -> bool:
    bs, bw, bn, be = bbox
    return not (east < bw or west > be or north < bs or south > bn)


def _feature_in_bbox(feature: dict[str, Any], bbox: tuple[float, float, float, float]) -> bool:
    geom = feature.get("geometry") or {}
    gtype = geom.get("type")
    coords = geom.get("coordinates")
    if not coords:
        return True
    bs, bw, bn, be = bbox

    def point_ok(lng: float, lat: float) -> bool:
        return bs <= lat <= bn and bw <= lng <= be

    if gtype == "Point":
        lng, lat = coords
        return point_ok(lng, lat)
    if gtype == "LineString":
        return any(point_ok(lng, lat) for lng, lat in coords)
    return True


def _element_to_feature(layer_id: str, element: dict[str, Any]) -> Optional[dict[str, Any]]:
    tags = element.get("tags") or {}
    etype = element.get("type")
    osm_id = element.get("id")
    name = tags.get("name") or tags.get("operator") or f"OSM {etype} {osm_id}"

    if layer_id == "pipelines" and etype == "way":
        geometry = element.get("geometry") or []
        if len(geometry) < 2:
            return None
        coordinates = [[pt["lon"], pt["lat"]] for pt in geometry if "lat" in pt and "lon" in pt]
        if len(coordinates) < 2:
            return None
        geom = {"type": "LineString", "coordinates": coordinates}
    elif layer_id in {"refineries", "storage_terminals"}:
        center = _element_center(element)
        if not center:
            return None
        lat, lng = center
        geom = {"type": "Point", "coordinates": [lng, lat]}
    else:
        return None

    return {
        "type": "Feature",
        "id": f"osm/{etype}/{osm_id}",
        "geometry": geom,
        "properties": {
            "name": name,
            "layer_id": layer_id,
            "osm_type": etype,
            "osm_id": osm_id,
            "substance": tags.get("substance"),
            "operator": tags.get("operator"),
            "industrial": tags.get("industrial"),
            "man_made": tags.get("man_made"),
            "source": "openstreetmap",
            "attribution": "© OpenStreetMap contributors (ODbL)",
        },
    }


def _dedupe_features(features: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for feat in features:
        fid = str(feat.get("id") or "")
        if fid in seen:
            continue
        seen.add(fid)
        out.append(feat)
    return out


def _tiles_for_bbox(bbox: tuple[float, float, float, float]) -> list[tuple[str, tuple[float, float, float, float]]]:
    south, west, north, east = bbox
    span_lat = north - south
    span_lng = east - west
    if span_lat > 40 or span_lng > 60:
        return [
            (name, tile_bbox)
            for name, tile_bbox in WORLD_TILES
            if _bbox_intersects(bbox, *tile_bbox)
        ]
    return [("viewport", bbox)]


def get_osm_layer_catalog() -> dict[str, Any]:
    layers = [
        {
            "id": layer_id,
            "label": meta["label"],
            "geometry": meta["geometry"],
            "default_visible": False,
            "attribution": "© OpenStreetMap contributors",
            "license_note": "ODbL — community-mapped; not official cadastre.",
        }
        for layer_id, meta in OSM_LAYERS.items()
    ]
    return {
        "layers": layers,
        "data_as_of": _now_iso(),
        "source_labels": ["OpenStreetMap", "Overpass API"],
        "limitations": [
            "Community-mapped OSM data; coverage and accuracy vary by region.",
            "Respect Overpass rate limits — large views are tile-chunked and cached.",
            "Does not replace Mapbox oilmap layers; opt-in only.",
        ],
    }


def get_osm_layer_geojson(
    layer_id: str,
    *,
    bbox: Optional[tuple[float, float, float, float]] = None,
) -> dict[str, Any]:
    if layer_id not in OSM_LAYERS:
        raise KeyError(layer_id)

    if bbox is None:
        bbox = (-55.0, -180.0, 84.0, 180.0)

    cache_key = f"{layer_id}:{_bbox_key(bbox)}"
    cached = _layer_cache.get(cache_key)
    if cached and (time.time() - float(cached.get("loaded_at") or 0)) < CACHE_TTL_SECONDS:
        return dict(cached["response"])

    warnings: list[str] = []
    features: list[dict[str, Any]] = []
    tiles = _tiles_for_bbox(bbox)

    with ThreadPoolExecutor(max_workers=min(MAX_TILE_WORKERS, len(tiles) or 1)) as executor:
        futures = {
            executor.submit(fetch_overpass_elements, layer_id, tile_bbox): tile_name
            for tile_name, tile_bbox in tiles
        }
        for future in as_completed(futures):
            tile_name = futures[future]
            try:
                elements = future.result()
                for element in elements:
                    feat = _element_to_feature(layer_id, element)
                    if feat and _feature_in_bbox(feat, bbox):
                        features.append(feat)
            except Exception as exc:
                warnings.append(f"{tile_name}: {exc}")

    features = _dedupe_features(features)
    meta = OSM_LAYERS[layer_id]
    response = {
        "type": "FeatureCollection",
        "features": features,
        "layer_id": layer_id,
        "label": meta["label"],
        "bbox": list(bbox),
        "feature_count": len(features),
        "tile_count": len(tiles),
        "data_as_of": _now_iso(),
        "attribution": "© OpenStreetMap contributors (ODbL)",
        "license_note": "Community OSM — not official government cadastre.",
        "limitations": get_osm_layer_catalog()["limitations"] + warnings,
        "cached": False,
    }

    _layer_cache[cache_key] = {"loaded_at": time.time(), "response": response}
    return response
