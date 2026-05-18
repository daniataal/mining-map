"""Staged multi-modal route planning with shipping cost estimates.

This is still an open-data first planning engine, not a contracted freight
quote. International movements are modeled as realistic handoffs: inland
pickup -> export gateway -> trunk route -> import gateway -> final delivery.

Geometry sources (env-configurable, all degrade gracefully):
  - road: OSRM driving network (``OSRM_BASE_URL``)
  - sea: searoute marine network when ``SEAROUTE_ENABLED``; else offshore corridors
  - air: great-circle trunk; road access via OSRM when possible
  - rail: simplified hub-to-hub great-circle segments (not a track database)
"""

from __future__ import annotations

import math
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass, field
from typing import Any, Callable, Optional

ROUTE_PLAN_DEADLINE_SEC = float(os.getenv("ROUTE_PLAN_DEADLINE_SEC", "75"))

try:
    from backend.services.routing_geometry import (
        INLAND_PORT_THRESHOLD_KM,
        ResolvedGeometry,
        great_circle_geometry,
        inland_origin_heuristic,
        normalize_country_key,
        rank_trade_hubs,
        resolve_leg_geometry,
        select_nearest_trade_hub,
    )
    from backend.services.shipping_costs import estimate_route_cost, route_cost_to_dict
    from backend.services.vessel_ais import NAVIGATIONAL_STATUS_LABELS
except ImportError:
    from services.routing_geometry import (  # type: ignore[no-redef]
        INLAND_PORT_THRESHOLD_KM,
        ResolvedGeometry,
        great_circle_geometry,
        inland_origin_heuristic,
        normalize_country_key,
        rank_trade_hubs,
        resolve_leg_geometry,
        select_nearest_trade_hub,
    )
    from services.shipping_costs import estimate_route_cost, route_cost_to_dict
    from services.vessel_ais import NAVIGATIONAL_STATUS_LABELS


SUPPORTED_SHIPPING_METHODS = ("sea", "road", "rail", "pipeline", "air")

# Simple route inflation multipliers so straight-line distance can approximate
# real networks. Sea paths with corridor waypoints already approximate the
# sailing corridor, so the multiplier is intentionally small.
METHOD_DISTANCE_MULTIPLIERS: dict[str, float] = {
    "sea": 1.03,
    "road": 1.25,
    "rail": 1.18,
    "pipeline": 1.10,
    "air": 1.05,
}


@dataclass(frozen=True)
class TransportHub:
    name: str
    lat: float
    lng: float
    country: str
    kind: str


@dataclass
class RoutePoint:
    name: str
    lat: float
    lng: float
    kind: str = "transit"
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class PlannedLeg:
    leg_id: str
    from_point: RoutePoint
    to_point: RoutePoint
    method: str
    distance_km: float
    duration_hours: float
    method_score: float
    notes: list[str] = field(default_factory=list)
    path: list[tuple[float, float]] = field(default_factory=list)
    geometry_source: str = "straight_line"
    cost_overrides: dict[str, Any] = field(default_factory=dict)


MARITIME_HUBS: tuple[TransportHub, ...] = (
    TransportHub("Dar es Salaam Port", -6.823, 39.289, "Tanzania", "port"),
    TransportHub("Port of Beira", -19.823, 34.838, "Mozambique", "port"),
    TransportHub("Port of Durban", -29.868, 31.050, "South Africa", "port"),
    TransportHub("Port of Maputo", -25.967, 32.567, "Mozambique", "port"),
    TransportHub("Port of Walvis Bay", -22.957, 14.505, "Namibia", "port"),
    TransportHub("Port of Mombasa", -4.043, 39.668, "Kenya", "port"),
    TransportHub("Port of Tema", 5.640, 0.018, "Ghana", "port"),
    TransportHub("Port of Lagos", 6.450, 3.390, "Nigeria", "port"),
    TransportHub("Port of Abidjan", 5.292, -4.013, "Cote d'Ivoire", "port"),
    TransportHub("Port of Dakar", 14.681, -17.432, "Senegal", "port"),
    TransportHub("Port Said", 31.265, 32.301, "Egypt", "port"),
    TransportHub("Jebel Ali Port", 24.996, 55.060, "United Arab Emirates", "port"),
    TransportHub("Mumbai JNPT", 18.944, 72.954, "India", "port"),
    TransportHub("Port of Singapore", 1.264, 103.840, "Singapore", "port"),
    TransportHub("Port of Shanghai", 31.230, 121.473, "China", "port"),
    TransportHub("Port of Rotterdam", 51.924, 4.477, "Netherlands", "port"),
    TransportHub("Port of Antwerp", 51.219, 4.402, "Belgium", "port"),
    TransportHub("Port of Hamburg", 53.545, 9.970, "Germany", "port"),
    TransportHub("Port of Houston", 29.735, -95.275, "United States", "port"),
    TransportHub("Port of Los Angeles", 33.729, -118.269, "United States", "port"),
    TransportHub("Port of Santos", -23.960, -46.333, "Brazil", "port"),
    TransportHub("Haifa Port", 32.819, 34.990, "Israel", "port"),
    TransportHub("Port of Eilat", 29.557, 34.952, "Israel", "port"),
    TransportHub("Port of Ashdod", 31.801, 34.645, "Israel", "port"),
)

COASTAL_COUNTRIES: frozenset[str] = frozenset(
    normalize_country_key(hub.country) for hub in MARITIME_HUBS
)

RAIL_HUBS: tuple[TransportHub, ...] = (
    TransportHub("Tunduma Rail Border", -9.298, 32.769, "Tanzania", "rail_hub"),
    TransportHub("Ndola Rail Terminal", -12.968, 28.636, "Zambia", "rail_hub"),
    TransportHub("Lobito Rail Terminal", -12.364, 13.536, "Angola", "rail_hub"),
    TransportHub("Beira Rail Terminal", -19.823, 34.838, "Mozambique", "rail_hub"),
    TransportHub("Durban Rail Terminal", -29.868, 31.050, "South Africa", "rail_hub"),
    TransportHub("Mombasa Rail Terminal", -4.043, 39.668, "Kenya", "rail_hub"),
    TransportHub("Dar es Salaam Rail Terminal", -6.823, 39.289, "Tanzania", "rail_hub"),
    TransportHub("Rotterdam Rail Terminal", 51.924, 4.477, "Netherlands", "rail_hub"),
    TransportHub("Antwerp Rail Terminal", 51.219, 4.402, "Belgium", "rail_hub"),
    TransportHub("Hamburg Rail Terminal", 53.545, 9.970, "Germany", "rail_hub"),
)

