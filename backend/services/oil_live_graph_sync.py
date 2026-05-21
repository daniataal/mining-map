"""Meridian commercial graph sync — merge free sources into oil_commercial_events + oil_terminals."""

from __future__ import annotations

import json
import os
import re
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

try:
    from psycopg2.extras import Json, RealDictCursor
except ImportError:
    Json = None  # type: ignore
    RealDictCursor = None  # type: ignore

try:
    from backend.services.storage_terminals import get_storage_terminals
except ImportError:
    from services.storage_terminals import get_storage_terminals

try:
    from backend.services.eu_procurement_store import ensure_eu_procurement_tables
except ImportError:
    from services.eu_procurement_store import ensure_eu_procurement_tables

try:
    from backend.services.gov_procurement_store import ensure_gov_procurement_tables
except ImportError:
    from services.gov_procurement_store import ensure_gov_procurement_tables

OIL_INTEL_API_URL = os.getenv("OIL_INTEL_API_URL", "http://oil-live-intel:8095").rstrip("/")
OIL_INTEL_INTERNAL_KEY = os.getenv("OIL_INTEL_INTERNAL_KEY", "oil-intel-dev")
STORAGE_IMPORT_CAP = int(os.getenv("OIL_GRAPH_STORAGE_IMPORT_CAP", "15000"))
GRAPH_SYNC_ENABLED = (os.getenv("OIL_GRAPH_SYNC_ENABLED") or "true").strip().lower() not in {
    "0",
    "false",
    "no",
    "off",
}


def _demo_seed_disabled() -> bool:
    """True when OIL_LIVE_DISABLE_DEMO_SEED is unset or truthy (default: real data only)."""
    return (os.getenv("OIL_LIVE_DISABLE_DEMO_SEED", "1") or "1").strip().lower() in (
        "1",
        "true",
        "yes",
        "on",
    )
_MIGRATIONS_DIR = Path(__file__).resolve().parents[2] / "oil-live-intel" / "migrations"
_MIGRATION_008 = _MIGRATIONS_DIR / "008_commercial_graph.sql"
_MIGRATION_010 = _MIGRATIONS_DIR / "010_oil_live_sync_state.sql"
_MIGRATION_011 = _MIGRATIONS_DIR / "011_port_calls_metadata.sql"
# Public tanker MMSI patterns (not live AIS) for corridor seed density.
_SEED_TANKER_MMSIS = (636023100, 636023101, 636023102, 636023103, 636023104)
_SEED_VESSEL_NAMES = (
    "MT MERIDIAN STAR",
    "MT ATLAS TRADER",
    "MT PACIFIC VOYAGER",
    "MT GULF HORIZON",
    "MT NORTH SEA",
)
# Export hub country → import hub country pairs for Recipe B corridors.
_SEED_CORRIDOR_COUNTRY_PAIRS = (
    ("Saudi Arabia", "Netherlands"),
    ("United Arab Emirates", "Singapore"),
    ("United States of America", "China"),
    ("Russia", "India"),
    ("Kuwait", "South Korea"),
)
PETROLEUM_HS_PREFIXES = ("2709", "2710", "2711", "2802")
PETROLEUM_KEYWORDS = re.compile(
    r"(petroleum|fuel|diesel|gasoil|gasoline|crude|lng|lpg|jet|kerosene|naphtha|oil|gas)",
    re.I,
)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_name(name: str) -> str:
    text = (name or "").lower().strip()
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return " ".join(text.split())


def _pg_json(obj: Any) -> Any:
    if Json is None:
        return json.dumps(obj)
    return Json(obj)


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
    return bool(row[0]) if row else False


def _apply_migration_file(conn: Any, path: Path) -> None:
    if not path.is_file():
        raise FileNotFoundError(f"Missing migration: {path}")
    sql = path.read_text(encoding="utf-8")
    with conn.cursor() as cur:
        cur.execute(sql)
    conn.commit()


def ensure_commercial_graph_tables(conn: Any) -> None:
    """Apply graph-related migrations when oil-live base tables already exist."""
    with conn.cursor() as cur:
        if not _table_exists(cur, "oil_terminals"):
            raise RuntimeError(
                "oil_terminals missing — start oil-live-intel once so Go migrations (001+) run"
            )
        need_008 = not _table_exists(cur, "oil_commercial_events")
        need_010 = not _table_exists(cur, "oil_live_sync_state")
        cur.execute(
            """
            SELECT NOT EXISTS (
              SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'oil_port_calls' AND column_name = 'metadata'
            )
            """
        )
        need_011 = bool(cur.fetchone()[0])
    if need_008:
        _apply_migration_file(conn, _MIGRATION_008)
    if need_010:
        _apply_migration_file(conn, _MIGRATION_010)
    if need_011:
        _apply_migration_file(conn, _MIGRATION_011)


