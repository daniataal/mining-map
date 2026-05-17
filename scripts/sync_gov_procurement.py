#!/usr/bin/env python3
"""Sync U.S. federal procurement awards from USAspending into Postgres."""

from __future__ import annotations

import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
BACKEND = os.path.join(ROOT, "backend")
if BACKEND not in sys.path:
    sys.path.insert(0, BACKEND)

from services.ingest.gov_procurement_sync import sync_gov_procurement_data  # noqa: E402

try:
    from main import ensure_schema_initialized, get_db_connection  # noqa: E402
except ImportError:
    from backend.main import ensure_schema_initialized, get_db_connection  # noqa: E402


def main() -> int:
    if not ensure_schema_initialized():
        print("Schema initialization failed.")
        return 1
    conn = get_db_connection()
    try:
        summary = sync_gov_procurement_data(conn)
        print(summary)
        return 0 if summary.get("status") == "ok" else 1
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
