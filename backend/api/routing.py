"""HTTP surface for the supplier -> buyer product routing platform.

Owned by the architecture agent. Endpoints are intentionally stubs; the
real implementation lands in three parallel agents:

* Routing engine -- resolves ``RoutePlanRequest`` into ordered ``RouteLeg``s
  by combining mining/oil license coordinates, vessel positions from the
  AIS feed (``backend/services/maritime_intel.py``), port info from
  ``backend/services/port_logistics.py``, and country borders from
  ``backend/country_borders.py``.
* Cost engine -- fills ``CostBreakdown`` for each leg / the whole plan via
  ``POST /api/routing/cost-estimate``.
* Due diligence -- writes ``DueDiligenceStatus`` for the supplier, buyer,
  and (optionally) carriers / transit countries; the routing API only
  surfaces the latest snapshot.

The router is mounted from ``main.py`` only when ``ROUTE_PLANNER_ENABLED``
is truthy so the legacy ``/api/logistics/shipments`` endpoints are never
shadowed by half-built routing logic.
"""

from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

try:
    from backend.schemas.routing import (
        Buyer,
        CostBreakdown,
        CostEstimateRequest,
        CostEstimateResponse,
        DueDiligenceState,
        DueDiligenceStatus,
        GeoPoint,
        LocationRef,
        Product,
        RouteLeg,
        RoutePlan,
        RoutePlanListItem,
        RoutePlanRequest,
        RoutePlanStatus,
        Sector,
        ShippingMethod,
        ShippingMethodInfo,
        Supplier,
    )
except ImportError:  # Mirrors the dual-import idiom used in main.py.
    from schemas.routing import (  # type: ignore[no-redef]
        Buyer,
        CostBreakdown,
        CostEstimateRequest,
        CostEstimateResponse,
        DueDiligenceState,
        DueDiligenceStatus,
        GeoPoint,
        LocationRef,
        Product,
        RouteLeg,
        RoutePlan,
        RoutePlanListItem,
        RoutePlanRequest,
        RoutePlanStatus,
        Sector,
        ShippingMethod,
        ShippingMethodInfo,
        Supplier,
    )


ROUTE_PLANNER_ENABLED_ENV = "ROUTE_PLANNER_ENABLED"

router = APIRouter(prefix="/api/routing", tags=["routing"])


def is_route_planner_enabled() -> bool:
    """Truthy check matching the convention used elsewhere (``DISABLE_*``,
    ``MARITIME_*``). Defaults to off so production stays on the existing
    ``/api/logistics/shipments`` flow until the routing engine ships."""

    raw = (os.getenv(ROUTE_PLANNER_ENABLED_ENV) or "").strip().lower()
    return raw in {"1", "true", "yes", "on", "enabled"}


# ---------------------------------------------------------------------------
# Static catalogue served by the methods endpoint.
# ---------------------------------------------------------------------------

_SHIPPING_METHODS: list[ShippingMethodInfo] = [
    ShippingMethodInfo(
        method=ShippingMethod.TRUCK,
        label="Road freight",
        description="Truck movement within or across land borders. Fast for short hops, scales poorly across continents.",
        typical_speed_kmh=60.0,
        typical_cost_usd_per_tkm=0.10,
        requires_port=False,
        supports_hazardous=True,
        notes="Costs vary materially by corridor (insurance, security escorts in high-risk countries).",
    ),
    ShippingMethodInfo(
        method=ShippingMethod.RAIL,
        label="Rail freight",
        description="Bulk inland movement; only available where rail corridors exist between the supplier and a port.",
        typical_speed_kmh=45.0,
        typical_cost_usd_per_tkm=0.04,
        requires_port=False,
        supports_hazardous=True,
    ),
    ShippingMethodInfo(
        method=ShippingMethod.SEA,
        label="Sea freight",
        description="Cheapest mode for long hauls; requires port handoffs at both ends and a specific vessel.",
        typical_speed_kmh=35.0,
        typical_cost_usd_per_tkm=0.005,
        requires_port=True,
        supports_hazardous=True,
        notes="Vessel reference comes from the AIS feed at /api/maritime/vessels.",
    ),
    ShippingMethodInfo(
        method=ShippingMethod.AIR,
        label="Air freight",
        description="Used for high-value low-volume cargo only (e.g. precious metals dore).",
        typical_speed_kmh=750.0,
        typical_cost_usd_per_tkm=2.50,
        requires_port=False,
        supports_hazardous=False,
        notes="Hazardous goods need IATA DGR clearance; treat support as case-by-case.",
    ),
    ShippingMethodInfo(
        method=ShippingMethod.PIPELINE,
        label="Pipeline",
        description="Continuous transport for crude / refined oil / gas only.",
        typical_speed_kmh=10.0,
        typical_cost_usd_per_tkm=0.015,
        requires_port=False,
        supports_hazardous=True,
        notes="Only applicable for Sector.OIL_AND_GAS products.",
    ),
    ShippingMethodInfo(
        method=ShippingMethod.INLAND_WATERWAY,
        label="Inland waterway",
        description="Barge / river freight; relevant on the Niger, Nile, Mississippi, Rhine, Yangtze corridors.",
        typical_speed_kmh=15.0,
        typical_cost_usd_per_tkm=0.02,
        requires_port=True,
        supports_hazardous=True,
    ),
    ShippingMethodInfo(
        method=ShippingMethod.MULTIMODAL,
        label="Multimodal",
        description="Composite leg covered by a single carrier (e.g. door-to-door 3PL); details land on the leg metadata.",
        typical_speed_kmh=None,
        typical_cost_usd_per_tkm=None,
        requires_port=False,
        supports_hazardous=True,
    ),
]