def _record_graph_sync_at(conn: Any, finished_at: str) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO oil_live_sync_state (key, value, updated_at)
            VALUES ('last_graph_sync_at', %s::timestamptz, now())
            ON CONFLICT (key) DO UPDATE SET
              value = EXCLUDED.value,
              updated_at = now()
            """,
            (finished_at,),
        )


def _ensure_demo_opportunities(cur: Any) -> dict[str, Any]:
    """
    Link open opportunities to real terminals; seed one demo row when empty.

    When OIL_LIVE_DISABLE_DEMO_SEED is truthy (default), skips entirely — no linking or inserts.
    """
    if _demo_seed_disabled():
        return {"skipped": True, "reason": "OIL_LIVE_DISABLE_DEMO_SEED"}
    linked_from_port_call = 0
    remapped_terminals = 0
    created = 0

    cur.execute(
        """
        UPDATE oil_opportunities o
        SET terminal_id = pc.terminal_id, updated_at = now()
        FROM oil_port_calls pc
        WHERE o.port_call_id = pc.id
          AND o.terminal_id IS NULL
          AND pc.terminal_id IS NOT NULL
        """
    )
    linked_from_port_call = cur.rowcount

    cur.execute(
        """
        UPDATE oil_opportunities o
        SET terminal_id = t2.id, updated_at = now()
        FROM oil_terminals t1
        JOIN oil_terminals t2
          ON lower(t2.country) = lower(t1.country)
         AND (
           lower(t2.name) = lower(t1.name)
           OR lower(t2.name) LIKE '%' || split_part(lower(t1.name), ' ', 1) || '%'
         )
         AND t2.source = 'osm_storage_import'
        WHERE o.terminal_id = t1.id
          AND t1.source = 'curated_seed'
          AND t2.id <> t1.id
        """
    )
    remapped_terminals = cur.rowcount

    cur.execute("SELECT COUNT(*)::int FROM oil_opportunities WHERE status = 'open'")
    open_count = int(cur.fetchone()[0] or 0)
    if open_count > 0:
        return {
            "linked_from_port_call": linked_from_port_call,
            "remapped_to_osm_terminals": remapped_terminals,
            "demo_created": 0,
            "open_opportunities": open_count,
        }

    cur.execute(
        """
        SELECT pc.id::text, pc.terminal_id::text, pc.mmsi, t.name, pc.event_type, pc.confidence
        FROM oil_port_calls pc
        JOIN oil_terminals t ON t.id = pc.terminal_id
        WHERE pc.status = 'closed' AND pc.terminal_id IS NOT NULL
        ORDER BY pc.arrival_ts DESC NULLS LAST
        LIMIT 1
        """
    )
    row = cur.fetchone()
    if not row:
        return {
            "linked_from_port_call": linked_from_port_call,
            "remapped_to_osm_terminals": remapped_terminals,
            "demo_created": 0,
            "open_opportunities": 0,
        }

    pc_id, terminal_id, mmsi, terminal_name, event_type, confidence = row
    title = f"Possible cargo opportunity at {terminal_name}"
    hypothesis = (
        f"Demo opportunity linked to terminal {terminal_name} "
        f"({event_type or 'visit'}) — inferred from public data."
    )
    evidence = _pg_json(
        [
            "Created during graph sync for demo map → Deal Execution Pack wiring",
            f"Terminal: {terminal_name}",
            f"Event: {event_type or 'port_call'}",
        ]
    )
    checklist = _pg_json(
        [
            "Confirm cargo grade and volume with operator (not inferred AIS alone)",
            "Obtain indicative buy and sell prices",
            "Validate terminal slot and logistics path",
        ]
    )
    cur.execute(
        """
        INSERT INTO oil_opportunities (
          opportunity_type, mmsi, terminal_id, port_call_id, title, hypothesis,
          confidence, evidence, profit_checklist, status, expires_at
        )
        SELECT
          'possible_cargo_flip', %s, %s::uuid, %s::uuid, %s, %s, %s, %s, %s, 'open',
          now() + interval '30 days'
        WHERE NOT EXISTS (
          SELECT 1 FROM oil_opportunities
          WHERE opportunity_type = 'possible_cargo_flip'
            AND mmsi = %s
            AND terminal_id = %s::uuid
            AND status = 'open'
        )
        """,
        (
            mmsi,
            terminal_id,
            pc_id,
            title,
            hypothesis,
            float(confidence or 0.72),
            evidence,
            checklist,
            mmsi,
            terminal_id,
        ),
    )
    if cur.rowcount:
        created = 1

    return {
        "linked_from_port_call": linked_from_port_call,
        "remapped_to_osm_terminals": remapped_terminals,
        "demo_created": created,
        "open_opportunities": open_count + created,
    }


def _is_petroleum_license_row(commodity: str, license_type: str, sector: str) -> bool:
    haystack = " ".join((commodity or "", license_type or "", sector or "")).strip()
    if not haystack:
        return False
    sector_l = (sector or "").strip().lower()
    if sector_l in {"oil", "gas", "petroleum", "energy", "oil_and_gas", "oil & gas"}:
        return True
    return bool(PETROLEUM_KEYWORDS.search(haystack))


def _merge_company_metadata(
    existing: Optional[dict],
    incoming: Optional[dict],
    *,
    source: str,
    company_type: str,
) -> dict:
    base = dict(existing or {})
    base.update(incoming or {})
    roles: list[str] = []
    for item in base.get("roles") or []:
        if isinstance(item, str) and item.strip():
            roles.append(item.strip())
    if company_type and company_type not in roles:
        roles.append(company_type)
    base["roles"] = roles

    sources: list[dict] = []
    seen: set[str] = set()
    for item in base.get("sources") or []:
        if isinstance(item, dict):
            name = str(item.get("name") or "").strip()
            if name and name not in seen:
                seen.add(name)
                sources.append(item)
    if source and source not in seen:
        sources.append({"name": source, "fetched_at": _now_iso()})
    base["sources"] = sources
    return base


def _upsert_company(
    cur: Any,
    *,
    name: str,
    country: str = "",
    company_type: str = "operator",
    source: str = "graph_sync",
    confidence: float = 0.55,
    metadata: Optional[dict] = None,
) -> Optional[str]:
    name = (name or "").strip()
    if not name or len(name) < 2:
        return None
    norm = _normalize_name(name)
    if not norm:
        return None
    cur.execute(
        """
        SELECT metadata FROM oil_companies
        WHERE normalized_name = %s AND country = %s
        LIMIT 1
        """,
        (norm, country or ""),
    )
    row = cur.fetchone()
    existing_meta = row[0] if row and row[0] else {}
    if isinstance(existing_meta, str):
        try:
            existing_meta = json.loads(existing_meta)
        except json.JSONDecodeError:
            existing_meta = {}
    merged_meta = _merge_company_metadata(
        existing_meta if isinstance(existing_meta, dict) else {},
        metadata or {},
        source=source,
        company_type=company_type,
    )
    cur.execute(
        """
        INSERT INTO oil_companies (name, normalized_name, company_type, country, source, confidence, metadata)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (normalized_name, country) DO UPDATE SET
          name = EXCLUDED.name,
          company_type = CASE
            WHEN EXCLUDED.confidence >= oil_companies.confidence THEN EXCLUDED.company_type
            ELSE oil_companies.company_type
          END,
          source = CASE
            WHEN EXCLUDED.confidence >= oil_companies.confidence THEN EXCLUDED.source
            ELSE oil_companies.source
          END,
          confidence = GREATEST(oil_companies.confidence, EXCLUDED.confidence),
          metadata = EXCLUDED.metadata,
          updated_at = now()
        RETURNING id::text
        """,
        (name, norm, company_type, country or "", source, confidence, _pg_json(merged_meta)),
    )
    row = cur.fetchone()
    return str(row[0]) if row else None


def _upsert_commercial_event(
    cur: Any,
    *,
    event_type: str,
    fingerprint: str,
    title: str,
    summary: str = "",
    country: str = "",
    partner_country: str = "",
    commodity_family: str = "",
    hs_code: str = "",
    mmsi: Optional[int] = None,
    terminal_id: Optional[str] = None,
    company_id: Optional[str] = None,
    port_call_id: Optional[str] = None,
    confidence: float = 0.5,
    sources: Optional[list] = None,
    evidence: Optional[list] = None,
    raw: Optional[dict] = None,
    occurred_at: Optional[str] = None,
) -> bool:
    cur.execute(
        """
        INSERT INTO oil_commercial_events (
          event_type, fingerprint, title, summary, country, partner_country,
          commodity_family, hs_code, mmsi, terminal_id, company_id, port_call_id,
          confidence, record_tier, sources, evidence, raw, occurred_at
        ) VALUES (
          %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::uuid, %s::uuid, %s::uuid,
          %s, 'inferred', %s, %s, %s, %s::timestamptz
        )
        ON CONFLICT (fingerprint) DO UPDATE SET
          title = EXCLUDED.title,
          summary = EXCLUDED.summary,
          confidence = GREATEST(oil_commercial_events.confidence, EXCLUDED.confidence),
          sources = EXCLUDED.sources,
          evidence = EXCLUDED.evidence,
          raw = EXCLUDED.raw,
          updated_at = now()
        """,
        (
            event_type,
            fingerprint,
            title,
            summary,
            country,
            partner_country,
            commodity_family,
            hs_code,
            mmsi,
            terminal_id,
            company_id,
            port_call_id,
            confidence,
            _pg_json(sources or []),
            _pg_json(evidence or []),
            _pg_json(raw or {}),
            occurred_at,
        ),
    )
    return cur.rowcount > 0


def _ensure_petroleum_osm_storage_layer(conn: Any) -> dict[str, Any]:
    """Materialize OSM storage tanks into petroleum_osm_features when cache is empty."""
    try:
        try:
            from backend.services.petroleum_osm_store import (
                ensure_petroleum_osm_tables,
                layer_has_cached_features,
                sync_layer_tiles,
            )
        except ImportError:
            from services.petroleum_osm_store import (
                ensure_petroleum_osm_tables,
                layer_has_cached_features,
                sync_layer_tiles,
            )
        ensure_petroleum_osm_tables(conn)
        if layer_has_cached_features(conn, "storage_terminals"):
            return {"status": "skipped", "reason": "storage_terminals already cached"}
        return sync_layer_tiles(conn, "storage_terminals")
    except Exception as exc:
        return {"status": "error", "message": str(exc)[:500]}


def _import_storage_terminals(cur: Any, cap: int = STORAGE_IMPORT_CAP) -> dict[str, Any]:
    cur.execute("SELECT COUNT(*)::int FROM oil_terminals")
    existing_count = int(cur.fetchone()[0] or 0)
    # Refresh OSM when DB is still seed-sized; cached snapshot avoids hammering Overpass every run.
    force_refresh = existing_count < 200
    payload = get_storage_terminals(force_refresh=force_refresh)
    entities = payload.get("entities") or []
    if len(entities) < 100:
        cached_payload = get_storage_terminals(force_refresh=False)
        cached_entities = cached_payload.get("entities") or []
        if len(cached_entities) > len(entities):
            payload = cached_payload
            entities = cached_entities
            force_refresh = False
    storage_warnings = [
        str(w) for w in (payload.get("limitations") or []) if str(w).strip()
    ][:8]
    data_source = payload.get("data_source")
    imported = 0
    companies = 0
    for entity in entities[:cap]:
        lat = entity.get("lat")
        lng = entity.get("lng")
        if lat is None or lng is None:
            continue
        name = entity.get("company") or entity.get("name") or entity.get("displayName") or "Storage terminal"
        country = entity.get("country") or ""
        operator = entity.get("operatorName") or ""
        products = entity.get("commodityHints") or entity.get("products") or []
        if isinstance(products, str):
            products = [products]
        osm_id = entity.get("id") or entity.get("sourceId")
        meta = {
            "osm_id": osm_id,
            "source_entity": entity.get("sourceName"),
            "capacity": entity.get("capacityText"),
        }
        cur.execute(
            """
            INSERT INTO oil_terminals (name, terminal_type, operator_name, country, products, source, confidence, geom, metadata)
            SELECT %s, %s, %s, %s, %s, 'osm_storage_import', %s,
              ST_SetSRID(ST_MakePoint(%s, %s), 4326), %s
            WHERE NOT EXISTS (
              SELECT 1 FROM oil_terminals t
              WHERE t.metadata->>'osm_id' = %s
            )
            """,
            (
                name,
                entity.get("entitySubtype") or "storage_terminal",
                operator or None,
                country,
                products,
                float(entity.get("confidenceScore") or 0.55),
                lng,
                lat,
                _pg_json(meta),
                str(osm_id) if osm_id else "",
            ),
        )
        if cur.rowcount:
            imported += 1
        if operator:
            cid = _upsert_company(
                cur,
                name=operator,
                country=country,
                company_type="terminal_operator",
                source="osm_storage",
                confidence=0.6,
                metadata={"osm_terminal": osm_id},
            )
            if cid:
                companies += 1
    cur.execute("SELECT COUNT(*)::int FROM oil_terminals")
    terminal_count = int(cur.fetchone()[0] or 0)
    result: dict[str, Any] = {
        "terminals_imported": imported,
        "companies_upserted": companies,
        "candidates": len(entities),
        "terminal_count": terminal_count,
        "force_refresh": force_refresh,
        "existing_before_import": existing_count,
        "data_source": data_source,
    }
    if storage_warnings:
        result["warnings"] = storage_warnings
    if len(entities) < 100 and terminal_count < 50:
        result["status"] = "error"
        result["error"] = (
            "Few storage candidates — Overpass may be blocked on this host. "
            "Set STORAGE_SKIP_LIVE_OVERPASS=true in backend.env and re-run graph-sync."
        )
    elif imported == 0 and terminal_count < 50:
        result["status"] = "warning"
        result["error"] = "No new terminals imported; DB still sparse."
    else:
        result["status"] = "ok"
    return result


def _index_licenses(cur: Any) -> dict[str, int]:
    events = 0
    companies = 0
    skipped = 0
    cur.execute(
        """
        SELECT id, company, country, commodity, status, phone_number, license_type, sector
        FROM licenses
        WHERE company IS NOT NULL AND TRIM(company) <> ''
        LIMIT 10000
        """
    )
    for row in cur.fetchall():
        lic_id, company, country, commodity, status, phone, license_type, sector = row
        if not _is_petroleum_license_row(commodity or "", license_type or "", sector or ""):
            skipped += 1
            continue
        cid = _upsert_company(
            cur,
            name=company,
            country=country or "",
            company_type="supplier_license",
            source="licenses",
            confidence=0.65 if (status or "").lower() in ("good", "approved") else 0.5,
            metadata={"license_id": lic_id, "commodity": commodity},
        )
        if cid:
            companies += 1
        fp = f"license:{lic_id}"
        if _upsert_commercial_event(
            cur,
            event_type="supplier_license",
            fingerprint=fp,
            title=f"License holder: {company}",
            summary=f"Supplier/license record in {country or 'unknown'}",
            country=country or "",
            commodity_family=_commodity_from_text(commodity or ""),
            company_id=cid,
            confidence=0.6,
            sources=[{"name": "licenses", "ref": lic_id, "fetched_at": _now_iso()}],
            evidence=[f"License status: {status or 'unknown'}"],
            raw={"license_id": lic_id, "phone": phone},
        ):
            events += 1
    return {"license_events": events, "license_companies": companies, "skipped_non_petroleum": skipped}


def _commodity_from_text(text: str) -> str:
    t = (text or "").lower()
    if "sulfur" in t or "sulphur" in t:
        return "sulfur"
    if "lng" in t or "natural gas" in t:
        return "gas"
    if "lpg" in t or "propane" in t:
        return "gas"
    if "crude" in t:
        return "crude"
    if any(x in t for x in ("diesel", "gasoil", "gasoline", "jet", "naphtha", "refined")):
        return "refined"
    if "oil" in t or "petroleum" in t or "fuel" in t:
        return "refined"
    return ""


def _mirror_trade_flows(cur: Any) -> int:
    if not _table_exists(cur, "oil_trade_flows"):
        return 0
    n = 0
    cur.execute(
        """
        SELECT id::text,
          COALESCE(reporter, reporter_country) AS reporter,
          COALESCE(partner, partner_country) AS partner,
          hs_code, year, flow_type,
          trade_value_usd, net_weight_kg, data_source, ingested_at
        FROM oil_trade_flows
        ORDER BY ingested_at DESC NULLS LAST
        LIMIT 5000
        """
    )
    for row in cur.fetchall():
        fid, rep, partner, hs, year, flow_type, val, weight_kg, data_src, ingested_at = row
        hs_s = str(hs or "")
        if hs_s and not any(hs_s.startswith(p) for p in PETROLEUM_HS_PREFIXES):
            continue
        fp = f"trade:{fid}"
        family = "crude" if hs_s.startswith("2709") else ("gas" if hs_s.startswith("2711") else "refined")
        if hs_s.startswith("2802"):
            family = "sulfur"
        flow_label = "export" if str(flow_type or "").upper() == "X" else "import"
        title = f"{flow_label} {rep} ↔ {partner} HS{hs_s} ({year})"
        occurred = ingested_at.isoformat() if ingested_at else None
        if _upsert_commercial_event(
            cur,
            event_type="macro_trade_flow",
            fingerprint=fp,
            title=title,
            summary=f"Macro trade {year or ''} — not vessel-level",
            country=rep or "",
            partner_country=partner or "",
            commodity_family=family,
            hs_code=hs_s,
            confidence=0.45,
            sources=[{"name": data_src or "comtrade", "fetched_at": _now_iso()}],
            evidence=["UN Comtrade / EIA macro flow"],
            raw={
                "trade_value_usd": float(val) if val is not None else None,
                "net_weight_kg": float(weight_kg) if weight_kg is not None else None,
                "year": int(year) if year is not None else None,
                "flow_type": flow_type,
            },
            occurred_at=occurred,
        ):
            n += 1
    return n


def _index_terminal_operators(cur: Any) -> dict[str, int]:
    """Ensure every distinct OSM terminal operator is in oil_companies."""
    companies = 0
    cur.execute(
        """
        SELECT DISTINCT TRIM(operator_name), country
        FROM oil_terminals
        WHERE operator_name IS NOT NULL AND TRIM(operator_name) <> ''
        """
    )
    for operator, country in cur.fetchall():
        cid = _upsert_company(
            cur,
            name=operator,
            country=country or "",
            company_type="terminal_operator",
            source="osm_storage",
            confidence=0.58,
            metadata={"indexed_from": "oil_terminals"},
        )
        if cid:
            companies += 1
    return {"operators_indexed": companies}


def _scalar_int(cur: Any) -> int:
    row = cur.fetchone()
    if not row:
        return 0
    return int(row[0] if isinstance(row, (tuple, list)) else list(row.values())[0])


def _seed_port_calls_if_sparse(cur: Any) -> dict[str, Any]:
    """
    Seed closed loading/unloading port calls for top hubs when AIS visits stay open.
    Clearly tagged source=seed_port_calls (non-demo).

    When OIL_LIVE_DISABLE_DEMO_SEED is truthy (default), skips entirely.
    """
    if _demo_seed_disabled():
        return {"skipped": True, "reason": "OIL_LIVE_DISABLE_DEMO_SEED"}
    cur.execute(
        """
        SELECT COUNT(*)::int FROM oil_port_calls
        WHERE status = 'closed'
          AND event_type IN ('possible_loading', 'possible_unloading')
          AND COALESCE(evidence::text, '') NOT LIKE '%seed_port_calls%'
        """
    )
    live_closed = _scalar_int(cur)
    cur.execute(
        """
        SELECT COUNT(*)::int FROM oil_port_calls
        WHERE COALESCE(evidence::text, '') LIKE '%seed_port_calls%'
        """
    )
    existing_seed = _scalar_int(cur)
    if live_closed >= 40 and existing_seed >= 80:
        return {
            "status": "skipped",
            "reason": "sufficient closed port calls",
            "live_closed": live_closed,
            "seed_existing": existing_seed,
        }

    cur.execute(
        """
        SELECT id::text, name, country, products, confidence
        FROM oil_terminals
        WHERE country IS NOT NULL AND TRIM(country) <> ''
          AND (
            products && ARRAY['crude_oil','petroleum','refined_products','diesel','fuel_oil']::text[]
            OR terminal_type ILIKE '%%export%%'
            OR terminal_type ILIKE '%%storage%%'
          )
        ORDER BY confidence DESC NULLS LAST, name
        LIMIT 80
        """
    )
    rows = cur.fetchall()
    by_country: dict[str, list[tuple[str, str, list, float]]] = {}
    for tid, name, country, products, conf in rows:
        by_country.setdefault(country, []).append((tid, name, products or [], float(conf or 0.5)))

    def _pick_terminal(country: str, prefer_export: bool) -> Optional[tuple[str, str, list]]:
        candidates = by_country.get(country) or []
        if not candidates:
            needle = (country or "").strip().lower()
            tokens = [t for t in re.split(r"[^a-z0-9]+", needle) if len(t) >= 4]
            for key, vals in by_country.items():
                kl = key.lower()
                if needle in kl or kl in needle:
                    candidates = vals
                    break
                if any(tok in kl for tok in tokens):
                    candidates = vals
                    break
        if not candidates:
            cur.execute(
                """
                SELECT id::text, name, products, confidence
                FROM oil_terminals
                WHERE country ILIKE %s
                  AND (
                    products && ARRAY['crude_oil','petroleum','refined_products','diesel','fuel_oil']::text[]
                    OR terminal_type ILIKE '%%export%%' OR terminal_type ILIKE '%%storage%%'
                  )
                ORDER BY confidence DESC NULLS LAST
                LIMIT 1
                """,
                (f"%{((country or '').split() or [''])[0]}%",),
            )
            row = cur.fetchone()
            if row:
                return row[0], row[1], row[2] or []
            return None
        if prefer_export:
            for tid, name, products, _ in candidates:
                if any("crude" in (p or "").lower() for p in products):
                    return tid, name, products
        return candidates[0][0], candidates[0][1], candidates[0][2]

    created = 0
    vessels_upserted = 0
    now = datetime.now(timezone.utc)

    for idx, mmsi in enumerate(_SEED_TANKER_MMSIS):
        vessel = _SEED_VESSEL_NAMES[idx % len(_SEED_VESSEL_NAMES)]
        cur.execute(
            """
            INSERT INTO oil_vessels (mmsi, name, vessel_type, tanker_class, crude_capable, product_tanker, deadweight_tons, max_draft_m)
            VALUES (%s, %s, 'Tanker', 'crude', true, false, 280000, 16.0)
            ON CONFLICT (mmsi) DO UPDATE SET name = EXCLUDED.name, crude_capable = true
            """,
            (mmsi, vessel),
        )
        if cur.rowcount:
            vessels_upserted += 1

        export_country, import_country = _SEED_CORRIDOR_COUNTRY_PAIRS[idx % len(_SEED_CORRIDOR_COUNTRY_PAIRS)]
        export_pick = _pick_terminal(export_country, prefer_export=True)
        import_pick = _pick_terminal(import_country, prefer_export=False)
        if not export_pick or not import_pick:
            continue
        export_id, export_name, export_products = export_pick
        import_id, import_name, _import_products = import_pick

        family = _commodity_from_text(" ".join(export_products)) or "crude"
        if family == "refined":
            product_family = "refined_products"
        elif family == "crude":
            product_family = "crude_oil"
        else:
            product_family = "crude_oil"

        load_arrival = now - timedelta(days=45 + idx * 7)
        load_departure = load_arrival + timedelta(hours=28)
        unload_arrival = load_departure + timedelta(days=18)
        unload_departure = unload_arrival + timedelta(hours=14)

        load_evidence = _pg_json(
            [
                {"source": "seed_port_calls", "pattern": "export_hub_load"},
                f"Export hub load at {export_name} ({export_country})",
                "Draft increased 6.2m (synthetic historical)",
            ]
        )
        unload_evidence = _pg_json(
            [
                {"source": "seed_port_calls", "pattern": "import_hub_discharge"},
                f"Import hub discharge at {import_name} ({import_country})",
                "Draft decreased 5.8m (synthetic historical)",
            ]
        )

        for event_type, terminal_id, terminal_name, arrival, departure, draft_in, draft_out, draft_delta, evidence in (
            (
                "possible_loading",
                export_id,
                export_name,
                load_arrival,
                load_departure,
                8.5,
                14.7,
                6.2,
                load_evidence,
            ),
            (
                "possible_unloading",
                import_id,
                import_name,
                unload_arrival,
                unload_departure,
                14.5,
                8.7,
                -5.8,
                unload_evidence,
            ),
        ):
            cur.execute(
                """
                INSERT INTO oil_port_calls (
                  mmsi, vessel_name, terminal_id, arrival_ts, departure_ts, duration_hours,
                  draft_in, draft_out, draft_delta, event_type, product_family_inferred,
                  estimated_volume_barrels, confidence, status, evidence, metadata
                )
                SELECT %s, %s, %s::uuid, %s, %s,
                  EXTRACT(EPOCH FROM (%s - %s)) / 3600.0,
                  %s, %s, %s, %s, %s, 750000, 0.74, 'closed', %s, %s::jsonb
                WHERE NOT EXISTS (
                  SELECT 1 FROM oil_port_calls
                  WHERE mmsi = %s AND terminal_id = %s::uuid
                    AND event_type = %s
                    AND COALESCE(evidence::text, '') LIKE '%%seed_port_calls%%'
                )
                """,
                (
                    mmsi,
                    vessel,
                    terminal_id,
                    arrival,
                    departure,
                    departure,
                    arrival,
                    draft_in,
                    draft_out,
                    draft_delta,
                    event_type,
                    product_family,
                    evidence,
                    _pg_json({"source": "seed_port_calls"}),
                    mmsi,
                    terminal_id,
                    event_type,
                ),
            )
            if cur.rowcount:
                created += 1

        # Repeat visit at export hub (Recipe F term-contract hint).
        repeat_arrival = load_arrival - timedelta(days=35)
        repeat_departure = repeat_arrival + timedelta(hours=22)
        cur.execute(
            """
            INSERT INTO oil_port_calls (
              mmsi, vessel_name, terminal_id, arrival_ts, departure_ts, duration_hours,
              draft_in, draft_out, draft_delta, event_type, product_family_inferred,
              estimated_volume_barrels, confidence, status, evidence
            )
            SELECT %s, %s, %s::uuid, %s, %s, 22, 8.8, 14.2, 5.4, 'possible_loading', %s,
              720000, 0.71, 'closed', %s
            WHERE NOT EXISTS (
              SELECT 1 FROM oil_port_calls
              WHERE mmsi = %s AND terminal_id = %s::uuid
                AND event_type = 'possible_loading'
                AND COALESCE(evidence::text, '') LIKE '%%seed_port_calls%%'
                AND arrival_ts < %s
            )
            """,
            (
                mmsi,
                vessel,
                export_id,
                repeat_arrival,
                repeat_departure,
                product_family,
                load_evidence,
                mmsi,
                export_id,
                load_arrival,
            ),
        )
        if cur.rowcount:
            created += 1

    return {
        "status": "ok",
        "created": created,
        "vessels_upserted": vessels_upserted,
        "live_closed_before": live_closed,
        "seed_existing_before": existing_seed,
    }


def _mirror_port_calls(cur: Any) -> int:
    if not _table_exists(cur, "oil_port_calls"):
        return 0
    n = 0
    cur.execute(
        """
        SELECT pc.id::text, pc.mmsi, pc.vessel_name, pc.terminal_id::text, t.name, t.country,
          pc.event_type, pc.product_family_inferred, pc.confidence,
          COALESCE(pc.departure_ts, pc.arrival_ts) AS occurred
        FROM oil_port_calls pc
        LEFT JOIN oil_terminals t ON t.id = pc.terminal_id
        ORDER BY COALESCE(pc.departure_ts, pc.arrival_ts) DESC NULLS LAST
        LIMIT 2000
        """
    )
    for row in cur.fetchall():
        pc_id, mmsi, vessel, tid, tname, country, event, family, conf, occurred = row
        fp = f"port_call:{pc_id}"
        if _upsert_commercial_event(
            cur,
            event_type="inferred_port_call",
            fingerprint=fp,
            title=f"{vessel or mmsi} @ {tname or 'terminal'}",
            summary=f"AIS-derived {event or 'visit'}",
            country=country or "",
            commodity_family=family or "",
            mmsi=int(mmsi) if mmsi else None,
            terminal_id=tid,
            port_call_id=pc_id,
            confidence=float(conf or 0.5),
            sources=[{"name": "ais_port_call", "fetched_at": _now_iso()}],
            evidence=[f"Event: {event}", "Inferred from public AIS"],
            raw={"vessel_name": vessel},
            occurred_at=occurred.isoformat() if occurred else None,
        ):
            n += 1
    return n


def _mirror_ted_notices(cur: Any) -> int:
    ensure_eu_procurement_tables(cur.connection)
    n = 0
    cur.execute(
        """
        SELECT notice_id, title, buyer, country, cpv, published_at
        FROM eu_procurement_notices
        WHERE title ILIKE ANY(ARRAY['%petrol%','%diesel%','%fuel%','%oil%','%gas%','%LPG%','%LNG%'])
           OR cpv LIKE '09%' OR cpv LIKE '091%'
        ORDER BY published_at DESC NULLS LAST
        LIMIT 2000
        """
    )
    for row in cur.fetchall():
        nid, title, buyer, country, cpv, published = row
        fp = f"ted:{nid}"
        cid = _upsert_company(
            cur,
            name=buyer or "Unknown buyer",
            country=country or "",
            company_type="possible_buyer",
            source="ted",
            confidence=0.5,
        )
        if _upsert_commercial_event(
            cur,
            event_type="procurement_notice",
            fingerprint=fp,
            title=(title or "TED notice")[:200],
            summary=f"EU procurement — buyer {buyer or 'unknown'}",
            country=country or "",
            commodity_family=_commodity_from_text(title or ""),
            company_id=cid,
            confidence=0.52,
            sources=[{"name": "eu_ted", "url": f"https://ted.europa.eu/en/notice/{nid}", "fetched_at": _now_iso()}],
            evidence=["EU TED public notice"],
            raw={"cpv": cpv, "buyer": buyer},
            occurred_at=(published or datetime.now(timezone.utc)).isoformat(),
        ):
            n += 1
    return n


def _mirror_gov_awards(cur: Any) -> int:
    ensure_gov_procurement_tables(cur.connection)
    n = 0
    cur.execute(
        """
        SELECT award_id, commodity_tag, recipient_name, agency, amount, award_date, description_snippet
        FROM gov_procurement_awards
        WHERE commodity_tag ILIKE '%petroleum%'
           OR commodity_tag ILIKE '%fuel%'
           OR description_snippet ILIKE ANY(ARRAY['%fuel%','%petroleum%','%diesel%','%JP8%','%F76%'])
        ORDER BY award_date DESC NULLS LAST
        LIMIT 2000
        """
    )
    for row in cur.fetchall():
        aid, tag, recipient, agency, amount, award_date, desc = row
        fp = f"usaspending:{aid}:{tag}"
        cid = _upsert_company(
            cur,
            name=recipient or "Award recipient",
            country="United States",
            company_type="gov_awardee",
            source="usaspending",
            confidence=0.55,
        )
        if _upsert_commercial_event(
            cur,
            event_type="gov_contract",
            fingerprint=fp,
            title=f"US award: {recipient or aid}",
            summary=(desc or "")[:300],
            country="United States",
            commodity_family="refined",
            company_id=cid,
            confidence=0.58,
            sources=[{"name": "usaspending", "fetched_at": _now_iso()}],
            evidence=[f"Agency: {agency}", f"Commodity tag: {tag}"],
            raw={"amount": float(amount) if amount else None, "agency": agency},
            occurred_at=award_date.isoformat() if award_date else None,
        ):
            n += 1
    return n


def _sync_census_trade_flows(conn: Any) -> dict[str, Any]:
    try:
        from backend.services.census_trade import sync_census_trade_flows
    except ImportError:
        from services.census_trade import sync_census_trade_flows
    try:
        return sync_census_trade_flows(conn)
    except Exception as exc:
        return {"status": "error", "message": str(exc)}


def _sync_usitc_trade_flows(conn: Any) -> dict[str, Any]:
    try:
        from backend.services.usitc_dataweb import sync_usitc_dataweb_flows
    except ImportError:
        from services.usitc_dataweb import sync_usitc_dataweb_flows
    try:
        return sync_usitc_dataweb_flows(conn)
    except Exception as exc:
        return {"status": "error", "message": str(exc)}


def _sync_eia_crude_imports(conn: Any) -> dict[str, Any]:
    try:
        from backend.services.eia_imports import sync_eia_crude_imports
    except ImportError:
        from services.eia_imports import sync_eia_crude_imports
    try:
        return sync_eia_crude_imports(conn)
    except Exception as exc:
        return {"status": "error", "message": str(exc)}


def _sync_eia_refinery_throughput(conn: Any) -> dict[str, Any]:
    try:
        from backend.services.eia_imports import sync_eia_refinery_throughput
    except ImportError:
        from services.eia_imports import sync_eia_refinery_throughput
    try:
        return sync_eia_refinery_throughput(conn)
    except Exception as exc:
        return {"status": "error", "message": str(exc)}


def _sync_eia_historic_downloads(conn: Any) -> dict[str, Any]:
    try:
        from backend.services.eia_historic_imports import (
            default_downloads_dir,
            ingest_eia_downloads_folder,
        )
    except ImportError:
        from services.eia_historic_imports import (
            default_downloads_dir,
            ingest_eia_downloads_folder,
        )
    target = default_downloads_dir()
    if not target or not Path(target).is_dir():
        return {"status": "skipped", "reason": "EIA_DOWNLOADS_DIR missing or not a directory"}
    try:
        files = list(Path(target).glob("impa*"))
        if not files:
            return {"status": "skipped", "reason": "no impa*.xls/xlsx in EIA_DOWNLOADS_DIR"}
        return ingest_eia_downloads_folder(conn, target)
    except Exception as exc:
        return {"status": "error", "message": str(exc)}


def _sync_eurostat_trade_flows(conn: Any) -> dict[str, Any]:
    try:
        from backend.services.eurostat_trade import sync_eurostat_hs27
    except ImportError:
        from services.eurostat_trade import sync_eurostat_hs27
    try:
        return sync_eurostat_hs27(conn)
    except Exception as exc:
        return {"status": "error", "message": str(exc)}


def _sync_jodi_validation(conn: Any) -> dict[str, Any]:
    try:
        from backend.services.jodi_oil import sync_jodi_snapshots
    except ImportError:
        from services.jodi_oil import sync_jodi_snapshots
    try:
        return sync_jodi_snapshots(conn)
    except Exception as exc:
        return {"status": "error", "message": str(exc)}


def _sync_commodity_trade_comtrade(conn: Any) -> dict[str, Any]:
    try:
        from backend.services.commodity_trade_flows import sync_mining_hs_comtrade
    except ImportError:
        from services.commodity_trade_flows import sync_mining_hs_comtrade
    try:
        return sync_mining_hs_comtrade(conn)
    except Exception as exc:
        return {"status": "error", "message": str(exc)}


def _sync_uk_trade_manifests(conn: Any) -> dict[str, Any]:
    try:
        from backend.services.trade_manifest_ingest import sync_uk_open_trade_rows
    except ImportError:
        from services.trade_manifest_ingest import sync_uk_open_trade_rows
    try:
        return sync_uk_open_trade_rows(conn)
    except Exception as exc:
        return {"status": "error", "message": str(exc)}


def _run_gleif_batch(conn: Any, *, limit: int) -> dict[str, Any]:
    try:
        from backend.services.gleif_batch import enrich_companies_with_lei
    except ImportError:
        from services.gleif_batch import enrich_companies_with_lei
    try:
        return enrich_companies_with_lei(conn, limit=limit)
    except Exception as exc:
        return {"status": "error", "message": str(exc)}


def _run_wikidata_batch(conn: Any, *, limit: int) -> dict[str, Any]:
    try:
        from backend.services.wikidata_company_enrichment import (
            enrich_companies_with_wikidata,
        )
    except ImportError:
        from services.wikidata_company_enrichment import enrich_companies_with_wikidata
    try:
        return enrich_companies_with_wikidata(conn, limit=limit)
    except Exception as exc:
        return {"status": "error", "message": str(exc)}


def _run_opensanctions_batch(conn: Any, *, limit: int) -> dict[str, Any]:
    try:
        from backend.services.opensanctions_screening import (
            screen_companies_for_sanctions,
        )
    except ImportError:
        from services.opensanctions_screening import screen_companies_for_sanctions
    try:
        return screen_companies_for_sanctions(conn, limit=limit)
    except Exception as exc:
        return {"status": "error", "message": str(exc)}


def _denormalize_mcr_party_enrichment(conn: Any) -> dict[str, Any]:
    try:
        from backend.services.oil_live_mcr_denormalize import (
            denormalize_mcr_party_enrichment,
        )
    except ImportError:
        from services.oil_live_mcr_denormalize import denormalize_mcr_party_enrichment
    try:
        return denormalize_mcr_party_enrichment(conn)
    except Exception as exc:
        return {"status": "error", "message": str(exc)}


def _trigger_synthetic_bol_rebuild() -> dict[str, Any]:
    url = f"{OIL_INTEL_API_URL}/api/oil-live/internal/synthetic-bol-rebuild"
    req = urllib.request.Request(
        url,
        data=b"{}",
        method="POST",
        headers={
            "Content-Type": "application/json",
            "X-Oil-Intel-Internal": OIL_INTEL_INTERNAL_KEY,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            body = resp.read().decode("utf-8")
            return json.loads(body) if body else {"status": "ok"}
    except Exception as exc:
        return {"status": "skipped", "error": str(exc)}


def run_full_graph_sync(conn: Any, *, rebuild_synthetic_bol: bool = True) -> dict[str, Any]:
    """Run all graph merge steps against mining_db."""
    if not GRAPH_SYNC_ENABLED:
        return {"status": "skipped", "reason": "OIL_GRAPH_SYNC_ENABLED is off"}

    with conn.cursor() as cur:
        if not _table_exists(cur, "oil_terminals"):
            return {
                "status": "skipped",
                "reason": "oil_terminals missing — start oil-live-intel once to apply Go migrations",
            }
    try:
        ensure_commercial_graph_tables(conn)
    except RuntimeError as exc:
        return {"status": "skipped", "reason": str(exc)}
    started = _now_iso()
    census_key = (os.getenv("CENSUS_API_KEY") or "").strip()
    eia_key = (os.getenv("EIA_API_KEY") or "").strip()
    summary: dict[str, Any] = {
        "started_at": started,
        "census_api_key_configured": bool(census_key),
        "eia_api_key_configured": bool(eia_key),
        "opensanctions_api_key_configured": bool(
            (os.getenv("OPENSANCTIONS_API_KEY") or "").strip()
        ),
        "steps": {},
    }
    gleif_limit = int(os.getenv("GLEIF_BATCH_LIMIT", "100") or "100")
    wikidata_limit = int(os.getenv("WIKIDATA_BATCH_LIMIT", "50") or "50")
    opensanctions_limit = int(os.getenv("OPENSANCTIONS_BATCH_LIMIT", "50") or "50")
    with conn.cursor() as cur:
        if not _table_exists(cur, "oil_terminals"):
            summary["steps"]["storage_terminals"] = {
                "status": "skipped",
                "reason": "oil_terminals table missing — start oil-live-intel once to apply migrations",
            }
        else:
            summary["steps"]["storage_terminals"] = _import_storage_terminals(cur)
        summary["steps"]["petroleum_osm_storage"] = _ensure_petroleum_osm_storage_layer(conn)
        summary["steps"]["licenses"] = _index_licenses(cur)
        summary["steps"]["terminal_operators"] = _index_terminal_operators(cur)
        summary["steps"]["seed_port_calls"] = _seed_port_calls_if_sparse(cur)
        summary["steps"]["trade_flows"] = {"events": _mirror_trade_flows(cur)}
        summary["steps"]["census_trade"] = _sync_census_trade_flows(conn)
        summary["steps"]["usitc_trade"] = _sync_usitc_trade_flows(conn)
        # Phase 4b — EIA crude imports + refinery throughput (macro tier, country-level).
        summary["steps"]["eia_crude_imports"] = _sync_eia_crude_imports(conn)
        summary["steps"]["eia_refinery_throughput"] = _sync_eia_refinery_throughput(conn)
        summary["steps"]["eia_historic_imports"] = _sync_eia_historic_downloads(conn)
        summary["steps"]["eurostat_trade"] = _sync_eurostat_trade_flows(conn)
        summary["steps"]["jodi_oil"] = _sync_jodi_validation(conn)
        summary["steps"]["commodity_trade_flows"] = _sync_commodity_trade_comtrade(conn)
        summary["steps"]["trade_manifest_uk"] = _sync_uk_trade_manifests(conn)
        # Phase 4c — LEI + Wikidata batch enrichment for oil_companies.
        summary["steps"]["gleif_batch"] = _run_gleif_batch(conn, limit=gleif_limit)
        summary["steps"]["wikidata_enrich"] = _run_wikidata_batch(
            conn, limit=wikidata_limit
        )
        # Phase 4a — OpenSanctions screening for oil_companies.
        summary["steps"]["opensanctions_screening"] = _run_opensanctions_batch(
            conn, limit=opensanctions_limit
        )
        summary["steps"]["port_calls"] = {"events": _mirror_port_calls(cur)}
        try:
            try:
                from backend.services.vessel_position_observations import (
                    mirror_maritime_redis_snapshot,
                )
            except ImportError:
                from services.vessel_position_observations import (
                    mirror_maritime_redis_snapshot,
                )
            summary["steps"]["vessel_position_mirror"] = mirror_maritime_redis_snapshot(conn)
        except Exception as exc:
            summary["steps"]["vessel_position_mirror"] = {
                "status": "skipped",
                "error": str(exc),
            }
        summary["steps"]["ted"] = {"events": _mirror_ted_notices(cur)}
        summary["steps"]["gov_awards"] = {"events": _mirror_gov_awards(cur)}
        summary["steps"]["opportunity_links"] = _ensure_demo_opportunities(cur)
    conn.commit()
    if rebuild_synthetic_bol:
        summary["synthetic_bol"] = _trigger_synthetic_bol_rebuild()
        # Post-rebuild: copy lei + sanctions from oil_companies → meridian_cargo_records
        # so the cargo popup / drawer can render chips without extra JOINs.
        summary["steps"]["mcr_party_denormalize"] = _denormalize_mcr_party_enrichment(
            conn
        )
    summary["finished_at"] = _now_iso()
    _record_graph_sync_at(conn, summary["finished_at"])
    conn.commit()
    summary["status"] = "ok"
    return summary


def purge_demo_seed(conn: Any) -> dict[str, int]:
    """
    Remove demo opportunities and seeded/demo port calls from mining_db.

    Admin: POST /api/admin/oil-live/purge-demo-seed with X-Admin-Token.
    Example:
      curl -X POST "http://localhost:8000/api/admin/oil-live/purge-demo-seed" \\
        -H "X-Admin-Token: $ADMIN_API_TOKEN"
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            DELETE FROM oil_opportunities o
            WHERE o.title ILIKE '%%DEMO%%'
               OR o.hypothesis ILIKE '%%DEMO%%'
               OR o.mmsi = 636012345
               OR EXISTS (
                 SELECT 1 FROM oil_port_calls pc
                 WHERE pc.id = o.port_call_id
                   AND (
                     COALESCE(pc.evidence::text, '') ILIKE '%%seed_port_calls%%'
                     OR COALESCE(pc.metadata::text, '') ILIKE '%%seed_port_calls%%'
                     OR pc.vessel_name ILIKE '%%DEMO%%'
                   )
               )
            """
        )
        opportunities_deleted = int(cur.rowcount or 0)
        cur.execute(
            """
            DELETE FROM oil_port_calls
            WHERE vessel_name ILIKE '%%DEMO%%'
               OR mmsi = 636012345
               OR COALESCE(evidence::text, '') ILIKE '%%seed_port_calls%%'
               OR COALESCE(metadata::text, '') ILIKE '%%seed_port_calls%%'
            """
        )
        port_calls_deleted = int(cur.rowcount or 0)
    conn.commit()
    return {
        "opportunities_deleted": opportunities_deleted,
        "port_calls_deleted": port_calls_deleted,
    }
