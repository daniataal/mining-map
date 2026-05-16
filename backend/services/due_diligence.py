"""Due-diligence evaluation engine for supplier→buyer routing.

Five check dimensions evaluated in order:
  1. sanctions   – supplier/buyer country against OFAC/EU/UNSC list
  2. corridor    – embargoed supplier→buyer+product pairs
  3. license     – DB license validity for declared license IDs (or coverage query)
  4. kyc         – KYC tier by transaction value + entity name completeness
  5. commodity   – conflict mineral screen + product-type-specific advisories

─── Route-planner integration hook ──────────────────────────────────────────
Call this before `plan_route` finalises a route:

    from services.due_diligence import evaluate_due_diligence
    from schemas.due_diligence import DDRequest

    report = evaluate_due_diligence(
        DDRequest(
            supplier_country=origin.metadata.get("country", ""),
            buyer_country=destination.metadata.get("country", ""),
            product_type=payload["product"],
            quantity_tons=payload.get("quantity_tons"),
            license_ids=payload.get("license_ids"),
        ),
        db_conn=conn,   # optional psycopg2 connection; pass None to skip DB checks
    )
    if report.recommendation == "block":
        raise ValueError("Route blocked by DD: " + "; ".join(report.blockers))
    response["due_diligence"] = report.model_dump()

─── Extending the rules engine ──────────────────────────────────────────────
• Country lists / embargo corridors / KYC thresholds:
    Edit backend/data/dd_rules.json — no Python changes required.

• New check dimension:
    1. Write a `_check_<dimension>(req, rules) -> list[CheckResult]` function.
    2. Append it to the `_ALL_CHECKERS` list at the bottom of this file.
    The scorer/recommender picks it up automatically.

• Override scoring weights:
    Adjust "scoring" block in dd_rules.json (fail_deduction, warn_deduction,
    approve_threshold, block_threshold).
"""

from __future__ import annotations

import json
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Rules loader
# ---------------------------------------------------------------------------

_RULES_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "dd_rules.json")
_RULES_CACHE: Optional[dict[str, Any]] = None


def _load_rules() -> dict[str, Any]:
    global _RULES_CACHE
    if _RULES_CACHE is not None:
        return _RULES_CACHE
    try:
        with open(_RULES_PATH, encoding="utf-8") as fh:
            _RULES_CACHE = json.load(fh)
    except FileNotFoundError:
        logger.warning("dd_rules.json not found at %s; using empty ruleset", _RULES_PATH)
        _RULES_CACHE = {}
    return _RULES_CACHE


def reload_rules() -> None:
    """Force-reload dd_rules.json from disk (useful in tests or hot-reload scenarios)."""
    global _RULES_CACHE
    _RULES_CACHE = None
    _load_rules()


# ---------------------------------------------------------------------------
# Import schemas with dual-path fallback (direct run vs package import)
# ---------------------------------------------------------------------------

try:
    from backend.schemas.due_diligence import CheckResult, DDRequest, DueDiligenceReport
except ImportError:
    from schemas.due_diligence import CheckResult, DDRequest, DueDiligenceReport  # type: ignore[no-redef]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _normalise_country(name: str) -> str:
    """Lower-strip for case-insensitive comparisons."""
    return (name or "").strip().lower()


def _country_in_list(country: str, lst: list[str]) -> bool:
    target = _normalise_country(country)
    return any(_normalise_country(c) == target for c in lst)


def _product_matches(product_type: str, rule_products: list[str]) -> bool:
    """True if rule_products contains '*' or the normalised product_type."""
    normalised = (product_type or "").strip().lower()
    for p in rule_products:
        if p.strip() == "*" or p.strip().lower() == normalised:
            return True
    return False


# ---------------------------------------------------------------------------
# Check: sanctions
# ---------------------------------------------------------------------------

