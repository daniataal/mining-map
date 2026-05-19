"""U.S. federal procurement intelligence for dossier Gov Spending & Tenders.

Live data is sourced from the public USAspending.gov API (no API key required).
The module searches federal awards by recipient name and normalises rows for the
dossier UI. Non-U.S. licensees typically return zero rows — the response
documents scope and limitations explicitly instead of fabricating awards.

Env vars (all optional):
    GOV_PROCUREMENT_DISABLED       set to 1/true/yes to skip live USAspending calls
    USASPENDING_API_BASE           default https://api.usaspending.gov
    USASPENDING_REQUEST_TIMEOUT    seconds (default 20)
    USASPENDING_AWARD_LIMIT        max rows per entity (default 50)
    USASPENDING_FEED_LIMIT         max rows per commodity profile in aggregate feed (default 40)
    GOV_PROCUREMENT_SYNC_ENABLED   set to 0/false to skip background sync
    GOV_PROCUREMENT_SYNC_ON_STARTUP  set to 1/true to sync on API startup
"""

from __future__ import annotations

import json
import logging
import os
import re
from datetime import date, datetime, timezone
from typing import Any, Callable, Optional
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

logger = logging.getLogger(__name__)

USASPENDING_API_BASE = (os.getenv("USASPENDING_API_BASE") or "https://api.usaspending.gov").rstrip("/")
USASPENDING_SEARCH_PATH = "/api/v2/search/spending_by_award/"
REQUEST_TIMEOUT_SECONDS = float(os.getenv("USASPENDING_REQUEST_TIMEOUT", "20"))
AWARD_LIMIT = max(1, min(int(os.getenv("USASPENDING_AWARD_LIMIT", "50")), 100))
FEED_LIMIT_PER_PROFILE = max(5, min(int(os.getenv("USASPENDING_FEED_LIMIT", "40")), 100))
# USAspending requires award_type_codes from a single group per request.
AWARD_TYPE_GROUPS: dict[str, list[str]] = {
    "contracts": ["A", "B", "C", "D"],
    "grants": ["02", "03", "04", "05"],
    "direct_payments": ["06", "10"],
    "other_assistance": ["09", "11"],
    "loans": ["07", "08"],
}

COMMON_AWARD_FIELDS = [
    "Award ID",
    "Recipient Name",
    "Recipient UEI",
    "Recipient DUNS Number",
    "Description",
    "Award Amount",
    "Awarding Agency",
    "Funding Agency",
    "Award Type",
    "generated_internal_id",
    "recipient_id",
]

CONTRACT_AWARD_FIELDS = [
    *COMMON_AWARD_FIELDS,
    "Start Date",
    "End Date",
    "Contract Award Type",
    "NAICS",
    "PSC",
]

LOAN_AWARD_FIELDS = [
    "Award ID",
    "Recipient Name",
    "Recipient UEI",
    "Recipient DUNS Number",
    "Description",
    "Awarding Agency",
    "Funding Agency",
    "Award Type",
    "Loan Value",
    "Issued Date",
    "generated_internal_id",
    "recipient_id",
]

GROUP_AWARD_FIELDS: dict[str, list[str]] = {
    "contracts": CONTRACT_AWARD_FIELDS,
    "grants": COMMON_AWARD_FIELDS,
    "direct_payments": COMMON_AWARD_FIELDS,
    "other_assistance": COMMON_AWARD_FIELDS,
    "loans": LOAN_AWARD_FIELDS,
}

GROUP_SORT_FIELD: dict[str, str] = {
    "contracts": "Award Amount",
    "grants": "Award Amount",
    "direct_payments": "Award Amount",
    "other_assistance": "Award Amount",
    "loans": "Loan Value",
}

USASPENDING_EARLIEST_DATE = date(2007, 10, 1)

SOURCE_NAME = "USAspending.gov"
SOURCE_HOME = "https://www.usaspending.gov"
LIMITATIONS = [
    "Covers U.S. federal contracts, grants, and loans only — not state, foreign, or private tenders.",
    "Recipient matching is fuzzy on company name; verify high-value awards on usaspending.gov before deal use.",
    "Award amounts reflect obligated federal dollars; outlays may differ.",
    "Data is refreshed by Treasury on a nightly cadence; recent awards may lag.",
]

