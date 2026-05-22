"""Map-optimized license reads: viewport clusters at low zoom, geometry simplify helpers."""

from __future__ import annotations

import math
from typing import Any, Optional


def license_grid_degrees(zoom: Optional[float]) -> Optional[float]:
    """Grid size for server-side clustering; None = return individual points."""
    if zoom is None:
        return None
    try:
        z = float(zoom)
    except (TypeError, ValueError):
        return None
    # z >= 7: bbox points + client MarkerClusterGroup (avoids 1.5° grid soup).
    if z >= 7:
        return None
    if z < 3:
        return 12.0
    if z < 4:
        return 8.0
    return 4.0


def license_cluster_min_count(grid_deg: float) -> int:
    """Drop singleton grid cells; coarse cells need more licenses to be useful."""
    try:
        g = float(grid_deg)
    except (TypeError, ValueError):
        return 2
    return 3 if g >= 4.0 else 2


def query_license_clusters(
    cur: Any,
    *,
    sector_sql: str,
    sector_params: list[Any],
    country_sql: str,
    country_params: list[Any],
    min_lat: float,
    max_lat: float,
    min_lng: float,
    max_lng: float,
    grid_deg: float,
    open_clause: str,
    limit: int = 800,
) -> list[dict[str, Any]]:
    """Aggregate licenses into viewport grid cells for low-zoom map paint."""
    safe_limit = max(1, min(int(limit or 800), 2000))
    min_cnt = license_cluster_min_count(grid_deg)
    sql = f"""
        SELECT
            (FLOOR(lat / %s) * %s + %s / 2.0)::float AS lat,
            (FLOOR(lng / %s) * %s + %s / 2.0)::float AS lng,
            COUNT(*)::int AS cnt,
            MAX(country) AS country,
            MAX(COALESCE(sector, 'mining')) AS sector
        FROM licenses
        WHERE {sector_sql}
          AND ({country_sql})
          AND lat IS NOT NULL AND lng IS NOT NULL
          AND lat BETWEEN %s AND %s
          AND lng BETWEEN %s AND %s
          {open_clause}
        GROUP BY FLOOR(lat / %s), FLOOR(lng / %s)
        HAVING COUNT(*) >= %s
        ORDER BY cnt DESC
        LIMIT %s
    """
    g = grid_deg
    params = [
        g,
        g,
        g,
        g,
        g,
        g,
        *sector_params,
        *country_params,
        min_lat,
        max_lat,
        min_lng,
        max_lng,
        g,
        g,
        min_cnt,
        safe_limit,
    ]
    cur.execute(sql, tuple(params))
    rows = cur.fetchall()
    out: list[dict[str, Any]] = []
    for row in rows:
        keys = row.keys() if hasattr(row, "keys") else []
        lat = row["lat"] if "lat" in keys else row[0]
        lng = row["lng"] if "lng" in keys else row[1]
        cnt = row["cnt"] if "cnt" in keys else row[2]
        country = (row["country"] if "country" in keys else row[3]) or ""
        sector = (row["sector"] if "sector" in keys else row[4]) or "mining"
        if lat is None or lng is None or not cnt or int(cnt) < min_cnt:
            continue
        out.append(
            {
                "id": f"cluster:{round(float(lat), 4)}:{round(float(lng), 4)}",
                "company": f"{int(cnt)} licenses",
                "licenseType": "Cluster",
                "commodity": "",
                "status": "Active",
                "date": None,
                "country": country,
                "region": "",
                "sector": sector,
                "lat": float(lat),
                "lng": float(lng),
                "mapClusterCount": int(cnt),
                "mapClusterGridDeg": float(g),
                "entityKind": "license",
            }
        )
    return out


def simplify_tolerance_for_zoom(zoom: Optional[float]) -> float:
    """Degrees tolerance for ST_Simplify on WGS84 geometries (pipelines)."""
    if zoom is None:
        return 0.0
    try:
        z = float(zoom)
    except (TypeError, ValueError):
        return 0.0
    if z >= 10:
        return 0.0
    if z >= 8:
        return 0.02
    return min(0.35, 0.04 * math.pow(2, 8 - z))


def license_cluster_limit_for_zoom(zoom: Optional[float], requested: int = 800) -> int:
    """Fewer markers at world zoom — avoids hundreds of DOM nodes."""
    try:
        z = float(zoom) if zoom is not None else 99.0
    except (TypeError, ValueError):
        return max(1, min(int(requested or 800), 2000))
    if z < 3:
        return min(requested, 60)
    if z < 5:
        return min(requested, 120)
    if z < 8:
        return min(requested, 350)
    return max(1, min(int(requested or 800), 2000))
