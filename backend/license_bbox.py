"""Pure helpers for GET /licenses viewport (bbox) validation — no DB or FastAPI imports."""

from __future__ import annotations

from typing import Optional, Tuple


def licenses_bbox_tuple_if_valid(
    min_lat: Optional[float],
    max_lat: Optional[float],
    min_lng: Optional[float],
    max_lng: Optional[float],
) -> Optional[Tuple[float, float, float, float]]:
    """Return (min_lat, max_lat, min_lng, max_lng) if all four are finite and form a non-degenerate box.

    Partial params, NaN, inverted ranges, or dateline wraps (west > east) return None so callers
    can fall back to the legacy full-table behavior (backward compatible).
    """
    if min_lat is None or max_lat is None or min_lng is None or max_lng is None:
        return None
    try:
        a, b, c, d = float(min_lat), float(max_lat), float(min_lng), float(max_lng)
    except (TypeError, ValueError):
        return None
    for v in (a, b, c, d):
        if v != v:  # NaN
            return None
    if a >= b or c >= d:
        return None
    return (a, b, c, d)
