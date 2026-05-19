"""OpenStreetMap railway corridors via Overpass (free, ODbL).

Fetches ``railway=rail|light_rail`` ways between two hubs for route planning.
Results are cached in memory with TTL, similar to petroleum OSM layers.
"""

from __future__ import annotations

import json
import math
import os
import time
from typing import Any, Callable, Optional
from urllib.parse import urlencode
from urllib.request import Request, urlopen

OVERPASS_URL = os.getenv("RAIL_OVERPASS_URL", "https://overpass-api.de/api/interpreter")
OVERPASS_TIMEOUT_SEC = float(os.getenv("RAIL_OVERPASS_TIMEOUT_SEC", "45"))
CACHE_TTL_SECONDS = int(os.getenv("RAIL_OSM_CACHE_TTL_SEC", str(60 * 60 * 12)))
MAX_CHUNK_KM = float(os.getenv("RAIL_OVERPASS_MAX_CHUNK_KM", "650"))
USER_AGENT = "MeridianMiningMap/1.0 (rail-routing; +https://github.com/)"

_rail_cache: dict[str, dict[str, Any]] = {}


def _cache_get(key: str) -> Optional[list[tuple[float, float]]]:
    entry = _rail_cache.get(key)
    if not entry:
        return None
    if time.monotonic() - float(entry.get("stored_at", 0)) > CACHE_TTL_SECONDS:
        _rail_cache.pop(key, None)
        return None
    path = entry.get("path")
    if isinstance(path, list) and path:
        return [(float(p[0]), float(p[1])) for p in path]
    return None


def _cache_put(key: str, path: list[tuple[float, float]]) -> None:
    _rail_cache[key] = {"stored_at": time.monotonic(), "path": path}


def _haversine_km(a_lat: float, a_lng: float, b_lat: float, b_lng: float) -> float:
    r_km = 6371.0
    d_lat = math.radians(b_lat - a_lat)
    d_lng = math.radians(b_lng - a_lng)
    aa = (
        math.sin(d_lat / 2) ** 2
        + math.cos(math.radians(a_lat)) * math.cos(math.radians(b_lat)) * math.sin(d_lng / 2) ** 2
    )
    return 2 * r_km * math.atan2(math.sqrt(aa), math.sqrt(1 - aa))


def _bbox_for_segment(
    a_lat: float,
    a_lng: float,
    b_lat: float,
    b_lng: float,
    *,
    pad_deg: float = 0.35,
) -> tuple[float, float, float, float]:
    south = min(a_lat, b_lat) - pad_deg
    north = max(a_lat, b_lat) + pad_deg
    west = min(a_lng, b_lng) - pad_deg
    east = max(a_lng, b_lng) + pad_deg
    return south, west, north, east


def _cache_key(a_lat: float, a_lng: float, b_lat: float, b_lng: float) -> str:
    return "|".join(f"{round(v, 3)}" for v in (a_lat, a_lng, b_lat, b_lng))


def build_rail_overpass_query(bbox: tuple[float, float, float, float]) -> str:
    south, west, north, east = bbox
    bbox_text = f"{south},{west},{north},{east}"
    return f"""
[out:json][timeout:45];
(
  way["railway"~"^(rail|light_rail)$"]({bbox_text});
);
out geom qt;
""".strip()


def fetch_overpass_rail_ways(
    bbox: tuple[float, float, float, float],
    *,
    http_opener: Optional[Callable[..., Any]] = None,
) -> list[dict[str, Any]]:
    body = urlencode({"data": build_rail_overpass_query(bbox)}).encode("utf-8")
    req = Request(
        OVERPASS_URL,
        data=body,
        headers={
            "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
            "User-Agent": USER_AGENT,
        },
    )
    opener = http_opener or urlopen
    with opener(req, timeout=OVERPASS_TIMEOUT_SEC) as response:
        payload = json.load(response)
    if not isinstance(payload, dict):
        return []
    elements = payload.get("elements")
    return elements if isinstance(elements, list) else []


def _way_polyline(way: dict[str, Any]) -> list[tuple[float, float]]:
    geometry = way.get("geometry")
    if not isinstance(geometry, list):
        return []
    points: list[tuple[float, float]] = []
    for node in geometry:
        if not isinstance(node, dict):
            continue
        lat = node.get("lat")
        lng = node.get("lon")
        if lat is None or lng is None:
            continue
        points.append((float(lat), float(lng)))
    return points


def _path_distance_km(path: list[tuple[float, float]]) -> float:
    total = 0.0
    for idx in range(len(path) - 1):
        a_lat, a_lng = path[idx]
        b_lat, b_lng = path[idx + 1]
        total += _haversine_km(a_lat, a_lng, b_lat, b_lng)
    return total


def _nearest_index(path: list[tuple[float, float]], lat: float, lng: float) -> int:
    best_idx = 0
    best_km = float("inf")
    for idx, (p_lat, p_lng) in enumerate(path):
        km = _haversine_km(lat, lng, p_lat, p_lng)
        if km < best_km:
            best_km = km
            best_idx = idx
    return best_idx


