"""External routing geometry (OSRM roads, searoute sea, great-circle air/rail).

All network calls are best-effort: failures degrade to straight-line or corridor
fallbacks without raising to the API layer.
"""

from __future__ import annotations

import math
import os
import time
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Any, Callable, Optional, Protocol, Sequence

import requests

try:
    from backend.services.rail_osm_overpass import fetch_rail_corridor_geometry
except ImportError:
    from services.rail_osm_overpass import fetch_rail_corridor_geometry  # type: ignore[no-redef]

OSRM_BASE_URL = (os.getenv("OSRM_BASE_URL") or "https://router.project-osrm.org").rstrip("/")
OSRM_TIMEOUT_SEC = float(os.getenv("OSRM_TIMEOUT_SEC", "8"))
SEAROUTE_TIMEOUT_SEC = float(os.getenv("SEAROUTE_TIMEOUT_SEC", "15"))
# Skip OSRM when less than this many seconds remain on the plan deadline.
OSRM_DEADLINE_BUFFER_SEC = float(os.getenv("OSRM_DEADLINE_BUFFER_SEC", "1.5"))
SEAROUTE_DEADLINE_BUFFER_SEC = float(os.getenv("SEAROUTE_DEADLINE_BUFFER_SEC", "2.0"))
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


def _remaining_deadline_seconds(deadline: Optional[float]) -> Optional[float]:
    if deadline is None:
        return None
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        return 0.0
    return remaining


def _effective_http_timeout(default_sec: float, deadline: Optional[float]) -> float:
    remaining = _remaining_deadline_seconds(deadline)
    if remaining is None:
        return default_sec
    if remaining <= 0:
        return 0.25
    return max(0.25, min(default_sec, remaining))


def _osrm_cache_key(a_lat: float, a_lng: float, b_lat: float, b_lng: float) -> tuple[float, float, float, float]:
    return (round(a_lat, 3), round(a_lng, 3), round(b_lat, 3), round(b_lng, 3))


@lru_cache(maxsize=256)
def _cached_osrm_route_key(key: tuple[float, float, float, float]) -> str:
    return "|".join(str(v) for v in key)


_osrm_geometry_cache: dict[str, ResolvedGeometry] = {}
_osrm_geometry_cache_max: int = int(os.getenv("OSRM_GEOMETRY_CACHE_MAX", "256"))


def configure_osrm_geometry_cache(*, max_entries: int) -> None:
    """Resize the in-memory OSRM geometry LRU (route-service sets a large cap at startup)."""
    global _osrm_geometry_cache_max
    _osrm_geometry_cache_max = max(64, int(max_entries))


def osrm_cache_stats() -> dict[str, int]:
    return {
        "entries": len(_osrm_geometry_cache),
        "max_entries": _osrm_geometry_cache_max,
    }


def _store_osrm_geometry_cache(key_str: str, resolved: ResolvedGeometry) -> None:
    while len(_osrm_geometry_cache) >= _osrm_geometry_cache_max and _osrm_geometry_cache:
        try:
            _osrm_geometry_cache.pop(next(iter(_osrm_geometry_cache)))
        except StopIteration:
            break
    _osrm_geometry_cache[key_str] = resolved


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
    deadline: Optional[float] = None,
    use_cache: bool = True,
) -> ResolvedGeometry:
    """Query OSRM driving profile; fall back to straight line on any error."""

    cache_key = _osrm_cache_key(a_lat, a_lng, b_lat, b_lng)
    if use_cache:
        cached = _osrm_geometry_cache.get(_cached_osrm_route_key(cache_key))
        if cached is not None:
            return cached

    remaining = _remaining_deadline_seconds(deadline)
    if remaining is not None and remaining < OSRM_DEADLINE_BUFFER_SEC:
        return straight_line_geometry(
            a_lat,
            a_lng,
            b_lat,
            b_lng,
            method=method,
            source="straight_line_fallback",
            note="OSRM skipped: route plan deadline nearly exceeded.",
        )

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
        response = getter(url, timeout=_effective_http_timeout(OSRM_TIMEOUT_SEC, deadline))
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
        resolved = ResolvedGeometry(
            path=tuple(path),
            distance_km=distance_km,
            duration_hours=duration_hours,
            source="osrm",
            notes=["Road geometry from OSRM driving network."],
        )
        if use_cache and resolved.source == "osrm":
            _store_osrm_geometry_cache(_cached_osrm_route_key(cache_key), resolved)
        return resolved
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


