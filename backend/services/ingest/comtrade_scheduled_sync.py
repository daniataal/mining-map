"""Scheduled UN Comtrade HS chapter 27 refresh into oil_trade_flows."""

from __future__ import annotations

import logging
import os
import time
from typing import Any, Callable, Optional

try:
    from backend.services.comtrade_sync_store import (
        ensure_comtrade_sync_tables,
        finish_sync_run,
        start_sync_run,
    )
except ImportError:
    from services.comtrade_sync_store import (
        ensure_comtrade_sync_tables,
        finish_sync_run,
        start_sync_run,
    )

logger = logging.getLogger(__name__)

SYNC_ENABLED = (os.getenv("COMTRADE_SYNC_ENABLED") or "true").strip().lower() not in {
    "0",
    "false",
    "no",
    "off",
}
DEFAULT_YEAR = int(os.getenv("COMTRADE_SYNC_YEAR", str(max(2022, time.gmtime().tm_year - 2))))
BASE_SLEEP = max(0.5, float(os.getenv("COMTRADE_SYNC_SLEEP_SECONDS", "1.2")))
MAX_BACKOFF = max(BASE_SLEEP, float(os.getenv("COMTRADE_SYNC_MAX_BACKOFF_SECONDS", "60")))


def _load_ingest_helpers() -> tuple[Any, Any, Any, list[dict], dict[str, str]]:
    try:
        from backend.ingest_oil_trades import (
            OIL_HS_CODES,
            TOP_OIL_EXPORTERS,
            _fetch_comtrade_bulk,
            ensure_table,
            upsert_rows,
        )
    except ImportError:
        from ingest_oil_trades import (
            OIL_HS_CODES,
            TOP_OIL_EXPORTERS,
            _fetch_comtrade_bulk,
            ensure_table,
            upsert_rows,
        )
    return ensure_table, upsert_rows, _fetch_comtrade_bulk, TOP_OIL_EXPORTERS, OIL_HS_CODES


def _sleep_with_backoff(attempt: int, base: float = BASE_SLEEP) -> None:
    delay = min(MAX_BACKOFF, base * (2 ** min(attempt, 5)))
    time.sleep(delay)


def sync_comtrade_hs27(
    conn: Any,
    *,
    year: Optional[int] = None,
    api_key: Optional[str] = None,
    fetch_bulk: Optional[Callable[..., list[dict]]] = None,
    sleep_fn: Callable[[float], None] = time.sleep,
) -> dict[str, Any]:
    """
    Refresh oil_trade_flows for HS 2709/2710/2711 using the keyed Comtrade API.

    Respects free-tier rate limits with exponential backoff on HTTP 429/503.
    """
    if not SYNC_ENABLED:
        return {"status": "skipped", "reason": "COMTRADE_SYNC_ENABLED is off"}

    key = (api_key if api_key is not None else os.getenv("COMTRADE_API_KEY", "")).strip()
    if not key:
        return {"status": "skipped", "reason": "COMTRADE_API_KEY not set"}

    target_year = year if year is not None else DEFAULT_YEAR
    ensure_table, upsert_rows, fetch_bulk_fn, exporters, hs_codes = _load_ingest_helpers()
    if fetch_bulk is not None:
        fetch_bulk_fn = fetch_bulk

    ensure_comtrade_sync_tables(conn)
    ensure_table(conn)
    conn.commit()

    run_id = start_sync_run(conn, year=target_year)
    conn.commit()

    requests_made = 0
    rows_upserted = 0
    errors: list[str] = []

    for country in exporters:
        for hs_code in hs_codes:
            attempts = 0
            rows: list[dict] = []
            while attempts < 4:
                attempts += 1
                requests_made += 1
                try:
                    rows = fetch_bulk_fn(country["m49"], hs_code, target_year, key)
                    break
                except Exception as exc:
                    msg = f"{country.get('name')}/{hs_code}: {exc}"
                    logger.warning("Comtrade fetch error: %s", msg)
                    if attempts >= 4:
                        errors.append(msg)
                        rows = []
                        break
                    _sleep_with_backoff(attempts)
            if not rows:
                sleep_fn(BASE_SLEEP)
                continue
            try:
                written = upsert_rows(conn, rows)
                rows_upserted += written
            except Exception as exc:
                errors.append(f"upsert {country.get('name')}/{hs_code}: {exc}")
            sleep_fn(BASE_SLEEP)

    status = "success" if not errors else ("partial" if rows_upserted else "error")
    note = None
    if errors and rows_upserted:
        note = f"{len(errors)} fetch/upsert warnings; {rows_upserted} rows written"
    elif errors:
        note = "; ".join(errors[:5])

    finish_sync_run(
        conn,
        run_id,
        status=status,
        requests_made=requests_made,
        rows_upserted=rows_upserted,
        errors=errors,
        note=note,
    )
    conn.commit()

    return {
        "status": status,
        "run_id": run_id,
        "year": target_year,
        "requests_made": requests_made,
        "rows_upserted": rows_upserted,
        "errors": errors,
    }