FEED_LIMITATIONS = [
    *LIMITATIONS,
    "Commodity feed uses NAICS/PSC/keyword filters on federal contracts (last 5 years); grants and loans are not included in the browse feed.",
    "Aggregate company list is deduplicated by UEI or recipient name; totals are summed across matched commodity filters.",
    "Browse list is loaded from the local database (refreshed on schedule by gov-procurement-sync-worker).",
]

# Profiles for browsing federal contractors by commodity (contracts only to limit API volume).
COMMODITY_FEED_PROFILES: list[dict[str, Any]] = [
    {
        "id": "gold",
        "label": "Gold",
        "category": "precious",
        "naics_require": ["212221"],
        "keywords": ["gold ore", "gold mining"],
        "psc_codes": [],
    },
    {
        "id": "silver",
        "label": "Silver",
        "category": "precious",
        "naics_require": ["212222"],
        "keywords": ["silver ore", "silver mining"],
        "psc_codes": [],
    },
    {
        "id": "copper",
        "label": "Copper",
        "category": "strategic",
        "naics_require": ["21223"],
        "keywords": ["copper ore", "copper concentrate"],
        "psc_codes": [],
    },
    {
        "id": "manganese",
        "label": "Manganese",
        "category": "strategic",
        "naics_require": ["2122"],
        "keywords": ["manganese", "ferromanganese"],
        "psc_codes": [],
    },
    {
        "id": "oil",
        "label": "Oil",
        "category": "fuels",
        "naics_require": ["211", "32411"],
        "keywords": ["crude petroleum", "petroleum reserve", "strategic petroleum"],
        "psc_codes": ["1510", "9140"],
    },
    {
        "id": "diesel",
        "label": "Diesel",
        "category": "fuels",
        "naics_require": [],
        "keywords": ["diesel fuel", "ulsd", "distillate fuel", "diesel"],
        "psc_codes": ["1510"],
    },
    {
        "id": "gas",
        "label": "Natural Gas",
        "category": "fuels",
        "naics_require": ["21113"],
        "keywords": ["natural gas", "lng", "liquefied natural gas"],
        "psc_codes": [],
    },
    {
        "id": "sulphur",
        "label": "Sulphur",
        "category": "strategic",
        "naics_require": [],
        "keywords": ["sulfur", "sulphur", "elemental sulfur"],
        "psc_codes": [],
    },
]

FEED_CONTRACT_TYPE_CODES = AWARD_TYPE_GROUPS["contracts"]
FEED_LOOKBACK_YEARS = 5


def _clean_text(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, str):
        cleaned = " ".join(value.split())
        return cleaned or None
    cleaned = str(value).strip()
    return cleaned or None


def _parse_date(value: Any) -> Optional[date]:
    if value in (None, "", " "):
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    raw = _clean_text(value)
    if not raw:
        return None
    candidate = raw.replace("Z", "+00:00")
    for layout in ("%Y-%m-%d", "%Y/%m/%d", "%m/%d/%Y"):
        try:
            return datetime.strptime(candidate[: len(layout)], layout).date()
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(candidate).date()
    except ValueError:
        return None


def _parse_amount(value: Any) -> float:
    if value in (None, "", " "):
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    raw = _clean_text(value)
    if not raw:
        return 0.0
    try:
        return float(raw.replace(",", "").replace("$", ""))
    except ValueError:
        return 0.0


def _gov_procurement_disabled() -> bool:
    flag = (os.getenv("GOV_PROCUREMENT_DISABLED") or "").strip().lower()
    return flag in {"1", "true", "yes", "on"}


def build_usaspending_search_payload(
    company_name: str,
    *,
    award_type_codes: list[str],
    fields: list[str],
    sort_field: str = "Award Amount",
    limit: int = AWARD_LIMIT,
    page: int = 1,
    lookback_years: int = 10,
) -> dict[str, Any]:
    """Build POST body for /api/v2/search/spending_by_award/."""
    today = date.today()
    start_year = max(USASPENDING_EARLIEST_DATE.year, today.year - max(1, lookback_years))
    start_date = max(date(start_year, 10, 1), USASPENDING_EARLIEST_DATE)
    return {
        "filters": {
            "recipient_search_text": [company_name.strip()],
            "award_type_codes": award_type_codes,
            "time_period": [
                {
                    "start_date": start_date.isoformat(),
                    "end_date": today.isoformat(),
                }
            ],
        },
        "fields": fields,
        "limit": limit,
        "page": page,
        "sort": sort_field,
        "order": "desc",
        "subawards": False,
    }