GIBRALTAR_ATLANTIC_GUARD: tuple[tuple[float, float], ...] = (
    (35.0, -7.8),
    (35.8, -6.4),
)


def _segment_needs_gibraltar_guard(a: tuple[float, float], b: tuple[float, float]) -> bool:
    """Catch coarse Atlantic -> Strait segments that clip northern Morocco."""

    a_lat, a_lng = a
    b_lat, b_lng = b
    min_lat, max_lat = sorted((a_lat, b_lat))
    min_lng, max_lng = sorted((a_lng, b_lng))
    if min_lat < 33.0 or max_lat > 36.3 or min_lng < -8.8 or max_lng > -5.0:
        return False
    southwest = (a_lat <= 35.2 and a_lng <= -6.5) or (b_lat <= 35.2 and b_lng <= -6.5)
    strait = (a_lat >= 35.6 and a_lng >= -6.2) or (b_lat >= 35.6 and b_lng >= -6.2)
    return southwest and strait


def _merge_paths(segments: list[tuple[float, float]]) -> list[tuple[float, float]]:
    if not segments:
        return []
    merged: list[tuple[float, float]] = [segments[0]]
    for lat, lng in segments[1:]:
        if haversine_km(merged[-1][0], merged[-1][1], lat, lng) < 0.5:
            continue
        merged.append((lat, lng))
    return merged


def _offshore_sea_endpoints(
    a_lat: float,
    a_lng: float,
    b_lat: float,
    b_lng: float,
    corridor_path: Sequence[tuple[float, float]],
) -> tuple[tuple[float, float], tuple[float, float], bool]:
    """Pick open-water endpoints from a corridor when port coords sit on land."""

    if len(corridor_path) < 3:
        return (a_lat, a_lng), (b_lat, b_lng), False
    sea_origin = corridor_path[1]
    sea_dest = corridor_path[-2]
    used = (
        haversine_km(a_lat, a_lng, sea_origin[0], sea_origin[1]) > 8
        or haversine_km(b_lat, b_lng, sea_dest[0], sea_dest[1]) > 8
    )
    return sea_origin, sea_dest, used


def repair_known_sea_chokepoints(
    path: Sequence[tuple[float, float]],
) -> tuple[list[tuple[float, float]], bool]:
    """Insert guard waypoints for known places where coarse marine edges cross land."""

    if len(path) < 2:
        return list(path), False
    repaired: list[tuple[float, float]] = [path[0]]
    changed = False
    for point in path[1:]:
        previous = repaired[-1]
        if _segment_needs_gibraltar_guard(previous, point):
            for guard in GIBRALTAR_ATLANTIC_GUARD:
                if haversine_km(repaired[-1][0], repaired[-1][1], guard[0], guard[1]) > 8:
                    repaired.append(guard)
                    changed = True
        repaired.append(point)
    return repaired, changed


