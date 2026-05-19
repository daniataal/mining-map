"""SEC EDGAR company ticker lookup (free, no API key).

Uses https://www.sec.gov/files/company_tickers.json per SEC fair-access policy.
"""

from __future__ import annotations

import json
import os
import re
import time
from difflib import SequenceMatcher
from typing import Any, Optional
from urllib.request import Request, urlopen

COMPANY_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
USER_AGENT = os.getenv(
    "SEC_EDGAR_USER_AGENT",
    "MeridianMiningMap/1.0 (contact: admin@example.com; open-data research)",
)
CACHE_TTL_SECONDS = 60 * 60 * 24

_ticker_cache: dict[str, Any] = {"loaded_at": 0.0, "rows": []}


def _normalize_name(value: str) -> str:
    text = (value or "").lower().strip()
    text = re.sub(r"[^a-z0-9]+", " ", text)
    for suffix in (
        " inc",
        " ltd",
        " llc",
        " corp",
        " corporation",
        " company",
        " co",
        " plc",
        " limited",
        " sa",
        " ag",
    ):
        if text.endswith(suffix):
            text = text[: -len(suffix)].strip()
    return " ".join(text.split())


def _fetch_company_tickers() -> list[dict[str, Any]]:
    req = Request(
        COMPANY_TICKERS_URL,
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
    )
    with urlopen(req, timeout=30) as resp:
        payload = json.loads(resp.read().decode("utf-8"))

    rows: list[dict[str, Any]] = []
    if isinstance(payload, dict):
        for entry in payload.values():
            if isinstance(entry, dict):
                rows.append(entry)
    elif isinstance(payload, list):
        rows = [row for row in payload if isinstance(row, dict)]
    return rows


def _cached_tickers(force_refresh: bool = False) -> list[dict[str, Any]]:
    age = time.time() - float(_ticker_cache.get("loaded_at") or 0.0)
    if not force_refresh and _ticker_cache.get("rows") and age < CACHE_TTL_SECONDS:
        return list(_ticker_cache["rows"])
    rows = _fetch_company_tickers()
    _ticker_cache["loaded_at"] = time.time()
    _ticker_cache["rows"] = rows
    return rows


def edgar_company_url(cik: str | int) -> str:
    cik_padded = str(cik).zfill(10)
    return (
        "https://www.sec.gov/cgi-bin/browse-edgar"
        f"?action=getcompany&CIK={cik_padded}&owner=exclude&count=40"
    )


def lookup_sec_company(
    company_name: str,
    *,
    limit: int = 5,
    min_score: float = 0.72,
) -> dict[str, Any]:
    """
    Fuzzy-match a company name against SEC EDGAR tickers JSON.
    Returns best matches with CIK, ticker, and browse-edgar URL.
    """
    query = (company_name or "").strip()
    if not query:
        return {
            "status": "error",
            "message": "company name is required",
            "matches": [],
        }

    norm_query = _normalize_name(query)
    if not norm_query:
        return {
            "status": "error",
            "message": "company name is required",
            "matches": [],
        }

    try:
        rows = _cached_tickers()
    except Exception as exc:
        return {
            "status": "error",
            "message": f"SEC EDGAR ticker fetch failed: {exc}",
            "matches": [],
            "query": query,
        }

    scored: list[tuple[float, dict[str, Any]]] = []
    for row in rows:
        title = str(row.get("title") or row.get("name") or "").strip()
        if not title:
            continue
        norm_title = _normalize_name(title)
        if not norm_title:
            continue
        if norm_query == norm_title:
            score = 1.0
        elif norm_query in norm_title or norm_title in norm_query:
            score = 0.92
        else:
            score = SequenceMatcher(None, norm_query, norm_title).ratio()
        if score < min_score:
            continue
        cik = row.get("cik_str") or row.get("cik")
        ticker = str(row.get("ticker") or "").strip()
        scored.append(
            (
                score,
                {
                    "company_name": title,
                    "ticker": ticker or None,
                    "cik": str(cik) if cik is not None else None,
                    "cik_padded": str(cik).zfill(10) if cik is not None else None,
                    "edgar_url": edgar_company_url(cik) if cik is not None else None,
                    "match_score": round(score, 3),
                },
            )
        )

    scored.sort(key=lambda item: (-item[0], item[1].get("company_name") or ""))
    matches = [item[1] for item in scored[: max(1, min(limit, 20))]]

    return {
        "status": "success",
        "query": query,
        "normalized_query": norm_query,
        "match_count": len(matches),
        "matches": matches,
        "best_match": matches[0] if matches else None,
        "source_url": COMPANY_TICKERS_URL,
        "limitations": [
            "US SEC registrants only; private and non-US issuers may not appear.",
            "Name matching is heuristic — confirm CIK on sec.gov before compliance use.",
        ],
    }