AIR_HUBS: tuple[TransportHub, ...] = (
    TransportHub("Kenneth Kaunda International Airport", -15.330, 28.452, "Zambia", "airport"),
    TransportHub("OR Tambo International Airport", -26.133, 28.242, "South Africa", "airport"),
    TransportHub("Julius Nyerere International Airport", -6.878, 39.202, "Tanzania", "airport"),
    TransportHub("Kotoka International Airport", 5.605, -0.167, "Ghana", "airport"),
    TransportHub("Jomo Kenyatta International Airport", -1.319, 36.928, "Kenya", "airport"),
    TransportHub("Cairo International Airport", 30.122, 31.406, "Egypt", "airport"),
    TransportHub("Borg El Arab Airport", 30.918, 29.696, "Egypt", "airport"),
    TransportHub("Hurghada International Airport", 27.178, 33.799, "Egypt", "airport"),
    TransportHub("Luxor International Airport", 25.671, 32.706, "Egypt", "airport"),
    TransportHub("Dubai International Airport", 25.253, 55.365, "United Arab Emirates", "airport"),
    TransportHub("Brussels Airport", 50.901, 4.484, "Belgium", "airport"),
    TransportHub("Amsterdam Schiphol Airport", 52.310, 4.768, "Netherlands", "airport"),
    TransportHub("Frankfurt Airport", 50.037, 8.562, "Germany", "airport"),
    TransportHub("London Heathrow Airport", 51.470, -0.454, "United Kingdom", "airport"),
    TransportHub("Singapore Changi Airport", 1.364, 103.991, "Singapore", "airport"),
    TransportHub("Shanghai Pudong Airport", 31.144, 121.808, "China", "airport"),
    TransportHub("Ben Gurion Airport (TLV)", 32.011, 34.870, "Israel", "airport"),
)

SEA_ANCHORS: dict[str, tuple[str, float, float]] = {
    "bab_el_mandeb": ("Bab el-Mandeb sea lane", 12.610, 43.330),
    "suez": ("Suez Canal approach", 29.960, 32.550),
    "red_sea_north": ("Northern Red Sea lane", 27.700, 34.200),
    "gulf_aqaba": ("Gulf of Aqaba approach", 28.600, 34.750),
    "east_med": ("Eastern Mediterranean lane", 34.200, 27.000),
    "western_med": ("Western Mediterranean lane", 36.500, 5.000),
    "canary_approach": ("Canary Islands offshore lane", 28.000, -14.500),
    "morocco_atlantic": ("Morocco Atlantic offshore lane", 35.000, -7.800),
    "gibraltar_west": ("Western Strait of Gibraltar approach", 35.800, -6.400),
    "gibraltar": ("Strait of Gibraltar", 35.960, -5.600),
    "atlantic_africa": ("Mid-Atlantic Africa offshore lane", 20.000, -15.000),
    "english_channel": ("English Channel approach", 50.050, 1.200),
    "cape": ("Cape of Good Hope lane", -35.000, 18.200),
    "west_africa": ("West Africa offshore lane", 3.000, -12.000),
    "malacca": ("Malacca Strait", 2.600, 101.000),
    "colombo": ("Indian Ocean lane off Colombo", 6.100, 79.100),
    "mid_atlantic": ("North Atlantic lane", 38.000, -35.000),
    "panama": ("Panama Canal approach", 9.080, -79.680),
}


def _to_point(payload: dict[str, Any], default_kind: str) -> RoutePoint:
    return RoutePoint(
        name=str(payload.get("name") or payload.get("id") or default_kind),
        lat=float(payload["lat"]),
        lng=float(payload["lng"]),
        kind=str(payload.get("kind") or default_kind),
        metadata=payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {},
    )


def _point_from_hub(hub: TransportHub) -> RoutePoint:
    return RoutePoint(
        name=hub.name,
        lat=hub.lat,
        lng=hub.lng,
        kind=hub.kind,
        metadata={
            "country": hub.country,
            "hub_kind": hub.kind,
            "source": "static_trade_gateway_catalog",
        },
    )


def _anchor_point(anchor_id: str) -> RoutePoint:
    name, lat, lng = SEA_ANCHORS[anchor_id]
    return RoutePoint(name=name, lat=lat, lng=lng, kind="sea_lane", metadata={"anchor_id": anchor_id})


def _haversine_km(a_lat: float, a_lng: float, b_lat: float, b_lng: float) -> float:
    r_km = 6371.0
    d_lat = math.radians(b_lat - a_lat)
    d_lng = math.radians(b_lng - a_lng)
    aa = (
        math.sin(d_lat / 2) ** 2
        + math.cos(math.radians(a_lat)) * math.cos(math.radians(b_lat)) * math.sin(d_lng / 2) ** 2
    )
    return 2 * r_km * math.atan2(math.sqrt(aa), math.sqrt(1 - aa))


def _path_distance_km(path: list[tuple[float, float]]) -> float:
    total = 0.0
    for idx in range(len(path) - 1):
        a_lat, a_lng = path[idx]
        b_lat, b_lng = path[idx + 1]
        total += _haversine_km(a_lat, a_lng, b_lat, b_lng)
    return total


def _nearest_hub(point: RoutePoint, hubs: tuple[TransportHub, ...]) -> TransportHub:
    return min(hubs, key=lambda hub: _haversine_km(point.lat, point.lng, hub.lat, hub.lng))


def _point_country(point: RoutePoint) -> str:
    meta = point.metadata if isinstance(point.metadata, dict) else {}
    return str(meta.get("country") or "").strip()