def fetch_sea_route(
    a_lat: float,
    a_lng: float,
    b_lat: float,
    b_lng: float,
    *,
    corridor_fallback: Callable[[], list[tuple[float, float]]],
    deadline: Optional[float] = None,
) -> ResolvedGeometry:
    """Marine route via searoute when enabled; otherwise corridor fallback."""

    fallback_path, fallback_repaired = repair_known_sea_chokepoints(corridor_fallback())
    if len(fallback_path) < 2:
        fallback_path = [(a_lat, a_lng), (b_lat, b_lng)]
    fallback_distance = path_distance_km(fallback_path)
    fallback_notes = ["Sea leg uses static offshore corridor waypoints (searoute disabled or failed)."]
    if fallback_repaired:
        fallback_notes.append("Gibraltar guard waypoints added to avoid clipping northern Morocco.")
    fallback = ResolvedGeometry(
        path=tuple(fallback_path),
        distance_km=fallback_distance,
        duration_hours=fallback_distance / DEFAULT_SPEED_KMH["sea"],
        source="corridor_fallback",
        notes=fallback_notes,
    )

    remaining = _remaining_deadline_seconds(deadline)
    if remaining is not None and remaining < SEAROUTE_DEADLINE_BUFFER_SEC:
        return ResolvedGeometry(
            path=fallback.path,
            distance_km=fallback.distance_km,
            duration_hours=fallback.duration_hours,
            source="corridor_fallback",
            notes=[*fallback.notes, "Searoute skipped: route plan deadline nearly exceeded."],
        )

    if not SEAROUTE_ENABLED:
        return fallback

    sea_origin, sea_dest, used_offshore = _offshore_sea_endpoints(
        a_lat, a_lng, b_lat, b_lng, fallback_path
    )
    offshore_notes: list[str] = []
    if used_offshore:
        offshore_notes.append(
            "Port coordinates on land; searoute trunk anchored via offshore corridor waypoints."
        )

    try:
        import searoute as sr  # type: ignore[import-untyped]
    except ImportError:
        note = "searoute package not installed; using corridor fallback."
        return ResolvedGeometry(
            path=fallback.path,
            distance_km=fallback.distance_km,
            duration_hours=fallback.duration_hours,
            source="corridor_fallback",
            notes=[note, *offshore_notes],
        )

    try:
        searoute_started = time.monotonic()
        # searoute expects [longitude, latitude]
        o_lat, o_lng = sea_origin
        d_lat, d_lng = sea_dest
        feature = sr.searoute([o_lng, o_lat], [d_lng, d_lat], units="km")
        if time.monotonic() - searoute_started > SEAROUTE_TIMEOUT_SEC:
            return ResolvedGeometry(
                path=fallback.path,
                distance_km=fallback.distance_km,
                duration_hours=fallback.duration_hours,
                source="corridor_fallback",
                notes=[*fallback.notes, "Searoute exceeded time budget; using corridor fallback."],
            )
        trunk = _searoute_linestring_coords(feature)
        if len(trunk) < 2:
            return fallback
        trunk, trunk_repaired = repair_known_sea_chokepoints(trunk)

        approach = great_circle_geometry(
            a_lat, a_lng, o_lat, o_lng, method="sea", num_points=8, source="offshore_connector"
        )
        departure = great_circle_geometry(
            d_lat, d_lng, b_lat, b_lng, method="sea", num_points=8, source="offshore_connector"
        )
        path = _merge_paths([*approach.path, *trunk[1:], *departure.path[1:]])
        path, repaired = repair_known_sea_chokepoints(path)
        repaired = repaired or trunk_repaired

        props = feature.get("properties") if isinstance(feature, dict) else {}
        length_km = 0.0
        if isinstance(props, dict):
            length_km = float(props.get("length") or props.get("distance") or 0.0)
        distance_km = path_distance_km(path) if repaired or used_offshore else (
            length_km if length_km > 0 else path_distance_km(path)
        )
        notes = ["Sea geometry from searoute marine network.", *offshore_notes]
        if repaired:
            notes.append("Gibraltar guard waypoints added to avoid clipping northern Morocco.")
        return ResolvedGeometry(
            path=tuple(path),
            distance_km=distance_km,
            duration_hours=distance_km / DEFAULT_SPEED_KMH["sea"],
            source="searoute",
            notes=notes,
        )
    except Exception:
        return fallback


# lat_min, lat_max, lng_min, lng_max — open water where rail geodesics must not run.
OPEN_WATER_BOXES: tuple[tuple[float, float, float, float], ...] = (
    (-12.0, 8.0, -18.0, 18.0),  # Gulf of Guinea & tropical Atlantic
    (-25.0, -5.0, -25.0, 5.0),  # South Atlantic mid-ocean
    (15.0, 45.0, -55.0, -20.0),  # North Atlantic mid-ocean
)

RAIL_MAX_CORRIDOR_KM = 2200.0
RAIL_SHORT_SEGMENT_KM = 80.0


def _point_in_open_water(lat: float, lng: float) -> bool:
    for lat_min, lat_max, lng_min, lng_max in OPEN_WATER_BOXES:
        if lat_min <= lat <= lat_max and lng_min <= lng <= lng_max:
            return True
    return False


def _region_bucket(lat: float, lng: float) -> str:
    if 35.0 <= lat <= 72.0 and -12.0 <= lng <= 35.0:
        return "europe"
    if -38.0 <= lat <= 38.0 and -20.0 <= lng <= 55.0:
        return "africa"
    return "other"


