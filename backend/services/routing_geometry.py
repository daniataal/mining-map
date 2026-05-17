"""External routing geometry (OSRM roads, searoute sea, great-circle air/rail).

All network calls are best-effort: failures degrade to straight-line or corridor
fallbacks without raising to the API layer.
"""

from __future__ import annotations

import math
import os
from dataclasses import dataclass, field
from typing import Any, Callable, Optional, Sequence

import requests

OSRM_BASE_URL = (os.getenv("OSRM_BASE_URL") or "https://router.project-osrm.org").rstrip("/")
OSRM_TIMEOUT_SEC = float(os.getenv("OSRM_TIMEOUT_SEC", "8"))
SEAROUTE_ENABLED = (os.getenv("SEAROUTE_ENABLED") or "1").strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
    "enabled",
}

DEFAULT_SPEED_KMH: dict[str, float] = {
    "road": 55.0,
    "rail": 45.0,
    "sea": 35.0,
    "air": 750.0,
    "pipeline": 10.0,
}


@dataclass(frozen=True)
class ResolvedGeometry:
    path: tuple[tuple[float, float], ...]
    distance_km: float
    duration_hours: float
    source: str
    notes: list[str] = field(default_factory=list)


def haversine_km(a_lat: float, a_lng: float, b_lat: float, b_lng: float) -> float:
    r_km = 6371.0
    d_lat = math.radians(b_lat - a_lat)
    d_lng = math.radians(b_lng - a_lng)
    aa = (
        math.sin(d_lat / 2) ** 2
        + math.cos(math.radians(a_lat)) * math.cos(math.radians(b_lat)) * math.sin(d_lng / 2) ** 2
    )
    return 2 * r_km * math.atan2(math.sqrt(aa), math.sqrt(1 - aa))


def path_distance_km(path: Sequence[tuple[float, float]]) -> float:
    total = 0.0
    for idx in range(len(path) - 1):
        a_lat, a_lng = path[idx]
        b_lat, b_lng = path[idx + 1]
        total += haversine_km(a_lat, a_lng, b_lat, b_lng)
    return total


def straight_line_geometry(
    a_lat: float,
    a_lng: float,
    b_lat: float,
    b_lng: float,
    *,
    method: str,
    source: str = "straight_line",
    note: Optional[str] = None,
) -> ResolvedGeometry:
    distance = haversine_km(a_lat, a_lng, b_lat, b_lng)
    speed = DEFAULT_SPEED_KMH.get(method, 50.0)
    duration = distance / speed if speed > 0 else 0.0
    notes = [note] if note else []
    return ResolvedGeometry(
        path=((a_lat, a_lng), (b_lat, b_lng)),
        distance_km=distance,
        duration_hours=duration,
        source=source,
        notes=notes,
    )


def great_circle_geometry(
    a_lat: float,
    a_lng: float,
    b_lat: float,
    b_lng: float,
    *,
    method: str,
    num_points: int = 48,
    source: str = "great_circle",
) -> ResolvedGeometry:
    points: list[tuple[float, float]] = []
    lat1, lng1, lat2, lng2 = map(math.radians, (a_lat, a_lng, b_lat, b_lng))
    delta = 2 * math.asin(
        math.sqrt(
            math.sin((lat2 - lat1) / 2) ** 2
            + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2
        )
    )
    if delta < 1e-9:
        return straight_line_geometry(a_lat, a_lng, b_lat, b_lng, method=method, source=source)

    steps = max(2, num_points)
    for step in range(steps + 1):
        f = step / steps
        a = math.sin((1 - f) * delta) / math.sin(delta)
        b = math.sin(f * delta) / math.sin(delta)
        x = a * math.cos(lat1) * math.cos(lng1) + b * math.cos(lat2) * math.cos(lng2)
        y = a * math.cos(lat1) * math.sin(lng1) + b * math.cos(lat2) * math.sin(lng2)
        z = a * math.sin(lat1) + b * math.sin(lat2)
        lat = math.degrees(math.atan2(z, math.sqrt(x * x + y * y)))
        lng = math.degrees(math.atan2(y, x))
        points.append((lat, lng))

    distance = path_distance_km(points)
    speed = DEFAULT_SPEED_KMH.get(method, 50.0)
    return ResolvedGeometry(
        path=tuple(points),
        distance_km=distance,
        duration_hours=distance / speed if speed > 0 else 0.0,
        source=source,
        notes=[],
    )


