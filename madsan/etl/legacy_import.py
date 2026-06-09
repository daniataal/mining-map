#!/usr/bin/env python3
"""Transitional ETL: legacy mining_db -> madsan ingestion_jobs (Go worker processes master writes)."""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone

try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    print("pip install psycopg2-binary", file=sys.stderr)
    sys.exit(1)

LEGACY = os.environ.get(
    "LEGACY_DATABASE_URL",
    "postgresql://postgres:password@127.0.0.1:5434/mining_db",
)
MADSAN = os.environ.get(
    "DATABASE_URL",
    "postgresql://postgres:password@127.0.0.1:5433/madsan_db",
)
BATCH = int(os.environ.get("ETL_BATCH", "5000"))
MAX_ROWS = int(os.environ.get("ETL_MAX_ROWS", "0"))  # 0 = no limit
TABLES = os.environ.get("ETL_TABLES", "").split(",") if os.environ.get("ETL_TABLES") else []

LAYER_ASSET_TYPE = {
    "storage_terminals": "tank_farm",
    "refineries": "refinery",
    "pipelines": "pipeline",
    "oilfields": "terminal",
    "oil_fields": "terminal",
    "petroleum_wells": "terminal",
    "wells": "terminal",
}

QUERIES: dict[str, str] = {
    "petroleum_osm_features": """
        SELECT id, layer_id, tags,
               ST_Y(ST_PointOnSurface(geom)) AS latitude,
               ST_X(ST_PointOnSurface(geom)) AS longitude
        FROM petroleum_osm_features
        WHERE geom IS NOT NULL
        ORDER BY id OFFSET %s LIMIT %s
    """,
    "oil_vessels": """
        SELECT v.mmsi, v.imo, v.name, v.vessel_type, v.tanker_class,
               p.lat AS latitude, p.lon AS longitude, p.ts AS last_seen_at
        FROM oil_vessels v
        LEFT JOIN LATERAL (
            SELECT lat, lon, ts FROM oil_ais_positions
            WHERE mmsi = v.mmsi ORDER BY ts DESC LIMIT 1
        ) p ON true
        ORDER BY v.mmsi OFFSET %s LIMIT %s
    """,
    "oil_companies": """
        SELECT id, name, country, company_type, confidence, metadata
        FROM oil_companies ORDER BY name OFFSET %s LIMIT %s
    """,
    "licenses": """
        SELECT id, company, country, commodity, sector, license_type, lat AS latitude, lng AS longitude,
               phone_number, contact_person, geo_confidence, raw_payload
        FROM licenses
        WHERE lat IS NOT NULL AND lng IS NOT NULL
        ORDER BY id OFFSET %s LIMIT %s
    """,
}

TABLE_META = [
    ("oil_vessels", "vessel", None),
    ("oil_companies", "company", None),
    ("licenses", "asset", "mine"),
    ("petroleum_osm_features", "asset", None),
]


def normalize_row(table: str, entity_type: str, default_asset_type: str | None, row: dict) -> dict:
    name = (
        row.get("name")
        or row.get("company_name")
        or row.get("company")
        or row.get("title")
    )
    if not name and table == "petroleum_osm_features":
        tags = row.get("tags") or {}
        if isinstance(tags, str):
            try:
                tags = json.loads(tags)
            except json.JSONDecodeError:
                tags = {}
        name = tags.get("name") or tags.get("operator") or f"{row.get('layer_id')}:{row.get('id')}"

    lat = row.get("latitude") or row.get("lat")
    lng = row.get("longitude") or row.get("lon") or row.get("lng")
    country = row.get("country_code") or row.get("country")

    asset_type = default_asset_type
    if table == "petroleum_osm_features":
        asset_type = LAYER_ASSET_TYPE.get(str(row.get("layer_id")), "terminal")
    elif table == "licenses":
        sector = (row.get("sector") or "mining").lower()
        asset_type = "mine" if sector == "mining" else "processing_plant"

    commodities: list[str] = []
    if row.get("commodity"):
        commodities = [str(row["commodity"])]
    if table == "petroleum_osm_features":
        commodities = ["petroleum"]

    rec = {
        "entity_type": entity_type,
        "name": name,
        "country_code": country,
        "latitude": lat,
        "longitude": lng,
        "commodities": commodities,
        "asset_type": asset_type,
        "source_slug": f"legacy_{table}",
        "external_id": str(row.get("id") or row.get("mmsi") or ""),
        "raw_payload": {k: (str(v) if hasattr(v, "isoformat") else v) for k, v in row.items()},
    }
    if table == "oil_vessels":
        rec["mmsi"] = str(row.get("mmsi")) if row.get("mmsi") is not None else None
        rec["imo"] = row.get("imo")
    if row.get("confidence") is not None:
        rec["confidence_score"] = float(row["confidence"])
    if row.get("geo_confidence") is not None:
        rec["confidence_score"] = float(row["geo_confidence"])
    return rec


def fetch_legacy(conn, table: str, offset: int) -> list[dict]:
    sql = QUERIES[table]
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(sql, (offset, BATCH))
        rows = cur.fetchall()
        return [dict(r) for r in rows]


def enqueue_job(conn, source_slug: str, records: list[dict]) -> None:
    payload = {"records": records, "imported_at": datetime.now(timezone.utc).isoformat()}
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO ingestion_jobs (job_type, source_slug, status, payload, scheduled_at)
            VALUES ('legacy_etl', %s, 'pending', %s::jsonb, now())
            """,
            (source_slug, json.dumps(payload, default=str)),
        )
    conn.commit()


def main() -> None:
    dry = os.environ.get("ETL_DRY_RUN", "false").lower() == "true"
    legacy = psycopg2.connect(LEGACY)
    madsan = psycopg2.connect(MADSAN)
    stats: dict[str, int] = {}
    tables = TABLE_META
    if TABLES:
        tables = [t for t in TABLE_META if t[0] in TABLES]

    for table, entity_type, asset_type in tables:
        offset = 0
        total = 0
        while True:
            if MAX_ROWS and total >= MAX_ROWS:
                break
            rows = fetch_legacy(legacy, table, offset)
            if not rows:
                break
            if MAX_ROWS:
                rows = rows[: max(0, MAX_ROWS - total)]
            records = [normalize_row(table, entity_type, asset_type, r) for r in rows]
            if not dry:
                enqueue_job(madsan, f"legacy_{table}", records)
            total += len(records)
            offset += BATCH
            if len(rows) < BATCH:
                break
        stats[table] = total
        print(f"{table}: {total} records {'(dry-run)' if dry else 'enqueued'}")

    report_path = os.path.join(os.path.dirname(__file__), "..", "agent_reports", "etl_legacy_report.json")
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(
            {"generated_at": datetime.now(timezone.utc).isoformat(), "counts": stats, "dry_run": dry},
            f,
            indent=2,
        )
    print(json.dumps(stats))


if __name__ == "__main__":
    main()
