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
    # z >= 8: bbox points + client clustering (server grid through z=7).
    if z >= 8:
        return None
    if z < 3:
        return 16.0
    if z < 4:
        return 12.0
    if z < 8:
        return 8.0
    return None


def license_cluster_min_count(grid_deg: float) -> int:
    """Drop singleton grid cells; coarse cells need more licenses to be useful."""
    try:
        g = float(grid_deg)
    except (TypeError, ValueError):
        return 2
    if g >= 12.0:
        return 4
    if g >= 4.0:
        return 3
    return 2


def _cluster_cell_key(
    lat: float, lng: float, grid_deg: float, origin_lat: float = 0.0, origin_lng: float = 0.0
) -> tuple[int, int]:
    half = grid_deg / 2.0
    return (
        math.floor((lat - origin_lat - half) / grid_deg),
        math.floor((lng - origin_lng - half) / grid_deg),
    )


def _dominant_cluster_center(clusters: list[dict[str, Any]]) -> tuple[float, float] | None:
    best = -1
    lat = lng = 0.0
    for row in clusters:
        cnt = int(row.get("mapClusterCount") or 0)
        if cnt > best:
            best = cnt
            lat = float(row["lat"])
            lng = float(row["lng"])
    if best < 0:
        return None
    return lat, lng


_COUNTRY_LAND_BBOXES: dict[str, tuple[float, float, float, float]] = {
    "ghana": (4.5, 11.5, -3.5, 1.5),
    "cote d'ivoire": (4.2, 10.7, -8.6, -2.5),
    "côte d'ivoire": (4.2, 10.7, -8.6, -2.5),
    "ivory coast": (4.2, 10.7, -8.6, -2.5),
    "nigeria": (4.0, 14.0, 2.7, 14.5),
    "senegal": (12.0, 16.8, -17.8, -11.2),
    "mali": (10.0, 25.0, -12.5, 4.5),
    "guinea": (7.0, 12.8, -15.5, -7.5),
    "liberia": (4.2, 8.6, -11.6, -7.2),
    "sierra leone": (6.8, 10.1, -13.5, -10.0),
}


def _normalize_country_land_key(country: str) -> str:
    return (country or "").strip().lower().replace("\u2019", "'")


def _refine_cluster_land_position(lat: float, lng: float, country: str) -> tuple[float, float]:
    bbox = _COUNTRY_LAND_BBOXES.get(_normalize_country_land_key(country))
    if not bbox:
        return lat, lng
    min_lat, max_lat, min_lng, max_lng = bbox
    if min_lat <= lat <= max_lat and min_lng <= lng <= max_lng:
        return lat, lng
    return (min_lat + max_lat) / 2.0, (min_lng + max_lng) / 2.0


def _snap_cluster_to_viewport(
    lat: float,
    lng: float,
    *,
    min_lat: float,
    max_lat: float,
    min_lng: float,
    max_lng: float,
    grid_deg: float,
) -> tuple[float, float]:
    if min_lat <= lat <= max_lat and min_lng <= lng <= max_lng:
        edge = max(grid_deg * 0.25, 0.5)
        if (
            lat - min_lat >= edge
            and max_lat - lat >= edge
            and lng - min_lng >= edge
            and max_lng - lng >= edge
        ):
            return lat, lng
    return (min_lat + max_lat) / 2.0, (min_lng + max_lng) / 2.0