def _decode_osrm_coordinates(geojson_geometry: dict[str, Any]) -> list[tuple[float, float]]:
    coords = geojson_geometry.get("coordinates")
    if not isinstance(coords, list):
        return []
    out: list[tuple[float, float]] = []
    for item in coords:
        if not isinstance(item, (list, tuple)) or len(item) < 2:
            continue
        lng, lat = float(item[0]), float(item[1])
        out.append((lat, lng))
    return out


def fetch_osrm_route(
    a_lat: float,
    a_lng: float,
    b_lat: float,
    b_lng: float,
    *,
    method: str = "road",
    http_get: Optional[Callable[..., Any]] = None,
) -> ResolvedGeometry:
    """Query OSRM driving profile; fall back to straight line on any error."""

    fallback = straight_line_geometry(
        a_lat,
        a_lng,
        b_lat,
        b_lng,
        method=method,
        source="straight_line_fallback",
        note="OSRM unavailable; using geodesic fallback.",
    )
    url = (
        f"{OSRM_BASE_URL}/route/v1/driving/"
        f"{a_lng},{a_lat};{b_lng},{b_lat}"
        "?overview=full&geometries=geojson&steps=false"
    )
    getter = http_get or requests.get
    try:
        response = getter(url, timeout=OSRM_TIMEOUT_SEC)
        if getattr(response, "status_code", 200) != 200:
            return fallback
        payload = response.json() if hasattr(response, "json") else response
        if not isinstance(payload, dict):
            return fallback
        routes = payload.get("routes")
        if not isinstance(routes, list) or not routes:
            return fallback
        route0 = routes[0]
        geometry = route0.get("geometry") if isinstance(route0, dict) else None
        if not isinstance(geometry, dict):
            return fallback
        path = _decode_osrm_coordinates(geometry)
        if len(path) < 2:
            return fallback
        distance_m = float(route0.get("distance") or 0.0)
        duration_s = float(route0.get("duration") or 0.0)
        distance_km = distance_m / 1000.0 if distance_m > 0 else path_distance_km(path)
        duration_hours = duration_s / 3600.0 if duration_s > 0 else distance_km / DEFAULT_SPEED_KMH["road"]
        return ResolvedGeometry(
            path=tuple(path),
            distance_km=distance_km,
            duration_hours=duration_hours,
            source="osrm",
            notes=["Road geometry from OSRM driving network."],
        )
    except Exception:
        return fallback


def _searoute_linestring_coords(feature: Any) -> list[tuple[float, float]]:
    if not isinstance(feature, dict):
        return []
    geometry = feature.get("geometry")
    if not isinstance(geometry, dict):
        return []
    coords = geometry.get("coordinates")
    if not isinstance(coords, list):
        return []
    out: list[tuple[float, float]] = []
    for item in coords:
        if not isinstance(item, (list, tuple)) or len(item) < 2:
            continue
        lng, lat = float(item[0]), float(item[1])
        out.append((lat, lng))
    return out


