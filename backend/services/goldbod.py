"""Ghana Gold Board (GoldBod) license verification for dossier due diligence.

GoldBod is Ghana's sole regulator for buying, grading, and exporting gold. There is
no documented public REST API as of 2026; this module:

1. Optionally calls a partner API when ``GOLDBOD_API_BASE_URL`` + ``GOLDBOD_API_KEY`` are set.
2. Otherwise matches against the official public License Registry HTML page
   (https://goldbod.net/license-registry/index.html) with in-memory TTL cache.
3. Always returns deep links + manual checklist when live data is unavailable.

Env (all optional):
    GOLDBOD_API_BASE_URL   Partner / SSMOS / GoldBod Trace API root (when available)
    GOLDBOD_API_KEY        Bearer or API key for the above
    GOLDBOD_REGISTRY_URL   Override public registry page URL
    GOLDBOD_CACHE_TTL_SECONDS  Registry HTML cache TTL (default 86400)
    GOLDBOD_REGISTRY_DISABLED  Set 1/true to skip registry fetch (manual links only)
    GOLDBOD_USER_AGENT     HTTP User-Agent for registry fetch
"""

from __future__ import annotations

import json
import logging
import os
import re
import time
from datetime import date, datetime
from difflib import SequenceMatcher
from typing import Any, Callable, Optional
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

logger = logging.getLogger(__name__)

GOLDBOD_PORTAL_URL = "https://www.goldbod.gov.gh/"
GOLDBOD_LICENSING_URL = "https://goldbod.gov.gh/licensing/"
GOLDBOD_REGISTRY_DEFAULT_URL = "https://goldbod.net/license-registry/index.html"
SSMOS_URL = "https://smallscale.gold/"

VALID_STATUSES = {
    "active",
    "not_found",
    "unknown",
    "api_unavailable",
    "check_manually",
}

_REGISTRY_CACHE: dict[str, Any] = {"fetched_at": 0.0, "entries": [], "error": None}

_LICENSE_CATEGORY_PREFIXES = {
    "GGB/AGR/": "aggregator",
    "GGB/SFA/": "self_financing_aggregator",
    "GGB/LB2/": "buyer_tier_2",
    "GGB/LB1/": "buyer_tier_1",
}


def _env_flag(name: str) -> bool:
    return (os.getenv(name) or "").strip().lower() in {"1", "true", "yes", "on"}


def _user_agent() -> str:
    return (os.getenv("GOLDBOD_USER_AGENT") or "MeridianMiningMap/1.0 (goldbod-registry)").strip()


def _registry_url() -> str:
    return (os.getenv("GOLDBOD_REGISTRY_URL") or GOLDBOD_REGISTRY_DEFAULT_URL).strip()


def _cache_ttl_seconds() -> int:
    raw = (os.getenv("GOLDBOD_CACHE_TTL_SECONDS") or "86400").strip()
    try:
        return max(300, int(raw))
    except ValueError:
        return 86400


def _clean_text(value: Any) -> str:
    if value is None:
        return ""
    return " ".join(str(value).split()).strip()


def _normalize_company_name(name: str) -> str:
    text = _clean_text(name).upper()
    for suffix in (
        " LIMITED COMPANY",
        " LIMITED LIABILITY COMPANY",
        " COMPANY LIMITED",
        " LIMITED",
        " LTD.",
        " LTD",
        " PLC",
        " INC",
        " LLC",
        " CO.",
        " CO",
    ):
        if text.endswith(suffix):
            text = text[: -len(suffix)].strip()
    text = re.sub(r"[^A-Z0-9& ]+", " ", text)
    return " ".join(text.split())


def is_ghana_country(country: str) -> bool:
    key = _clean_text(country).lower()
    if not key:
        return False
    if key in {"gh", "gha", "ghana", "republic of ghana"}:
        return True
    return "ghana" in key


def is_gold_commodity(commodity: str) -> bool:
    key = _clean_text(commodity).lower()
    if not key:
        return False
    return any(token in key for token in ("gold", "bullion", "precious metal", "doré", "dore"))


