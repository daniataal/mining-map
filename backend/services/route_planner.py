"""Simple multi-leg route planning with shipping cost estimates."""

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

# Simple route inflation multipliers so straight-line distance can approximate network distance.
METHOD_DISTANCE_MULTIPLIERS: dict[str, float] = {
    "sea": 1.15,
    "road": 1.25,
    "rail": 1.18,
    "pipeline": 1.10,
    "air": 1.05,
}


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


def _to_point(payload: dict[str, Any], default_kind: str) -> RoutePoint:
    return RoutePoint(
        name=str(payload.get("name") or payload.get("id") or default_kind),
        lat=float(payload["lat"]),
        lng=float(payload["lng"]),
        kind=str(payload.get("kind") or default_kind),
        metadata=payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {},
    )


def _haversine_km(a_lat: float, a_lng: float, b_lat: float, b_lng: float) -> float:
    r_km = 6371.0
    d_lat = math.radians(b_lat - a_lat)
    d_lng = math.radians(b_lng - a_lng)
    aa = (
        math.sin(d_lat / 2) ** 2
        + math.cos(math.radians(a_lat)) * math.cos(math.radians(b_lat)) * math.sin(d_lng / 2) ** 2
    )
    return 2 * r_km * math.atan2(math.sqrt(aa), math.sqrt(1 - aa))


def _pipeline_viable(a: RoutePoint, b: RoutePoint, layer_enabled: bool) -> bool:
    # Hook point for real pipeline topology checks; currently guarded by feature flag.
    if not layer_enabled:
        return False
    return a.kind in {"refinery", "terminal", "port", "pipeline_node"} or b.kind in {
        "refinery",
        "terminal",
        "port",
        "pipeline_node",
    }


def _normalized_methods(
    requested_methods: Optional[list[str]],
    *,
    pipeline_layer_enabled: bool,
    from_point: RoutePoint,
    to_point: RoutePoint,
) -> list[str]:
    if requested_methods:
        candidates = [item.strip().lower() for item in requested_methods if str(item).strip()]
    else:
        candidates = list(SUPPORTED_SHIPPING_METHODS)

    filtered: list[str] = []
    for method in candidates:
        if method not in SUPPORTED_SHIPPING_METHODS:
            continue
        if method == "pipeline" and not _pipeline_viable(from_point, to_point, pipeline_layer_enabled):
            continue
        filtered.append(method)
    return filtered or ["road"]


def _leg_note(method: str) -> Optional[str]:
    if method == "sea":
        return (
            "Sea leg is AIS-aware; attach vessel hints (mmsi/imo/destination) for downstream "
            "tracking consistency with vessel_ais records."
        )
    if method == "pipeline":
        return "Pipeline leg chosen only when pipeline layer support is enabled."
    if method == "air":
        return "Air is currently a planning stub and may be cost-prohibitive at scale."
    return None


def _plan_leg(
    leg_index: int,
    from_point: RoutePoint,
    to_point: RoutePoint,
    methods: list[str],
    quantity_tons: float,
) -> PlannedLeg:
    straight_line_km = _haversine_km(from_point.lat, from_point.lng, to_point.lat, to_point.lng)
    if straight_line_km <= 0:
        straight_line_km = 0.001

    choices: list[tuple[str, float, float]] = []
    for method in methods:
        multiplier = METHOD_DISTANCE_MULTIPLIERS[method]
        effective_distance = straight_line_km * multiplier
        score = effective_distance
        if method == "air":
            score *= 3.0
        # Encourage heavier flows to prefer rail/sea/pipeline over road when feasible.
        if quantity_tons >= 300 and method in {"rail", "sea", "pipeline"}:
            score *= 0.9
        choices.append((method, effective_distance, score))

    chosen_method, chosen_distance, chosen_score = sorted(choices, key=lambda row: row[2])[0]
    notes: list[str] = []
    extra_note = _leg_note(chosen_method)
    if extra_note:
        notes.append(extra_note)
    if chosen_method == "sea":
        notes.append(f"AIS status references available: {len(NAVIGATIONAL_STATUS_LABELS)}")

    return PlannedLeg(
        leg_id=f"leg-{leg_index + 1}",
        from_point=from_point,
        to_point=to_point,
        method=chosen_method,
        distance_km=chosen_distance,
        method_score=chosen_score,
        notes=notes,
    )


def plan_route(request_payload: dict[str, Any]) -> dict[str, Any]:
    origin = _to_point(request_payload["origin"], "origin")
    destination = _to_point(request_payload["destination"], "destination")
    transit_raw = request_payload.get("transit_points") or []
    transit_points = [_to_point(item, "transit") for item in transit_raw if isinstance(item, dict)]

    quantity_tons = float(request_payload.get("quantity_tons") or 1.0)
    pipeline_layer_enabled = bool(request_payload.get("pipeline_layer_enabled", False))
    preferred_methods_raw = request_payload.get("preferred_methods")
    preferred_methods = preferred_methods_raw if isinstance(preferred_methods_raw, list) else None

    points = [origin, *transit_points, destination]
    legs: list[PlannedLeg] = []
    for idx in range(len(points) - 1):
        from_point = points[idx]
        to_point = points[idx + 1]
        candidate_methods = _normalized_methods(
            preferred_methods,
            pipeline_layer_enabled=pipeline_layer_enabled,
            from_point=from_point,
            to_point=to_point,
        )
        legs.append(_plan_leg(idx, from_point, to_point, candidate_methods, quantity_tons))

    legs_payload = [
        {
            "leg_id": leg.leg_id,
            "from": asdict(leg.from_point),
            "to": asdict(leg.to_point),
            "method": leg.method,
            "distance_km": round(leg.distance_km, 3),
            "method_score": round(leg.method_score, 3),
            "notes": leg.notes,
        }
        for leg in legs
    ]

    cost_breakdown = estimate_route_cost(legs_payload, cargo_tons=quantity_tons)
    response: dict[str, Any] = {
        "product": request_payload.get("product"),
        "quantity_tons": quantity_tons,
        "supported_methods": list(SUPPORTED_SHIPPING_METHODS),
        "pipeline_layer_enabled": pipeline_layer_enabled,
        "route": {
            "origin": asdict(origin),
            "transit_points": [asdict(item) for item in transit_points],
            "destination": asdict(destination),
            "legs": legs_payload,
            "optimization": {
                "strategy": "greedy-shortest-effective-distance",
                "note": "Selects best method per user-selected leg sequence.",
            },
        },
        "cost_breakdown": route_cost_to_dict(cost_breakdown),
    }
    return response