# ---------------------------------------------------------------------------
# Helpers used by stubs.
# ---------------------------------------------------------------------------


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _ensure_enabled() -> None:
    if not is_route_planner_enabled():
        raise HTTPException(
            status_code=503,
            detail=(
                f"Route planner is disabled. Set {ROUTE_PLANNER_ENABLED_ENV}=1 "
                "to expose this contract while the routing engine is being built."
            ),
        )


def _stub_supplier_from_id(supplier_id: str) -> Supplier:
    """Placeholder supplier hydration.

    Real implementation: SELECT from licenses by id and map the row through
    the same shape used by ``_build_license_api_results`` in main.py.
    """
    return Supplier(
        id=supplier_id,
        company=f"Supplier {supplier_id}",
        sector=Sector.MINING,
        origin=LocationRef(
            name=f"Supplier site {supplier_id}",
            point=GeoPoint(lat=0.0, lng=0.0),
        ),
        origin_license_id=supplier_id,
        dd_status=DueDiligenceStatus(state=DueDiligenceState.NOT_STARTED),
    )


def _stub_buyer_from_id(buyer_id: str) -> Buyer:
    return Buyer(
        id=buyer_id,
        company=f"Buyer {buyer_id}",
        destination=LocationRef(
            name=f"Buyer site {buyer_id}",
            point=GeoPoint(lat=0.0, lng=0.0),
        ),
        dd_status=DueDiligenceStatus(state=DueDiligenceState.NOT_STARTED),
    )


def _aggregate_dd(*statuses: Optional[DueDiligenceStatus]) -> DueDiligenceStatus:
    """Pessimistic aggregator. Real DD agent will replace this."""

    state = DueDiligenceState.NOT_STARTED
    findings: list[str] = []
    blocking: list[str] = []
    risk_level: Optional[str] = None
    confidence: Optional[float] = None
    last_checked: Optional[datetime] = None

    severity = {
        DueDiligenceState.NOT_STARTED: 0,
        DueDiligenceState.PENDING: 1,
        DueDiligenceState.PASSED: 2,
        DueDiligenceState.EXPIRED: 3,
        DueDiligenceState.FLAGGED: 4,
        DueDiligenceState.BLOCKED: 5,
    }

    for status in statuses:
        if status is None:
            continue
        if severity[status.state] >= severity[state]:
            state = status.state
            risk_level = status.risk_level or risk_level
            confidence = status.confidence if status.confidence is not None else confidence
            last_checked = status.last_checked_at or last_checked
        findings.extend(status.findings)
        blocking.extend(status.blocking_findings)

    return DueDiligenceStatus(
        state=state,
        risk_level=risk_level,
        confidence=confidence,
        findings=findings,
        blocking_findings=blocking,
        last_checked_at=last_checked,
    )


# ---------------------------------------------------------------------------
# Endpoints (stubs).
# ---------------------------------------------------------------------------


@router.get("/shipping-methods", response_model=list[ShippingMethodInfo])
def list_shipping_methods() -> list[ShippingMethodInfo]:
    """Catalogue of supported shipping methods.

    Pure-static; safe to expose without DB access. The UI consumes this for
    method pickers and tooltips.
    """
    _ensure_enabled()
    return list(_SHIPPING_METHODS)


