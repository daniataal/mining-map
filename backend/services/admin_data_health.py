"""Aggregate operational data-health stats for admin dashboard."""

from __future__ import annotations

from typing import Any, Optional

try:
    from backend.services.comtrade_sync_store import ensure_comtrade_sync_tables, list_sync_runs
    from backend.services.eu_procurement_store import ensure_eu_procurement_tables, list_sync_runs as list_ted_sync_runs
    from backend.services.gov_procurement_store import ensure_gov_procurement_tables, list_sync_runs as list_gov_sync_runs
    from backend.services.ingest.kazakhstan_arcgis_probe import get_latest_probe as get_kz_probe, run_and_persist_probe as run_kz_probe
    from backend.services.ingest.philippines_mgb_arcgis_probe import (
        get_latest_probe as get_ph_probe,
        run_and_persist_probe as run_ph_probe,
    )
    from backend.services.license_sync_store import (
        ensure_license_sync_tables,
        list_latest_sync_run_per_source,
        list_sync_drift_alerts,
    )
    from backend.services.petroleum_osm_store import ensure_petroleum_osm_tables, layer_feature_stats
    from backend.services.petroleum_osm_sync_store import ensure_petroleum_osm_sync_tables, list_sync_runs as list_osm_sync_runs
    from backend.services.sync_alert_store import count_unread_alerts, ensure_sync_alert_tables
    from backend.services.sync_sla import build_source_sla_dashboard
except ImportError:
    from services.comtrade_sync_store import ensure_comtrade_sync_tables, list_sync_runs
    from services.eu_procurement_store import ensure_eu_procurement_tables, list_sync_runs as list_ted_sync_runs
    from services.gov_procurement_store import ensure_gov_procurement_tables, list_sync_runs as list_gov_sync_runs
    from services.ingest.kazakhstan_arcgis_probe import get_latest_probe as get_kz_probe, run_and_persist_probe as run_kz_probe
    from services.ingest.philippines_mgb_arcgis_probe import (
        get_latest_probe as get_ph_probe,
        run_and_persist_probe as run_ph_probe,
    )
    from services.license_sync_store import (
        ensure_license_sync_tables,
        list_latest_sync_run_per_source,
        list_sync_drift_alerts,
    )
    from services.petroleum_osm_store import ensure_petroleum_osm_tables, layer_feature_stats
    from services.petroleum_osm_sync_store import ensure_petroleum_osm_sync_tables, list_sync_runs as list_osm_sync_runs
    from services.sync_alert_store import count_unread_alerts, ensure_sync_alert_tables
    from services.sync_sla import build_source_sla_dashboard

_NORDIC_SOURCE_IDS = (
    "norway_npd_production_licences_current",
    "finland_tukes_active_mining_areas",
)
_POLAND_SOURCE_IDS = (
    "poland_pgi_deposits",
    "poland_pgi_midas_layer1",
    "poland_pgi_midas_layer2",
)


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


def _license_counts_by_source_id(conn: Any, *, source_ids: Optional[tuple[str, ...]] = None) -> list[dict[str, Any]]:
    ids = source_ids or _NORDIC_SOURCE_IDS + _POLAND_SOURCE_IDS
    if not ids:
        return []
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT source_id, COUNT(*)::int AS license_count
            FROM licenses
            WHERE source_id = ANY(%s)
            GROUP BY source_id
            ORDER BY source_id ASC;
            """,
            (list(ids),),
        )
        rows = cur.fetchall()
    out: list[dict[str, Any]] = []
    seen = set(ids)
    for row in rows:
        if isinstance(row, dict):
            sid = row.get("source_id")
            out.append({"source_id": sid, "license_count": row.get("license_count")})
        else:
            sid, count = row[0], int(row[1])
            out.append({"source_id": sid, "license_count": count})
        if sid:
            seen.discard(sid)
    for sid in sorted(seen):
        out.append({"source_id": sid, "license_count": 0})
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


def _nordic_admin_notes(source_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    caps = {
        "norway_npd_production_licences_current": 2500,
        "finland_tukes_active_mining_areas": 500,
    }
    notes: list[dict[str, Any]] = []
    for row in source_rows:
        sid = str(row.get("source_id") or "")
        if sid not in caps:
            continue
        count = int(row.get("license_count") or 0)
        cap = caps[sid]
        notes.append(
            {
                "source_id": sid,
                "license_count": count,
                "sync_cap": cap,
                "note": (
                    f"{count} rows in DB (OPEN_DATA_SOURCES cap {cap} per run). "
                    "NPD Factmaps / Tukes GTK — verify at official register."
                ),
            }
        )
    return notes


def get_data_health(conn: Any, *, refresh_probes: bool = False) -> dict[str, Any]:
    ensure_license_sync_tables(conn)
    ensure_comtrade_sync_tables(conn)
    ensure_petroleum_osm_tables(conn)
    ensure_petroleum_osm_sync_tables(conn)
    ensure_sync_alert_tables(conn)
    ensure_eu_procurement_tables(conn)
    ensure_gov_procurement_tables(conn)

    if refresh_probes:
        for label, runner in (("kz", run_kz_probe), ("ph", run_ph_probe)):
            try:
                runner(conn)
                conn.commit()
            except Exception as exc:
                print(f"[data-health] {label} ArcGIS probe failed: {exc}")

    osm_layers = {}
    for layer_id in ("pipelines", "refineries"):
        try:
            osm_layers[layer_id] = layer_feature_stats(conn, layer_id)
        except Exception as exc:
            osm_layers[layer_id] = {"error": str(exc)}

    latest_runs = list_latest_sync_run_per_source(conn)
    source_sla = build_source_sla_dashboard(latest_runs)
    license_by_source = _license_counts_by_source_id(conn)

    return {
        "status": "success",
        "license_sync_runs_latest": latest_runs,
        "source_sync_sla": source_sla,
        "license_drift_alerts": list_sync_drift_alerts(conn, limit=20),
        "sync_alert_unread_count": count_unread_alerts(conn),
        "comtrade_sync_runs": list_sync_runs(conn, limit=15),
        "petroleum_osm_sync_runs": list_osm_sync_runs(conn, limit=15),
        "eu_procurement_sync_runs": list_ted_sync_runs(conn, limit=10),
        "gov_procurement_sync_runs": list_gov_sync_runs(conn, limit=10),
        "license_counts_by_country": _license_counts_by_country(conn),
        "license_counts_by_source_id": license_by_source,
        "nordic_source_admin_notes": _nordic_admin_notes(license_by_source),
        "manually_edited_count": _manually_edited_count(conn),
        "petroleum_osm_layers": osm_layers,
        "kazakhstan_arcgis_probe": get_kz_probe(conn),
        "philippines_mgb_arcgis_probe": get_ph_probe(conn),
        "open_data_probes": {
            "kazakhstan_arcgis_hub": get_kz_probe(conn),
            "philippines_mgb_arcgis": get_ph_probe(conn),
        },
    }
