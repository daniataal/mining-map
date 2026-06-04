"""
EIA crude imports + refinery throughput sync (Phase 4b)
=======================================================

Two free EIA v2 datasets feed Meridian's macro trade tier:

* **Crude imports** —
  ``https://api.eia.gov/v2/crude-oil-imports/data/``
  monthly U.S. crude oil imports by country of origin. Aggregated to the
  rolling **last 12 months** per origin and upserted into
  ``oil_trade_flows`` with ``data_source='eia'``, ``hs_code='2709'``,
  ``flow_type='M'``.

* **Refinery utilisation by PADD** —
  ``https://api.eia.gov/v2/petroleum/pnp/wiup/data/``
  weekly inputs / operable capacity by PADD region. Stored in a new
  ``oil_refinery_throughput`` table (created in-place via
  ``CREATE TABLE IF NOT EXISTS``).

Both functions skip cleanly when ``EIA_API_KEY`` is unset.

EIA free API key signup: https://www.eia.gov/opendata/register.php
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

try:
    import requests
except ImportError:  # pragma: no cover - requests is in requirements.txt
    requests = None  # type: ignore

LOG = logging.getLogger("meridian.eia_imports")

EIA_BASE_URL = "https://api.eia.gov/v2"
CRUDE_IMPORTS_URL = f"{EIA_BASE_URL}/crude-oil-imports/data/"
REFINERY_UTILIZATION_URL = f"{EIA_BASE_URL}/petroleum/pnp/wiup/data/"
PADD_STOCK_URL = f"{EIA_BASE_URL}/petroleum/stoc/wstk/data/"

# EIA Weekly Petroleum Status Report — ending stocks excluding SPR (million bbl).
PADD_STOCK_SERIES: dict[str, str] = {
    "US": "WCRSTUS1",
    "PADD1": "WCRSTP11",
    "PADD2": "WCRSTP21",
    "PADD3": "WCRSTP31",
    "PADD4": "WCRSTP41",
    "PADD5": "WCRSTP51",
}
SERIES_TO_PADD = {series: padd for padd, series in PADD_STOCK_SERIES.items()}

REPO_ROOT = Path(__file__).resolve().parents[2]
EIA_PADD_STORAGE_CACHE_PATH = REPO_ROOT / "data" / "cache" / "eia_padd_storage.json"

REQUEST_TIMEOUT_SECONDS = 20
PAGE_SIZE = 5000


# Minimal subset of EIA "originId" → display name for crude imports.
# The API also returns ``originName`` in payloads, so this is mostly a
# stability hint for the rare facets that come back un-named.
_DEFAULT_HS_DESC = "Petroleum oils, crude"


def _eia_enabled() -> Optional[str]:
    key = (os.getenv("EIA_API_KEY") or "").strip()
    return key or None


def _is_undefined_column(exc: Exception) -> bool:
    name = type(exc).__name__
    if name == "UndefinedColumn":
        return True
    pgcode = getattr(exc, "pgcode", "") or ""
    return pgcode == "42703"


def _http_get_json(url: str, params: dict[str, Any]) -> Optional[dict[str, Any]]:
    if requests is None:
        return None
    try:
        resp = requests.get(url, params=params, timeout=REQUEST_TIMEOUT_SECONDS)
    except Exception as exc:  # noqa: BLE001
        LOG.warning("EIA HTTP error url=%s err=%s", url, exc)
        return None
    if resp.status_code != 200:
        LOG.warning("EIA HTTP %s url=%s body=%s", resp.status_code, url, resp.text[:200])
        return None
    try:
        return resp.json()
    except Exception as exc:  # noqa: BLE001
        LOG.warning("EIA JSON parse error: %s", exc)
        return None


def _ensure_oil_trade_flows(conn: Any) -> None:
    """Guarantee the oil_trade_flows table exists (matches ingest_oil_trades.ensure_table)."""
    try:
        from backend.ingest_oil_trades import ensure_table  # type: ignore
    except ImportError:  # pragma: no cover
        from ingest_oil_trades import ensure_table  # type: ignore
    ensure_table(conn)


def _twelve_months_back(now: Optional[datetime] = None) -> str:
    base = now or datetime.now(timezone.utc)
    year = base.year
    month = base.month - 12
    while month <= 0:
        month += 12
        year -= 1
    return f"{year:04d}-{month:02d}"


def _current_period(now: Optional[datetime] = None) -> str:
    base = now or datetime.now(timezone.utc)
    return f"{base.year:04d}-{base.month:02d}"


def _aggregate_crude_imports(rows: list[dict[str, Any]]) -> dict[tuple[str, str], dict[str, Any]]:
    """
    Group EIA crude-import rows by (origin_country, destination_country) and
    sum the last 12 months. Quantity is reported in **1000 barrels** per
    month — we convert to kg via a rough 1 bbl ≈ 136 kg (crude average)
    for ``net_weight_kg``.
    """
    grouped: dict[tuple[str, str], dict[str, Any]] = {}
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        origin = (
            row.get("originName")
            or row.get("origin")
            or row.get("originCountryName")
            or row.get("originType")
            or "Unknown"
        )
        destination = (
            row.get("destinationName")
            or row.get("destination")
            or row.get("destinationStateName")
            or "United States"
        )
        try:
            qty_kbbl = float(row.get("quantity") or 0.0)
        except (TypeError, ValueError):
            qty_kbbl = 0.0
        key = (str(origin).strip() or "Unknown", str(destination).strip() or "United States")
        bucket = grouped.setdefault(
            key,
            {
                "origin": key[0],
                "destination": key[1],
                "quantity_kbbl_sum": 0.0,
                "month_count": 0,
                "latest_period": None,
            },
        )
        bucket["quantity_kbbl_sum"] += qty_kbbl
        bucket["month_count"] += 1
        period = row.get("period") or row.get("month") or row.get("date")
        if period and (
            bucket["latest_period"] is None or str(period) > str(bucket["latest_period"])
        ):
            bucket["latest_period"] = str(period)
    return grouped


def _format_upsert_rows(
    grouped: dict[tuple[str, str], dict[str, Any]],
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for (origin, destination), bucket in grouped.items():
        kbbl = float(bucket.get("quantity_kbbl_sum") or 0.0)
        bbl = kbbl * 1000.0
        weight_kg = int(round(bbl * 136.0))  # rough crude average
        latest = bucket.get("latest_period") or ""
        try:
            year = int(latest.split("-")[0]) if latest else datetime.now(timezone.utc).year
        except Exception:
            year = datetime.now(timezone.utc).year
        out.append(
            {
                "reporter": destination,
                "reporter_m49": "840",
                "reporter_iso2": "US",
                "partner": origin,
                "partner_m49": "0",
                "hs_code": "2709",
                "hs_description": _DEFAULT_HS_DESC,
                "flow_type": "M",
                "year": year,
                "trade_value_usd": None,
                "net_weight_kg": weight_kg,
                "data_source": "eia",
            }
        )
    return out


def sync_eia_crude_imports(conn: Any) -> dict[str, Any]:
    """
    Pull the most recent ~12 months of EIA crude-oil-imports data and
    upsert per-origin rollups into ``oil_trade_flows``.

    Skips cleanly with a logged warning when ``EIA_API_KEY`` is unset or
    when ``requests`` is unavailable.
    """
    key = _eia_enabled()
    if not key:
        LOG.warning("sync_eia_crude_imports skipped: EIA_API_KEY unset")
        return {
            "status": "skipped",
            "reason": "EIA_API_KEY unset — free signup at https://www.eia.gov/opendata/register.php",
        }
    if requests is None:
        return {"status": "skipped", "reason": "requests library unavailable"}
    if conn is None:
        return {"status": "skipped", "reason": "no db connection"}

    start = _twelve_months_back()
    end = _current_period()
    params = {
        "api_key": key,
        "frequency": "monthly",
        "data[0]": "quantity",
        "start": start,
        "end": end,
        "sort[0][column]": "period",
        "sort[0][direction]": "desc",
        "offset": 0,
        "length": PAGE_SIZE,
    }
    payload = _http_get_json(CRUDE_IMPORTS_URL, params)
    if not payload:
        return {
            "status": "ok",
            "rows_upserted": 0,
            "message": "EIA crude-imports endpoint returned no data",
        }
    rows = (payload.get("response") or {}).get("data") or []
    grouped = _aggregate_crude_imports(rows)
    upsert_rows = _format_upsert_rows(grouped)

    if not upsert_rows:
        return {
            "status": "ok",
            "rows_upserted": 0,
            "message": "no crude-import rows after aggregation",
            "start": start,
            "end": end,
        }

    try:
        _ensure_oil_trade_flows(conn)
        try:
            from backend.ingest_oil_trades import upsert_rows as _do_upsert  # type: ignore
        except ImportError:  # pragma: no cover
            from ingest_oil_trades import upsert_rows as _do_upsert  # type: ignore
        written = _do_upsert(conn, upsert_rows)
    except Exception as exc:
        LOG.exception("sync_eia_crude_imports: upsert failed: %s", exc)
        return {"status": "error", "message": f"upsert failed: {exc}"}

    return {
        "status": "ok",
        "rows_upserted": written,
        "origins": len(upsert_rows),
        "raw_rows": len(rows),
        "start": start,
        "end": end,
        "data_source": "eia",
    }


# ---------------------------------------------------------------------------
# Refinery throughput
# ---------------------------------------------------------------------------

_REFINERY_DDL = """
CREATE TABLE IF NOT EXISTS oil_refinery_throughput (
  padd            TEXT NOT NULL,
  week_ending     DATE NOT NULL,
  utilization_pct NUMERIC,
  crude_input_mbbl_d NUMERIC,
  ingested_at     TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (padd, week_ending)
);
"""


def _parse_week_ending(period: Any) -> Optional[str]:
    if not period:
        return None
    text = str(period).strip()
    if not text:
        return None
    # EIA returns ISO-ish YYYY-MM-DD for weekly series.
    return text[:10]


def sync_eia_refinery_throughput(conn: Any) -> dict[str, Any]:
    """
    Pull EIA weekly refinery utilisation by PADD, store in
    ``oil_refinery_throughput`` (created inline if missing).

    Skips cleanly when ``EIA_API_KEY`` is unset.
    """
    key = _eia_enabled()
    if not key:
        LOG.warning("sync_eia_refinery_throughput skipped: EIA_API_KEY unset")
        return {"status": "skipped", "reason": "EIA_API_KEY unset"}
    if requests is None:
        return {"status": "skipped", "reason": "requests library unavailable"}
    if conn is None:
        return {"status": "skipped", "reason": "no db connection"}

    try:
        with conn.cursor() as cur:
            cur.execute(_REFINERY_DDL)
        conn.commit()
    except Exception as exc:
        LOG.exception("sync_eia_refinery_throughput: CREATE TABLE failed: %s", exc)
        return {"status": "error", "message": f"create table failed: {exc}"}

    params = {
        "api_key": key,
        "frequency": "weekly",
        "data[0]": "value",
        "sort[0][column]": "period",
        "sort[0][direction]": "desc",
        "offset": 0,
        "length": PAGE_SIZE,
    }
    payload = _http_get_json(REFINERY_UTILIZATION_URL, params)
    if not payload:
        return {"status": "ok", "rows_upserted": 0, "message": "no data returned"}

    rows = (payload.get("response") or {}).get("data") or []
    # Group by (PADD, week_ending) and pull utilization vs crude input.
    grouped: dict[tuple[str, str], dict[str, Any]] = {}
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        padd_raw = (
            row.get("duoarea")
            or row.get("padd")
            or row.get("series-description")
            or ""
        )
        padd = str(padd_raw).strip()
        if not padd:
            continue
        week = _parse_week_ending(row.get("period") or row.get("week"))
        if not week:
            continue
        series = (row.get("series") or row.get("series-id") or "").lower()
        try:
            value = float(row.get("value") or 0.0)
        except (TypeError, ValueError):
            value = None
        bucket = grouped.setdefault(
            (padd, week),
            {"utilization_pct": None, "crude_input_mbbl_d": None},
        )
        if value is None:
            continue
        # Heuristic split: utilization series carry "ut" in the id; input
        # series carry "wcrri" (Weekly Crude Refinery Inputs).
        if "ut" in series or "util" in series:
            bucket["utilization_pct"] = value
        elif "wcrri" in series or "input" in series:
            bucket["crude_input_mbbl_d"] = value
        else:
            # Fall through: if we still have no utilization, keep value as utilization.
            if bucket["utilization_pct"] is None:
                bucket["utilization_pct"] = value

    upserts = 0
    errors: list[str] = []
    try:
        with conn.cursor() as cur:
            for (padd, week), vals in grouped.items():
                try:
                    cur.execute(
                        """
                        INSERT INTO oil_refinery_throughput
                          (padd, week_ending, utilization_pct, crude_input_mbbl_d, ingested_at)
                        VALUES (%s, %s, %s, %s, now())
                        ON CONFLICT (padd, week_ending) DO UPDATE SET
                          utilization_pct = COALESCE(EXCLUDED.utilization_pct, oil_refinery_throughput.utilization_pct),
                          crude_input_mbbl_d = COALESCE(EXCLUDED.crude_input_mbbl_d, oil_refinery_throughput.crude_input_mbbl_d),
                          ingested_at = now()
                        """,
                        (padd, week, vals.get("utilization_pct"), vals.get("crude_input_mbbl_d")),
                    )
                    upserts += 1
                except Exception as exc:
                    errors.append(f"{padd}/{week}: {exc}")
        conn.commit()
    except Exception as exc:
        LOG.exception("sync_eia_refinery_throughput: bulk upsert failed: %s", exc)
        return {"status": "error", "message": str(exc), "rows_upserted": upserts}

    return {
        "status": "ok",
        "rows_upserted": upserts,
        "raw_rows": len(rows),
        "errors": errors[:10],
        "data_source": "eia",
    }


# ---------------------------------------------------------------------------
# PADD weekly crude storage (WPSR) — macro tier for gov storage enrichment
# ---------------------------------------------------------------------------

_PADD_STORAGE_DDL = """
CREATE TABLE IF NOT EXISTS eia_padd_storage_snapshot (
  padd TEXT PRIMARY KEY,
  series_id TEXT NOT NULL,
  stocks_million_bbl NUMERIC NOT NULL,
  period DATE NOT NULL,
  ingested_at TIMESTAMPTZ DEFAULT now()
);
"""


def _normalize_series_id(value: Any) -> str:
    return str(value or "").strip().upper()


def _parse_latest_padd_storage_rows(rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    latest: dict[str, dict[str, Any]] = {}
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        series = _normalize_series_id(row.get("series") or row.get("seriesId") or row.get("series-id"))
        padd = SERIES_TO_PADD.get(series)
        if not padd:
            continue
        period = _parse_week_ending(row.get("period") or row.get("week"))
        if not period:
            continue
        try:
            value = float(row.get("value"))
        except (TypeError, ValueError):
            continue
        existing = latest.get(padd)
        if existing is None or str(period) > str(existing["period"]):
            latest[padd] = {
                "padd": padd,
                "series_id": series,
                "stocks_million_bbl": round(value, 2),
                "period": period,
            }
    return latest


def format_eia_padd_capacity_text(snapshot: dict[str, Any]) -> str:
    padd = str(snapshot.get("padd") or "US")
    mbbl = float(snapshot.get("stocks_million_bbl") or 0.0)
    period = snapshot.get("period") or "latest"
    label = padd if padd == "US" else padd.replace("PADD", "PADD ")
    return (
        f"~{mbbl:.1f} million bbl {label} crude stocks ex SPR "
        f"(EIA weekly WPSR, {period})"
    )


def fetch_eia_padd_storage_latest(api_key: Optional[str] = None) -> dict[str, dict[str, Any]]:
    """Fetch latest weekly PADD crude stocks from EIA v2 (no DB write)."""
    key = (api_key or _eia_enabled() or "").strip()
    if not key:
        return {}
    if requests is None:
        return {}

    params: dict[str, Any] = {
        "api_key": key,
        "frequency": "weekly",
        "data[0]": "value",
        "sort[0][column]": "period",
        "sort[0][direction]": "desc",
        "offset": 0,
        "length": PAGE_SIZE,
    }
    for idx, series in enumerate(PADD_STOCK_SERIES.values()):
        params[f"facets[series][{idx}]"] = series

    payload = _http_get_json(PADD_STOCK_URL, params)
    if not payload:
        return {}
    rows = (payload.get("response") or {}).get("data") or []
    return _parse_latest_padd_storage_rows(rows)


def write_eia_padd_storage_cache(snapshot: dict[str, dict[str, Any]], *, fetched_at: Optional[str] = None) -> Path:
    ts = fetched_at or datetime.now(timezone.utc).isoformat()
    EIA_PADD_STORAGE_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "fetched_at": ts,
        "source": PADD_STOCK_URL,
        "data_source": "eia",
        "padds": snapshot,
    }
    EIA_PADD_STORAGE_CACHE_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return EIA_PADD_STORAGE_CACHE_PATH


def read_eia_padd_storage_cache(path: Optional[Path] = None) -> dict[str, dict[str, Any]]:
    cache_path = path or EIA_PADD_STORAGE_CACHE_PATH
    if not cache_path.is_file():
        return {}
    try:
        payload = json.loads(cache_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    padds = payload.get("padds") if isinstance(payload, dict) else None
    if not isinstance(padds, dict):
        return {}
    return {str(k): v for k, v in padds.items() if isinstance(v, dict)}


def load_eia_padd_storage_overlay() -> dict[str, dict[str, Any]]:
    """Read latest cached PADD storage snapshot for gov hub enrichment."""
    return read_eia_padd_storage_cache()


def sync_eia_padd_storage(conn: Any) -> dict[str, Any]:
    """
    Pull EIA weekly PADD crude stocks (WPSR), persist to Postgres + JSON cache.

    Used by graph-sync on a schedule; storage-terminal gov enrichment reads the cache.
    """
    key = _eia_enabled()
    if not key:
        LOG.warning("sync_eia_padd_storage skipped: EIA_API_KEY unset")
        return {"status": "skipped", "reason": "EIA_API_KEY unset"}
    if requests is None:
        return {"status": "skipped", "reason": "requests library unavailable"}

    snapshot = fetch_eia_padd_storage_latest(key)
    if not snapshot:
        cached = read_eia_padd_storage_cache()
        if cached:
            return {
                "status": "ok",
                "rows_upserted": 0,
                "padds": len(cached),
                "message": "EIA fetch empty; kept existing cache",
                "cache_path": str(EIA_PADD_STORAGE_CACHE_PATH),
            }
        return {"status": "ok", "rows_upserted": 0, "message": "no PADD storage data returned"}

    fetched_at = datetime.now(timezone.utc).isoformat()
    cache_path = write_eia_padd_storage_cache(snapshot, fetched_at=fetched_at)
    upserts = 0
    if conn is not None:
        try:
            with conn.cursor() as cur:
                cur.execute(_PADD_STORAGE_DDL)
                for padd, row in snapshot.items():
                    cur.execute(
                        """
                        INSERT INTO eia_padd_storage_snapshot
                          (padd, series_id, stocks_million_bbl, period, ingested_at)
                        VALUES (%s, %s, %s, %s, now())
                        ON CONFLICT (padd) DO UPDATE SET
                          series_id = EXCLUDED.series_id,
                          stocks_million_bbl = EXCLUDED.stocks_million_bbl,
                          period = EXCLUDED.period,
                          ingested_at = now()
                        """,
                        (
                            padd,
                            row.get("series_id"),
                            row.get("stocks_million_bbl"),
                            row.get("period"),
                        ),
                    )
                    upserts += 1
            conn.commit()
        except Exception as exc:
            LOG.exception("sync_eia_padd_storage: db upsert failed: %s", exc)
            return {
                "status": "partial",
                "rows_upserted": upserts,
                "padds": len(snapshot),
                "cache_path": str(cache_path),
                "message": f"cache written; db upsert failed: {exc}",
            }

    return {
        "status": "ok",
        "rows_upserted": upserts or len(snapshot),
        "padds": len(snapshot),
        "cache_path": str(cache_path),
        "fetched_at": fetched_at,
        "data_source": "eia",
    }


__all__ = [
    "sync_eia_crude_imports",
    "sync_eia_refinery_throughput",
    "sync_eia_padd_storage",
    "fetch_eia_padd_storage_latest",
    "load_eia_padd_storage_overlay",
    "format_eia_padd_capacity_text",
    "read_eia_padd_storage_cache",
    "write_eia_padd_storage_cache",
    "EIA_BASE_URL",
    "CRUDE_IMPORTS_URL",
    "REFINERY_UTILIZATION_URL",
    "PADD_STOCK_URL",
]