def _chain_way_polylines(
    ways: list[list[tuple[float, float]]],
    a_lat: float,
    a_lng: float,
    b_lat: float,
    b_lng: float,
) -> list[tuple[float, float]]:
    if not ways:
        return []
    remaining = [list(poly) for poly in ways if len(poly) >= 2]
    if not remaining:
        return []

    def endpoint_dist(poly: list[tuple[float, float]], reverse: bool) -> float:
        lat, lng = poly[-1] if reverse else poly[0]
        return _haversine_km(a_lat, a_lng, lat, lng)

    start_poly = min(
        remaining,
        key=lambda poly: min(endpoint_dist(poly, False), endpoint_dist(poly, True)),
    )
    remaining.remove(start_poly)
    if endpoint_dist(start_poly, False) <= endpoint_dist(start_poly, True):
        merged = list(start_poly)
    else:
        merged = list(reversed(start_poly))

    while remaining:
        tail_lat, tail_lng = merged[-1]
        best_idx = -1
        best_reverse = False
        best_km = float("inf")
        for idx, poly in enumerate(remaining):
            for reverse in (False, True):
                head_lat, head_lng = poly[-1] if reverse else poly[0]
                km = _haversine_km(tail_lat, tail_lng, head_lat, head_lng)
                if km < best_km:
                    best_km = km
                    best_idx = idx
                    best_reverse = reverse
        if best_idx < 0 or best_km > 120:
            break
        poly = remaining.pop(best_idx)
        segment = list(reversed(poly)) if best_reverse else list(poly)
        if _haversine_km(merged[-1][0], merged[-1][1], segment[0][0], segment[0][1]) > 0.5:
            merged.extend(segment)
        else:
            merged.extend(segment[1:])

    start_idx = _nearest_index(merged, a_lat, a_lng)
    end_idx = _nearest_index(merged, b_lat, b_lng)
    if start_idx <= end_idx:
        trimmed = merged[start_idx : end_idx + 1]
    else:
        trimmed = list(reversed(merged[end_idx : start_idx + 1]))
    if len(trimmed) < 2:
        return merged
    return trimmed


def _elements_to_path(
    elements: list[dict[str, Any]],
    a_lat: float,
    a_lng: float,
    b_lat: float,
    b_lng: float,
) -> list[tuple[float, float]]:
    ways = [_way_polyline(element) for element in elements if element.get("type") == "way"]
    ways = [poly for poly in ways if len(poly) >= 2]
    return _chain_way_polylines(ways, a_lat, a_lng, b_lat, b_lng)


def fetch_rail_corridor_geometry(
    a_lat: float,
    a_lng: float,
    b_lat: float,
    b_lng: float,
    *,
    http_opener: Optional[Callable[..., Any]] = None,
    use_cache: bool = True,
) -> Optional[list[tuple[float, float]]]:
    """Return an ordered (lat, lng) path along OSM railways, or None if empty."""

    key = _cache_key(a_lat, a_lng, b_lat, b_lng)
    if use_cache:
        cached = _cache_get(key)
        if cached:
            return cached

    distance_km = _haversine_km(a_lat, a_lng, b_lat, b_lng)
    if distance_km < 5:
        return None

    chunk_paths: list[tuple[float, float]] = []
    if distance_km <= MAX_CHUNK_KM:
        bboxes = [_bbox_for_segment(a_lat, a_lng, b_lat, b_lng)]
    else:
        steps = max(2, int(math.ceil(distance_km / MAX_CHUNK_KM)))
        bboxes = []
        for step in range(steps):
            f0 = step / steps
            f1 = (step + 1) / steps
            c0_lat = a_lat + (b_lat - a_lat) * f0
            c0_lng = a_lng + (b_lng - a_lng) * f0
            c1_lat = a_lat + (b_lat - a_lat) * f1
            c1_lng = a_lng + (b_lng - a_lng) * f1
            bboxes.append(_bbox_for_segment(c0_lat, c0_lng, c1_lat, c1_lng, pad_deg=0.45))

    merged: list[tuple[float, float]] = []
    for bbox in bboxes:
        try:
            elements = fetch_overpass_rail_ways(bbox, http_opener=http_opener)
        except Exception:
            continue
        segment = _elements_to_path(elements, a_lat, a_lng, b_lat, b_lng)
        if len(segment) < 2:
            continue
        if not merged:
            merged.extend(segment)
        else:
            if _haversine_km(merged[-1][0], merged[-1][1], segment[0][0], segment[0][1]) > 0.5:
                merged.extend(segment)
            else:
                merged.extend(segment[1:])

    if len(merged) < 2:
        return None

    if _path_distance_km(merged) < distance_km * 0.25:
        return None

    if use_cache:
        _cache_put(key, merged)
    return merged


def rail_cache_stats() -> dict[str, int]:
    return {"entries": len(_rail_cache), "ttl_seconds": CACHE_TTL_SECONDS}
