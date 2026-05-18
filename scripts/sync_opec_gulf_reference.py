#!/usr/bin/env python3
"""Upsert curated OPEC / Persian Gulf oil & gas reference rows into licenses."""

from __future__ import annotations

import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
BACKEND = os.path.join(ROOT, "backend")
if BACKEND not in sys.path:
    sys.path.insert(0, BACKEND)

from services.ingest.opec_gulf_sync import sync_opec_gulf_data  # noqa: E402

try:
    from main import get_db_connection  # noqa: E402
except ImportError:
    from backend.main import get_db_connection  # noqa: E402


def main() -> int:
    conn = get_db_connection()
    try:
        summary = sync_opec_gulf_data(conn)
        print(summary)
        return 0 if summary.get("entities_written", 0) > 0 else 1
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