def is_ghana_gold_entity(*, country: str, commodity: str = "") -> bool:
    return is_ghana_country(country) and is_gold_commodity(commodity)


def _infer_license_category(certificate_number: str) -> str:
    cert = _clean_text(certificate_number).upper()
    for prefix, category in _LICENSE_CATEGORY_PREFIXES.items():
        if cert.startswith(prefix):
            return category
    return "goldbod_license"


def _parse_registry_html(html: str) -> list[dict[str, str]]:
    entries: list[dict[str, str]] = []
    for match in re.finditer(r"<tr[^>]*>(.*?)</tr>", html, flags=re.IGNORECASE | re.DOTALL):
        cells = re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", match.group(1), flags=re.IGNORECASE | re.DOTALL)
        texts = [_clean_text(re.sub(r"<[^>]+>", " ", cell)) for cell in cells]
        cert = next((t for t in texts if t.upper().startswith("GGB/")), None)
        if not cert:
            continue
        name = ""
        issue_date = ""
        expiry_date = ""
        for idx, text in enumerate(texts):
            upper = text.upper()
            if upper.startswith("GGB/"):
                if idx > 0 and not texts[idx - 1].isdigit():
                    name = texts[idx - 1]
                if idx + 1 < len(texts):
                    issue_date = texts[idx + 1]
                if idx + 2 < len(texts):
                    expiry_date = texts[idx + 2]
                break
        if not name and len(texts) >= 2:
            name = texts[1]
        if not name:
            continue
        entries.append(
            {
                "business_name": name,
                "certificate_number": cert.upper(),
                "issue_date": issue_date,
                "expiry_date": expiry_date,
                "license_category": _infer_license_category(cert),
                "normalized_name": _normalize_company_name(name),
            }
        )
    return entries


def _fetch_registry_html(
    *,
    url: Optional[str] = None,
    urlopen_fn: Callable[..., Any] = urlopen,
) -> str:
    target = url or _registry_url()
    req = Request(target, headers={"User-Agent": _user_agent(), "Accept": "text/html"})
    with urlopen_fn(req, timeout=25) as resp:
        return resp.read().decode("utf-8", errors="replace")


def load_registry_entries(
    *,
    force_refresh: bool = False,
    urlopen_fn: Callable[..., Any] = urlopen,
) -> tuple[list[dict[str, str]], Optional[str]]:
    """Return cached public registry rows; error string when fetch fails."""
    if _env_flag("GOLDBOD_REGISTRY_DISABLED"):
        return [], "registry_disabled"

    now = time.time()
    ttl = _cache_ttl_seconds()
    if (
        not force_refresh
        and _REGISTRY_CACHE.get("entries")
        and now - float(_REGISTRY_CACHE.get("fetched_at") or 0) < ttl
    ):
        return list(_REGISTRY_CACHE["entries"]), _REGISTRY_CACHE.get("error")

    try:
        html = _fetch_registry_html(urlopen_fn=urlopen_fn)
        entries = _parse_registry_html(html)
        _REGISTRY_CACHE["entries"] = entries
        _REGISTRY_CACHE["fetched_at"] = now
        _REGISTRY_CACHE["error"] = None if entries else "registry_empty"
        return entries, _REGISTRY_CACHE["error"]
    except (HTTPError, URLError, TimeoutError, OSError) as exc:
        logger.warning("GoldBod registry fetch failed: %s", exc)
        _REGISTRY_CACHE["error"] = str(exc)
        if _REGISTRY_CACHE.get("entries"):
            return list(_REGISTRY_CACHE["entries"]), str(exc)
        return [], str(exc)