def _check_sanctions(req: DDRequest, rules: dict[str, Any]) -> list[CheckResult]:
    sanctioned: list[str] = rules.get("sanctioned_countries", [])
    high_risk: list[str] = rules.get("high_risk_countries", [])
    results: list[CheckResult] = []

    for role, country in [("supplier", req.supplier_country), ("buyer", req.buyer_country)]:
        if _country_in_list(country, sanctioned):
            results.append(
                CheckResult(
                    check_id=f"sanctions.{role}",
                    dimension="sanctions",
                    verdict="fail",
                    message=(
                        f"{role.capitalize()} country '{country}' appears on the sanctioned-country list. "
                        "This route cannot be approved."
                    ),
                    detail={"country": country, "role": role, "list": "sanctioned_countries"},
                )
            )
        elif _country_in_list(country, high_risk):
            results.append(
                CheckResult(
                    check_id=f"sanctions.{role}_high_risk",
                    dimension="sanctions",
                    verdict="warn",
                    message=(
                        f"{role.capitalize()} country '{country}' is classified as high-risk. "
                        "Enhanced monitoring and escalation to compliance team required."
                    ),
                    detail={"country": country, "role": role, "list": "high_risk_countries"},
                )
            )
        else:
            results.append(
                CheckResult(
                    check_id=f"sanctions.{role}",
                    dimension="sanctions",
                    verdict="pass",
                    message=f"{role.capitalize()} country '{country}' is not on any sanctions or high-risk list.",
                    detail={"country": country, "role": role},
                )
            )

    return results


# ---------------------------------------------------------------------------
# Check: embargoed corridors
# ---------------------------------------------------------------------------

def _check_corridor(req: DDRequest, rules: dict[str, Any]) -> list[CheckResult]:
    corridors: list[dict[str, Any]] = rules.get("embargoed_corridors", [])
    supplier_norm = _normalise_country(req.supplier_country)
    buyer_norm = _normalise_country(req.buyer_country)

    for corridor in corridors:
        rule_supplier = corridor.get("supplier_country", "*").strip()
        rule_buyer = corridor.get("buyer_country", "*").strip()
        rule_products: list[str] = corridor.get("products", ["*"])
        embargo_id = corridor.get("id", "unknown")

        supplier_match = rule_supplier == "*" or _normalise_country(rule_supplier) == supplier_norm
        buyer_match = rule_buyer == "*" or _normalise_country(rule_buyer) == buyer_norm
        product_match = _product_matches(req.product_type, rule_products)

        if supplier_match and buyer_match and product_match:
            return [
                CheckResult(
                    check_id=f"corridor.{embargo_id}",
                    dimension="corridor",
                    verdict="fail",
                    message=(
                        f"Trade corridor '{req.supplier_country}' → '{req.buyer_country}' "
                        f"for product '{req.product_type}' is embargoed. "
                        f"Reason: {corridor.get('reason', 'Regulatory restriction')}"
                    ),
                    detail={
                        "embargo_id": embargo_id,
                        "supplier_country": req.supplier_country,
                        "buyer_country": req.buyer_country,
                        "product_type": req.product_type,
                        "reason": corridor.get("reason"),
                    },
                )
            ]

    return [
        CheckResult(
            check_id="corridor.clear",
            dimension="corridor",
            verdict="pass",
            message=(
                f"No active embargo found for '{req.supplier_country}' → '{req.buyer_country}' "
                f"({req.product_type})."
            ),
            detail={},
        )
    ]


# ---------------------------------------------------------------------------
# Check: license validity
# ---------------------------------------------------------------------------