def segment_likely_crosses_ocean(
    a_lat: float,
    a_lng: float,
    b_lat: float,
    b_lng: float,
    *,
    samples: int = 7,
) -> bool:
    """Heuristic: sample points along the geodesic and flag mid-segment open water."""
    distance_km = haversine_km(a_lat, a_lng, b_lat, b_lng)
    if distance_km < RAIL_SHORT_SEGMENT_KM:
        return False
    steps = max(2, samples)
    for step in range(1, steps):
        f = step / steps
        lat = a_lat + (b_lat - a_lat) * f
        lng = a_lng + (b_lng - a_lng) * f
        if not _point_in_open_water(lat, lng):
            continue
        if (
            haversine_km(a_lat, a_lng, lat, lng) > 40
            and haversine_km(lat, lng, b_lat, b_lng) > 40
        ):
            return True
    return False


def rail_corridor_viable(
    export_hub_lat: float,
    export_hub_lng: float,
    export_hub_country: str,
    import_hub_lat: float,
    import_hub_lng: float,
    import_hub_country: str,
    *,
    origin_country: str = "",
    dest_country: str = "",
) -> tuple[bool, list[str]]:
    """Return whether a hub-to-hub rail corridor is plausible on land."""
    notes: list[str] = []
    corridor_km = haversine_km(export_hub_lat, export_hub_lng, import_hub_lat, import_hub_lng)
    if corridor_km > RAIL_MAX_CORRIDOR_KM:
        notes.append(
            f"Rail corridor {corridor_km:.0f} km between hubs exceeds "
            f"{RAIL_MAX_CORRIDOR_KM:.0f} km screening limit."
        )
        return False, notes

    export_region = _region_bucket(export_hub_lat, export_hub_lng)
    import_region = _region_bucket(import_hub_lat, import_hub_lng)
    if export_region != import_region and {export_region, import_region} <= {"europe", "africa"}:
        notes.append(
            "Intercontinental rail corridor rejected (Africa↔Europe requires sea or road intermodal)."
        )
        return False, notes

    if segment_likely_crosses_ocean(
        export_hub_lat, export_hub_lng, import_hub_lat, import_hub_lng
    ):
        notes.append("Rail hub pair would cross open ocean; corridor rejected.")
        return False, notes

    origin_key = normalize_country_key(origin_country)
    dest_key = normalize_country_key(dest_country)
    export_key = normalize_country_key(export_hub_country)
    import_key = normalize_country_key(import_hub_country)
    if origin_key and export_key and origin_key != export_key:
        notes.append(
            f"Export rail hub is in {export_hub_country.strip()} but origin is {origin_country.strip()}; "
            "no same-country rail gateway in catalog."
        )
        return False, notes
    if dest_key and import_key and dest_key != import_key:
        notes.append(
            f"Import rail hub is in {import_hub_country.strip()} but destination is {dest_country.strip()}; "
            "no same-country rail gateway in catalog."
        )
        return False, notes

    return True, notes


def _rail_trunk_geometry(
    seg_a: tuple[float, float],
    seg_b: tuple[float, float],
    *,
    http_get: Optional[Callable[..., Any]] = None,
    deadline: Optional[float] = None,
) -> tuple[ResolvedGeometry, bool]:
    """Hub-to-hub rail trunk: OSM tracks when available, else OSRM driving approximation."""

    a_lat, a_lng = seg_a
    b_lat, b_lng = seg_b
    seg_km = haversine_km(a_lat, a_lng, b_lat, b_lng)
    if segment_likely_crosses_ocean(a_lat, a_lng, b_lat, b_lng):
        raise ValueError("rail trunk crosses open water")

    osm_path = fetch_rail_corridor_geometry(a_lat, a_lng, b_lat, b_lng)
    if osm_path and len(osm_path) >= 2:
        distance = path_distance_km(osm_path)
        return (
            ResolvedGeometry(
                path=tuple(osm_path),
                distance_km=distance,
                duration_hours=distance / DEFAULT_SPEED_KMH["rail"],
                source="rail_osm",
                notes=["Rail trunk geometry from OpenStreetMap railway ways."],
            ),
            True,
        )

    seg = fetch_osrm_route(
        a_lat,
        a_lng,
        b_lat,
        b_lng,
        method="rail",
        http_get=http_get,
        deadline=deadline,
    )
    if seg.source == "straight_line_fallback" and segment_likely_crosses_ocean(
        a_lat, a_lng, b_lat, b_lng
    ):
        raise ValueError("rail trunk OSRM fallback crosses open water")
    return (
        ResolvedGeometry(
            path=seg.path,
            distance_km=seg.distance_km,
            duration_hours=seg.duration_hours,
            source="rail_approximation_road",
            notes=[
                "No OSM rail corridor in bbox; hub trunk uses OSRM driving (rail_approximation_road).",
                *seg.notes,
            ],
        ),
        False,
    )


