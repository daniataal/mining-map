"""Staged multi-modal route planning with shipping cost estimates.

This is still an open-data first planning engine, not a contracted freight
quote. The important v1 behavior is that international movements are modeled
as realistic handoffs: inland pickup -> export gateway -> trunk route ->
import gateway -> final delivery. Sea legs include corridor waypoints so the
map does not draw impossible straight lines over land.
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass, field
from typing import Any, Optional

try:
    from backend.services.shipping_costs import estimate_route_cost, route_cost_to_dict
    from backend.services.vessel_ais import NAVIGATIONAL_STATUS_LABELS
except ImportError:
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
    method_score: float
    notes: list[str] = field(default_factory=list)
    path: list[tuple[float, float]] = field(default_factory=list)
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
)

AIR_HUBS: tuple[TransportHub, ...] = (
    TransportHub("Kenneth Kaunda International Airport", -15.330, 28.452, "Zambia", "airport"),
    TransportHub("OR Tambo International Airport", -26.133, 28.242, "South Africa", "airport"),
    TransportHub("Julius Nyerere International Airport", -6.878, 39.202, "Tanzania", "airport"),
    TransportHub("Kotoka International Airport", 5.605, -0.167, "Ghana", "airport"),
    TransportHub("Jomo Kenyatta International Airport", -1.319, 36.928, "Kenya", "airport"),
    TransportHub("Dubai International Airport", 25.253, 55.365, "United Arab Emirates", "airport"),
    TransportHub("Amsterdam Schiphol Airport", 52.310, 4.768, "Netherlands", "airport"),
    TransportHub("Frankfurt Airport", 50.037, 8.562, "Germany", "airport"),
    TransportHub("London Heathrow Airport", 51.470, -0.454, "United Kingdom", "airport"),
    TransportHub("Singapore Changi Airport", 1.364, 103.991, "Singapore", "airport"),
    TransportHub("Shanghai Pudong Airport", 31.144, 121.808, "China", "airport"),
)

SEA_ANCHORS: dict[str, tuple[str, float, float]] = {
    "bab_el_mandeb": ("Bab el-Mandeb sea lane", 12.610, 43.330),
    "suez": ("Suez Canal approach", 29.960, 32.550),
    "east_med": ("Eastern Mediterranean lane", 34.200, 27.000),
    "gibraltar": ("Strait of Gibraltar", 35.960, -5.600),
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


def _same_place(a: RoutePoint, b: RoutePoint, max_km: float = 35.0) -> bool:
    return _haversine_km(a.lat, a.lng, b.lat, b.lng) <= max_km


def _is_europe(point: RoutePoint) -> bool:
    return 35.0 <= point.lat <= 72.0 and -15.0 <= point.lng <= 45.0


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


def _sea_anchor_ids_one_way(origin: RoutePoint, destination: RoutePoint) -> list[str]:
    if _is_europe(destination):
        if _is_asia_indian_ocean(origin):
            return ["malacca", "colombo", "bab_el_mandeb", "suez", "east_med", "gibraltar", "english_channel"]
        if _is_southern_africa(origin):
            return ["cape", "west_africa", "gibraltar", "english_channel"]
        if _is_east_or_south_africa(origin):
            return ["bab_el_mandeb", "suez", "east_med", "gibraltar", "english_channel"]
        if _is_west_africa(origin):
            return ["west_africa", "gibraltar", "english_channel"]
        if _is_americas(origin):
            return ["mid_atlantic", "english_channel"]
    if _is_europe(origin):
        return list(reversed(_sea_anchor_ids_one_way(destination, origin)))
    if _is_americas(origin) and _is_asia_indian_ocean(destination):
        return ["panama", "malacca"]
    if _is_asia_indian_ocean(origin) and _is_americas(destination):
        return ["malacca", "panama"]
    return []


def _sea_path(origin: RoutePoint, destination: RoutePoint) -> list[tuple[float, float]]:
    points = [(origin.lat, origin.lng)]
    for anchor_id in _sea_anchor_ids_one_way(origin, destination):
        anchor = _anchor_point(anchor_id)
        if _haversine_km(points[-1][0], points[-1][1], anchor.lat, anchor.lng) > 120:
            points.append((anchor.lat, anchor.lng))
    if _haversine_km(points[-1][0], points[-1][1], destination.lat, destination.lng) > 1:
        points.append((destination.lat, destination.lng))
    return points


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
            f"{stage}. Sea trunk leg uses static corridor waypoints and AIS-ready ports; "
            "attach vessel/booking data before execution."
        )
    if method == "air":
        return f"{stage}. Air leg is for high-value/low-volume cargo and requires airline/security quote validation."
    if method == "rail":
        return f"{stage}. Rail selected as lower-cost inland bridge where a corridor exists; validate rail slot availability."
    if method == "pipeline":
        return f"{stage}. Pipeline requires confirmed connection rights and product compatibility."
    return f"{stage}. Trucking/drayage estimate; validate road permits, border documents, and secure transport."


def _make_leg(
    index: int,
    from_point: RoutePoint,
    to_point: RoutePoint,
    method: str,
    quantity_tons: float,
    *,
    stage: str,
    path: Optional[list[tuple[float, float]]] = None,
    cost_overrides: Optional[dict[str, Any]] = None,
) -> PlannedLeg:
    route_path = path or [(from_point.lat, from_point.lng), (to_point.lat, to_point.lng)]
    raw_distance = _path_distance_km(route_path)
    if raw_distance <= 0:
        raw_distance = 0.001
    effective_distance = raw_distance * METHOD_DISTANCE_MULTIPLIERS[method]
    score = effective_distance
    if method == "air":
        score *= 3.0
    if quantity_tons >= 300 and method in {"rail", "sea", "pipeline"}:
        score *= 0.9

    notes = [_leg_note(method, stage)]
    if method == "sea":
        notes.append(f"AIS status references available: {len(NAVIGATIONAL_STATUS_LABELS)}")

    return PlannedLeg(
        leg_id=f"leg-{index + 1}",
        from_point=from_point,
        to_point=to_point,
        method=method,
        distance_km=effective_distance,
        method_score=score,
        notes=notes,
        path=route_path,
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
    path: Optional[list[tuple[float, float]]] = None,
    cost_overrides: Optional[dict[str, Any]] = None,
) -> None:
    if _same_place(from_point, to_point):
        return
    legs.append(
        _make_leg(
            len(legs),
            from_point,
            to_point,
            method,
            quantity_tons,
            stage=stage,
            path=path,
            cost_overrides=cost_overrides,
        )
    )


def _plan_sea_route(
    origin: RoutePoint,
    destination: RoutePoint,
    requested_methods: list[str],
    quantity_tons: float,
) -> tuple[list[PlannedLeg], list[RoutePoint]]:
    legs: list[PlannedLeg] = []
    export_port = _point_from_hub(_nearest_hub(origin, MARITIME_HUBS))
    import_port = _point_from_hub(_nearest_hub(destination, MARITIME_HUBS))

    origin_to_port_km = _haversine_km(origin.lat, origin.lng, export_port.lat, export_port.lng)
    import_to_dest_km = _haversine_km(import_port.lat, import_port.lng, destination.lat, destination.lng)
    _append_if_not_same(
        legs,
        origin,
        export_port,
        _inland_method(requested_methods, origin_to_port_km),
        quantity_tons,
        stage="1. Inland pickup to export port",
    )
    _append_if_not_same(
        legs,
        export_port,
        import_port,
        "sea",
        quantity_tons,
        stage="2. Ocean trunk route between nominated ports",
        path=_sea_path(export_port, import_port),
    )
    _append_if_not_same(
        legs,
        import_port,
        destination,
        _inland_method(requested_methods, import_to_dest_km),
        quantity_tons,
        stage="3. Final delivery from import port",
    )
    return legs, [export_port, import_port]


def _plan_air_route(
    origin: RoutePoint,
    destination: RoutePoint,
    requested_methods: list[str],
    quantity_tons: float,
) -> tuple[list[PlannedLeg], list[RoutePoint]]:
    legs: list[PlannedLeg] = []
    export_airport = _point_from_hub(_nearest_hub(origin, AIR_HUBS))
    import_airport = _point_from_hub(_nearest_hub(destination, AIR_HUBS))
    origin_to_air_km = _haversine_km(origin.lat, origin.lng, export_airport.lat, export_airport.lng)
    import_to_dest_km = _haversine_km(import_airport.lat, import_airport.lng, destination.lat, destination.lng)

    _append_if_not_same(
        legs,
        origin,
        export_airport,
        _inland_method(requested_methods, origin_to_air_km),
        quantity_tons,
        stage="1. Secure pickup to export airport",
    )
    _append_if_not_same(
        legs,
        export_airport,
        import_airport,
        "air",
        quantity_tons,
        stage="2. Air cargo trunk route",
    )
    _append_if_not_same(
        legs,
        import_airport,
        destination,
        _inland_method(requested_methods, import_to_dest_km),
        quantity_tons,
        stage="3. Secure final delivery from airport",
    )
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


def plan_route(request_payload: dict[str, Any]) -> dict[str, Any]:
    origin = _to_point(request_payload["origin"], "origin")
    destination = _to_point(request_payload["destination"], "destination")

    quantity_tons = float(request_payload.get("quantity_tons") or 1.0)
    pipeline_layer_enabled = bool(request_payload.get("pipeline_layer_enabled", False))
    preferred_methods_raw = request_payload.get("preferred_methods")
    preferred_methods = preferred_methods_raw if isinstance(preferred_methods_raw, list) else None
    requested_methods = _requested_backend_methods(preferred_methods)

    if "sea" in requested_methods:
        legs, gateways = _plan_sea_route(origin, destination, requested_methods, quantity_tons)
        strategy = "staged-inland-port-sea-port-inland"
    elif "air" in requested_methods:
        legs, gateways = _plan_air_route(origin, destination, requested_methods, quantity_tons)
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

    legs_payload = [
        {
            "leg_id": leg.leg_id,
            "from": asdict(leg.from_point),
            "to": asdict(leg.to_point),
            "method": leg.method,
            "distance_km": round(leg.distance_km, 3),
            "method_score": round(leg.method_score, 3),
            "notes": leg.notes,
            "path": [[round(lat, 5), round(lng, 5)] for lat, lng in leg.path],
            **leg.cost_overrides,
        }
        for leg in legs
    ]

    cost_breakdown = estimate_route_cost(legs_payload, cargo_tons=quantity_tons)
    return {
        "product": request_payload.get("product"),
        "quantity_tons": quantity_tons,
        "supported_methods": list(SUPPORTED_SHIPPING_METHODS),
        "pipeline_layer_enabled": pipeline_layer_enabled,
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
        "limitations": [
            "Gateway catalog is static and open-first; validate nominated port/airport acceptance, storage, and documentation.",
            "Sea corridors are waypoint approximations, not final vessel routing or berth-to-berth navigation.",
            "Freight cost is a screening estimate; obtain broker/carrier quotes before committing.",
        ],
    }
