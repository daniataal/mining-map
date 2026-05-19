"""Sync EU public procurement notices from TED Search API (free, no API key)."""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from datetime import datetime
from typing import Any, Callable, Optional

try:
    from backend.services.eu_procurement_store import (
        ensure_eu_procurement_tables,
        finish_sync_run,
        start_sync_run,
        upsert_notice,
    )
except ImportError:
    from services.eu_procurement_store import (
        ensure_eu_procurement_tables,
        finish_sync_run,
        start_sync_run,
        upsert_notice,
    )

TED_SEARCH_URL = os.getenv(
    "TED_SEARCH_API_URL",
    "https://api.ted.europa.eu/v3/notices/search",
)

# CPV division 091 — petroleum, natural gas, mining (and related)
DEFAULT_CPV_QUERY = os.getenv(
    "TED_PROCUREMENT_CPV_QUERY",
    "classification-cpv IN (09100000 09110000 09120000 09130000)",
)

TED_FIELDS = [
    "ND",
    "TI",
    "CY",
    "buyer-name",
    "classification-cpv",
    "BT-720-Tender",
    "publication-date",
    "links",
]

ISO3_TO_COUNTRY: dict[str, str] = {
    "SWE": "Sweden",
    "NOR": "Norway",
    "FIN": "Finland",
    "POL": "Poland",
    "DEU": "Germany",
    "FRA": "France",
    "ESP": "Spain",
    "ITA": "Italy",
    "NLD": "Netherlands",
    "BEL": "Belgium",
    "AUT": "Austria",
    "DNK": "Denmark",
    "PRT": "Portugal",
    "IRL": "Ireland",
    "GRC": "Greece",
    "CZE": "Czech Republic",
    "ROU": "Romania",
    "HUN": "Hungary",
    "BGR": "Bulgaria",
    "HRV": "Croatia",
    "SVK": "Slovakia",
    "SVN": "Slovenia",
    "LTU": "Lithuania",
    "LVA": "Latvia",
    "EST": "Estonia",
    "LUX": "Luxembourg",
    "MLT": "Malta",
    "CYP": "Cyprus",
}


def _user_agent() -> str:
    return os.getenv(
        "TED_USER_AGENT",
        os.getenv(
            "OPEN_DATA_SYNC_USER_AGENT",
            "MeridianMiningMap/1.0 (EU TED open data; contact admin)",
        ),
    )


def _first_localized(obj: Any, *, prefer: tuple[str, ...] = ("eng", "en")) -> str:
    if isinstance(obj, str):
        return obj.strip()
    if not isinstance(obj, dict):
        return ""
    for key in prefer:
        val = obj.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip()
        if isinstance(val, list) and val:
            return str(val[0]).strip()
    for val in obj.values():
        if isinstance(val, str) and val.strip():
            return val.strip()
        if isinstance(val, list) and val:
            return str(val[0]).strip()
    return ""


def _parse_published_at(raw: Any) -> Optional[datetime]:
    if not raw:
        return None
    text = str(raw).strip()
    if not text:
        return None
    text = text.replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(text)
    except ValueError:
        return None


def _parse_award_value(raw: Any) -> Optional[float]:
    if raw is None:
        return None
    if isinstance(raw, (int, float)):
        return float(raw)
    if isinstance(raw, dict):
        for key in ("value", "amount", "total"):
            if key in raw:
                return _parse_award_value(raw[key])
    text = str(raw).strip().replace(",", "")
    try:
        return float(text)
    except ValueError:
        return None


def _notice_url(notice_id: str, links: Any) -> str:
    if isinstance(links, dict):
        html = links.get("html") or {}
        if isinstance(html, dict):
            eng = html.get("ENG") or html.get("eng")
            if eng:
                return str(eng)
    return f"https://ted.europa.eu/en/notice/{notice_id}"