def _origin_country(origin: RoutePoint) -> str:
    return _point_country(origin)


def _destination_country(destination: RoutePoint) -> str:
    return _point_country(destination)


def _select_hub(
    point: RoutePoint,
    hubs: tuple[TransportHub, ...],
    *,
    country: str = "",
) -> tuple[TransportHub, list[str]]:
    resolved_country = country or _point_country(point)
    hub, notes = select_nearest_trade_hub(
        point.lat,
        point.lng,
        hubs,
        country=resolved_country,
    )
    return hub, notes


# Primary seaport per country when coordinates are far from domestic gateways (stale picks).
CANONICAL_MARITIME_BY_COUNTRY: dict[str, str] = {
    "israel": "Haifa Port",
    "ghana": "Port of Tema",
    "egypt": "Port Said",
    "netherlands": "Port of Rotterdam",
    "belgium": "Port of Antwerp",
    "germany": "Port of Hamburg",
    "tanzania": "Dar es Salaam Port",
    "kenya": "Port of Mombasa",
    "south africa": "Port of Durban",
    "nigeria": "Port of Lagos",
    "cote d'ivoire": "Port of Abidjan",
    "senegal": "Port of Dakar",
}

# When the party is farther than this from every domestic port, treat coords as stale.
STALE_COORDS_DOMESTIC_PORT_KM = 1200.0


def _canonical_maritime_hub(
    domestic: list[TransportHub],
    country_key: str,
) -> Optional[TransportHub]:
    target = CANONICAL_MARITIME_BY_COUNTRY.get(country_key)
    if not target:
        return None
    target_lower = target.lower()
    for hub in domestic:
        if hub.name.lower() == target_lower or target_lower in hub.name.lower():
            return hub
    return None


def _explicit_domestic_hub_from_point(
    point: RoutePoint,
    domestic: list[TransportHub],
) -> Optional[TransportHub]:
    point_name = normalize_country_key(point.name)
    if not point_name:
        return None
    for hub in domestic:
        hub_name = normalize_country_key(hub.name)
        if hub_name and (hub_name in point_name or point_name in hub_name):
            return hub
    return None


def _select_country_authoritative_hub(
    point: RoutePoint,
    hubs: tuple[TransportHub, ...],
    *,
    country: str = "",
    role: str = "import",
) -> tuple[TransportHub, list[str]]:
    """Pick the nearest hub in the declared country when country metadata is known.

  Coordinates may be stale (e.g. buyer country set to Israel while lat/lng still
  point at a foreign port). For import/export gateway selection, the declared country
  takes precedence so sea/air trunks terminate in the correct state.
    """
    resolved_country = (country or _point_country(point)).strip()
    country_key = normalize_country_key(resolved_country)
    if not country_key:
        return _select_hub(point, hubs, country=resolved_country)

    domestic = [hub for hub in hubs if normalize_country_key(hub.country) == country_key]
    if not domestic:
        return _select_hub(point, hubs, country=resolved_country)

    explicit_hub = _explicit_domestic_hub_from_point(point, domestic)
    if explicit_hub is not None:
        return explicit_hub, [
            f"{role.title()} gateway {explicit_hub.name} selected from explicit destination name."
        ]

    nearest_domestic = min(
        domestic,
        key=lambda item: _haversine_km(point.lat, point.lng, item.lat, item.lng),
    )
    domestic_km = _haversine_km(
        point.lat,
        point.lng,
        nearest_domestic.lat,
        nearest_domestic.lng,
    )
    notes: list[str] = []
    if domestic_km > STALE_COORDS_DOMESTIC_PORT_KM:
        canonical = _canonical_maritime_hub(domestic, country_key)
        if canonical is not None:
            notes.append(
                f"{role.title()} gateway {canonical.name} selected for {resolved_country} "
                f"(coordinates are {domestic_km:.0f} km from the nearest domestic port — likely stale)."
            )
            return canonical, notes

    hub = nearest_domestic
    global_hub, global_notes = select_nearest_trade_hub(point.lat, point.lng, hubs, country="")
    notes.extend(global_notes)
    if normalize_country_key(global_hub.country) != country_key:
        notes.append(
            f"{role.title()} gateway {hub.name} selected in {resolved_country} "
            f"(nearest in destination country); global nearest hub was {global_hub.name}."
        )
    return hub, notes


def _select_maritime_export_hub(
    origin: RoutePoint,
    hubs: tuple[TransportHub, ...],
) -> tuple[TransportHub, list[str]]:
    """Export seaport: declared origin country wins over foreign nearest-by-coords."""
    return _select_country_authoritative_hub(
        origin,
        hubs,
        country=_origin_country(origin),
        role="export",
    )


def _nearest_port_distance_km(point: RoutePoint) -> float:
    hub, _ = _select_hub(point, MARITIME_HUBS)
    return _haversine_km(point.lat, point.lng, hub.lat, hub.lng)


def _nearest_maritime_hubs(point: RoutePoint, limit: int = 3) -> list[TransportHub]:
    return list(
        rank_trade_hubs(
            point.lat,
            point.lng,
            MARITIME_HUBS,
            country=_point_country(point),
            limit=limit,
        )
    )


def _origin_needs_alternatives(origin: RoutePoint) -> tuple[bool, str]:
    nearest_km = _nearest_port_distance_km(origin)
    return inland_origin_heuristic(
        origin.lat,
        origin.lng,
        nearest_km,
        origin_country=_origin_country(origin),
        coastal_countries=COASTAL_COUNTRIES,
        inland_port_threshold_km=INLAND_PORT_THRESHOLD_KM,
    )


def _port_slug(port_name: str) -> str:
    slug = port_name.lower()
    if slug.startswith("port of "):
        slug = slug[8:]
    elif slug.startswith("port "):
        slug = slug[5:]
    compact = "".join(ch if ch.isalnum() else "_" for ch in slug).strip("_")
    return (compact[:40] if compact else "port")


def _same_place(a: RoutePoint, b: RoutePoint, max_km: float = 35.0) -> bool:
    return _haversine_km(a.lat, a.lng, b.lat, b.lng) <= max_km


