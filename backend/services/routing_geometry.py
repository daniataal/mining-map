"""External routing geometry (OSRM roads, searoute sea, great-circle air/rail).

All network calls are best-effort: failures degrade to straight-line or corridor
fallbacks without raising to the API layer.
"""

from __future__ import annotations

import math
import os
from dataclasses import dataclass, field
from typing import Any, Callable, Optional, Protocol, Sequence

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