def _check_licenses(
    req: DDRequest,
    rules: dict[str, Any],
    db_conn: Any,
) -> tuple[list[CheckResult], bool]:
    """Returns (check_results, license_check_performed)."""
    if db_conn is None:
        return (
            [
                CheckResult(
                    check_id="license.no_db",
                    dimension="license",
                    verdict="warn",
                    message=(
                        "No database connection provided; license validity could not be verified. "
                        "Pass db_conn to evaluate_due_diligence() for live license checks."
                    ),
                    detail={},
                )
            ],
            False,
        )

    commodity_rules: dict[str, Any] = rules.get("commodity_rules", {})
    pt = (req.product_type or "other").lower()
    valid_statuses: list[str] = (
        commodity_rules.get(pt, {}).get("required_license_statuses", ["active", "Active", "ACTIVE", "granted"])
    )

    results: list[CheckResult] = []

    # --- Specific license ID validation ---
    if req.license_ids:
        for lid in req.license_ids:
            try:
                with db_conn.cursor() as cur:
                    cur.execute(
                        "SELECT id, company, country, commodity, license_type, status "
                        "FROM licenses WHERE id = %s",
                        (lid,),
                    )
                    row = cur.fetchone()
            except Exception as exc:
                logger.warning("License DB query failed for id=%s: %s", lid, exc)
                results.append(
                    CheckResult(
                        check_id=f"license.query_error.{lid[:16]}",
                        dimension="license",
                        verdict="warn",
                        message=f"License lookup failed for ID '{lid}': {exc}",
                        detail={"license_id": lid},
                    )
                )
                continue

            if row is None:
                results.append(
                    CheckResult(
                        check_id=f"license.not_found.{lid[:16]}",
                        dimension="license",
                        verdict="fail",
                        message=f"License ID '{lid}' not found in the license registry.",
                        detail={"license_id": lid},
                    )
                )
                continue

            # row is dict-like or tuple; handle both RealDictCursor and plain cursor
            if hasattr(row, "keys"):
                r = dict(row)
            else:
                keys = ["id", "company", "country", "commodity", "license_type", "status"]
                r = dict(zip(keys, row))

            status = str(r.get("status") or "").strip()
            if status not in valid_statuses:
                results.append(
                    CheckResult(
                        check_id=f"license.invalid_status.{lid[:16]}",
                        dimension="license",
                        verdict="fail",
                        message=(
                            f"License '{lid}' ({r.get('company', 'unknown')}) has status '{status}', "
                            f"which is not an accepted active status for '{req.product_type}' trades."
                        ),
                        detail={
                            "license_id": lid,
                            "status": status,
                            "expected_statuses": valid_statuses,
                            "company": r.get("company"),
                            "country": r.get("country"),
                        },
                    )
                )
            else:
                # Check country consistency
                lic_country = _normalise_country(str(r.get("country") or ""))
                supplier_norm = _normalise_country(req.supplier_country)
                country_mismatch = lic_country and supplier_norm and lic_country != supplier_norm

                results.append(
                    CheckResult(
                        check_id=f"license.valid.{lid[:16]}",
                        dimension="license",
                        verdict="warn" if country_mismatch else "pass",
                        message=(
                            (
                                f"License '{lid}' is active but issued in '{r.get('country')}', "
                                f"not the declared supplier country '{req.supplier_country}'."
                            )
                            if country_mismatch
                            else (
                                f"License '{lid}' ({r.get('company', 'unknown')}) is active "
                                f"and consistent with the declared route."
                            )
                        ),
                        detail={
                            "license_id": lid,
                            "status": status,
                            "license_country": r.get("country"),
                            "supplier_country": req.supplier_country,
                            "country_mismatch": country_mismatch,
                        },
                    )
                )

        return results, True

    # --- Coverage query (no specific license IDs given) ---
    try:
        with db_conn.cursor() as cur:
            cur.execute(
                "SELECT COUNT(*) FROM licenses "
                "WHERE country ILIKE %s AND status = ANY(%s) "
                "LIMIT 1",
                (req.supplier_country, valid_statuses),
            )
            row = cur.fetchone()
            count = row[0] if row else 0
    except Exception as exc:
        logger.warning("License coverage query failed: %s", exc)
        return (
            [
                CheckResult(
                    check_id="license.coverage_error",
                    dimension="license",
                    verdict="warn",
                    message=f"License coverage query failed: {exc}",
                    detail={},
                )
            ],
            True,
        )

    if count == 0:
        return (
            [
                CheckResult(
                    check_id="license.no_coverage",
                    dimension="license",
                    verdict="warn",
                    message=(
                        f"No active {req.product_type} licenses found for '{req.supplier_country}' "
                        "in the registry. Provide license_ids in the request for explicit validation."
                    ),
                    detail={"supplier_country": req.supplier_country, "product_type": req.product_type},
                )
            ],
            True,
        )

    return (
        [
            CheckResult(
                check_id="license.coverage_ok",
                dimension="license",
                verdict="pass",
                message=(
                    f"Active licenses found for '{req.supplier_country}' ({req.product_type}). "
                    "Provide specific license_ids for stricter per-license validation."
                ),
                detail={
                    "supplier_country": req.supplier_country,
                    "product_type": req.product_type,
                    "active_license_count": count,
                },
            )
        ],
        True,
    )