def _facility_connector_required(from_point: RoutePoint, to_point: RoutePoint) -> bool:
    """Port/airport (or other gateway) to a different facility type always needs a connector leg."""
    from_kind = (from_point.kind or "").lower()
    to_kind = (to_point.kind or "").lower()
    to_name = (to_point.name or "").lower()
    if from_kind == "port" and (
        to_kind == "airport" or "airport" in to_name or "ben gurion" in to_name
    ):
        return True
    if from_kind == "airport" and to_kind not in {"airport", "sea_lane"}:
        return True
    return False


def _connector_leg_needed(from_point: RoutePoint, to_point: RoutePoint, *, max_km: float = 35.0) -> bool:
    distance_km = _haversine_km(from_point.lat, from_point.lng, to_point.lat, to_point.lng)
    if _facility_connector_required(from_point, to_point):
        return distance_km > 1.0
    return distance_km > max_km


def _select_sea_import_hub(
    destination: RoutePoint,
    hubs: tuple[TransportHub, ...],
    *,
    country: str = "",
) -> tuple[TransportHub, list[str]]:
    """Pick import seaport; prefer Haifa for Israel airport deliveries (sea + road to TLV)."""
    resolved_country = (country or _point_country(destination)).strip()
    country_key = normalize_country_key(resolved_country)
    dest_kind = (destination.kind or "").lower()
    dest_name = (destination.name or "").lower()
    is_airport_dest = dest_kind == "airport" or "airport" in dest_name or "ben gurion" in dest_name

    if country_key == "israel" and is_airport_dest:
        haifa = next((hub for hub in hubs if "haifa" in hub.name.lower()), None)
        if haifa is not None:
            return haifa, [
                "Sea trunk terminates at Haifa Port for airport delivery; "
                "road connector to Ben Gurion (TLV) follows."
            ]

    return _select_country_authoritative_hub(
        destination,
        hubs,
        country=resolved_country,
        role="import",
    )


def _is_europe(point: RoutePoint) -> bool:
    return 35.0 <= point.lat <= 72.0 and -15.0 <= point.lng <= 45.0


def _is_eastern_mediterranean(point: RoutePoint) -> bool:
    """Levant, Cyprus, and eastern Med coast (Haifa, Beirut, Alexandria, etc.)."""
    return 28.0 <= point.lat < 35.0 and 25.0 <= point.lng <= 42.0


def _is_red_sea_or_gulf_of_aqaba(point: RoutePoint) -> bool:
    name = (point.name or "").lower()
    return (
        "eilat" in name
        or "aqaba" in name
        or (27.0 <= point.lat <= 30.5 and 34.0 <= point.lng <= 35.5)
    )


def _is_mediterranean_destination(point: RoutePoint) -> bool:
    return _is_europe(point) or _is_eastern_mediterranean(point)


def _is_east_or_south_africa(point: RoutePoint) -> bool:
    return -36.0 <= point.lat <= 16.0 and 20.0 <= point.lng <= 55.0


def _is_southern_africa(point: RoutePoint) -> bool:
    return point.lat <= -20.0 and 10.0 <= point.lng <= 42.0


def _is_west_africa(point: RoutePoint) -> bool:
    return -10.0 <= point.lat <= 25.0 and -25.0 <= point.lng <= 20.0


def _is_asia_indian_ocean(point: RoutePoint) -> bool:
    return -12.0 <= point.lat <= 35.0 and 55.0 <= point.lng <= 125.0


def _is_americas(point: RoutePoint) -> bool:
    return -60.0 <= point.lat <= 70.0 and -170.0 <= point.lng <= -30.0


def _atlantic_to_mediterranean_anchors(destination: RoutePoint) -> list[str]:
    """Offshore Atlantic → Med corridor; branch for Levant vs NW Europe."""
    base = ["west_africa", "canary_approach", "morocco_atlantic", "gibraltar_west", "gibraltar", "western_med"]
    if _is_eastern_mediterranean(destination):
        return [*base, "east_med"]
    return [*base, "english_channel"]


def _sea_anchor_ids_one_way(origin: RoutePoint, destination: RoutePoint) -> list[str]:
    if _is_red_sea_or_gulf_of_aqaba(destination):
        if _is_west_africa(origin):
            return [
                "west_africa",
                "canary_approach",
                "morocco_atlantic",
                "gibraltar_west",
                "gibraltar",
                "western_med",
                "suez",
                "red_sea_north",
                "gulf_aqaba",
            ]
        if _is_europe(origin):
            return ["english_channel", "gibraltar", "western_med", "suez", "red_sea_north", "gulf_aqaba"]
        if _is_americas(origin):
            return ["mid_atlantic", "english_channel", "gibraltar", "western_med", "suez", "red_sea_north", "gulf_aqaba"]
        if _is_east_or_south_africa(origin) or _is_asia_indian_ocean(origin):
            return ["bab_el_mandeb", "red_sea_north", "gulf_aqaba"]
    if _is_mediterranean_destination(destination):
        if _is_asia_indian_ocean(origin):
            return ["malacca", "colombo", "bab_el_mandeb", "suez", "east_med", "gibraltar", "english_channel"]
        if _is_southern_africa(origin):
            return ["cape", "west_africa", "canary_approach", "morocco_atlantic", "gibraltar_west", "gibraltar", "english_channel"]
        if _is_east_or_south_africa(origin):
            if _is_eastern_mediterranean(destination):
                return ["bab_el_mandeb", "suez", "east_med"]
            return ["bab_el_mandeb", "suez", "east_med", "gibraltar", "english_channel"]
        if _is_west_africa(origin):
            return _atlantic_to_mediterranean_anchors(destination)
        if _is_americas(origin):
            return ["mid_atlantic", "english_channel"]
        if _is_europe(origin):
            if _is_eastern_mediterranean(destination):
                return ["english_channel", "gibraltar", "western_med", "east_med"]
            return ["english_channel", "gibraltar", "western_med"]
        if _is_eastern_mediterranean(origin) and _is_europe(destination):
            return ["east_med", "western_med", "gibraltar", "english_channel"]
    if _is_americas(origin) and _is_asia_indian_ocean(destination):
        return ["panama", "malacca"]
    if _is_asia_indian_ocean(origin) and _is_americas(destination):
        return ["malacca", "panama"]
    return []


