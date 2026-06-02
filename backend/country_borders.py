from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Any

COUNTRY_BORDERS_PATH = Path(__file__).resolve().parent / "data" / "country_borders.geojson"
COUNTRY_NAME_KEYS = ("ADMIN", "name", "NAME", "formal_en")

# Keep aliases in sync with the generator so client country labels map cleanly
# to the backend-owned GeoJSON feature properties.
COUNTRY_ALIASES = {
    "cape verde": "cabo verde",
    "congo kinshasa": "democratic republic of the congo",
    "congo brazzaville": "republic of the congo",
    "cote divoire": "cote d ivoire",
    "czech republic": "czechia",
    "dem rep congo": "democratic republic of the congo",
    "democratic republic of congo": "democratic republic of the congo",
    "drc": "democratic republic of the congo",
    "ivory coast": "cote d ivoire",
    "laos": "lao pdr",
    "macedonia": "north macedonia",
    "myanmar burma": "myanmar",
    "palestine": "state of palestine",
    "republic of congo": "republic of the congo",
    "republic of moldova": "moldova",
    "republic of north macedonia": "north macedonia",
    "russia": "russian federation",
    "south korea": "korea",
    "swaziland": "eswatini",
    "syria": "syrian arab republic",
    "tanzania": "united republic of tanzania",
    "the bahamas": "bahamas",
    "the gambia": "gambia",
    "timor leste": "east timor",
    "uae": "united arab emirates",
    "uk": "united kingdom",
    "usa": "united states of america",
    "united states": "united states of america",
    "venezuela": "venezuela bolivarian republic of",
    "viet nam": "vietnam",
}


def normalize_country_name(value: str) -> str:
    ascii_value = (
        unicodedata.normalize("NFKD", value)
        .encode("ascii", "ignore")
        .decode("ascii")
        .lower()
        .strip()
    )
    ascii_value = ascii_value.replace("&", " and ")
    ascii_value = re.sub(r"[^a-z0-9]+", " ", ascii_value)
    ascii_value = re.sub(r"\s+", " ", ascii_value).strip()
    return COUNTRY_ALIASES.get(ascii_value, ascii_value)


def parse_requested_countries(raw_countries: str | None) -> list[str]:
    if not raw_countries:
        return []
    return [re.sub(r"\s+", " ", part).strip() for part in raw_countries.split(",") if part.strip()]


@dataclass
class CachedCountryBorders:
    mtime_ns: int
    payload: dict[str, Any]
    base_etag: str


_CACHE: CachedCountryBorders | None = None


def _load_country_borders() -> CachedCountryBorders:
    global _CACHE

    if not COUNTRY_BORDERS_PATH.exists():
        # Keep graph-sync alive in slim containers that omit the large borders file.
        # Downstream callers get an empty FeatureCollection instead of a hard crash.
        payload = {"type": "FeatureCollection", "features": []}
        _CACHE = CachedCountryBorders(
            mtime_ns=0,
            payload=payload,
            base_etag="missing-country-borders",
        )
        return _CACHE

    stat = COUNTRY_BORDERS_PATH.stat()
    if _CACHE and _CACHE.mtime_ns == stat.st_mtime_ns:
        return _CACHE

    raw_text = COUNTRY_BORDERS_PATH.read_text(encoding="utf-8")
    payload = json.loads(raw_text)
    if payload.get("type") != "FeatureCollection" or not isinstance(payload.get("features"), list):
        raise ValueError(f"{COUNTRY_BORDERS_PATH} is not a GeoJSON FeatureCollection")

    _CACHE = CachedCountryBorders(
        mtime_ns=stat.st_mtime_ns,
        payload=payload,
        base_etag=hashlib.sha256(raw_text.encode("utf-8")).hexdigest(),
    )
    return _CACHE


def _feature_matches(feature: dict[str, Any], requested: set[str]) -> bool:
    properties = feature.get("properties") or {}
    if not isinstance(properties, dict):
        return False

    for key in COUNTRY_NAME_KEYS:
        value = properties.get(key)
        if isinstance(value, str) and normalize_country_name(value) in requested:
            return True
    return False


def get_country_borders_geojson(requested_countries: list[str] | None = None) -> tuple[dict[str, Any], str]:
    cached = _load_country_borders()
    requested = sorted(
        {
            normalize_country_name(country)
            for country in (requested_countries or [])
            if isinstance(country, str) and normalize_country_name(country)
        }
    )

    if not requested:
        return cached.payload, cached.base_etag

    requested_set = set(requested)
    filtered = {
        "type": "FeatureCollection",
        "features": [
            feature
            for feature in cached.payload["features"]
            if isinstance(feature, dict) and _feature_matches(feature, requested_set)
        ],
    }
    filtered_etag = hashlib.sha256(
        f"{cached.base_etag}|{','.join(requested)}".encode("utf-8")
    ).hexdigest()
    return filtered, filtered_etag
