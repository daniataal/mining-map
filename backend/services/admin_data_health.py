"""Aggregate operational data-health stats for admin dashboard."""

from __future__ import annotations

from typing import Any, Optional

try:
    from backend.services.comtrade_sync_store import ensure_comtrade_sync_tables, list_sync_runs
    from backend.services.eu_procurement_store import ensure_eu_procurement_tables, list_sync_runs as list_ted_sync_runs
    from backend.services.ingest.kazakhstan_arcgis_probe import get_latest_probe, run_and_persist_probe
    from backend.services.license_sync_store import (
        ensure_license_sync_tables,
        list_latest_sync_run_per_source,
        list_sync_drift_alerts,
    )
    from backend.services.petroleum_osm_store import ensure_petroleum_osm_tables, layer_feature_stats
    from backend.services.petroleum_osm_sync_store import ensure_petroleum_osm_sync_tables, list_sync_runs as list_osm_sync_runs
    from backend.services.sync_alert_store import count_unread_alerts, ensure_sync_alert_tables
except ImportError:
    from services.comtrade_sync_store import ensure_comtrade_sync_tables, list_sync_runs
    from services.eu_procurement_store import ensure_eu_procurement_tables, list_sync_runs as list_ted_sync_runs
    from services.ingest.kazakhstan_arcgis_probe import get_latest_probe, run_and_persist_probe
    from services.license_sync_store import (
        ensure_license_sync_tables,
        list_latest_sync_run_per_source,
        list_sync_drift_alerts,
    )
    from services.petroleum_osm_store import ensure_petroleum_osm_tables, layer_feature_stats
    from services.petroleum_osm_sync_store import ensure_petroleum_osm_sync_tables, list_sync_runs as list_osm_sync_runs
    from services.sync_alert_store import count_unread_alerts, ensure_sync_alert_tables


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


def get_data_health(conn: Any, *, refresh_kz_probe: bool = False) -> dict[str, Any]:
    ensure_license_sync_tables(conn)
    ensure_comtrade_sync_tables(conn)
    ensure_petroleum_osm_tables(conn)
    ensure_petroleum_osm_sync_tables(conn)
    ensure_sync_alert_tables(conn)
    ensure_eu_procurement_tables(conn)

    if refresh_kz_probe:
        try:
            run_and_persist_probe(conn)
            conn.commit()
        except Exception as exc:
            print(f"[data-health] KZ ArcGIS probe failed: {exc}")

    osm_layers = {}
    for layer_id in ("pipelines", "refineries"):
        try:
            osm_layers[layer_id] = layer_feature_stats(conn, layer_id)
        except Exception as exc:
            osm_layers[layer_id] = {"error": str(exc)}

    kz_probe = get_latest_probe(conn)

    return {
        "status": "success",
        "license_sync_runs_latest": list_latest_sync_run_per_source(conn),
        "license_drift_alerts": list_sync_drift_alerts(conn, limit=20),
        "sync_alert_unread_count": count_unread_alerts(conn),
        "comtrade_sync_runs": list_sync_runs(conn, limit=15),
        "petroleum_osm_sync_runs": list_osm_sync_runs(conn, limit=15),
        "eu_procurement_sync_runs": list_ted_sync_runs(conn, limit=10),
        "license_counts_by_country": _license_counts_by_country(conn),
        "manually_edited_count": _manually_edited_count(conn),
        "petroleum_osm_layers": osm_layers,
        "kazakhstan_arcgis_probe": kz_probe,
    }