def _sea_path(origin: RoutePoint, destination: RoutePoint) -> list[tuple[float, float]]:
    waypoints = [(origin.lat, origin.lng)]
    for anchor_id in _sea_anchor_ids_one_way(origin, destination):
        anchor = _anchor_point(anchor_id)
        if _haversine_km(waypoints[-1][0], waypoints[-1][1], anchor.lat, anchor.lng) > 120:
            waypoints.append((anchor.lat, anchor.lng))
    if _haversine_km(waypoints[-1][0], waypoints[-1][1], destination.lat, destination.lng) > 1:
        waypoints.append((destination.lat, destination.lng))
    if len(waypoints) < 2:
        waypoints = [(origin.lat, origin.lng), (destination.lat, destination.lng)]

    segments: list[tuple[float, float]] = []
    for idx in range(len(waypoints) - 1):
        a_lat, a_lng = waypoints[idx]
        b_lat, b_lng = waypoints[idx + 1]
        seg = great_circle_geometry(
            a_lat,
            a_lng,
            b_lat,
            b_lng,
            method="sea",
            num_points=14,
            source="corridor_segment",
        )
        if not segments:
            segments.extend(seg.path)
        else:
            segments.extend(seg.path[1:])
    return segments


def _pipeline_viable(a: RoutePoint, b: RoutePoint, layer_enabled: bool) -> bool:
    if not layer_enabled:
        return False
    return a.kind in {"refinery", "terminal", "port", "pipeline_node"} or b.kind in {
        "refinery",
        "terminal",
        "port",
        "pipeline_node",
    }


def _requested_backend_methods(requested_methods: Optional[list[str]]) -> list[str]:
    if not requested_methods:
        return ["sea", "road"]
    normalized: list[str] = []
    for item in requested_methods:
        method = str(item).strip().lower()
        if method in SUPPORTED_SHIPPING_METHODS and method not in normalized:
            normalized.append(method)
    return normalized or ["road"]


def _inland_method(requested_methods: list[str], distance_km: float) -> str:
    if "rail" in requested_methods and distance_km >= 350:
        return "rail"
    return "road"


def _leg_note(method: str, stage: str) -> str:
    if method == "sea":
        return (
            f"{stage}. Sea trunk uses searoute or offshore corridor waypoints; "
            "attach vessel/booking data before execution."
        )
    if method == "air":
        return f"{stage}. Air trunk is great-circle; airport access uses OSRM when available."
    if method == "rail":
        return (
            f"{stage}. Rail is hub-to-hub screening only; validate gauge, slots, and border clearance."
        )
    if method == "pipeline":
        return f"{stage}. Pipeline requires confirmed connection rights and product compatibility."
    return f"{stage}. Trucking/drayage via OSRM when available; validate permits and secure transport."


def _distance_multiplier(method: str, geometry_source: str) -> float:
    if geometry_source in {"osrm", "searoute"}:
        return 1.0
    if method == "sea" and geometry_source == "corridor_fallback":
        return METHOD_DISTANCE_MULTIPLIERS["sea"]
    if method in METHOD_DISTANCE_MULTIPLIERS:
        return METHOD_DISTANCE_MULTIPLIERS[method]
    return 1.0


def _geometry_for_leg(
    from_point: RoutePoint,
    to_point: RoutePoint,
    method: str,
    *,
    corridor_fallback: Optional[Callable[[], list[tuple[float, float]]]] = None,
    deadline: Optional[float] = None,
) -> ResolvedGeometry:
    rail_hubs: Optional[tuple[tuple[float, float], tuple[float, float]]] = None
    if method == "rail":
        export_hub = _nearest_hub(from_point, RAIL_HUBS)
        import_hub = _nearest_hub(to_point, RAIL_HUBS)
        rail_hubs = ((export_hub.lat, export_hub.lng), (import_hub.lat, import_hub.lng))
    return resolve_leg_geometry(
        from_point.lat,
        from_point.lng,
        to_point.lat,
        to_point.lng,
        method,
        corridor_fallback=corridor_fallback,
        rail_hubs=rail_hubs,
        deadline=deadline,
    )


def _resolve_leg_geometries_parallel(
    specs: list[tuple[RoutePoint, RoutePoint, str, Optional[Callable[[], list[tuple[float, float]]]]]],
    *,
    deadline: Optional[float],
) -> list[ResolvedGeometry]:
    """Resolve independent leg geometries concurrently (OSRM + searoute)."""
    if not specs:
        return []
    if len(specs) == 1:
        from_point, to_point, method, corridor_fallback = specs[0]
        return [
            _geometry_for_leg(
                from_point,
                to_point,
                method,
                corridor_fallback=corridor_fallback,
                deadline=deadline,
            )
        ]

    results: list[Optional[ResolvedGeometry]] = [None] * len(specs)

    def _resolve(index: int) -> tuple[int, ResolvedGeometry]:
        from_point, to_point, method, corridor_fallback = specs[index]
        return index, _geometry_for_leg(
            from_point,
            to_point,
            method,
            corridor_fallback=corridor_fallback,
            deadline=deadline,
        )

    max_workers = min(4, len(specs))
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = [executor.submit(_resolve, index) for index in range(len(specs))]
        for future in as_completed(futures):
            index, geometry = future.result()
            results[index] = geometry

    return [geometry for geometry in results if geometry is not None]