def infer_commodity_and_category(
    *,
    naics: Optional[str] = None,
    psc: Optional[str] = None,
    description: Optional[str] = None,
    award_type: Optional[str] = None,
) -> tuple[str, str]:
    """Map federal award metadata to dossier commodity + filter category."""
    haystack = " ".join(
        part
        for part in (
            _clean_text(naics),
            _clean_text(psc),
            _clean_text(description),
            _clean_text(award_type),
        )
        if part
    ).lower()

    naics_code = re.sub(r"\D", "", haystack[:12])
    if naics_code.startswith("212221") or re.search(r"\bgold\b", haystack):
        return "Gold", "precious"
    if naics_code.startswith("212222") or re.search(r"\bsilver\b", haystack):
        return "Silver", "precious"
    if naics_code.startswith("21223") or re.search(r"\bcopper\b|\bnickel\b|\bzinc\b|\blead\b", haystack):
        return "Base Metals", "strategic"
    if naics_code.startswith("2122") or re.search(r"\bmanganese\b|\bmetallurg", haystack):
        return "Manganese", "strategic"
    if naics_code.startswith("2123") or re.search(r"\bphosphate\b|\bgypsum\b|\blimestone\b", haystack):
        return "Industrial Minerals", "strategic"
    if naics_code.startswith("2131") or re.search(r"\bmining support\b|\bexploration\b", haystack):
        return "Mining Services", "strategic"
    if re.search(r"\boil\b|\bcrude\b|\bpetroleum\b|\bspr\b|\brefined\b|\bjet fuel\b|\bdiesel\b|\bulsd\b", haystack):
        commodity = "Diesel" if re.search(r"\bdiesel\b|\bulsd\b", haystack) else "Oil"
        return commodity, "fuels"
    if re.search(r"\blng\b|\bnatural gas\b|\bgas pipeline\b", haystack):
        return "Natural Gas", "fuels"
    if re.search(r"\bcoal\b", haystack):
        return "Coal", "fuels"
    if re.search(r"\bsulfur\b|\bsulphur\b", haystack):
        return "Sulphur", "strategic"
    if re.search(r"\bplatinum\b|\bpalladium\b|\bprecious\b", haystack):
        return "Precious Metals", "precious"
    if re.search(r"\bgrant\b|\bloan\b|\bassistance\b", haystack):
        return "Federal Assistance", "other"
    return "Federal Award", "other"


def infer_award_status(*, end_date: Optional[date], amount: float) -> str:
    if end_date and end_date < date.today():
        return "COMPLETED"
    if amount <= 0:
        return "UNDER REVIEW"
    return "ACTIVE"


def format_award_period(start: Optional[date], end: Optional[date]) -> str:
    def _fmt(d: Optional[date]) -> str:
        if not d:
            return "—"
        return d.strftime("%b %Y")

    if not start and not end:
        return "Period unknown"
    return f"{_fmt(start)} – {_fmt(end)}"


def usaspending_award_url(generated_internal_id: Optional[str], award_id: Optional[str]) -> Optional[str]:
    token = _clean_text(generated_internal_id) or _clean_text(award_id)
    if not token:
        return None
    return f"{SOURCE_HOME}/award/{token}"