def normalize_ted_notice(raw: dict[str, Any]) -> dict[str, Any]:
    notice_id = str(raw.get("ND") or raw.get("publication-number") or "").strip()
    title = _first_localized(raw.get("TI"))
    buyer = _first_localized(raw.get("buyer-name"))
    cy = raw.get("CY")
    country_code = ""
    if isinstance(cy, list) and cy:
        country_code = str(cy[0]).strip().upper()
    elif isinstance(cy, str):
        country_code = cy.strip().upper()
    country = ISO3_TO_COUNTRY.get(country_code, country_code)

    cpv_list = raw.get("classification-cpv")
    cpv = ""
    if isinstance(cpv_list, list) and cpv_list:
        cpv = ",".join(str(c) for c in cpv_list)
    elif isinstance(cpv_list, str):
        cpv = cpv_list

    return {
        "notice_id": notice_id,
        "title": title,
        "buyer": buyer,
        "country": country,
        "cpv": cpv,
        "award_value": _parse_award_value(raw.get("BT-720-Tender")),
        "published_at": _parse_published_at(raw.get("publication-date")),
        "source_url": _notice_url(notice_id, raw.get("links")),
        "raw_payload": raw,
    }


def fetch_ted_page(
    *,
    query: str,
    limit: int = 100,
    iteration_token: Optional[str] = None,
    http_post: Callable[..., dict[str, Any]] | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "query": query,
        "limit": max(1, min(limit, 250)),
        "fields": TED_FIELDS,
    }
    if iteration_token:
        payload["iterationNextToken"] = iteration_token

    if http_post is not None:
        return http_post(TED_SEARCH_URL, payload)

    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        TED_SEARCH_URL,
        data=body,
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": _user_agent(),
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8"))


def sync_ted_procurement(
    conn: Any,
    *,
    query: Optional[str] = None,
    max_notices: int = 500,
    max_pages: int = 5,
    sleep_fn: Callable[[float], None] = time.sleep,
    http_post: Callable[..., dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Pull TED notices for mining/petroleum CPV codes into eu_procurement_notices."""
    enabled = (os.getenv("TED_PROCUREMENT_SYNC_ENABLED") or "true").strip().lower()
    if enabled in {"0", "false", "no", "off"}:
        return {"status": "skipped", "reason": "TED_PROCUREMENT_SYNC_ENABLED is off"}

    cpv_query = (query or DEFAULT_CPV_QUERY).strip()
    ensure_eu_procurement_tables(conn)
    conn.commit()

    run_id = start_sync_run(conn)
    conn.commit()

    fetched = 0
    upserted = 0
    errors: list[str] = []
    token: Optional[str] = None
    page = 0

    try:
        while page < max_pages and fetched < max_notices:
            page += 1
            try:
                response = fetch_ted_page(
                    query=cpv_query,
                    limit=min(100, max_notices - fetched),
                    iteration_token=token,
                    http_post=http_post,
                )
            except urllib.error.HTTPError as exc:
                errors.append(f"TED HTTP {exc.code}: {exc.reason}")
                break
            except Exception as exc:
                errors.append(f"TED fetch: {exc}")
                break

            notices = response.get("notices") or []
            if not notices:
                break

            for raw in notices:
                if not isinstance(raw, dict):
                    continue
                fetched += 1
                normalized = normalize_ted_notice(raw)
                if not normalized.get("notice_id"):
                    continue
                if upsert_notice(conn, normalized):
                    upserted += 1

            conn.commit()
            token = response.get("iterationNextToken")
            if not token:
                break
            sleep_fn(max(0.25, float(os.getenv("TED_PROCUREMENT_SLEEP_SECONDS", "0.5"))))

        status = "success" if not errors else ("partial" if upserted else "error")
        finish_sync_run(
            conn,
            run_id,
            status=status,
            notices_fetched=fetched,
            notices_upserted=upserted,
            errors=errors,
        )
        conn.commit()
        return {
            "status": status,
            "notices_fetched": fetched,
            "notices_upserted": upserted,
            "errors": errors,
        }
    except Exception as exc:
        finish_sync_run(
            conn,
            run_id,
            status="error",
            notices_fetched=fetched,
            notices_upserted=upserted,
            errors=errors + [str(exc)],
        )
        conn.commit()
        raise
