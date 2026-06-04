#!/usr/bin/env python3
"""Batch materialize storage terminal popup JSON into storage_terminal_display.

Usage (from repo root, with DATABASE_URL or DB_* set):
  python -m backend.scripts.materialize_storage_terminal_displays
  python -m backend.scripts.materialize_storage_terminal_displays --limit 2000
  python -m backend.scripts.materialize_storage_terminal_displays --terminal-id osm:node:123

Requires STORAGE_DISPLAY_MATERIALIZE_ENABLED=true (set in env or export before run).
Periodic refresh: re-run after petroleum-osm-sync worker or oil_live_graph_sync petroleum_osm_storage step.
"""

from __future__ import annotations

import argparse
import json
import os
import sys


def main() -> int:
    parser = argparse.ArgumentParser(description="Materialize storage terminal display JSON in Postgres")
    parser.add_argument("--limit", type=int, default=None, help="Max OSM rows per run (default: env cap)")
    parser.add_argument(
        "--terminal-id",
        action="append",
        dest="terminal_ids",
        default=None,
        help="Materialize only these terminal ids (repeatable)",
    )
    args = parser.parse_args()

    os.environ.setdefault("STORAGE_DISPLAY_MATERIALIZE_ENABLED", "true")

    try:
        from backend.services.storage_terminal_display import (
            _db_connect,
            materialize_storage_displays,
            storage_display_materialize_enabled,
        )
    except ImportError:
        from services.storage_terminal_display import (  # type: ignore
            _db_connect,
            materialize_storage_displays,
            storage_display_materialize_enabled,
        )

    if not storage_display_materialize_enabled():
        print("STORAGE_DISPLAY_MATERIALIZE_ENABLED is off; export true or pass --help", file=sys.stderr)
        return 1

    conn = _db_connect()
    try:
        summary = materialize_storage_displays(
            conn,
            terminal_ids=args.terminal_ids,
            limit=args.limit,
        )
        conn.commit()
    finally:
        conn.close()

    print(json.dumps(summary, indent=2, default=str))
    return 0 if summary.get("status") in {"success", "skipped"} else 1


if __name__ == "__main__":
    raise SystemExit(main())
