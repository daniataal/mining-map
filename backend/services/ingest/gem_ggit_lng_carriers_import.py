"""
GEM GGIT supplemental — LNG carrier fleet (Dec 2025 release).

Placeholder ingest: creates ``gem_lng_carriers`` when the workbook is present.
Full AIS linkage is handled by oil-live-intel maritime workers separately.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Optional

REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_FILENAME = "Global-Gas-Infrastructure-Tracker-GGIT-LNG-Carriers-December-2025.xlsx"


def default_workbook_path() -> Path:
    override = (os.getenv("GEM_GGIT_LNG_CARRIERS_XLSX_PATH") or "").strip()
    if override:
        return Path(override).expanduser()
    return REPO_ROOT / DEFAULT_FILENAME


def ensure_gem_lng_carrier_tables(conn: Any) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS gem_lng_carriers (
                id BIGSERIAL PRIMARY KEY,
                carrier_key TEXT NOT NULL UNIQUE,
                vessel_name TEXT,
                imo TEXT,
                tags JSONB NOT NULL DEFAULT '{}'::jsonb,
                fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            """
        )


def ingest_gem_ggit_lng_carriers(
    conn: Any,
    *,
    workbook_path: Optional[str | Path] = None,
) -> dict[str, Any]:
    path = Path(workbook_path).expanduser() if workbook_path else default_workbook_path()
    ensure_gem_lng_carrier_tables(conn)
    if not path.is_file():
        return {
            "status": "skipped",
            "reason": "workbook_missing",
            "workbook_path": str(path),
            "carriers_written": 0,
        }
    return {
        "status": "skipped",
        "reason": "parser_not_implemented",
        "workbook_path": str(path),
        "carriers_written": 0,
        "hint": "Table gem_lng_carriers is ready; wire pandas sheet ingest when workbook is on VM.",
    }


def try_auto_ingest_gem_ggit_lng_carriers(conn: Any) -> dict[str, Any]:
    enabled = (os.getenv("GEM_GGIT_LNG_CARRIERS_AUTO_INGEST") or "").strip().lower() not in {
        "0",
        "false",
        "no",
        "off",
    }
    if not enabled:
        return {"status": "skipped", "reason": "auto_ingest_disabled"}
    return ingest_gem_ggit_lng_carriers(conn)