def rail_hub_geometry(
    a_lat: float,
    a_lng: float,
    b_lat: float,
    b_lng: float,
    *,
    export_hub: tuple[float, float],
    import_hub: tuple[float, float],
    export_hub_country: str = "",
    import_hub_country: str = "",
    origin_country: str = "",
    dest_country: str = "",
    http_get: Optional[Callable[..., Any]] = None,
    deadline: Optional[float] = None,
) -> Optional[ResolvedGeometry]:
    """Rail: origin → export hub → import hub → destination using OSRM on land segments."""

    viable, viability_notes = rail_corridor_viable(
        export_hub[0],
        export_hub[1],
        export_hub_country,
        import_hub[0],
        import_hub[1],
        import_hub_country,
        origin_country=origin_country,
        dest_country=dest_country,
    )
    if not viable:
        return None

    waypoints = [(a_lat, a_lng), export_hub, import_hub, (b_lat, b_lng)]
    deduped: list[tuple[float, float]] = []
    for point in waypoints:
        if deduped and haversine_km(deduped[-1][0], deduped[-1][1], point[0], point[1]) < 5:
            continue
        deduped.append(point)
    if len(deduped) < 2:
        deduped = [(a_lat, a_lng), (b_lat, b_lng)]

    segments: list[tuple[float, float]] = []
    notes = [
        "Rail leg uses OSM track geometry between hubs when mapped; otherwise OSRM driving approximation.",
        *viability_notes,
    ]
    used_osm = False
    used_road_approx = False
    export_tuple = export_hub
    import_tuple = import_hub

    for idx in range(len(deduped) - 1):
        seg_a = deduped[idx]
        seg_b = deduped[idx + 1]
        seg_km = haversine_km(seg_a[0], seg_a[1], seg_b[0], seg_b[1])
        if seg_km < 1.0:
            continue
        is_hub_trunk = {seg_a, seg_b} == {export_tuple, import_tuple}
        if seg_km <= RAIL_SHORT_SEGMENT_KM:
            if segment_likely_crosses_ocean(seg_a[0], seg_a[1], seg_b[0], seg_b[1]):
                return None
            seg = straight_line_geometry(
                seg_a[0],
                seg_a[1],
                seg_b[0],
                seg_b[1],
                method="rail",
                source="rail_short_haul",
            )
        elif is_hub_trunk and seg_km > RAIL_SHORT_SEGMENT_KM:
            try:
                seg, osm_used = _rail_trunk_geometry(
                    seg_a, seg_b, http_get=http_get, deadline=deadline
                )
            except ValueError:
                return None
            used_osm = used_osm or osm_used
            used_road_approx = used_road_approx or seg.source == "rail_approximation_road"
        else:
            seg = fetch_osrm_route(
                seg_a[0],
                seg_a[1],
                seg_b[0],
                seg_b[1],
                method="rail",
                http_get=http_get,
                deadline=deadline,
            )
            if seg.source == "straight_line_fallback" and segment_likely_crosses_ocean(
                seg_a[0], seg_a[1], seg_b[0], seg_b[1]
            ):
                return None
        if not segments:
            segments.extend(seg.path)
        else:
            segments.extend(seg.path[1:])

    if len(segments) < 2:
        return None

    distance = path_distance_km(segments)
    if used_osm:
        source = "rail_osm"
    elif used_road_approx:
        source = "rail_approximation_road"
    else:
        source = "rail_hub"
    return ResolvedGeometry(
        path=tuple(segments),
        distance_km=distance,
        duration_hours=distance / DEFAULT_SPEED_KMH["rail"],
        source=source,
        notes=notes,
    )


RailHubSelection = dict[str, Any]