@router.post("/plans", response_model=RoutePlan)
def create_route_plan(payload: RoutePlanRequest) -> RoutePlan:
    """Stub for ``POST /api/routing/plans``.

    Real routing engine should:
    1. Resolve ``supplier``/``buyer`` (via ``supplier_id``/``buyer_id`` against
       the existing licenses table when set) and verify both parties exist.
    2. Build the leg graph using port_logistics + maritime_intel + country_borders.
    3. Call the cost engine (``POST /api/routing/cost-estimate``) for the
       computed legs and persist the result.
    4. Pull the latest DD snapshot for both parties from
       ``services/dd/orchestrator.py``.
    5. Persist the ``RoutePlan`` (new ``route_plans`` table) and return it.
    """

    _ensure_enabled()

    if payload.supplier is None and not payload.supplier_id:
        raise HTTPException(status_code=400, detail="supplier or supplier_id required")
    if payload.buyer is None and not payload.buyer_id:
        raise HTTPException(status_code=400, detail="buyer or buyer_id required")

    supplier = payload.supplier or _stub_supplier_from_id(payload.supplier_id or "unknown")
    buyer = payload.buyer or _stub_buyer_from_id(payload.buyer_id or "unknown")

    plan_id = str(uuid.uuid4())
    plan = RoutePlan(
        id=plan_id,
        status=RoutePlanStatus.DRAFT,
        supplier=supplier,
        buyer=buyer,
        product=payload.product,
        incoterm=payload.incoterm or "FOB",
        legs=[],
        cost_breakdown=CostBreakdown(notes="Stub: routing engine has not run yet."),
        dd_status=_aggregate_dd(supplier.dd_status, buyer.dd_status),
        requested_departure=payload.requested_departure,
        requested_arrival=payload.requested_arrival,
        created_at=_utcnow(),
        updated_at=_utcnow(),
        notes=payload.notes,
        metadata={
            "stub": True,
            "preferred_methods": [m.value for m in payload.preferred_methods],
            "avoid_country_iso2": list(payload.avoid_country_iso2),
        },
    )
    return plan


@router.get("/plans", response_model=list[RoutePlanListItem])
def list_route_plans(
    supplier_id: Optional[str] = Query(default=None),
    buyer_id: Optional[str] = Query(default=None),
    status: Optional[RoutePlanStatus] = Query(default=None),
    limit: int = Query(default=50, ge=1, le=500),
) -> list[RoutePlanListItem]:
    """Stub list endpoint. Real implementation reads from ``route_plans``."""
    _ensure_enabled()
    _ = (supplier_id, buyer_id, status, limit)
    return []


@router.get("/plans/{plan_id}", response_model=RoutePlan)
def get_route_plan(plan_id: str) -> RoutePlan:
    """Stub fetch endpoint. Returns 404 until persistence lands."""
    _ensure_enabled()
    raise HTTPException(
        status_code=404,
        detail=f"RoutePlan {plan_id} not found (route plan persistence not implemented yet).",
    )


@router.post("/cost-estimate", response_model=CostEstimateResponse)
def estimate_cost(payload: CostEstimateRequest) -> CostEstimateResponse:
    """Stub for ``POST /api/routing/cost-estimate``.

    The cost engine should:
    1. Load legs from ``payload.plan_id`` or use ``payload.legs`` directly.
    2. For each leg, multiply ``distance_km * product.quantity`` by the
       method-specific rate (see ``_SHIPPING_METHODS`` for indicative values
       only -- real numbers belong in a rate-card service).
    3. Add fixed line items for handling, customs, insurance, and docs.
    """
    _ensure_enabled()

    if not payload.plan_id and not payload.legs:
        raise HTTPException(status_code=400, detail="plan_id or legs required")

    legs: list[RouteLeg] = payload.legs or []
    per_leg = [
        CostBreakdown(notes=f"Stub estimate for leg {leg.id} ({leg.method.value}).")
        for leg in legs
    ]
    return CostEstimateResponse(
        plan_id=payload.plan_id,
        cost_breakdown=CostBreakdown(notes="Stub: cost engine has not run yet."),
        per_leg=per_leg,
        limitations=[
            "Cost engine is not implemented; all amounts are zero.",
            "Rate-card and insurance multipliers are owned by the cost engine agent.",
        ],
    )


@router.get("/plans/{plan_id}/dd-status", response_model=DueDiligenceStatus)
def get_route_plan_dd_status(plan_id: str) -> DueDiligenceStatus:
    """Stub for the per-plan DD pull-through.

    Real implementation joins the latest ``dd_reports`` rows for the
    supplier and the buyer (and any carrier with a sanctions hit).
    """
    _ensure_enabled()
    _ = plan_id
    return DueDiligenceStatus(
        state=DueDiligenceState.NOT_STARTED,
        findings=["Stub: DD orchestrator has not been wired to the route planner yet."],
    )