def _make_leg(
    index: int,
    from_point: RoutePoint,
    to_point: RoutePoint,
    method: str,
    quantity_tons: float,
    *,
    stage: str,
    geometry: Optional[ResolvedGeometry] = None,
    cost_overrides: Optional[dict[str, Any]] = None,
) -> PlannedLeg:
    resolved = geometry or _geometry_for_leg(from_point, to_point, method)
    route_path = list(resolved.path)
    raw_distance = resolved.distance_km if resolved.distance_km > 0 else _path_distance_km(route_path)
    if raw_distance <= 0:
        raw_distance = 0.001
    multiplier = _distance_multiplier(method, resolved.source)
    effective_distance = raw_distance * multiplier
    duration_hours = resolved.duration_hours
    if duration_hours <= 0:
        duration_hours = raw_distance / 50.0
    score = effective_distance
    if method == "air":
        score *= 3.0
    if quantity_tons >= 300 and method in {"rail", "sea", "pipeline"}:
        score *= 0.9

    notes = [_leg_note(method, stage), *resolved.notes]
    if method == "sea":
        notes.append(f"AIS status references available: {len(NAVIGATIONAL_STATUS_LABELS)}")

    return PlannedLeg(
        leg_id=f"leg-{index + 1}",
        from_point=from_point,
        to_point=to_point,
        method=method,
        distance_km=effective_distance,
        duration_hours=duration_hours,
        method_score=score,
        notes=notes,
        path=route_path,
        geometry_source=resolved.source,
        cost_overrides=cost_overrides or {},
    )


def _append_if_not_same(
    legs: list[PlannedLeg],
    from_point: RoutePoint,
    to_point: RoutePoint,
    method: str,
    quantity_tons: float,
    *,
    stage: str,
    geometry: Optional[ResolvedGeometry] = None,
    corridor_fallback: Optional[Callable[[], list[tuple[float, float]]]] = None,
    cost_overrides: Optional[dict[str, Any]] = None,
    connector_max_km: float = 35.0,
    deadline: Optional[float] = None,
) -> None:
    if not _connector_leg_needed(from_point, to_point, max_km=connector_max_km):
        return
    resolved = geometry
    if resolved is None:
        resolved = _geometry_for_leg(
            from_point,
            to_point,
            method,
            corridor_fallback=corridor_fallback,
            deadline=deadline,
        )
    legs.append(
        _make_leg(
            len(legs),
            from_point,
            to_point,
            method,
            quantity_tons,
            stage=stage,
            geometry=resolved,
            cost_overrides=cost_overrides,
        )
    )


def _plan_sea_route(
    origin: RoutePoint,
    destination: RoutePoint,
    requested_methods: list[str],
    quantity_tons: float,
    *,
    export_hub: Optional[TransportHub] = None,
    deadline: Optional[float] = None,
) -> tuple[list[PlannedLeg], list[RoutePoint]]:
    legs: list[PlannedLeg] = []
    hub_notes: list[str] = []
    if export_hub is None:
        export_hub, hub_notes = _select_maritime_export_hub(origin, MARITIME_HUBS)
    import_hub, import_notes = _select_sea_import_hub(
        destination,
        MARITIME_HUBS,
        country=_destination_country(destination),
    )
    export_port = _point_from_hub(export_hub)
    import_port = _point_from_hub(import_hub)

    origin_to_port_km = _haversine_km(origin.lat, origin.lng, export_port.lat, export_port.lng)
    pickup_notes = list(hub_notes)

    leg_specs: list[
        tuple[
            RoutePoint,
            RoutePoint,
            str,
            str,
            Optional[Callable[[], list[tuple[float, float]]]],
            float,
        ]
    ] = []
    if _connector_leg_needed(origin, export_port):
        leg_specs.append(
            (
                origin,
                export_port,
                _inland_method(requested_methods, origin_to_port_km),
                "1. Inland pickup to export port",
                None,
                35.0,
            )
        )
    if _connector_leg_needed(export_port, import_port):
        leg_specs.append(
            (
                export_port,
                import_port,
                "sea",
                "2. Ocean trunk route between nominated ports",
                lambda: _sea_path(export_port, import_port),
                35.0,
            )
        )
    if _connector_leg_needed(import_port, destination, max_km=8.0):
        leg_specs.append(
            (
                import_port,
                destination,
                "road",
                "3. Final delivery from import port",
                None,
                8.0,
            )
        )

    geometry_specs = [(spec[0], spec[1], spec[2], spec[4]) for spec in leg_specs]
    resolved_geometries = _resolve_leg_geometries_parallel(geometry_specs, deadline=deadline)

    for index, spec in enumerate(leg_specs):
        from_point, to_point, method, stage, _corridor, _max_km = spec
        _append_if_not_same(
            legs,
            from_point,
            to_point,
            method,
            quantity_tons,
            stage=stage,
            geometry=resolved_geometries[index] if index < len(resolved_geometries) else None,
            deadline=deadline,
        )
    if pickup_notes and legs:
        legs[0].notes.extend(pickup_notes)
    if import_notes and len(legs) >= 1:
        legs[-1].notes.extend(import_notes)
    return legs, [export_port, import_port]


def _plan_air_route(
    origin: RoutePoint,
    destination: RoutePoint,
    requested_methods: list[str],
    quantity_tons: float,
    *,
    deadline: Optional[float] = None,
) -> tuple[list[PlannedLeg], list[RoutePoint]]:
    legs: list[PlannedLeg] = []
    export_hub, export_notes = _select_hub(origin, AIR_HUBS, country=_origin_country(origin))
    import_hub, import_notes = _select_country_authoritative_hub(
        destination,
        AIR_HUBS,
        country=_destination_country(destination),
        role="import",
    )
    export_airport = _point_from_hub(export_hub)
    import_airport = _point_from_hub(import_hub)
    origin_to_air_km = _haversine_km(origin.lat, origin.lng, export_airport.lat, export_airport.lng)
    import_to_dest_km = _haversine_km(import_airport.lat, import_airport.lng, destination.lat, destination.lng)

    leg_specs: list[tuple[RoutePoint, RoutePoint, str, str, Optional[Callable[[], list[tuple[float, float]]]]]] = []
    if _connector_leg_needed(origin, export_airport):
        leg_specs.append(
            (
                origin,
                export_airport,
                _inland_method(requested_methods, origin_to_air_km),
                "1. Secure pickup to export airport",
                None,
            )
        )
    if _connector_leg_needed(export_airport, import_airport):
        leg_specs.append(
            (
                export_airport,
                import_airport,
                "air",
                "2. Air cargo trunk route",
                None,
            )
        )
    if _connector_leg_needed(import_airport, destination):
        leg_specs.append(
            (
                import_airport,
                destination,
                _inland_method(requested_methods, import_to_dest_km),
                "3. Secure final delivery from airport",
                None,
            )
        )

    resolved_geometries = _resolve_leg_geometries_parallel(
        [(spec[0], spec[1], spec[2], spec[4]) for spec in leg_specs],
        deadline=deadline,
    )

    for index, spec in enumerate(leg_specs):
        from_point, to_point, method, stage, _corridor = spec
        _append_if_not_same(
            legs,
            from_point,
            to_point,
            method,
            quantity_tons,
            stage=stage,
            geometry=resolved_geometries[index] if index < len(resolved_geometries) else None,
            deadline=deadline,
        )
    if export_notes and legs:
        legs[0].notes.extend(export_notes)
    air_trunk_index = next((idx for idx, spec in enumerate(leg_specs) if spec[2] == "air"), None)
    if import_notes and air_trunk_index is not None and air_trunk_index < len(legs):
        legs[air_trunk_index].notes.extend(import_notes)
    return legs, [export_airport, import_airport]