def fetch_sea_route(
    a_lat: float,
    a_lng: float,
    b_lat: float,
    b_lng: float,
    *,
    corridor_fallback: Callable[[], list[tuple[float, float]]],
) -> ResolvedGeometry:
    """Marine route via searoute when enabled; otherwise corridor fallback."""

    fallback_path = corridor_fallback()
    if len(fallback_path) < 2:
        fallback_path = [(a_lat, a_lng), (b_lat, b_lng)]
    fallback_distance = path_distance_km(fallback_path)
    fallback = ResolvedGeometry(
        path=tuple(fallback_path),
        distance_km=fallback_distance,
        duration_hours=fallback_distance / DEFAULT_SPEED_KMH["sea"],
        source="corridor_fallback",
        notes=["Sea leg uses static offshore corridor waypoints (searoute disabled or failed)."],
    )

    if not SEAROUTE_ENABLED:
        return fallback

    try:
        import searoute as sr  # type: ignore[import-untyped]
    except ImportError:
        note = "searoute package not installed; using corridor fallback."
        return ResolvedGeometry(
            path=fallback.path,
            distance_km=fallback.distance_km,
            duration_hours=fallback.duration_hours,
            source="corridor_fallback",
            notes=[note],
        )

    try:
        # searoute expects [longitude, latitude]
        feature = sr.searoute([a_lng, a_lat], [b_lng, b_lat], units="km")
        path = _searoute_linestring_coords(feature)
        if len(path) < 2:
            return fallback
        props = feature.get("properties") if isinstance(feature, dict) else {}
        length_km = 0.0
        if isinstance(props, dict):
            length_km = float(props.get("length") or props.get("distance") or 0.0)
        distance_km = length_km if length_km > 0 else path_distance_km(path)
        return ResolvedGeometry(
            path=tuple(path),
            distance_km=distance_km,
            duration_hours=distance_km / DEFAULT_SPEED_KMH["sea"],
            source="searoute",
            notes=["Sea geometry from searoute marine network."],
        )
    except Exception:
        return fallback


def rail_hub_geometry(
    a_lat: float,
    a_lng: float,
    b_lat: float,
    b_lng: float,
    *,
    export_hub: tuple[float, float],
    import_hub: tuple[float, float],
) -> ResolvedGeometry:
    """Simplified rail: origin → export hub → import hub → destination."""

    waypoints = [(a_lat, a_lng), export_hub, import_hub, (b_lat, b_lng)]
    deduped: list[tuple[float, float]] = []
    for point in waypoints:
        if deduped and haversine_km(deduped[-1][0], deduped[-1][1], point[0], point[1]) < 5:
            continue
        deduped.append(point)
    if len(deduped) < 2:
        deduped = [(a_lat, a_lng), (b_lat, b_lng)]

    segments: list[tuple[float, float]] = []
    for idx in range(len(deduped) - 1):
        seg = great_circle_geometry(
            deduped[idx][0],
            deduped[idx][1],
            deduped[idx + 1][0],
            deduped[idx + 1][1],
            method="rail",
            num_points=12,
            source="rail_segment",
        )
        if not segments:
            segments.extend(seg.path)
        else:
            segments.extend(seg.path[1:])

    distance = path_distance_km(segments)
    return ResolvedGeometry(
        path=tuple(segments),
        distance_km=distance,
        duration_hours=distance / DEFAULT_SPEED_KMH["rail"],
        source="rail_hub",
        notes=[
            "Rail leg is a simplified hub-to-hub approximation; validate corridor slots and gauge compatibility.",
        ],
    )


def resolve_leg_geometry(
    a_lat: float,
    a_lng: float,
    b_lat: float,
    b_lng: float,
    method: str,
    *,
    corridor_fallback: Optional[Callable[[], list[tuple[float, float]]]] = None,
    rail_hubs: Optional[tuple[tuple[float, float], tuple[float, float]]] = None,
    http_get: Optional[Callable[..., Any]] = None,
) -> ResolvedGeometry:
    method = method.strip().lower()
    if method == "road":
        return fetch_osrm_route(a_lat, a_lng, b_lat, b_lng, method=method, http_get=http_get)
    if method == "air":
        return great_circle_geometry(a_lat, a_lng, b_lat, b_lng, method=method)
    if method == "sea":
        fallback = corridor_fallback or (lambda: [(a_lat, a_lng), (b_lat, b_lng)])
        return fetch_sea_route(a_lat, a_lng, b_lat, b_lng, corridor_fallback=fallback)
    if method == "rail" and rail_hubs is not None:
        export_hub, import_hub = rail_hubs
        return rail_hub_geometry(
            a_lat,
            a_lng,
            b_lat,
            b_lng,
            export_hub=export_hub,
            import_hub=import_hub,
        )
    return straight_line_geometry(a_lat, a_lng, b_lat, b_lng, method=method)