def resolve_leg_geometry(
    a_lat: float,
    a_lng: float,
    b_lat: float,
    b_lng: float,
    method: str,
    *,
    corridor_fallback: Optional[Callable[[], list[tuple[float, float]]]] = None,
    rail_hubs: Optional[RailHubSelection] = None,
    http_get: Optional[Callable[..., Any]] = None,
    deadline: Optional[float] = None,
) -> ResolvedGeometry:
    method = method.strip().lower()
    if method == "road":
        return fetch_osrm_route(
            a_lat,
            a_lng,
            b_lat,
            b_lng,
            method=method,
            http_get=http_get,
            deadline=deadline,
        )
    if method == "air":
        return great_circle_geometry(
            a_lat,
            a_lng,
            b_lat,
            b_lng,
            method=method,
            source="air_great_circle_trunk",
        )
    if method == "sea":
        fallback = corridor_fallback or (lambda: [(a_lat, a_lng), (b_lat, b_lng)])
        return fetch_sea_route(
            a_lat,
            a_lng,
            b_lat,
            b_lng,
            corridor_fallback=fallback,
            deadline=deadline,
        )
    if method == "rail" and rail_hubs is not None:
        export_hub = rail_hubs["export"]
        import_hub = rail_hubs["import"]
        resolved = rail_hub_geometry(
            a_lat,
            a_lng,
            b_lat,
            b_lng,
            export_hub=export_hub,
            import_hub=import_hub,
            export_hub_country=str(rail_hubs.get("export_country") or ""),
            import_hub_country=str(rail_hubs.get("import_country") or ""),
            origin_country=str(rail_hubs.get("origin_country") or ""),
            dest_country=str(rail_hubs.get("dest_country") or ""),
            http_get=http_get,
            deadline=deadline,
        )
        if resolved is not None:
            return resolved
        return straight_line_geometry(
            a_lat,
            a_lng,
            b_lat,
            b_lng,
            method="road",
            source="rail_rejected",
            note="Rail corridor unavailable; caller should prefer road geometry.",
        )
    return straight_line_geometry(a_lat, a_lng, b_lat, b_lng, method=method)


# Countries with no direct sea access (screening list; not exhaustive).
LANDLOCKED_COUNTRIES: frozenset[str] = frozenset(
    {
        "afghanistan",
        "armenia",
        "austria",
        "azerbaijan",
        "belarus",
        "bhutan",
        "bolivia",
        "botswana",
        "burkina faso",
        "burundi",
        "central african republic",
        "chad",
        "czech republic",
        "czechia",
        "ethiopia",
        "hungary",
        "kazakhstan",
        "kyrgyzstan",
        "laos",
        "lesotho",
        "liechtenstein",
        "luxembourg",
        "macedonia",
        "north macedonia",
        "malawi",
        "mali",
        "moldova",
        "mongolia",
        "nepal",
        "niger",
        "paraguay",
        "rwanda",
        "serbia",
        "slovakia",
        "south sudan",
        "switzerland",
        "tajikistan",
        "turkmenistan",
        "uganda",
        "uzbekistan",
        "vatican",
        "zambia",
        "zimbabwe",
        "eswatini",
        "swaziland",
    }
)

# Default distance from origin to nearest export port before treating as inland.
INLAND_PORT_THRESHOLD_KM = 450.0

# Max straight-line inland haul to a foreign trade gateway before preferring domestic.
MAX_INLAND_HAUL_TO_HUB_KM = 800.0

# Allow a domestic hub to win when it is only slightly farther than the global nearest.
DOMESTIC_HUB_EXTRA_KM = 200.0


class TradeHubLike(Protocol):
    name: str
    lat: float
    lng: float
    country: str


def _hub_distance_km(lat: float, lng: float, hub: TradeHubLike) -> float:
    return haversine_km(lat, lng, hub.lat, hub.lng)