def _plan_direct_inland_route(
    origin: RoutePoint,
    destination: RoutePoint,
    requested_methods: list[str],
    quantity_tons: float,
    *,
    pipeline_layer_enabled: bool,
) -> tuple[list[PlannedLeg], list[RoutePoint]]:
    direct_km = _haversine_km(origin.lat, origin.lng, destination.lat, destination.lng)
    method = _inland_method(requested_methods, direct_km)
    if "pipeline" in requested_methods and _pipeline_viable(origin, destination, pipeline_layer_enabled):
        method = "pipeline"
    leg = _make_leg(
        0,
        origin,
        destination,
        method,
        quantity_tons,
        stage="1. Direct inland route",
    )
    return [leg], []


def _hub_label_for_point(point: RoutePoint) -> Optional[str]:
    """Short label for map hub markers (ports, airports, rail terminals)."""
    kind = (point.kind or "").lower()
    if kind in {"port", "airport", "rail_hub"}:
        return point.name
    return None


def _legs_to_payload(legs: list[PlannedLeg]) -> list[dict[str, Any]]:
    return [
        {
            "leg_id": leg.leg_id,
            "from": asdict(leg.from_point),
            "to": asdict(leg.to_point),
            "method": leg.method,
            "distance_km": round(leg.distance_km, 3),
            "duration_hours": round(leg.duration_hours, 3),
            "method_score": round(leg.method_score, 3),
            "geometry_source": leg.geometry_source,
            "notes": leg.notes,
            "path": [[round(lat, 5), round(lng, 5)] for lat, lng in leg.path],
            "hub_label": _hub_label_for_point(leg.to_point),
            "map_label": _hub_label_for_point(leg.to_point),
            **leg.cost_overrides,
        }
        for leg in legs
    ]


def _build_route_plan_entry(
    *,
    alternative_id: str,
    label: str,
    is_recommended: bool,
    legs: list[PlannedLeg],
    gateways: list[RoutePoint],
    strategy: str,
    origin: RoutePoint,
    destination: RoutePoint,
    quantity_tons: float,
) -> dict[str, Any]:
    legs_payload = _legs_to_payload(legs)
    cost_breakdown = estimate_route_cost(legs_payload, cargo_tons=quantity_tons)
    return {
        "id": alternative_id,
        "alternative_id": alternative_id,
        "label": label,
        "is_recommended": is_recommended,
        "route": {
            "origin": asdict(origin),
            "transit_points": [asdict(item) for item in gateways],
            "destination": asdict(destination),
            "legs": legs_payload,
            "optimization": {
                "strategy": strategy,
                "note": (
                    "Gateway selection uses nearest static trade hubs. Replace with live freight, "
                    "port rotation, and corridor availability providers before execution."
                ),
            },
        },
        "cost_breakdown": route_cost_to_dict(cost_breakdown),
    }


def _preferred_trunk_rank(requested_methods: list[str], alternative_id: str) -> int:
    if alternative_id.startswith("sea"):
        return requested_methods.index("sea") if "sea" in requested_methods else 99
    if alternative_id.startswith("air"):
        return requested_methods.index("air") if "air" in requested_methods else 99
    return 50


def _pick_recommended_plan(
    plans: list[dict[str, Any]],
    requested_methods: list[str],
) -> dict[str, Any]:
    if not plans:
        raise ValueError("No route plans generated")
    if len(plans) == 1:
        return plans[0]

    def sort_key(plan: dict[str, Any]) -> tuple[float, int, str]:
        total = float(plan.get("cost_breakdown", {}).get("total_cost_usd") or 0)
        pref = _preferred_trunk_rank(requested_methods, str(plan.get("id") or ""))
        return (total, pref, str(plan.get("id") or ""))

    return min(plans, key=sort_key)


