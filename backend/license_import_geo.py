"""Resolve lat/lng for bulk CSV import without live geocoding HTTP calls.

Supports:
1. Explicit ``lat`` / ``lng`` columns (handled in ``parse_license_import_csv``).
2. A ``location`` cell that is either a coordinate pair string (e.g. ``6.5,-1.5``)
   or, when ``country`` is Ghana, a label matched against the in-repo approximate
   centroid table (same data as ``convert_data.LOCATION_MAP`` / ``ghana_location_centroids``).

For non-Ghana countries, place names are **not** auto-mapped — use coordinates
in ``location`` or ``lat``/``lng``.
"""

from __future__ import annotations

import re
from typing import Optional

from ghana_location_centroids import LOCATION_MAP

_COORD_PAIR_RE = re.compile(
    r"^\s*([-+]?\d+(?:\.\d+)?)\s*[,;]\s*([-+]?\d+(?:\.\d+)?)\s*$"
)


def _is_ghana_country(country: str) -> bool:
    n = (country or "").strip().lower()
    return n in ("ghana", "gh", "republic of ghana")


def parse_lat_lng_pair_from_string(s: str) -> Optional[tuple[float, float]]:
    """Parse ``lat,lng`` or ``lat;lng`` or two whitespace-separated numbers."""
    raw = (s or "").strip()
    if not raw:
        return None
    m = _COORD_PAIR_RE.match(raw)
    if m:
        try:
            return float(m.group(1)), float(m.group(2))
        except ValueError:
            return None
    parts = raw.split()
    if len(parts) == 2:
        try:
            return float(parts[0]), float(parts[1])
        except ValueError:
            return None
    return None


def _fuzzy_ghana_lookup(location_line: str) -> Optional[tuple[float, float, str]]:
    """Match a single line against Ghana centroid keys (legacy convert_data behavior)."""
    line = location_line.strip()
    if not line:
        return None
    if line in LOCATION_MAP:
        v = LOCATION_MAP[line]
        return v["lat"], v["lng"], line
    for k, v in LOCATION_MAP.items():
        if k in line or line in k:
            return v["lat"], v["lng"], k
    return None


def resolve_location_to_coords(location: str, country: str) -> Optional[tuple[float, float, str]]:
    """
    Returns (lat, lng, resolution_note) or None if unresolved.

    ``resolution_note`` is a short provenance string for errors/logging.
    """
    loc = (location or "").strip()
    if not loc:
        return None

    pair = parse_lat_lng_pair_from_string(loc)
    if pair:
        lat, lng = pair
        return lat, lng, "coordinate_pair_in_location_column"

    # Multiline: try each non-empty line (common in source exports)
    for seg in loc.splitlines():
        seg_s = seg.strip()
        if not seg_s:
            continue
        pair2 = parse_lat_lng_pair_from_string(seg_s)
        if pair2:
            a, b = pair2
            return a, b, "coordinate_pair_in_location_column"
        if _is_ghana_country(country):
            hit = _fuzzy_ghana_lookup(seg_s)
            if hit:
                lat, lng, key = hit
                return lat, lng, f"ghana_centroid:{key}"
    if _is_ghana_country(country):
        hit = _fuzzy_ghana_lookup(loc)
        if hit:
            lat, lng, key = hit
            return lat, lng, f"ghana_centroid:{key}"
    return None


def validate_lat_lng_range(lat: float, lng: float) -> Optional[str]:
    if not -90.0 <= lat <= 90.0:
        return f"lat must be between -90 and 90 (got {lat})"
    if not -180.0 <= lng <= 180.0:
        return f"lng must be between -180 and 180 (got {lng})"
    return None
