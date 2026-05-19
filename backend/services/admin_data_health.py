"""Aggregate operational data-health stats for admin dashboard."""

from __future__ import annotations

from typing import Any, Optional

try:
    from backend.services.comtrade_sync_store import ensure_comtrade_sync_tables, list_sync_runs
    from backend.services.license_sync_store import (
        ensure_license_sync_tables,
        list_latest_sync_run_per_source,
        list_sync_drift_alerts,
    )
    from backend.services.petroleum_osm_store import ensure_petroleum_osm_tables, layer_feature_stats
except ImportError:
    from services.comtrade_sync_store import ensure_comtrade_sync_tables, list_sync_runs
    from services.license_sync_store import (
        ensure_license_sync_tables,
        list_latest_sync_run_per_source,
        list_sync_drift_alerts,
    )
    from services.petroleum_osm_store import ensure_petroleum_osm_tables, layer_feature_stats


def _license_counts_by_country(conn: Any, *, limit: int = 200) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT country, COUNT(*)::int AS license_count
            FROM licenses
            WHERE country IS NOT NULL AND TRIM(country) <> ''
            GROUP BY country
            ORDER BY license_count DESC, country ASC
            LIMIT %s;
            """,
            (max(1, min(limit, 500)),),
        )
        rows = cur.fetchall()
    out: list[dict[str, Any]] = []
    for row in rows:
        if isinstance(row, dict):
            out.append({"country": row.get("country"), "license_count": row.get("license_count")})
        else:
            out.append({"country": row[0], "license_count": int(row[1])})
    return out


def _manually_edited_count(conn: Any) -> int:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT COUNT(*)::int FROM licenses WHERE manually_edited IS TRUE;"
        )
        row = cur.fetchone()
    if not row:
        return 0
    return int(row[0] if not isinstance(row, dict) else row.get("count", 0))


def get_data_health(conn: Any) -> dict[str, Any]:
    ensure_license_sync_tables(conn)
    ensure_comtrade_sync_tables(conn)
    ensure_petroleum_osm_tables(conn)

    osm_layers = {}
    for layer_id in ("pipelines", "refineries"):
        try:
            osm_layers[layer_id] = layer_feature_stats(conn, layer_id)
        except Exception as exc:
            osm_layers[layer_id] = {"error": str(exc)}

    return {
        "status": "success",
        "license_sync_runs_latest": list_latest_sync_run_per_source(conn),
        "license_drift_alerts": list_sync_drift_alerts(conn, limit=20),
        "comtrade_sync_runs": list_sync_runs(conn, limit=15),
        "license_counts_by_country": _license_counts_by_country(conn),
        "manually_edited_count": _manually_edited_count(conn),
        "petroleum_osm_layers": osm_layers,
    }
