from __future__ import annotations

import json
import os
import time
from typing import Any


try:
    from backend.services.ingest import open_data_sync
except ImportError:
    from services.ingest import open_data_sync

try:
    from backend.ingest_oil_trades import ingest as ingest_oil_trades
except ImportError:
    from ingest_oil_trades import ingest as ingest_oil_trades


def _int_env(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default


def run_once() -> dict[str, Any]:
    summary: dict[str, Any] = {"open_data": None, "oil_trades": None}
    print("[license-sync-worker] starting open-data sync…")
    summary["open_data"] = open_data_sync.sync_open_data_sources()
    print("[license-sync-worker] open-data sync:", json.dumps(summary["open_data"], default=str)[:2000])

    try:
        print("[license-sync-worker] oil trades seed refresh…")
        summary["oil_trades"] = ingest_oil_trades(year=2022, seed_only=True)
        print("[license-sync-worker] oil trades:", json.dumps(summary["oil_trades"], default=str)[:2000])
    except Exception as exc:
        summary["oil_trades"] = {"error": str(exc)}
        print(f"[license-sync-worker] oil trades refresh failed (non-fatal): {exc}")

    return summary


def main() -> None:
    interval_seconds = max(300, _int_env("LICENSE_DAILY_SYNC_INTERVAL_SECONDS", 86_400))
    backoff_seconds = max(60, _int_env("LICENSE_DAILY_SYNC_BACKOFF_SECONDS", 600))
    while True:
        try:
            run_once()
            time.sleep(interval_seconds)
        except Exception as exc:
            print(f"[license-sync-worker] sync failed: {exc}")
            time.sleep(backoff_seconds)


if __name__ == "__main__":
    main()
