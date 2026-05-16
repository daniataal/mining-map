"""Domain models for the supplier -> buyer product routing platform.

This module is the single source of truth for the routing contract. Other
agents implement against the shapes here:

* Routing engine: consumes ``RoutePlanRequest`` and returns ``RoutePlan`` with
  resolved ``legs`` and a populated ``CostBreakdown``.
* Due diligence: writes ``DueDiligenceStatus`` for the supplier, the buyer,
  and (optionally) each transit country, then attaches it to the plan.
* UI (mining-viz): renders ``RoutePlan`` directly; the camelCase mirror lives
  in ``mining-viz/src/types/routing.ts``.

Layer connections (how this slots into the existing platform):

* **Supply origin** -- A ``Supplier`` is anchored to a row in the existing
  ``licenses`` table via ``origin_license_id``. Mining licenses (sector
  ``mining``) and oil/gas licenses (sector ``oil_and_gas``) are both valid
  supply origins; the sector flows through to ``Product.sector``.
* **Sea legs** -- A ``RouteLeg`` with ``method = ShippingMethod.SEA`` may
  reference a vessel via ``vessel_ref`` (MMSI / IMO / name). The values
  match the AIS feed produced by ``backend/services/maritime_intel.py`` and
  ``backend/services/vessel_ais.py``; the routing engine should reuse those
  helpers to resolve a current position / ETA.
* **Port handoffs** -- Land<->sea handoffs are modelled as a ``LocationRef``
  with ``unlocode`` populated. Resolvable nodes come from
  ``backend/services/port_logistics.py`` and ``storage_terminals.py``.
* **Land risk** -- The country list on ``RouteLeg.country_crossings`` is
  expected to be derived from ``backend/country_borders.py`` so the routing
  engine and the DD layer agree on which jurisdictions a leg touches.
* **Existing shipments** -- The legacy ``/api/logistics/shipments`` endpoint
  and ``deal_shipments`` table remain untouched. A new ``Shipment`` (a
  concrete instance of a ``RoutePlan``) is what the routing platform
  produces; an adapter can fan a ``Shipment.legs`` list out into the legacy
  ``deal_shipments`` table for backwards compatibility if needed.
* **Due diligence** -- ``DueDiligenceStatus.report_id`` points at an entry
  in the ``dd_reports`` table managed by
  ``backend/services/dd/orchestrator.py``. The routing API never writes DD
  results itself; it only surfaces the latest snapshot.

The full pipeline is intentionally dependency-light at this stage: every
heavy field (``cost_breakdown``, ``dd_status``, ``legs[*].risk_factors``,
``legs[*].est_cost``) is optional so that other agents can fill it in
without coordinating breaking schema changes.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------


class ShippingMethod(str, Enum):
    """Transport modes a single ``RouteLeg`` can use.

    The enum is intentionally coarse. Sub-modes (e.g. reefer truck vs.
    flatbed) belong on ``RouteLeg.metadata`` so they do not bloat the
    routing engine's matching logic.
    """

    TRUCK = "truck"
    RAIL = "rail"
    SEA = "sea"
    AIR = "air"
    PIPELINE = "pipeline"
    INLAND_WATERWAY = "inland_waterway"
    MULTIMODAL = "multimodal"


class RoutePlanStatus(str, Enum):
    """Lifecycle of a ``RoutePlan`` record."""

    DRAFT = "draft"
    PROPOSED = "proposed"
    APPROVED = "approved"
    REJECTED = "rejected"
    EXECUTED = "executed"
    CANCELLED = "cancelled"


class ShipmentStatus(str, Enum):
    """Mirrors the ``ShipmentStatus`` union in mining-viz/src/types."""

    PLANNED = "planned"
    IN_TRANSIT = "in-transit"
    DELIVERED = "delivered"
    CANCELLED = "cancelled"


class DueDiligenceState(str, Enum):
    """Coarse DD verdict; granular findings live on the DD report itself."""

    NOT_STARTED = "not_started"
    PENDING = "pending"
    PASSED = "passed"
    FLAGGED = "flagged"
    BLOCKED = "blocked"
    EXPIRED = "expired"


class PartyKind(str, Enum):
    SUPPLIER = "supplier"
    BUYER = "buyer"
    CARRIER = "carrier"
    AGENT = "agent"


class Sector(str, Enum):
    """Mirrors the ``sector`` field already used by ``licenses``."""

    MINING = "mining"
    OIL_AND_GAS = "oil_and_gas"
    OTHER = "other"


# ---------------------------------------------------------------------------
# Shared building blocks
# ---------------------------------------------------------------------------


class GeoPoint(BaseModel):
    """A single coordinate on the map; matches the ``lat``/``lng`` convention
    used everywhere else in the project (see ``MiningLicense`` in
    ``mining-viz/src/types``)."""

    lat: float
    lng: float


class LocationRef(BaseModel):
    """A node on the route graph.

    A ``LocationRef`` may be a plain coordinate, an UN/LOCODE port, a license
    site, a logistics node, or a buyer warehouse. The routing engine should
    treat any field as advisory but use ``locode`` first when present.
    """

    name: str
    country: Optional[str] = None
    country_iso2: Optional[str] = Field(default=None, max_length=2)
    region: Optional[str] = None
    locode: Optional[str] = Field(
        default=None,
        description="UN/LOCODE for ports / inland points, when known.",
    )
    point: Optional[GeoPoint] = None
    license_id: Optional[str] = Field(
        default=None,
        description="Source row in the existing ``licenses`` table when this "
        "node is a mining/oil/gas license site.",
    )
    port_id: Optional[str] = Field(
        default=None,
        description="Identifier from /api/logistics/ports when this node is a "
        "port served by the port logistics service.",
    )
    storage_terminal_id: Optional[str] = Field(
        default=None,
        description="Identifier from /api/storage/terminals when this node is "
        "a storage / tank-farm terminal.",
    )
    address: Optional[str] = None
    notes: Optional[str] = None


class ContactRef(BaseModel):
    """Minimal contact pointer; full records live in ``entity_contacts``."""

    name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    entity_contact_id: Optional[str] = None


class VesselRef(BaseModel):
    """Reference to a vessel for ``ShippingMethod.SEA`` legs.

    Values are designed to round-trip with the AIS feed at
    ``/api/maritime/vessels`` (see ``backend/services/vessel_ais.py``).
    """

    mmsi: Optional[str] = None
    imo: Optional[str] = None
    name: Optional[str] = None
    flag: Optional[str] = None
    last_observed_at: Optional[datetime] = None


class CarrierRef(BaseModel):
    """Carrier moving a single leg (truck operator, shipping line, airline).

    The routing engine populates this; the DD layer can attach a
    ``DueDiligenceStatus`` per carrier via the optional ``dd_status`` field.
    """

    name: str
    party_id: Optional[str] = None
    contact: Optional[ContactRef] = None
    dd_status: Optional["DueDiligenceStatus"] = None


# ---------------------------------------------------------------------------
# Due diligence
# ---------------------------------------------------------------------------


class DueDiligenceStatus(BaseModel):
    """Snapshot of DD for a supplier, buyer, carrier, or whole route plan.

    The DD agent is the only writer; the routing API surfaces the latest
    ``DueDiligenceStatus`` next to whatever object it applies to so the UI
    can colour the route without a second round-trip. ``report_id`` points
    at an entry written by ``backend/services/dd/orchestrator.py``.
    """

    state: DueDiligenceState = DueDiligenceState.NOT_STARTED
    risk_level: Optional[str] = Field(
        default=None,
        description='Free-form, e.g. "low" / "medium" / "high"; matches the '
        "existing DD orchestrator output.",
    )
    confidence: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    summary: Optional[str] = None
    findings: list[str] = Field(default_factory=list)
    blocking_findings: list[str] = Field(default_factory=list)
    sanctions_hits: list[str] = Field(default_factory=list)
    report_id: Optional[str] = Field(
        default=None,
        description="ID of the dd_reports row produced by the DD orchestrator.",
    )
    last_checked_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None


# ---------------------------------------------------------------------------
# Parties: Supplier / Buyer / Product
# ---------------------------------------------------------------------------


class Supplier(BaseModel):
    """Origin party. Anchored to a license row whenever possible."""

    id: str
    company: str
    sector: Sector = Sector.MINING
    country: Optional[str] = None
    country_iso2: Optional[str] = Field(default=None, max_length=2)
    origin: LocationRef
    origin_license_id: Optional[str] = Field(
        default=None,
        description="Foreign key into the licenses table; preferred when the "
        "supplier is an existing licensed operator.",
    )
    contact: Optional[ContactRef] = None
    dd_status: Optional[DueDiligenceStatus] = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class Buyer(BaseModel):
    """Destination party. May be external (no license row required)."""

    id: str
    company: str
    country: Optional[str] = None
    country_iso2: Optional[str] = Field(default=None, max_length=2)
    destination: LocationRef
    contact: Optional[ContactRef] = None
    dd_status: Optional[DueDiligenceStatus] = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class Product(BaseModel):
    """The thing being shipped. Quantity defaults to metric tonnes because
    that is what mining/oil flows already report against."""

    sku: Optional[str] = None
    name: str
    sector: Sector = Sector.MINING
    commodity: Optional[str] = Field(
        default=None,
        description='e.g. "gold dore", "copper concentrate", "crude petroleum".',
    )
    hs_code: Optional[str] = Field(
        default=None,
        description="HS code (matches the oil_trade_flows table when applicable).",
    )
    quantity: Optional[float] = None
    unit: str = Field(default="t", description='Quantity unit, default metric tonnes ("t").')
    grade: Optional[str] = None
    packaging: Optional[str] = None
    hazardous: bool = False
    value_usd: Optional[float] = Field(
        default=None,
        description="Declared cargo value, used downstream by the cost engine for insurance.",
    )
    metadata: dict[str, Any] = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# Cost
# ---------------------------------------------------------------------------


class CostLine(BaseModel):
    """Single line item inside a ``CostBreakdown``."""

    label: str
    category: str = Field(
        ...,
        description='e.g. "transport", "customs", "insurance", "handling", "documentation", "storage".',
    )
    amount_usd: float
    note: Optional[str] = None


class CostBreakdown(BaseModel):
    """Estimated cost for a leg or the full plan.

    Stub; the routing engine populates ``lines`` and the totals. ``currency``
    is captured for forward compatibility but the API standardises on USD.
    """

    currency: str = "USD"
    total_usd: float = 0.0
    lines: list[CostLine] = Field(default_factory=list)
    confidence: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    estimated_at: Optional[datetime] = None
    estimator: Optional[str] = Field(
        default=None,
        description='Source of the estimate, e.g. "rate_card_v1", "ml_v0".',
    )
    notes: Optional[str] = None


# ---------------------------------------------------------------------------
# Route legs and plan
# ---------------------------------------------------------------------------


class RouteLeg(BaseModel):
    """A single transport segment.

    Legs chain in order. The routing engine guarantees ``leg[i].to_node`` is
    geographically consistent with ``leg[i+1].from_node`` (handoffs at ports,
    border crossings, etc.). Optional fields stay ``None`` until the routing
    or cost engines fill them in.
    """

    id: str
    sequence: int = Field(..., ge=0, description="Position of this leg in the route, starting at 0.")
    method: ShippingMethod
    from_node: LocationRef
    to_node: LocationRef
    distance_km: Optional[float] = None
    est_duration_hours: Optional[float] = None
    departure_eta: Optional[datetime] = None
    arrival_eta: Optional[datetime] = None
    carrier: Optional[CarrierRef] = None
    vessel_ref: Optional[VesselRef] = Field(
        default=None,
        description="Required when method == sea and a specific vessel is in scope; otherwise None.",
    )
    country_crossings: list[str] = Field(
        default_factory=list,
        description="Country names (matching the country_borders.geojson dataset) the leg crosses.",
    )
    risk_factors: list[str] = Field(
        default_factory=list,
        description="Free-form risk signals from the routing engine (e.g. 'sanctions_corridor', 'piracy_zone').",
    )
    est_cost: Optional[CostBreakdown] = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class RoutePlan(BaseModel):
    """A proposed end-to-end routing from ``Supplier`` to ``Buyer``."""

    id: str
    status: RoutePlanStatus = RoutePlanStatus.DRAFT
    supplier: Supplier
    buyer: Buyer
    product: Product
    legs: list[RouteLeg] = Field(default_factory=list)
    incoterm: Optional[str] = Field(
        default="FOB",
        description="Incoterm 2020 code; matches the existing deal_shipments column.",
    )
    cost_breakdown: Optional[CostBreakdown] = None
    dd_status: Optional[DueDiligenceStatus] = None
    requested_departure: Optional[datetime] = None
    requested_arrival: Optional[datetime] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    notes: Optional[str] = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class Shipment(BaseModel):
    """An actual movement against a ``RoutePlan``.

    A ``Shipment`` is what the carrier executes; it tracks live status while
    the parent ``RoutePlan`` stays as the design artefact. The legacy
    ``deal_shipments`` table maps onto a single-leg ``Shipment`` for
    backwards compatibility -- ``deal_id`` / ``deal_label`` carry across.
    """

    id: str
    plan_id: str
    deal_id: Optional[str] = None
    deal_label: Optional[str] = None
    status: ShipmentStatus = ShipmentStatus.PLANNED
    legs: list[RouteLeg] = Field(default_factory=list)
    actual_departure: Optional[datetime] = None
    actual_arrival: Optional[datetime] = None
    eta: Optional[datetime] = None
    notes: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


# ---------------------------------------------------------------------------
# Request / response payloads
# ---------------------------------------------------------------------------


class RoutePlanRequest(BaseModel):
    """Body of ``POST /api/routing/plans``.

    The routing engine resolves missing fields (legs, cost) and returns a
    populated ``RoutePlan``. Either ``supplier`` or ``supplier_id`` must be
    set; same for ``buyer``.
    """

    supplier: Optional[Supplier] = None
    supplier_id: Optional[str] = None
    buyer: Optional[Buyer] = None
    buyer_id: Optional[str] = None
    product: Product
    incoterm: Optional[str] = "FOB"
    requested_departure: Optional[datetime] = None
    requested_arrival: Optional[datetime] = None
    preferred_methods: list[ShippingMethod] = Field(
        default_factory=list,
        description="Optional method preferences; the routing engine still owns final selection.",
    )
    avoid_country_iso2: list[str] = Field(
        default_factory=list,
        description="ISO2 country codes the planner must avoid (e.g. due to sanctions policy).",
    )
    notes: Optional[str] = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class CostEstimateRequest(BaseModel):
    """Body of ``POST /api/routing/cost-estimate``.

    Either references an existing plan via ``plan_id`` or supplies an
    inline ``legs`` list. The cost engine populates ``CostBreakdown`` and
    returns ``CostEstimateResponse``.
    """

    plan_id: Optional[str] = None
    legs: Optional[list[RouteLeg]] = None
    product: Optional[Product] = None
    incoterm: Optional[str] = "FOB"


class CostEstimateResponse(BaseModel):
    plan_id: Optional[str] = None
    cost_breakdown: CostBreakdown
    per_leg: list[CostBreakdown] = Field(default_factory=list)
    limitations: list[str] = Field(default_factory=list)


class ShippingMethodInfo(BaseModel):
    """Description for ``GET /api/routing/shipping-methods``.

    The UI consumes this to render selectors and tooltips; values are
    intentionally simple to avoid coupling to any specific cost model.
    """

    method: ShippingMethod
    label: str
    description: str
    typical_speed_kmh: Optional[float] = None
    typical_cost_usd_per_tkm: Optional[float] = Field(
        default=None,
        description="Indicative cost in USD per tonne-kilometre; null when too variable to quote.",
    )
    requires_port: bool = False
    supports_hazardous: bool = True
    notes: Optional[str] = None


class RoutePlanListItem(BaseModel):
    """Trimmed ``RoutePlan`` for list endpoints."""

    id: str
    status: RoutePlanStatus
    supplier_company: str
    buyer_company: str
    product_name: str
    incoterm: Optional[str] = None
    leg_count: int = 0
    total_distance_km: Optional[float] = None
    total_cost_usd: Optional[float] = None
    dd_state: Optional[DueDiligenceState] = None
    created_at: Optional[datetime] = None


# Resolve the forward reference (CarrierRef -> DueDiligenceStatus declared later).
CarrierRef.model_rebuild()
