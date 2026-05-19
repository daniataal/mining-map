"""GLEIF LEI public lookup (free, no API key)."""

from __future__ import annotations

import json
import os
import re
import time
from typing import Any, Optional
from urllib.parse import quote
from urllib.request import Request, urlopen

GLEIF_SEARCH_URL = "https://api.gleif.org/api/v1/lei-records"
USER_AGENT = os.getenv(
    "GLEIF_USER_AGENT",
    "MeridianMiningMap/1.0 (open-data research; contact: admin@example.com)",
)
CACHE_TTL_SECONDS = 60 * 60 * 6
_cache: dict[str, Any] = {"loaded_at": 0.0, "key": "", "payload": {}}


def _normalize_name(value: str) -> str:
    text = (value or "").lower().strip()
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return " ".join(text.split())


def _fetch_lei_search(legal_name: str, *, limit: int = 5) -> dict[str, Any]:
    url = f"{GLEIF_SEARCH_URL}?filter[fulltext]={quote(legal_name)}&page[size]={limit}"
    req = Request(
        url,
        headers={"User-Agent": USER_AGENT, "Accept": "application/vnd.api+json"},
    )
    with urlopen(req, timeout=25) as resp:
        return json.loads(resp.read().decode("utf-8"))


def lookup_lei(company_name: str, *, limit: int = 5, force_refresh: bool = False) -> dict[str, Any]:
    """Return GLEIF LEI matches for a legal entity name."""
    query = (company_name or "").strip()
    if not query:
        return {"status": "error", "message": "Company name required", "matches": []}

    cache_key = _normalize_name(query)
    age = time.time() - float(_cache.get("loaded_at") or 0.0)
    if (
        not force_refresh
        and _cache.get("key") == cache_key
        and _cache.get("payload")
        and age < CACHE_TTL_SECONDS
    ):
        return dict(_cache["payload"])

    try:
        body = _fetch_lei_search(query, limit=limit)
    except Exception as exc:
        return {"status": "error", "message": str(exc), "matches": [], "query": query}

    matches: list[dict[str, Any]] = []
    for item in body.get("data") or []:
        if not isinstance(item, dict):
            continue
        attrs = item.get("attributes") or {}
        entity = attrs.get("entity") or {}
        legal = entity.get("legalName") or {}
        lei_id = attrs.get("lei") or item.get("id")
        matches.append(
            {
                "lei": lei_id,
                "legal_name": legal.get("name"),
                "status": attrs.get("registration", {}).get("status"),
                "country": (entity.get("legalAddress") or {}).get("country"),
                "gleif_url": f"https://search.gleif.org/#/record/{lei_id}" if lei_id else None,
            }
        )

    out = {
        "status": "success",
        "query": query,
        "match_count": len(matches),
        "matches": matches,
        "source": "GLEIF public API",
        "source_url": "https://www.gleif.org/en/lei-data",
    }
    _cache["loaded_at"] = time.time()
    _cache["key"] = cache_key
    _cache["payload"] = out
    return out