def normalize_usaspending_row(row: dict[str, Any], *, recipient_name: str) -> dict[str, Any]:
    """Normalise a single USAspending result row to snake_case dossier fields."""
    award_id = _clean_text(row.get("Award ID")) or _clean_text(row.get("generated_internal_id")) or "unknown"
    title = (
        _clean_text(row.get("Description"))
        or _clean_text(row.get("Contract Award Type"))
        or _clean_text(row.get("Award Type"))
        or f"Federal award {award_id}"
    )
    agency = (
        _clean_text(row.get("Funding Agency"))
        or _clean_text(row.get("Awarding Agency"))
        or "U.S. Federal"
    )
    amount = _parse_amount(row.get("Award Amount"))
    if amount <= 0:
        amount = _parse_amount(row.get("Loan Value"))
    start = _parse_date(row.get("Start Date")) or _parse_date(row.get("Issued Date"))
    end = _parse_date(row.get("End Date"))
    commodity, category = infer_commodity_and_category(
        naics=_clean_text(row.get("NAICS")),
        psc=_clean_text(row.get("PSC")),
        description=title,
        award_type=_clean_text(row.get("Award Type") or row.get("Contract Award Type")),
    )
    generated_id = _clean_text(row.get("generated_internal_id"))
    return {
        "award_id": award_id,
        "title": title,
        "agency": agency,
        "value_usd": amount,
        "commodity": commodity,
        "category": category,
        "uei": _clean_text(row.get("Recipient UEI")),
        "duns": _clean_text(row.get("Recipient DUNS Number")),
        "status": infer_award_status(end_date=end, amount=amount),
        "period": format_award_period(start, end),
        "recipient": _clean_text(row.get("Recipient Name")) or recipient_name,
        "start_date": start.isoformat() if start else None,
        "end_date": end.isoformat() if end else None,
        "naics": _clean_text(row.get("NAICS")),
        "psc": _clean_text(row.get("PSC")),
        "award_type": _clean_text(row.get("Award Type") or row.get("Contract Award Type")),
        "source_name": SOURCE_NAME,
        "source_url": usaspending_award_url(generated_id, award_id),
        "generated_internal_id": generated_id,
        "recipient_id": _clean_text(row.get("recipient_id")),
    }


def build_procurement_summary(awards: list[dict[str, Any]]) -> dict[str, Any]:
    total = sum(float(a.get("value_usd") or 0) for a in awards)
    active = [a for a in awards if (a.get("status") or "").upper() == "ACTIVE"]
    agency_totals: dict[str, float] = {}
    category_totals: dict[str, float] = {"precious": 0.0, "fuels": 0.0, "strategic": 0.0, "other": 0.0}
    for award in awards:
        agency = _clean_text(award.get("agency")) or "U.S. Federal"
        amount = float(award.get("value_usd") or 0)
        agency_totals[agency] = agency_totals.get(agency, 0.0) + amount
        category = (_clean_text(award.get("category")) or "other").lower()
        if category not in category_totals:
            category = "other"
        category_totals[category] += amount

    top_agency = None
    if agency_totals:
        top_agency = max(agency_totals.items(), key=lambda item: item[1])[0]

    portfolio: dict[str, float] = {}
    if total > 0:
        for key, amount in category_totals.items():
            portfolio[key] = round((amount / total) * 100, 1)
    else:
        portfolio = {key: 0.0 for key in category_totals}

    return {
        "total_awarded_usd": round(total, 2),
        "active_contract_count": len(active),
        "award_count": len(awards),
        "top_funding_agency": top_agency,
        "portfolio_by_category_pct": portfolio,
    }


def build_recipient_profile(awards: list[dict[str, Any]], *, query_name: str) -> Optional[dict[str, Any]]:
    if not awards:
        return None
    first = awards[0]
    return {
        "name": _clean_text(first.get("recipient")) or query_name,
        "uei": _clean_text(first.get("uei")),
        "duns": _clean_text(first.get("duns")),
        "recipient_id": _clean_text(first.get("recipient_id")),
    }


def _default_http_post(url: str, payload: dict[str, Any], *, timeout: float) -> dict[str, Any]:
    body = json.dumps(payload).encode("utf-8")
    req = Request(
        url,
        data=body,
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "mining-map-gov-procurement/1.0",
        },
        method="POST",
    )
    with urlopen(req, timeout=timeout) as response:
        raw = response.read().decode("utf-8")
    return json.loads(raw)