def _generate_route_plans(
    origin: RoutePoint,
    destination: RoutePoint,
    requested_methods: list[str],
    quantity_tons: float,
    *,
    pipeline_layer_enabled: bool,
    offer_alternatives: bool,
    deadline: Optional[float] = None,
) -> list[dict[str, Any]]:
    plans: list[dict[str, Any]] = []
    export_hub_limit = 2
    if deadline is not None and (deadline - time.monotonic()) < 25:
        export_hub_limit = 1

    if offer_alternatives and "sea" in requested_methods:
        export_hubs = _nearest_maritime_hubs(origin, limit=3 if offer_alternatives else 1)
        for idx, hub in enumerate(export_hubs[:export_hub_limit]):
            legs, gateways = _plan_sea_route(
                origin,
                destination,
                requested_methods,
                quantity_tons,
                export_hub=hub,
                deadline=deadline,
            )
            alt_id = f"sea_{_port_slug(hub.name)}"
            label = f"Via {hub.name} (sea)" if idx > 0 else f"Recommended: via {hub.name} (sea)"
            plans.append(
                _build_route_plan_entry(
                    alternative_id=alt_id,
                    label=label,
                    is_recommended=False,
                    legs=legs,
                    gateways=gateways,
                    strategy="staged-inland-port-sea-port-inland",
                    origin=origin,
                    destination=destination,
                    quantity_tons=quantity_tons,
                )
            )

    if offer_alternatives and "air" in requested_methods:
        legs, gateways = _plan_air_route(
            origin,
            destination,
            requested_methods,
            quantity_tons,
            deadline=deadline,
        )
        plans.append(
            _build_route_plan_entry(
                alternative_id="air",
                label="Via air freight",
                is_recommended=False,
                legs=legs,
                gateways=gateways,
                strategy="staged-secure-road-air-road",
                origin=origin,
                destination=destination,
                quantity_tons=quantity_tons,
            )
        )

    if not plans:
        if "sea" in requested_methods:
            legs, gateways = _plan_sea_route(
                origin,
                destination,
                requested_methods,
                quantity_tons,
                deadline=deadline,
            )
            strategy = "staged-inland-port-sea-port-inland"
        elif "air" in requested_methods:
            legs, gateways = _plan_air_route(
                origin,
                destination,
                requested_methods,
                quantity_tons,
                deadline=deadline,
            )
            strategy = "staged-secure-road-air-road"
        else:
            legs, gateways = _plan_direct_inland_route(
                origin,
                destination,
                requested_methods,
                quantity_tons,
                pipeline_layer_enabled=pipeline_layer_enabled,
            )
            strategy = "direct-inland"
        hub = (
            _select_hub(origin, MARITIME_HUBS, country=_origin_country(origin))[0]
            if strategy.startswith("staged-inland-port")
            else None
        )
        alt_id = "sea_primary" if "sea" in requested_methods else ("air" if "air" in requested_methods else "inland")
        label = (
            f"Via {hub.name} (sea)" if hub else ("Via air freight" if alt_id == "air" else "Direct inland route")
        )
        plans.append(
            _build_route_plan_entry(
                alternative_id=alt_id,
                label=label,
                is_recommended=True,
                legs=legs,
                gateways=gateways,
                strategy=strategy,
                origin=origin,
                destination=destination,
                quantity_tons=quantity_tons,
            )
        )

    return plans


def plan_route(request_payload: dict[str, Any]) -> dict[str, Any]:
    plan_started = time.monotonic()
    deadline = plan_started + ROUTE_PLAN_DEADLINE_SEC
    origin = _to_point(request_payload["origin"], "origin")
    destination = _to_point(request_payload["destination"], "destination")

    quantity_tons = float(request_payload.get("quantity_tons") or 1.0)
    pipeline_layer_enabled = bool(request_payload.get("pipeline_layer_enabled", False))
    preferred_methods_raw = request_payload.get("preferred_methods")
    preferred_methods = preferred_methods_raw if isinstance(preferred_methods_raw, list) else None
    requested_methods = _requested_backend_methods(preferred_methods)

    needs_alternatives, inland_reason = _origin_needs_alternatives(origin)
    multi_trunk = "sea" in requested_methods and "air" in requested_methods
    offer_alternatives = needs_alternatives or multi_trunk

    candidate_plans = _generate_route_plans(
        origin,
        destination,
        requested_methods,
        quantity_tons,
        pipeline_layer_enabled=pipeline_layer_enabled,
        offer_alternatives=offer_alternatives,
        deadline=deadline,
    )
    recommended = _pick_recommended_plan(candidate_plans, requested_methods)
    recommended_id = str(recommended["id"])
    recommended["label"] = "Recommended"
    recommended["is_recommended"] = True

    alternatives = [
        {**plan, "is_recommended": False}
        for plan in candidate_plans
        if str(plan.get("id")) != recommended_id
    ]

    elapsed_sec = time.monotonic() - plan_started
    base_limitations = [
        "Gateway catalog is static and open-first; validate nominated port/airport acceptance, storage, and documentation.",
        "Road geometry uses OSRM when reachable; failures fall back to straight-line segments without failing the request.",
        "Sea geometry uses searoute when SEAROUTE_ENABLED and the package is installed; otherwise offshore corridor waypoints.",
        f"Route geometry resolved in {elapsed_sec:.1f}s (budget {ROUTE_PLAN_DEADLINE_SEC:.0f}s); OSRM hub pairs may be cached.",
        "Rail is hub-to-hub screening only — not a track-level network graph.",
        "Air trunk is great-circle; airport drayage uses OSRM when available.",
        "Freight cost is a screening estimate; obtain broker/carrier quotes before committing.",
    ]
    if offer_alternatives and len(candidate_plans) > 1:
        base_limitations.append(
            "Multiple full-route alternatives are returned (sea vs air or export ports); each is a separate sequential plan — not merged on one map path."
        )

    landlocked_hint: Optional[str] = None
    if needs_alternatives:
        landlocked_hint = (
            "Origin is inland or landlocked: compare export-port and trunk-mode alternatives separately. "
            "Nominate port slots, border clearance, and carrier quotes before execution."
        )

    mixed_mode_notes: list[str] = []
    dest_kind = (destination.kind or "").lower()
    dest_name = (destination.name or "").lower()
    if "sea" in requested_methods and (
        dest_kind == "airport" or "airport" in dest_name or "ben gurion" in dest_name
    ):
        mixed_mode_notes.append(
            "Sea mode terminates at the nearest Israeli seaport (Haifa for TLV airport) with a road "
            "connector to the airport. For a direct trunk to Ben Gurion, use air freight instead of sea."
        )

    response: dict[str, Any] = {
        "product": request_payload.get("product"),
        "quantity_tons": quantity_tons,
        "supported_methods": list(SUPPORTED_SHIPPING_METHODS),
        "pipeline_layer_enabled": pipeline_layer_enabled,
        "recommended": recommended,
        "alternatives": alternatives,
        "route": recommended["route"],
        "cost_breakdown": recommended["cost_breakdown"],
        "routing_context": {
            "inland_origin": needs_alternatives,
            "inland_reason": inland_reason or None,
            "landlocked_hint": landlocked_hint,
            "alternatives_offered": offer_alternatives and len(alternatives) > 0,
        },
        "limitations": [*base_limitations, *mixed_mode_notes],
    }
    return response