def merge_license_clusters(
    clusters: list[dict[str, Any]], *, grid_deg: float, origin_lat: float = 0.0, origin_lng: float = 0.0
) -> list[dict[str, Any]]:
    """Merge neighboring grid bubbles so continental zoom shows fewer overlapping markers."""
    if len(clusters) < 2 or grid_deg <= 0:
        return clusters

    parent = list(range(len(clusters)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(i: int, j: int) -> None:
        pi, pj = find(i), find(j)
        if pi != pj:
            parent[pj] = pi

    cells: dict[tuple[int, int], list[int]] = {}
    for idx, cluster in enumerate(clusters):
        key = _cluster_cell_key(float(cluster["lat"]), float(cluster["lng"]), grid_deg, origin_lat, origin_lng)
        cells.setdefault(key, []).append(idx)

    for (iy, ix), members in list(cells.items()):
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dy == 0 and dx == 0:
                    continue
                neighbor = cells.get((iy + dy, ix + dx))
                if not neighbor:
                    continue
                for i in members:
                    for j in neighbor:
                        if clusters[i].get("country") == clusters[j].get("country"):
                            union(i, j)

    groups: dict[int, list[int]] = {}
    for idx in range(len(clusters)):
        groups.setdefault(find(idx), []).append(idx)

    merged: list[dict[str, Any]] = []
    for members in groups.values():
        if len(members) == 1:
            merged.append(clusters[members[0]])
            continue
        total = 0
        country = ""
        sector = "mining"
        group: list[dict[str, Any]] = []
        for idx in members:
            row = clusters[idx]
            cnt = int(row.get("mapClusterCount") or 0)
            total += cnt
            group.append(row)
            if not country and row.get("country"):
                country = str(row["country"])
            if row.get("sector"):
                sector = str(row["sector"])
        if total <= 0:
            merged.append(clusters[members[0]])
            continue
        center = _dominant_cluster_center(group)
        if center is None:
            merged.append(clusters[members[0]])
            continue
        lat, lng = center
        lat, lng = _refine_cluster_land_position(lat, lng, country)
        merged.append(
            {
                "id": f"cluster:{country}:{round(lat, 4)}:{round(lng, 4)}",
                "company": f"{total} licenses",
                "licenseType": "Cluster",
                "commodity": "",
                "status": "Active",
                "date": None,
                "country": country,
                "region": "",
                "sector": sector,
                "lat": lat,
                "lng": lng,
                "mapClusterCount": total,
                "mapClusterGridDeg": float(grid_deg),
                "entityKind": "license",
            }
        )

    merged.sort(key=lambda row: int(row.get("mapClusterCount") or 0), reverse=True)
    return merged


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
    zoom: Optional[float] = None,
) -> list[dict[str, Any]]:
    """Aggregate licenses into viewport grid cells for low-zoom map paint."""
    safe_limit = max(1, min(int(limit or 800), 2000))
    min_cnt = license_cluster_min_count(grid_deg)
    sql = f"""
        SELECT
            (PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY lat))::float AS lat,
            (PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY lng))::float AS lng,
            COUNT(*)::int AS cnt,
            country,
            MAX(COALESCE(sector, 'mining')) AS sector
        FROM (
            SELECT
                lat,
                lng,
                FLOOR((lat - %s) / %s)::bigint AS lat_bucket,
                FLOOR((lng - %s) / %s)::bigint AS lng_bucket,
                country,
                COALESCE(sector, 'mining') AS sector
            FROM licenses
            WHERE {sector_sql}
              AND ({country_sql})
              AND lat IS NOT NULL AND lng IS NOT NULL
              AND lat BETWEEN -90 AND 90
              AND lng BETWEEN -180 AND 180
              AND NOT (ABS(lat) < 0.05 AND ABS(lng) < 0.05)
              AND lat BETWEEN %s AND %s
              AND lng BETWEEN %s AND %s
              {open_clause}
        ) bucketed
        GROUP BY lat_bucket, lng_bucket, country
        HAVING COUNT(*) >= %s
        ORDER BY cnt DESC
        LIMIT %s
    """
    g = grid_deg
    params = [
        min_lat,
        g,
        min_lng,
        g,
        *sector_params,
        *country_params,
        min_lat,
        max_lat,
        min_lng,
        max_lng,
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
        lat, lng = _refine_cluster_land_position(float(lat), float(lng), str(country))
        out.append(
            {
                "id": f"cluster:{country}:{round(float(lat), 4)}:{round(float(lng), 4)}",
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
    merged = merge_license_clusters(out, grid_deg=g, origin_lat=min_lat, origin_lng=min_lng)
    snapped = []
    for row in merged:
        lat, lng = _snap_cluster_to_viewport(
            float(row["lat"]),
            float(row["lng"]),
            min_lat=min_lat,
            max_lat=max_lat,
            min_lng=min_lng,
            max_lng=max_lng,
            grid_deg=g,
        )
        row = dict(row)
        lat, lng = _refine_cluster_land_position(lat, lng, str(row.get("country") or ""))
        row["lat"] = lat
        row["lng"] = lng
        snapped.append(row)
    return collapse_clusters_tight_viewport(
        snapped,
        min_lat=min_lat,
        max_lat=max_lat,
        min_lng=min_lng,
        max_lng=max_lng,
        zoom=zoom,
    )


def collapse_clusters_tight_viewport(
    clusters: list[dict[str, Any]],
    *,
    min_lat: float,
    max_lat: float,
    min_lng: float,
    max_lng: float,
    zoom: Optional[float] = None,
) -> list[dict[str, Any]]:
    """Merge clusters into one bubble for country/regional zoom (z < 8)."""
    if len(clusters) <= 1:
        return clusters
    span = max(max_lat - min_lat, max_lng - min_lng)
    z = float(zoom) if zoom is not None else 99.0
    grid = float(clusters[0].get("mapClusterGridDeg") or 0)
    should_collapse = (z < 8 and 0 < span < 22) or (grid > 0 and span < grid * 1.5)
    if not should_collapse:
        return clusters

    by_country: dict[str, list[dict[str, Any]]] = {}
    for c in clusters:
        country = c.get("country") or ""
        by_country.setdefault(country, []).append(c)

    out = []
    for cc in by_country.values():
        out.append(_merge_cluster_rows(cc, min_lat=min_lat, max_lat=max_lat, min_lng=min_lng, max_lng=max_lng))
    return out


def _merge_cluster_rows(
    clusters: list[dict[str, Any]],
    *,
    min_lat: float = -90.0,
    max_lat: float = 90.0,
    min_lng: float = -180.0,
    max_lng: float = 180.0,
) -> dict[str, Any]:
    total = 0
    country = ""
    sector = "mining"
    grid = float(clusters[0].get("mapClusterGridDeg") or 0)
    for row in clusters:
        cnt = int(row.get("mapClusterCount") or 0)
        total += cnt
        if not country and row.get("country"):
            country = str(row["country"])
        if row.get("sector"):
            sector = str(row["sector"])
    if total <= 0:
        return clusters[0]
    center = _dominant_cluster_center(clusters)
    if center is None:
        return clusters[0]
    lat, lng = center
    if grid > 0:
        lat, lng = _snap_cluster_to_viewport(
            lat, lng, min_lat=min_lat, max_lat=max_lat, min_lng=min_lng, max_lng=max_lng, grid_deg=grid
        )
    lat, lng = _refine_cluster_land_position(lat, lng, country)
    return {
        "id": f"cluster:{country}:{round(lat, 4)}:{round(lng, 4)}",
        "company": f"{total} licenses",
        "licenseType": "Cluster",
        "commodity": "",
        "status": "Active",
        "date": None,
        "country": country,
        "region": "",
        "sector": sector,
        "lat": lat,
        "lng": lng,
        "mapClusterCount": total,
        "mapClusterGridDeg": grid,
        "entityKind": "license",
    }


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


def pipeline_geojson_limit_for_zoom(zoom: Optional[float]) -> int:
    """Cap OSM pipeline features per viewport — keeps Leaflet GeoJSON fetches fast."""
    try:
        z = float(zoom) if zoom is not None else 7.0
    except (TypeError, ValueError):
        z = 7.0
    if z >= 11:
        return 12000
    if z >= 9:
        return 8000
    if z >= 7:
        return 3500
    if z >= 5:
        return 2000
    return 1000


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