# ---------------------------------------------------------------------------
# Check: KYC
# ---------------------------------------------------------------------------

def _check_kyc(req: DDRequest, rules: dict[str, Any]) -> list[CheckResult]:
    thresholds: dict[str, Any] = rules.get("kyc_thresholds", {})
    enhanced_threshold = float(thresholds.get("enhanced_kyc_above_usd", 1_000_000))
    results: list[CheckResult] = []

    # Entity name completeness
    missing_names: list[str] = []
    if not req.supplier_entity_name:
        missing_names.append("supplier")
    if not req.buyer_entity_name:
        missing_names.append("buyer")

    if missing_names:
        results.append(
            CheckResult(
                check_id="kyc.entity_name_missing",
                dimension="kyc",
                verdict="warn",
                message=(
                    f"Entity name(s) missing for: {', '.join(missing_names)}. "
                    "KYC screening cannot be completed without legal entity names."
                ),
                detail={"missing_roles": missing_names},
            )
        )
    else:
        # Placeholder: actual watchlist / PEP screening would call an external API here.
        # To integrate: replace this pass with a call to your KYC provider SDK, e.g.
        #   result = kyc_provider.screen(req.supplier_entity_name, req.buyer_entity_name)
        results.append(
            CheckResult(
                check_id="kyc.name_screen",
                dimension="kyc",
                verdict="pass",
                message=(
                    f"Entity names provided: '{req.supplier_entity_name}' / '{req.buyer_entity_name}'. "
                    "Automated name screening placeholder — integrate KYC provider for live results."
                ),
                detail={
                    "supplier_entity_name": req.supplier_entity_name,
                    "buyer_entity_name": req.buyer_entity_name,
                    "screening_status": "placeholder",
                },
            )
        )

    # Transaction value tier
    if req.estimated_value_usd is not None:
        if req.estimated_value_usd >= enhanced_threshold:
            results.append(
                CheckResult(
                    check_id="kyc.high_value",
                    dimension="kyc",
                    verdict="warn",
                    message=(
                        f"Transaction value ${req.estimated_value_usd:,.0f} exceeds enhanced-KYC threshold "
                        f"(${enhanced_threshold:,.0f}). Full UBO disclosure and senior compliance sign-off required."
                    ),
                    detail={
                        "estimated_value_usd": req.estimated_value_usd,
                        "enhanced_kyc_threshold_usd": enhanced_threshold,
                        "kyc_tier": "enhanced",
                    },
                )
            )
        else:
            results.append(
                CheckResult(
                    check_id="kyc.value_tier",
                    dimension="kyc",
                    verdict="pass",
                    message=(
                        f"Transaction value ${req.estimated_value_usd:,.0f} is below enhanced-KYC threshold."
                    ),
                    detail={
                        "estimated_value_usd": req.estimated_value_usd,
                        "kyc_tier": "standard",
                    },
                )
            )
    else:
        results.append(
            CheckResult(
                check_id="kyc.value_unknown",
                dimension="kyc",
                verdict="warn",
                message=(
                    "Transaction value not provided. Cannot determine KYC tier. "
                    "Defaulting to enhanced-KYC posture."
                ),
                detail={"kyc_tier": "unknown"},
            )
        )

    return results