def _parse_expiry(expiry: str) -> Optional[date]:
    raw = _clean_text(expiry)
    if not raw:
        return None
    for layout in ("%d-%b-%y", "%d-%b-%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(raw, layout).date()
        except ValueError:
            continue
    return None


def _license_active(expiry_date: str, *, today: Optional[date] = None) -> bool:
    parsed = _parse_expiry(expiry_date)
    if parsed is None:
        return True
    ref = today or date.today()
    return parsed >= ref


def _name_similarity(left: str, right: str) -> float:
    if not left or not right:
        return 0.0
    if left == right:
        return 1.0
    if left in right or right in left:
        return 0.92
    return SequenceMatcher(None, left, right).ratio()


def _match_registry_entries(
    entries: list[dict[str, str]],
    *,
    company_name: str = "",
    license_number: str = "",
    min_score: float = 0.86,
) -> list[dict[str, Any]]:
    cert_query = _clean_text(license_number).upper()
    if cert_query:
        exact = [e for e in entries if e.get("certificate_number") == cert_query]
        if exact:
            return [{**row, "match_score": 1.0, "match_method": "certificate"} for row in exact]

    norm_query = _normalize_company_name(company_name)
    if not norm_query:
        return []

    scored: list[tuple[float, dict[str, str]]] = []
    for entry in entries:
        score = _name_similarity(norm_query, entry.get("normalized_name") or "")
        if score >= min_score:
            scored.append((score, entry))
    scored.sort(key=lambda pair: pair[0], reverse=True)
    return [
        {**entry, "match_score": round(score, 3), "match_method": "company_name"}
        for score, entry in scored[:5]
    ]


def _partner_api_configured() -> bool:
    return bool(_clean_text(os.getenv("GOLDBOD_API_BASE_URL")) and _clean_text(os.getenv("GOLDBOD_API_KEY")))


def _search_partner_api(
    *,
    company_name: str = "",
    license_number: str = "",
    business_id: str = "",
    urlopen_fn: Callable[..., Any] = urlopen,
) -> Optional[dict[str, Any]]:
    base = _clean_text(os.getenv("GOLDBOD_API_BASE_URL")).rstrip("/")
    key = _clean_text(os.getenv("GOLDBOD_API_KEY"))
    if not base or not key:
        return None

    params = {k: v for k, v in {
        "q": company_name,
        "company": company_name,
        "license": license_number,
        "certificate": license_number,
        "business_id": business_id,
    }.items() if v}
    url = f"{base}/search?{urlencode(params)}"
    req = Request(
        url,
        headers={
            "User-Agent": _user_agent(),
            "Accept": "application/json",
            "Authorization": f"Bearer {key}",
        },
    )
    try:
        with urlopen_fn(req, timeout=20) as resp:
            body = resp.read().decode("utf-8", errors="replace")
        data = json.loads(body)
        if isinstance(data, dict):
            return data
    except Exception as exc:  # noqa: BLE001
        logger.warning("GoldBod partner API failed: %s", exc)
    return None


def _manual_checklist() -> list[str]:
    return [
        "Confirm company legal name matches Ghana Gold Board License Registry.",
        "Verify license certificate number (GGB/…) and expiry date on the official registry.",
        "For small-scale miners, cross-check SSMOS compliance records if the operator uses that platform.",
        "Mining licenses (Minerals Commission) are separate from GoldBod trading/export licenses.",
    ]


def _portal_links(*, company_name: str = "") -> list[dict[str, str]]:
    links = [
        {"label": "GoldBod Official Portal", "url": GOLDBOD_PORTAL_URL},
        {"label": "GoldBod Licensing", "url": GOLDBOD_LICENSING_URL},
        {"label": "GoldBod License Registry", "url": _registry_url()},
        {"label": "SSMOS (Small Scale Mining OS)", "url": SSMOS_URL},
    ]
    if company_name:
        # Registry is static HTML tables — no server-side search param; link is for manual lookup.
        links.append(
            {
                "label": f"Registry lookup ({company_name[:40]})",
                "url": _registry_url(),
                "note": "Search this page (Ctrl+F) for the company name",
            }
        )
    return links


def verify_goldbod_license(
    *,
    company_name: str = "",
    license_number: str = "",
    business_id: str = "",
    country: str = "",
    commodity: str = "",
    urlopen_fn: Callable[..., Any] = urlopen,
) -> dict[str, Any]:
    """Verify GoldBod license status for a Ghana gold-sector entity."""
    eligible = is_ghana_gold_entity(country=country, commodity=commodity) or (
        is_ghana_country(country) and bool(_clean_text(company_name) or _clean_text(license_number))
    )
    limitations = [
        "GoldBod has no documented public REST API; registry matching uses the official public License Registry page unless GOLDBOD_API_BASE_URL is configured.",
        "A match in the registry indicates a GoldBod trading/export license — not a Minerals Commission mining lease.",
        "SSMOS / GoldBod Trace partner APIs require credentials from GoldBod or an authorized integrator.",
    ]
    payload: dict[str, Any] = {
        "status": "check_manually",
        "eligible": eligible,
        "company_name": _clean_text(company_name),
        "license_number_query": _clean_text(license_number).upper(),
        "business_id": _clean_text(business_id),
        "country": _clean_text(country),
        "commodity": _clean_text(commodity),
        "matches": [],
        "active_match": None,
        "data_source": "manual",
        "api_available": False,
        "registry_available": False,
        "links": _portal_links(company_name=company_name),
        "manual_checklist": _manual_checklist(),
        "limitations": limitations,
        "checked_at": datetime.utcnow().isoformat() + "Z",
    }

    if not eligible:
        payload["status"] = "unknown"
        payload["limitations"].append("Entity is outside Ghana gold scope — GoldBod check skipped.")
        return payload

    if _partner_api_configured():
        api_data = _search_partner_api(
            company_name=company_name,
            license_number=license_number,
            business_id=business_id,
            urlopen_fn=urlopen_fn,
        )
        if api_data:
            payload["api_available"] = True
            payload["data_source"] = "partner_api"
            matches = api_data.get("matches") or api_data.get("results") or []
            if isinstance(matches, list) and matches:
                payload["matches"] = matches
                active = next((m for m in matches if m.get("status") == "active"), matches[0])
                payload["active_match"] = active
                payload["status"] = "active" if active else "not_found"
                return payload
            status = _clean_text(api_data.get("status")).lower()
            if status in VALID_STATUSES:
                payload["status"] = status
                return payload

    entries, registry_error = load_registry_entries(urlopen_fn=urlopen_fn)
    payload["registry_available"] = bool(entries)
    if entries:
        payload["data_source"] = "public_registry"
        matches = _match_registry_entries(
            entries,
            company_name=company_name,
            license_number=license_number,
        )
        payload["matches"] = [
            {
                "business_name": m.get("business_name"),
                "certificate_number": m.get("certificate_number"),
                "issue_date": m.get("issue_date"),
                "expiry_date": m.get("expiry_date"),
                "license_category": m.get("license_category"),
                "match_score": m.get("match_score"),
                "match_method": m.get("match_method"),
                "is_active": _license_active(m.get("expiry_date") or ""),
            }
            for m in matches
        ]
        active_matches = [m for m in payload["matches"] if m.get("is_active")]
        if active_matches:
            payload["active_match"] = active_matches[0]
            payload["status"] = "active"
        elif matches:
            payload["active_match"] = matches[0]
            payload["status"] = "not_found"
            limitations.append("Name matched registry but license may be expired — verify expiry on GoldBod portal.")
        else:
            payload["status"] = "not_found"
    elif registry_error:
        payload["status"] = "api_unavailable"
        limitations.append(f"Public registry fetch failed: {registry_error}")
    else:
        payload["status"] = "check_manually"

    return payload


def build_entity_goldbod_payload(
    *,
    entity_id: str,
    company: str,
    country: str,
    commodity: str = "",
    license_number: str = "",
    urlopen_fn: Callable[..., Any] = urlopen,
) -> dict[str, Any]:
    result = verify_goldbod_license(
        company_name=company,
        license_number=license_number,
        country=country,
        commodity=commodity,
        urlopen_fn=urlopen_fn,
    )
    result["entity_id"] = entity_id
    return result
