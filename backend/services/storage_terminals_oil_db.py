"""Load oil_terminals Postgres rows as reference hubs for sparse OSM enrichment."""

from __future__ import annotations

import json
import os
from typing import Any, Optional

SOURCE_KIND = "oil_terminal_reference"
EXTERNAL_ID_PREFIX = "oil_terminal:"


def _db_connect():
    import psycopg2

    database_url = os.getenv("DATABASE_URL", "").strip()
    if database_url:
        return psycopg2.connect(database_url, connect_timeout=5)
    return psycopg2.connect(
        host=os.getenv("DB_HOST", "localhost"),
        port=int(os.getenv("DB_PORT", "5432")),
        database=os.getenv("DB_NAME", "mining_db"),
        user=os.getenv("DB_USER", "postgres"),
        password=os.getenv("DB_PASSWORD", "password"),
        connect_timeout=5,
    )


def _table_exists(cur: Any, table_name: str) -> bool:
    cur.execute(
        """
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = %s
        )
        """,
        (table_name,),
    )
    row = cur.fetchone()
    return bool(row and row[0])


def _products_to_text(products: Any) -> Optional[str]:
    if isinstance(products, list):
        values = [str(item).strip() for item in products if str(item).strip()]
        return ", ".join(values) if values else None
    if isinstance(products, str) and products.strip():
        return products.strip()
    return None


def normalize_oil_terminal_reference_row(row: dict[str, Any]) -> Optional[dict[str, Any]]:
    terminal_id = str(row.get("id") or "").strip()
    lat = row.get("lat")
    lng = row.get("lng")
    if not terminal_id or lat is None or lng is None:
        return None

    name = str(row.get("name") or "").strip() or "Storage terminal"
    operator = str(row.get("operator_name") or "").strip() or None
    owner = str(row.get("owner_name") or "").strip() or None
    country = str(row.get("country") or "").strip() or "Unknown"
    region = str(row.get("city") or row.get("port") or country).strip() or country
    products = _products_to_text(row.get("products"))
    metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
    if isinstance(row.get("metadata"), str):
        try:
            metadata = json.loads(row["metadata"])
        except json.JSONDecodeError:
            metadata = {}

    capacity_text = None
    if isinstance(metadata.get("capacity"), str) and metadata["capacity"].strip():
        capacity_text = metadata["capacity"].strip()

    source_url = str(row.get("source_url") or "").strip() or None
    confidence = float(row.get("confidence") or 0.55)

    return {
        "id": f"{EXTERNAL_ID_PREFIX}{terminal_id}",
        "company": name,
        "operatorName": operator,
        "ownerName": owner,
        "country": country,
        "region": region,
        "lat": float(lat),
        "lng": float(lng),
        "entitySubtype": str(row.get("terminal_type") or "storage_terminal"),
        "substanceText": products,
        "commodityHints": row.get("products") if isinstance(row.get("products"), list) else [],
        "capacityText": capacity_text,
        "sourceKind": SOURCE_KIND,
        "sourceRecordUrl": source_url,
        "sourceName": "oil_terminals (Postgres)",
        "confidenceScore": round(min(0.82, confidence), 2),
        "enrichmentNote": (
            f"Persisted oil terminal reference ({row.get('source') or 'unknown source'})."
        ),
    }


def load_oil_terminal_reference_hubs(
    *,
    limit: int = 5000,
    connect: Any = None,
) -> list[dict[str, Any]]:
    """Return oil_terminals rows as reference hubs — not map entities."""
    try:
        conn = connect() if connect else _db_connect()
    except Exception:
        return []
    close_conn = connect is None
    hubs: list[dict[str, Any]] = []
    try:
        with conn.cursor() as cur:
            if not _table_exists(cur, "oil_terminals"):
                return []
            cur.execute(
                """
                SELECT id::text, name, terminal_type, operator_name, owner_name,
                       country, port, city, products, source, source_url, confidence,
                       ST_Y(geom::geometry) AS lat, ST_X(geom::geometry) AS lon,
                       metadata
                FROM oil_terminals
                WHERE geom IS NOT NULL
                ORDER BY confidence DESC NULLS LAST, name
                LIMIT %s
                """,
                (max(1, int(limit)),),
            )
            columns = [desc[0] for desc in cur.description]
            for raw_row in cur.fetchall():
                row = dict(zip(columns, raw_row))
                row["lat"] = row.pop("lat", None)
                row["lng"] = row.pop("lon", None)
                hub = normalize_oil_terminal_reference_row(row)
                if hub:
                    hubs.append(hub)
    except Exception:
        return []
    finally:
        if close_conn:
            try:
                conn.close()
            except Exception:
                pass
    return hubs