# ---------------------------------------------------------------------------
# Check: commodity-specific
# ---------------------------------------------------------------------------

def _check_commodity(req: DDRequest, rules: dict[str, Any]) -> list[CheckResult]:
    commodity_rules: dict[str, Any] = rules.get("commodity_rules", {})
    pt = (req.product_type or "other").lower()
    ctype = commodity_rules.get(pt, {})
    results: list[CheckResult] = []

    # Conflict mineral screening (primarily mining)
    conflict_minerals: list[str] = ctype.get("conflict_minerals", [])
    conflict_high_risk_countries: list[str] = ctype.get("conflict_mineral_high_risk_countries", [])

    if conflict_minerals and req.commodity:
        commodity_norm = (req.commodity or "").strip().lower()
        is_conflict_mineral = any(cm.lower() == commodity_norm for cm in conflict_minerals)
        is_high_risk_origin = _country_in_list(req.supplier_country, conflict_high_risk_countries)

        if is_conflict_mineral and is_high_risk_origin:
            results.append(
                CheckResult(
                    check_id="commodity.conflict_mineral_high_risk",
                    dimension="commodity",
                    verdict="fail",
                    message=(
                        f"'{req.commodity}' is a potential conflict mineral and the supplier country "
                        f"'{req.supplier_country}' is on the conflict-mineral high-risk list. "
                        "OECD Due Diligence Guidance and ICGLR certification required before approval."
                    ),
                    detail={
                        "commodity": req.commodity,
                        "supplier_country": req.supplier_country,
                        "conflict_mineral": True,
                        "high_risk_origin": True,
                    },
                )
            )
        elif is_conflict_mineral:
            results.append(
                CheckResult(
                    check_id="commodity.conflict_mineral",
                    dimension="commodity",
                    verdict="warn",
                    message=(
                        f"'{req.commodity}' is listed as a potential conflict mineral. "
                        "Provenance documentation recommended even for non-high-risk origins."
                    ),
                    detail={
                        "commodity": req.commodity,
                        "conflict_mineral": True,
                        "high_risk_origin": False,
                    },
                )
            )
        else:
            results.append(
                CheckResult(
                    check_id="commodity.conflict_mineral_clear",
                    dimension="commodity",
                    verdict="pass",
                    message=f"'{req.commodity}' is not flagged as a conflict mineral for '{req.product_type}'.",
                    detail={"commodity": req.commodity},
                )
            )
    elif conflict_minerals and not req.commodity:
        results.append(
            CheckResult(
                check_id="commodity.unspecified",
                dimension="commodity",
                verdict="warn",
                message=(
                    f"Commodity not specified for '{req.product_type}' route. "
                    "Cannot perform conflict-mineral screening. "
                    "Provide 'commodity' in the request."
                ),
                detail={"product_type": req.product_type},
            )
        )

    # Product-type-specific advisories
    advisories: list[str] = ctype.get("certifications_advisory", [])
    if advisories:
        results.append(
            CheckResult(
                check_id=f"commodity.certifications_{pt}",
                dimension="commodity",
                verdict="pass",
                message=(
                    f"Advisory: consider obtaining or verifying {', '.join(advisories)} certification(s) "
                    f"for '{pt}' trades. Not blocking but recommended for counterparty due diligence."
                ),
                detail={"certifications": advisories, "product_type": pt},
            )
        )

    if ctype.get("offshore_extra_check"):
        results.append(
            CheckResult(
                check_id="commodity.offshore_flag",
                dimension="commodity",
                verdict="warn",
                message=(
                    "Oil/petroleum route flagged for offshore-field extra check. "
                    "Confirm field classification (onshore/offshore) and environmental permit status."
                ),
                detail={"product_type": pt},
            )
        )

    if ctype.get("pipeline_check"):
        results.append(
            CheckResult(
                check_id="commodity.pipeline_transit",
                dimension="commodity",
                verdict="warn",
                message=(
                    "Gas route may involve cross-border pipeline transit. "
                    "Verify transit-country agreements and GIIGNL membership where applicable."
                ),
                detail={"product_type": pt},
            )
        )

    if not results:
        results.append(
            CheckResult(
                check_id=f"commodity.{pt}_ok",
                dimension="commodity",
                verdict="pass",
                message=f"No specific commodity restrictions apply for '{pt}'.",
                detail={"product_type": pt},
            )
        )

    return results