def select_nearest_trade_hub(
    lat: float,
    lng: float,
    hubs: Sequence[TradeHubLike],
    *,
    country: str = "",
    max_inland_haul_km: float = MAX_INLAND_HAUL_TO_HUB_KM,
    domestic_extra_km: float = DOMESTIC_HUB_EXTRA_KM,
) -> tuple[TradeHubLike, list[str]]:
    """Pick a trade gateway with same-country preference when reasonable."""
    if not hubs:
        raise ValueError("hubs must not be empty")

    notes: list[str] = []
    ranked = sorted(hubs, key=lambda hub: _hub_distance_km(lat, lng, hub))
    nearest = ranked[0]
    nearest_km = _hub_distance_km(lat, lng, nearest)
    country_key = normalize_country_key(country)

    if not country_key:
        if nearest_km > max_inland_haul_km:
            notes.append(
                f"Nearest gateway {nearest.name} is {nearest_km:.0f} km away "
                f"(exceeds {max_inland_haul_km:.0f} km inland-haul guidance)."
            )
        return nearest, notes

    domestic = [hub for hub in hubs if normalize_country_key(hub.country) == country_key]
    if not domestic:
        if nearest_km > max_inland_haul_km:
            notes.append(
                f"No gateway in {country.strip()} catalog; nearest {nearest.name} is "
                f"{nearest_km:.0f} km away (exceeds {max_inland_haul_km:.0f} km inland-haul guidance)."
            )
        return nearest, notes

    nearest_domestic = min(domestic, key=lambda hub: _hub_distance_km(lat, lng, hub))
    domestic_km = _hub_distance_km(lat, lng, nearest_domestic)
    if normalize_country_key(nearest.country) == country_key:
        return nearest, notes

    if domestic_km <= max_inland_haul_km and domestic_km <= nearest_km + domestic_extra_km:
        notes.append(
            f"Selected domestic gateway {nearest_domestic.name} ({domestic_km:.0f} km) "
            f"instead of nearer foreign hub {nearest.name} ({nearest_km:.0f} km)."
        )
        return nearest_domestic, notes

    if nearest_km > max_inland_haul_km and domestic_km <= max_inland_haul_km * 1.25:
        notes.append(
            f"Foreign hub {nearest.name} ({nearest_km:.0f} km) exceeds inland-haul cap; "
            f"using domestic {nearest_domestic.name} ({domestic_km:.0f} km)."
        )
        return nearest_domestic, notes

    if nearest_km > max_inland_haul_km:
        notes.append(
            f"Nearest gateway {nearest.name} is {nearest_km:.0f} km away "
            f"(exceeds {max_inland_haul_km:.0f} km inland-haul guidance)."
        )
    return nearest, notes


def rank_trade_hubs(
    lat: float,
    lng: float,
    hubs: Sequence[TradeHubLike],
    *,
    country: str = "",
    limit: int = 3,
) -> list[TradeHubLike]:
    """Return up to ``limit`` hubs, prioritizing same-country gateways when known."""
    if limit <= 0 or not hubs:
        return []

    country_key = normalize_country_key(country)
    ranked = sorted(hubs, key=lambda hub: _hub_distance_km(lat, lng, hub))
    selected: list[TradeHubLike] = []
    seen_names: set[str] = set()

    if country_key:
        for hub in ranked:
            if normalize_country_key(hub.country) != country_key:
                continue
            if hub.name in seen_names:
                continue
            seen_names.add(hub.name)
            selected.append(hub)
            if len(selected) >= limit:
                return selected

    for hub in ranked:
        if hub.name in seen_names:
            continue
        seen_names.add(hub.name)
        selected.append(hub)
        if len(selected) >= limit:
            break
    return selected


def normalize_country_key(country: str) -> str:
    return " ".join(country.strip().lower().split())


def is_landlocked_country(country: str) -> bool:
    if not country:
        return False
    return normalize_country_key(country) in LANDLOCKED_COUNTRIES


def inland_origin_heuristic(
    origin_lat: float,
    origin_lng: float,
    nearest_port_km: float,
    *,
    origin_country: str = "",
    coastal_countries: frozenset[str] | frozenset = frozenset(),
    inland_port_threshold_km: float = INLAND_PORT_THRESHOLD_KM,
) -> tuple[bool, str]:
    """Return (needs_alternatives, reason_code) for inland / landlocked screening."""
    country_key = normalize_country_key(origin_country)
    if country_key and is_landlocked_country(origin_country):
        return True, "landlocked_country"
    if nearest_port_km > inland_port_threshold_km:
        return True, "far_from_port"
    if country_key and coastal_countries and country_key not in coastal_countries:
        return True, "no_coastline_in_catalog"
    return False, ""
