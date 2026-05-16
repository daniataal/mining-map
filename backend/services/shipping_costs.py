"""Shipping method cost model for multi-leg product movement."""

from __future__ import annotations

import os
from dataclasses import asdict, dataclass, field
from typing import Any


SUPPORTED_SHIPPING_METHODS = ("sea", "road", "rail", "pipeline", "air")


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return float(raw)
    except (TypeError, ValueError):
        return default


METHOD_RATE_USD_PER_TON_KM: dict[str, float] = {
    "sea": _env_float("SHIPPING_RATE_SEA_USD_PER_TON_KM", 0.03),
    "road": _env_float("SHIPPING_RATE_ROAD_USD_PER_TON_KM", 0.12),
    "rail": _env_float("SHIPPING_RATE_RAIL_USD_PER_TON_KM", 0.08),
    "pipeline": _env_float("SHIPPING_RATE_PIPELINE_USD_PER_TON_KM", 0.05),
    "air": _env_float("SHIPPING_RATE_AIR_USD_PER_TON_KM", 0.45),
}

PORT_FEE_USD_PER_SEA_LEG = _env_float("SHIPPING_PORT_FEE_USD", 2500.0)
INSURANCE_RATE = _env_float("SHIPPING_INSURANCE_RATE", 0.01)
PIPELINE_CONNECTION_FEE_USD = _env_float("SHIPPING_PIPELINE_CONNECTION_FEE_USD", 750.0)


@dataclass
class CostComponent:
    component: str
    amount_usd: float
    formula: str
    meta: dict[str, Any] = field(default_factory=dict)


@dataclass
class LegCostBreakdown:
    leg_id: str
    method: str
    distance_km: float
    cargo_tons: float
    base_cost_usd: float
    extras_cost_usd: float
    insurance_cost_usd: float
    total_cost_usd: float
    components: list[CostComponent] = field(default_factory=list)


@dataclass
class RouteCostBreakdown:
    currency: str
    cargo_tons: float
    total_distance_km: float
    method_subtotals_usd: dict[str, float]
    leg_costs: list[LegCostBreakdown]
    stubs: dict[str, Any]
    total_cost_usd: float


def estimate_leg_cost(leg: dict[str, Any], cargo_tons: float) -> LegCostBreakdown:
    method = str(leg.get("method", "")).strip().lower()
    if method not in METHOD_RATE_USD_PER_TON_KM:
        raise ValueError(f"Unsupported shipping method '{method}'")

    distance_km = float(leg.get("distance_km") or 0.0)
    rate = METHOD_RATE_USD_PER_TON_KM[method]

    base_cost = distance_km * cargo_tons * rate
    extras = 0.0
    components: list[CostComponent] = [
        CostComponent(
            component="distance_base",
            amount_usd=base_cost,
            formula=f"{distance_km:.2f}km * {cargo_tons:.2f}t * {rate:.4f} usd/(t*km)",
            meta={"method_rate_usd_per_ton_km": rate},
        )
    ]

    if method == "sea":
        sea_port_fee = float(leg.get("port_fee_usd", PORT_FEE_USD_PER_SEA_LEG))
        extras += sea_port_fee
        components.append(
            CostComponent(
                component="port_fee_stub",
                amount_usd=sea_port_fee,
                formula="flat sea leg fee (stub)",
            )
        )
    elif method == "pipeline":
        connection_fee = float(leg.get("pipeline_connection_fee_usd", PIPELINE_CONNECTION_FEE_USD))
        extras += connection_fee
        components.append(
            CostComponent(
                component="pipeline_connection_fee",
                amount_usd=connection_fee,
                formula="flat pipeline connection fee",
            )
        )

    insured_base = base_cost + extras
    insurance_cost = insured_base * INSURANCE_RATE
    components.append(
        CostComponent(
            component="insurance_stub",
            amount_usd=insurance_cost,
            formula=f"({insured_base:.2f}) * {INSURANCE_RATE:.4f}",
        )
    )

    total = insured_base + insurance_cost
    return LegCostBreakdown(
        leg_id=str(leg.get("leg_id") or ""),
        method=method,
        distance_km=distance_km,
        cargo_tons=cargo_tons,
        base_cost_usd=base_cost,
        extras_cost_usd=extras,
        insurance_cost_usd=insurance_cost,
        total_cost_usd=total,
        components=components,
    )


def estimate_route_cost(legs: list[dict[str, Any]], cargo_tons: float) -> RouteCostBreakdown:
    method_subtotals = {method: 0.0 for method in SUPPORTED_SHIPPING_METHODS}
    leg_costs: list[LegCostBreakdown] = []
    total_distance = 0.0

    for leg in legs:
        leg_cost = estimate_leg_cost(leg, cargo_tons)
        leg_costs.append(leg_cost)
        method_subtotals[leg_cost.method] += leg_cost.total_cost_usd
        total_distance += leg_cost.distance_km

    total_cost = sum(item.total_cost_usd for item in leg_costs)
    method_subtotals = {k: v for k, v in method_subtotals.items() if v > 0}
    return RouteCostBreakdown(
        currency="USD",
        cargo_tons=cargo_tons,
        total_distance_km=total_distance,
        method_subtotals_usd=method_subtotals,
        leg_costs=leg_costs,
        stubs={
            "port_fee": "Included for sea legs via SHIPPING_PORT_FEE_USD.",
            "insurance": "Applied to each leg via SHIPPING_INSURANCE_RATE.",
        },
        total_cost_usd=total_cost,
    )


def route_cost_to_dict(breakdown: RouteCostBreakdown) -> dict[str, Any]:
    payload = asdict(breakdown)
    payload["leg_costs"] = [
        {
            **asdict(leg),
            "components": [asdict(component) for component in leg.components],
        }
        for leg in breakdown.leg_costs
    ]
    return payload