# ---------------------------------------------------------------------------
# Scoring and recommendation
# ---------------------------------------------------------------------------

def _score_and_recommend(
    checks: list[CheckResult],
    rules: dict[str, Any],
) -> tuple[float, list[str], str]:
    """Returns (overall_score, blockers, recommendation)."""
    scoring = rules.get("scoring", {})
    fail_deduction = float(scoring.get("fail_deduction", 35))
    warn_deduction = float(scoring.get("warn_deduction", 10))
    approve_threshold = float(scoring.get("approve_threshold", 80))
    block_threshold = float(scoring.get("block_threshold", 50))

    score = 100.0
    blockers: list[str] = []
    has_fail = False

    for check in checks:
        if check.verdict == "fail":
            score -= fail_deduction
            blockers.append(check.message)
            has_fail = True
        elif check.verdict == "warn":
            score -= warn_deduction

    score = max(0.0, min(100.0, score))

    if has_fail or score < block_threshold:
        recommendation = "block"
    elif score < approve_threshold:
        recommendation = "escalate"
    else:
        recommendation = "approve"

    return round(score, 1), blockers, recommendation


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

# Registry of all check functions.  Each entry is a callable accepting
# (req, rules) or (req, rules, db_conn) for the license check.
# To add a new dimension: write a _check_X function and append it here.
_ALL_CHECKERS = [
    ("sanctions", _check_sanctions),
    ("corridor", _check_corridor),
    ("kyc", _check_kyc),
    ("commodity", _check_commodity),
]


def evaluate_due_diligence(
    req: DDRequest,
    *,
    db_conn: Any = None,
) -> DueDiligenceReport:
    """Evaluate a routing DD request and return a structured report.

    Args:
        req: DDRequest with route parameters.
        db_conn: Optional psycopg2 connection for live license lookups.
                 When None, license checks degrade to a single WARN.

    Returns:
        DueDiligenceReport with per-check verdicts, score, and recommendation.

    Integration note:
        The route planner should call this before calling `plan_route`.
        A "block" recommendation must prevent route finalisation.
        An "escalate" recommendation should attach the report to the route
        response as `due_diligence` and surface warnings in the UI.
    """
    rules = _load_rules()
    all_checks: list[CheckResult] = []

    for _dim, checker_fn in _ALL_CHECKERS:
        try:
            all_checks.extend(checker_fn(req, rules))
        except Exception as exc:
            logger.exception("DD checker '%s' raised an unexpected error: %s", _dim, exc)
            all_checks.append(
                CheckResult(
                    check_id=f"{_dim}.error",
                    dimension=_dim,
                    verdict="warn",
                    message=f"Check '{_dim}' could not complete due to an internal error: {exc}",
                    detail={"error": str(exc)},
                )
            )

    license_results, license_performed = _check_licenses(req, rules, db_conn)
    all_checks.extend(license_results)

    score, blockers, recommendation = _score_and_recommend(all_checks, rules)

    return DueDiligenceReport(
        request_id=str(uuid.uuid4()),
        supplier_country=req.supplier_country,
        buyer_country=req.buyer_country,
        product_type=req.product_type,
        commodity=req.commodity,
        checks=all_checks,
        overall_score=score,
        blockers=blockers,
        recommendation=recommendation,
        evaluated_at=datetime.now(timezone.utc).isoformat(),
        rules_version=rules.get("_version", "unknown"),
        license_check_performed=license_performed,
    )
