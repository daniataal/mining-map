"""Pydantic schemas for the routing due-diligence module.

Contract used by:
  - POST /api/routing/due-diligence  (HTTP surface)
  - services.due_diligence.evaluate_due_diligence  (engine)
  - services.route_planner (integration hook — see docstring in due_diligence.py)
"""

from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


class DDRequest(BaseModel):
    """Input for a single due-diligence evaluation.

    Minimum viable call: supplier_country + buyer_country + product_type.
    Supply license_ids and estimated_value_usd for richer checks.
    """

    supplier_country: str = Field(..., description="ISO country name or code of the supplier / origin")
    buyer_country: str = Field(..., description="ISO country name or code of the buyer / destination")
    product_type: str = Field(
        ...,
        description="Broad product category: 'mining', 'oil', 'gas', 'petroleum', or 'other'",
    )
    commodity: Optional[str] = Field(
        None,
        description="Specific commodity (e.g. 'gold', 'crude_oil', 'LNG', 'coltan'). "
        "Used for conflict-mineral screening.",
    )
    license_ids: Optional[list[str]] = Field(
        None,
        description="License IDs from the licenses table to validate against this route. "
        "When omitted, the engine performs a coverage query instead.",
    )
    quantity_tons: Optional[float] = Field(None, ge=0, description="Shipment volume in metric tons")
    estimated_value_usd: Optional[float] = Field(
        None, ge=0, description="Estimated transaction value in USD; drives KYC tier"
    )
    supplier_entity_name: Optional[str] = Field(None, description="Legal name of the supplier entity")
    buyer_entity_name: Optional[str] = Field(None, description="Legal name of the buyer entity")


class CheckResult(BaseModel):
    """Result of one atomic compliance check."""

    check_id: str = Field(..., description="Unique slug for the rule, e.g. 'sanctions.supplier'")
    dimension: str = Field(
        ...,
        description="Check family: 'sanctions' | 'corridor' | 'license' | 'kyc' | 'commodity'",
    )
    verdict: Literal["pass", "warn", "fail"]
    message: str
    detail: dict[str, Any] = Field(default_factory=dict)


class DueDiligenceReport(BaseModel):
    """Complete DD report returned by the engine and the API endpoint.

    Route-planner integration pattern (see route_planner.py hook point):

        report = evaluate_due_diligence(DDRequest(...), db_conn=conn)
        if report.recommendation == "block":
            raise ValueError("Route blocked: " + "; ".join(report.blockers))
        if report.recommendation == "escalate":
            response["dd_warning"] = report.model_dump()
    """

    request_id: str = Field(..., description="UUID for this evaluation run")
    supplier_country: str
    buyer_country: str
    product_type: str
    commodity: Optional[str] = None
    checks: list[CheckResult]
    overall_score: float = Field(
        ...,
        ge=0,
        le=100,
        description="Compliance score 0-100; 100 = fully clean, 0 = fully blocked",
    )
    blockers: list[str] = Field(
        default_factory=list,
        description="Human-readable reasons from all FAIL-level checks",
    )
    recommendation: Literal["approve", "escalate", "block"]
    evaluated_at: str = Field(..., description="ISO-8601 UTC timestamp")
    rules_version: str = Field(..., description="Version string from dd_rules.json")
    license_check_performed: bool = Field(
        False,
        description="True when at least one DB license lookup was attempted",
    )