def fetch_usaspending_awards(
    company_name: str,
    *,
    http_post: Callable[..., dict[str, Any]] = _default_http_post,
    limit: int = AWARD_LIMIT,
) -> tuple[list[dict[str, Any]], list[str]]:
    """Return normalised awards and non-fatal warning messages."""
    warnings: list[str] = []
    cleaned_name = _clean_text(company_name)
    if not cleaned_name:
        return [], ["Company name is required to search USAspending."]

    if _gov_procurement_disabled():
        warnings.append("Live USAspending lookup is disabled (GOV_PROCUREMENT_DISABLED).")
        return [], warnings

    url = f"{USASPENDING_API_BASE}{USASPENDING_SEARCH_PATH}"
    per_group_limit = max(5, limit // len(AWARD_TYPE_GROUPS))
    merged_rows: list[dict[str, Any]] = []
    seen_award_ids: set[str] = set()

    for group_name, type_codes in AWARD_TYPE_GROUPS.items():
        payload = build_usaspending_search_payload(
            cleaned_name,
            award_type_codes=type_codes,
            fields=GROUP_AWARD_FIELDS[group_name],
            sort_field=GROUP_SORT_FIELD[group_name],
            limit=per_group_limit,
        )
        try:
            body = http_post(url, payload, timeout=REQUEST_TIMEOUT_SECONDS)
        except HTTPError as exc:
            logger.warning(
                "USAspending HTTP error for %s (%s): %s",
                cleaned_name,
                group_name,
                exc,
            )
            warnings.append(f"USAspending {group_name} search returned HTTP {exc.code}.")
            continue
        except URLError as exc:
            logger.warning("USAspending network error for %s: %s", cleaned_name, exc)
            warnings.append("Could not reach USAspending API.")
            return [], warnings
        except (TimeoutError, json.JSONDecodeError, ValueError) as exc:
            logger.warning("USAspending parse error for %s: %s", cleaned_name, exc)
            warnings.append("USAspending response could not be parsed.")
            return [], warnings

        for message in body.get("messages") or []:
            if isinstance(message, str) and message.strip():
                warnings.append(message.strip())

        for row in body.get("results") or []:
            if not isinstance(row, dict):
                continue
            award_id = _clean_text(row.get("Award ID")) or _clean_text(row.get("generated_internal_id"))
            dedupe_key = award_id or json.dumps(row, sort_keys=True, default=str)
            if dedupe_key in seen_award_ids:
                continue
            seen_award_ids.add(dedupe_key)
            merged_rows.append(row)

    awards = [
        normalize_usaspending_row(row, recipient_name=cleaned_name) for row in merged_rows
    ]
    awards.sort(key=lambda row: float(row.get("value_usd") or 0), reverse=True)
    deduped_warnings: list[str] = []
    seen_warnings: set[str] = set()
    for warning in warnings:
        if warning not in seen_warnings:
            seen_warnings.add(warning)
            deduped_warnings.append(warning)
    return awards[:limit], deduped_warnings


def collect_gov_procurement(
    *,
    company_name: str,
    country: Optional[str] = None,
    http_post: Callable[..., dict[str, Any]] = _default_http_post,
) -> dict[str, Any]:
    """Aggregate federal procurement context for a licensee company."""
    awards, warnings = fetch_usaspending_awards(company_name, http_post=http_post)
    summary = build_procurement_summary(awards)
    recipient_profile = build_recipient_profile(awards, query_name=company_name)

    scope_notes = list(LIMITATIONS)
    if country and country.strip().lower() not in {
        "united states",
        "usa",
        "us",
        "u.s.",
        "u.s.a.",
    }:
        scope_notes.insert(
            0,
            f"License country is {country.strip()} — federal U.S. awards may not apply to this entity.",
        )

    return {
        "source": SOURCE_NAME,
        "source_url": SOURCE_HOME,
        "scope": "U.S. federal awards (contracts, grants, loans)",
        "limitations": scope_notes,
        "warnings": warnings,
        "recipient_profile": recipient_profile,
        "summary": summary,
        "awards": awards,
        "queried_at": datetime.now(timezone.utc).isoformat(),
        "query_company": _clean_text(company_name),
    }


def serialize_gov_procurement_award(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row.get("award_id"),
        "title": row.get("title"),
        "agency": row.get("agency"),
        "value": row.get("value_usd"),
        "commodity": row.get("commodity"),
        "category": row.get("category"),
        "uei": row.get("uei"),
        "duns": row.get("duns"),
        "status": row.get("status"),
        "period": row.get("period"),
        "recipient": row.get("recipient"),
        "startDate": row.get("start_date"),
        "endDate": row.get("end_date"),
        "naics": row.get("naics"),
        "psc": row.get("psc"),
        "awardType": row.get("award_type"),
        "sourceName": row.get("source_name"),
        "sourceUrl": row.get("source_url"),
    }


def _normalize_company_key(name: Optional[str], uei: Optional[str] = None) -> Optional[str]:
    if uei:
        return f"uei:{uei.strip().upper()}"
    cleaned = _clean_text(name)
    if not cleaned:
        return None
    simplified = re.sub(r"[^a-z0-9]+", " ", cleaned.lower()).strip()
    return f"name:{simplified}" if simplified else None


def build_commodity_feed_search_payload(
    profile: dict[str, Any],
    *,
    limit: int = FEED_LIMIT_PER_PROFILE,
    page: int = 1,
    lookback_years: int = FEED_LOOKBACK_YEARS,
) -> dict[str, Any]:
    """Build POST body for commodity-scoped contract search (no recipient filter)."""
    today = date.today()
    start_year = max(USASPENDING_EARLIEST_DATE.year, today.year - max(1, lookback_years))
    start_date = max(date(start_year, 10, 1), USASPENDING_EARLIEST_DATE)
    filters: dict[str, Any] = {
        "award_type_codes": FEED_CONTRACT_TYPE_CODES,
        "time_period": [
            {
                "start_date": start_date.isoformat(),
                "end_date": today.isoformat(),
            }
        ],
    }
    naics_require = [code for code in (profile.get("naics_require") or []) if code]
    if naics_require:
        filters["naics_codes"] = {"require": naics_require}
    psc_codes = [code for code in (profile.get("psc_codes") or []) if code]
    if psc_codes:
        filters["psc_codes"] = psc_codes
    keywords = [_clean_text(k) for k in (profile.get("keywords") or [])]
    keywords = [k for k in keywords if k]
    if keywords:
        filters["keywords"] = keywords
    return {
        "filters": filters,
        "fields": CONTRACT_AWARD_FIELDS,
        "limit": limit,
        "page": page,
        "sort": "Award Amount",
        "order": "desc",
        "subawards": False,
    }


def fetch_commodity_feed_awards(
    *,
    profiles: Optional[list[dict[str, Any]]] = None,
    http_post: Callable[..., dict[str, Any]] = _default_http_post,
    limit_per_profile: int = FEED_LIMIT_PER_PROFILE,
) -> tuple[list[dict[str, Any]], list[str]]:
    """Fetch federal contract awards for each commodity profile (contracts only)."""
    warnings: list[str] = []
    if _gov_procurement_disabled():
        return [], ["Live USAspending lookup is disabled (GOV_PROCUREMENT_DISABLED)."]

    active_profiles = profiles or COMMODITY_FEED_PROFILES
    url = f"{USASPENDING_API_BASE}{USASPENDING_SEARCH_PATH}"
    merged_rows: list[dict[str, Any]] = []
    seen_award_ids: set[str] = set()

    for profile in active_profiles:
        payload = build_commodity_feed_search_payload(profile, limit=limit_per_profile)
        profile_id = profile.get("id") or profile.get("label") or "unknown"
        try:
            body = http_post(url, payload, timeout=REQUEST_TIMEOUT_SECONDS)
        except HTTPError as exc:
            logger.warning("USAspending commodity feed HTTP error (%s): %s", profile_id, exc)
            warnings.append(f"USAspending feed for {profile_id} returned HTTP {exc.code}.")
            continue
        except URLError as exc:
            logger.warning("USAspending commodity feed network error: %s", exc)
            warnings.append("Could not reach USAspending API.")
            return [], warnings
        except (TimeoutError, json.JSONDecodeError, ValueError) as exc:
            logger.warning("USAspending commodity feed parse error: %s", exc)
            warnings.append("USAspending response could not be parsed.")
            return [], warnings

        for message in body.get("messages") or []:
            if isinstance(message, str) and message.strip():
                warnings.append(message.strip())

        for row in body.get("results") or []:
            if not isinstance(row, dict):
                continue
            award_id = _clean_text(row.get("Award ID")) or _clean_text(row.get("generated_internal_id"))
            dedupe_key = award_id or json.dumps(row, sort_keys=True, default=str)
            if dedupe_key in seen_award_ids:
                continue
            seen_award_ids.add(dedupe_key)
            tagged = dict(row)
            tagged["_feed_profile_id"] = profile_id
            merged_rows.append(tagged)

    awards = []
    for row in merged_rows:
        normalized = normalize_usaspending_row(
            row,
            recipient_name=_clean_text(row.get("Recipient Name")) or "",
        )
        normalized["feed_profile_id"] = row.get("_feed_profile_id")
        awards.append(normalized)
    awards.sort(key=lambda row: float(row.get("value_usd") or 0), reverse=True)
    deduped_warnings: list[str] = []
    seen_warnings: set[str] = set()
    for warning in warnings:
        if warning not in seen_warnings:
            seen_warnings.add(warning)
            deduped_warnings.append(warning)
    return awards, deduped_warnings


def aggregate_companies_from_awards(awards: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Roll up normalized awards into per-recipient company summaries."""
    companies: dict[str, dict[str, Any]] = {}
    for award in awards:
        recipient = _clean_text(award.get("recipient"))
        uei = _clean_text(award.get("uei"))
        key = _normalize_company_key(recipient, uei)
        if not key:
            continue
        amount = float(award.get("value_usd") or 0)
        commodity = _clean_text(award.get("commodity")) or "Federal Award"
        category = (_clean_text(award.get("category")) or "other").lower()
        entry = companies.get(key)
        if not entry:
            entry = {
                "company_key": key,
                "name": recipient or "Unknown recipient",
                "uei": uei,
                "duns": _clean_text(award.get("duns")),
                "recipient_id": _clean_text(award.get("recipient_id")),
                "total_awarded_usd": 0.0,
                "award_count": 0,
                "active_award_count": 0,
                "commodities": [],
                "categories": [],
                "top_agency": None,
                "top_award": None,
                "_agency_totals": {},
            }
            companies[key] = entry
        entry["total_awarded_usd"] += amount
        entry["award_count"] += 1
        if (award.get("status") or "").upper() == "ACTIVE":
            entry["active_award_count"] += 1
        if commodity not in entry["commodities"]:
            entry["commodities"].append(commodity)
        if category not in entry["categories"]:
            entry["categories"].append(category)
        agency = _clean_text(award.get("agency")) or "U.S. Federal"
        entry["_agency_totals"][agency] = entry["_agency_totals"].get(agency, 0.0) + amount
        top_award = entry.get("top_award")
        if not top_award or amount > float(top_award.get("value_usd") or 0):
            entry["top_award"] = {
                "award_id": award.get("award_id"),
                "title": award.get("title"),
                "value_usd": amount,
                "commodity": commodity,
                "agency": agency,
                "source_url": award.get("source_url"),
            }

    results: list[dict[str, Any]] = []
    for entry in companies.values():
        agency_totals = entry.pop("_agency_totals", {})
        if agency_totals:
            entry["top_agency"] = max(agency_totals.items(), key=lambda item: item[1])[0]
        entry["total_awarded_usd"] = round(float(entry["total_awarded_usd"]), 2)
        results.append(entry)
    results.sort(key=lambda row: float(row.get("total_awarded_usd") or 0), reverse=True)
    return results


def _filter_companies_by_commodity(
    companies: list[dict[str, Any]], commodity_filter: str
) -> list[dict[str, Any]]:
    profile = next(
        (p for p in COMMODITY_FEED_PROFILES if (p.get("id") or "").lower() == commodity_filter),
        None,
    )
    if not profile:
        return companies
    label = (_clean_text(profile.get("label")) or "").lower()
    return [
        row
        for row in companies
        if label in {(c or "").lower() for c in (row.get("commodities") or [])}
    ]


def collect_commodity_feed(
    *,
    refresh: bool = False,
    commodity: Optional[str] = None,
    http_post: Callable[..., dict[str, Any]] = _default_http_post,
) -> dict[str, Any]:
    """Live-fetch commodity-scoped federal contractors (prefer DB via API endpoint)."""
    commodity_filter = (_clean_text(commodity) or "").lower()
    profiles = COMMODITY_FEED_PROFILES
    if commodity_filter:
        profiles = [p for p in COMMODITY_FEED_PROFILES if (p.get("id") or "").lower() == commodity_filter]
        if not profiles:
            return {
                "source": SOURCE_NAME,
                "source_url": SOURCE_HOME,
                "scope": "U.S. federal contracts by commodity (cached browse feed)",
                "limitations": FEED_LIMITATIONS,
                "warnings": [f"Unknown commodity filter: {commodity}"],
                "cached": False,
                "cached_at": None,
                "queried_at": datetime.now(timezone.utc).isoformat(),
                "companies": [],
                "commodity_profiles": [],
            }

    awards, warnings = fetch_commodity_feed_awards(profiles=profiles, http_post=http_post)
    companies = aggregate_companies_from_awards(awards)
    queried_at = datetime.now(timezone.utc).isoformat()
    commodity_profiles = [
        {"id": p.get("id"), "label": p.get("label"), "category": p.get("category")}
        for p in COMMODITY_FEED_PROFILES
    ]

    if commodity_filter:
        companies = _filter_companies_by_commodity(companies, commodity_filter)

    return {
        "source": SOURCE_NAME,
        "source_url": SOURCE_HOME,
        "scope": "U.S. federal contracts by commodity (live browse feed)",
        "limitations": FEED_LIMITATIONS,
        "warnings": warnings,
        "cached": False,
        "data_origin": "live",
        "cached_at": None,
        "queried_at": queried_at,
        "companies": companies,
        "commodity_profiles": commodity_profiles,
    }


def serialize_gov_procurement_company(row: dict[str, Any]) -> dict[str, Any]:
    top_award = row.get("top_award") or {}
    return {
        "companyKey": row.get("company_key"),
        "name": row.get("name"),
        "uei": row.get("uei"),
        "duns": row.get("duns"),
        "recipientId": row.get("recipient_id"),
        "totalAwardedUsd": row.get("total_awarded_usd", 0),
        "awardCount": row.get("award_count", 0),
        "activeAwardCount": row.get("active_award_count", 0),
        "commodities": row.get("commodities") or [],
        "categories": row.get("categories") or [],
        "topAgency": row.get("top_agency"),
        "topAward": (
            {
                "id": top_award.get("award_id"),
                "title": top_award.get("title"),
                "value": top_award.get("value_usd"),
                "commodity": top_award.get("commodity"),
                "agency": top_award.get("agency"),
                "sourceUrl": top_award.get("source_url"),
            }
            if top_award
            else None
        ),
    }


def serialize_commodity_feed_response(payload: dict[str, Any]) -> dict[str, Any]:
    companies = payload.get("companies") or []
    serialized_companies = []
    for row in companies:
        if row.get("companyKey") or row.get("recipientKey"):
            serialized_companies.append(row)
        else:
            serialized_companies.append(serialize_gov_procurement_company(row))
    return {
        "source": payload.get("source"),
        "sourceUrl": payload.get("source_url"),
        "scope": payload.get("scope"),
        "limitations": payload.get("limitations") or [],
        "warnings": payload.get("warnings") or [],
        "cached": bool(payload.get("cached")),
        "dataOrigin": payload.get("data_origin"),
        "cachedAt": payload.get("cached_at"),
        "queriedAt": payload.get("queried_at"),
        "commodityProfiles": payload.get("commodity_profiles") or [],
        "pagination": payload.get("pagination"),
        "companies": serialized_companies,
    }


def serialize_gov_procurement_response(payload: dict[str, Any]) -> dict[str, Any]:
    summary = payload.get("summary") or {}
    profile = payload.get("recipient_profile")
    portfolio = summary.get("portfolio_by_category_pct") or {}
    result = {
        "source": payload.get("source"),
        "sourceUrl": payload.get("source_url"),
        "scope": payload.get("scope"),
        "limitations": payload.get("limitations") or [],
        "warnings": payload.get("warnings") or [],
        "queriedAt": payload.get("queried_at"),
        "queryCompany": payload.get("query_company"),
        "dataOrigin": payload.get("data_origin"),
        "lastSyncedAt": payload.get("last_synced_at"),
        "recipientProfile": (
            {
                "name": profile.get("name"),
                "uei": profile.get("uei"),
                "duns": profile.get("duns"),
                "recipientId": profile.get("recipient_id"),
            }
            if profile
            else None
        ),
        "summary": {
            "totalAwardedUsd": summary.get("total_awarded_usd", 0),
            "activeContractCount": summary.get("active_contract_count", 0),
            "awardCount": summary.get("award_count", 0),
            "topFundingAgency": summary.get("top_funding_agency"),
            "portfolioByCategoryPct": {
                "precious": portfolio.get("precious", 0),
                "fuels": portfolio.get("fuels", 0),
                "strategic": portfolio.get("strategic", 0),
                "other": portfolio.get("other", 0),
            },
        },
        "awards": [serialize_gov_procurement_award(row) for row in payload.get("awards") or []],
    }
    return result
