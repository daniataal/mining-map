"""
EIA historic U.S. petroleum imports — file ingest (PSM company-level).

Reads user-provided ``impaYYd.xls`` / ``impaYYd.xlsx`` files from ``EIA_DOWNLOADS_DIR``
(Petroleum Supply Monthly — Imports sheet). Does not call the EIA web API.

QUANTITY in source files is **thousand barrels**; stored normalized as barrels (× 1000).
"""

from __future__ import annotations

import json
import os
import re
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

try:
    import pandas as pd
except ImportError:  # pragma: no cover
    pd = None  # type: ignore

# Canonical column names (uppercase keys after normalization)
_COL_ALIASES: dict[str, str] = {
    "RPT_PERIOD": "rpt_period",
    "R_S_NAME": "r_s_name",
    "LINE_NUM": "line_num",
    "PROD_CODE": "prod_code",
    "PROD_NAME": "prod_name",
    "PORT_CODE": "port_code",
    "PORT_CITY": "port_city",
    "PORT_STATE": "port_state",
    "PORT_PADD": "port_padd",
    "GCTRY_CODE": "gctry_code",
    "CNTRY_NAME": "cntry_name",
    "QUANTITY": "quantity",
    "SULFUR": "sulfur",
    "APIGRAVITY": "apigravity",
    "PCOMP_RNAM": "pcomp_rnam",
    "PCOMP_SNAM": "pcomp_snam",
    "PCOMP_STAT": "pcomp_stat",
    "STATE_NAME": "state_name",
    "PCOMP_PADD": "pcomp_padd",
    "PCOMP_SITEID": "pcomp_siteid",
}

_HEADER_MARKERS = frozenset({"RPT_PERIOD", "R_S_NAME", "CNTRY_NAME", "QUANTITY"})

_DEFAULT_DOWNLOADS = os.path.expanduser("~/Downloads/EIA_downloads")


def default_downloads_dir() -> str:
    return (os.getenv("EIA_DOWNLOADS_DIR") or _DEFAULT_DOWNLOADS).strip()


def eia_historic_auto_ingest_enabled() -> bool:
    return (os.getenv("EIA_HISTORIC_AUTO_INGEST") or "true").strip().lower() not in {
        "0",
        "false",
        "no",
        "off",
    }


def try_auto_ingest_eia_downloads(
    conn: Any,
    *,
    folder_path: Optional[str] = None,
) -> dict[str, Any]:
    """
    Ingest impa*.xls(x) when auto-ingest is on and files are present.
    Idempotent — safe on every graph-sync / worker tick / backend startup.
    """
    if not eia_historic_auto_ingest_enabled():
        return {"status": "skipped", "reason": "EIA_HISTORIC_AUTO_INGEST is off"}
    folder = Path(folder_path or default_downloads_dir()).expanduser()
    if not folder.is_dir():
        return {"status": "skipped", "reason": f"EIA_DOWNLOADS_DIR missing: {folder}"}
    paths = _iter_import_files(folder)
    if not paths:
        return {"status": "skipped", "reason": "no impa*.xls/xlsx in EIA_DOWNLOADS_DIR"}
    return ingest_eia_downloads_folder(conn, str(folder))


def ensure_eia_historic_imports_table(conn: Any) -> None:
    ddl = """
    CREATE TABLE IF NOT EXISTS eia_historic_imports (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        data_source TEXT NOT NULL DEFAULT 'eia_file_upload',
        source_file TEXT NOT NULL,
        source_sheet TEXT,
        period_year INT,
        period_month INT,
        line_num INT,
        importer_name TEXT,
        importer_country TEXT DEFAULT 'United States',
        origin_country TEXT,
        origin_name TEXT,
        product TEXT,
        commodity_family TEXT,
        volume NUMERIC,
        volume_unit TEXT DEFAULT 'bbl',
        value_usd NUMERIC,
        port_code TEXT,
        port_city TEXT,
        port_state TEXT,
        raw JSONB,
        ingested_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_eia_historic_imports_grain
        ON eia_historic_imports (
            data_source, source_file, COALESCE(source_sheet, ''),
            period_year, COALESCE(period_month, 0),
            COALESCE(importer_name, ''), COALESCE(origin_country, ''),
            COALESCE(product, ''), COALESCE(port_code, ''), COALESCE(line_num, 0)
        );
    CREATE INDEX IF NOT EXISTS idx_eia_historic_imports_importer_year
        ON eia_historic_imports (importer_name, period_year);
    CREATE INDEX IF NOT EXISTS idx_eia_historic_imports_origin_year
        ON eia_historic_imports (origin_country, period_year);
    CREATE INDEX IF NOT EXISTS idx_eia_historic_imports_period
        ON eia_historic_imports (period_year, period_month);
    """
    with conn.cursor() as cur:
        cur.execute(ddl)


def map_product_to_commodity_family(product: Optional[str], prod_code: Optional[str] = None) -> str:
    name = (product or "").upper()
    code = str(prod_code or "").strip()
    if "CRUDE" in name or code.startswith("05"):
        return "crude"
    if any(x in name for x in ("DISTILLATE", "DIESEL", "GASOIL")):
        return "diesel"
    if any(x in name for x in ("MOTOR GAS", "GASOLINE", "REFORMULATED")):
        return "gasoline"
    if any(x in name for x in ("PROPANE", "NGL", "LPG", "BUTANE")):
        return "lpg"
    if "RESIDUAL" in name or "FUEL OIL" in name:
        return "fuel_oil"
    if "JET" in name or "KEROSENE" in name:
        return "jet"
    if "LUBRICANT" in name:
        return "other"
    if "ASPHALT" in name:
        return "other"
    return "other"


def _normalize_header_cell(val: Any) -> Optional[str]:
    if val is None or (isinstance(val, float) and pd is not None and pd.isna(val)):
        return None
    s = str(val).strip().upper()
    return s if s else None


def _detect_header_row(preview: Any) -> int:
    """Return 0-based row index of the header row."""
    for i in range(min(len(preview), 30)):
        cells = [_normalize_header_cell(c) for c in preview.iloc[i].tolist()]
        markers = {c for c in cells if c}
        if _HEADER_MARKERS.issubset(markers) or (
            "RPT_PERIOD" in markers and "CNTRY_NAME" in markers
        ):
            return i
    return 0


def _read_sheet(path: Path, sheet_name: str) -> Any:
    if pd is None:
        raise RuntimeError("pandas is required for EIA file ingest (pip install pandas openpyxl xlrd)")
    engine = "openpyxl" if path.suffix.lower() == ".xlsx" else "xlrd"
    preview = pd.read_excel(path, sheet_name=sheet_name, header=None, nrows=30, engine=engine)
    header_row = _detect_header_row(preview)
    df = pd.read_excel(path, sheet_name=sheet_name, header=header_row, engine=engine)
    df.columns = [_normalize_header_cell(c) or f"COL_{i}" for i, c in enumerate(df.columns)]
    return df


def _parse_period(val: Any) -> tuple[Optional[int], Optional[int]]:
    if val is None or (pd is not None and pd.isna(val)):
        return None, None
    if isinstance(val, datetime):
        return val.year, val.month
    s = str(val).strip()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d", "%m/%d/%Y"):
        try:
            dt = datetime.strptime(s[:19], fmt)
            return dt.year, dt.month
        except ValueError:
            continue
    m = re.match(r"(\d{4})-(\d{2})", s)
    if m:
        return int(m.group(1)), int(m.group(2))
    return None, None


def _safe_str(val: Any) -> Optional[str]:
    if val is None or (pd is not None and pd.isna(val)):
        return None
    s = str(val).strip()
    return s if s and s.lower() != "nan" else None


def _safe_int(val: Any) -> Optional[int]:
    if val is None or (pd is not None and pd.isna(val)):
        return None
    try:
        return int(float(val))
    except (TypeError, ValueError):
        return None


def _safe_float(val: Any) -> Optional[float]:
    if val is None or (pd is not None and pd.isna(val)):
        return None
    try:
        f = float(val)
        return f if f >= 0 else None
    except (TypeError, ValueError):
        return None


def _row_to_record(
    row: dict[str, Any],
    *,
    source_file: str,
    source_sheet: str,
    data_source: str = "eia_file_upload",
) -> Optional[dict[str, Any]]:
    importer = _safe_str(row.get("R_S_NAME"))
    origin = _safe_str(row.get("CNTRY_NAME"))
    product = _safe_str(row.get("PROD_NAME"))
    qty_kbbl = _safe_float(row.get("QUANTITY"))
    if not importer or not origin or qty_kbbl is None or qty_kbbl <= 0:
        return None

    year, month = _parse_period(row.get("RPT_PERIOD"))
    prod_code = row.get("PROD_CODE")
    port_code = _safe_str(row.get("PORT_CODE"))
    line_num = _safe_int(row.get("LINE_NUM"))

    volume_bbl = qty_kbbl * 1000.0
    raw = {k: row[k] for k in row if row.get(k) is not None and not (pd is not None and pd.isna(row.get(k)))}

    origin_name = _safe_str(row.get("PCOMP_RNAM")) or origin

    return {
        "data_source": data_source,
        "source_file": source_file,
        "source_sheet": source_sheet,
        "period_year": year,
        "period_month": month,
        "line_num": line_num,
        "importer_name": importer,
        "importer_country": "United States",
        "origin_country": origin,
        "origin_name": origin_name,
        "product": product,
        "commodity_family": map_product_to_commodity_family(product, prod_code),
        "volume": volume_bbl,
        "volume_unit": "bbl",
        "value_usd": None,
        "port_code": port_code,
        "port_city": _safe_str(row.get("PORT_CITY")),
        "port_state": _safe_str(row.get("PORT_STATE")),
        "raw": json.dumps(raw, default=str),
    }


def _iter_import_files(folder: Path) -> list[Path]:
    if not folder.is_dir():
        return []
    out: list[Path] = []
    for p in sorted(folder.iterdir()):
        if p.suffix.lower() not in (".xls", ".xlsx"):
            continue
        name = p.name.lower()
        if name.startswith("impa") or name == "import.xlsx":
            out.append(p)
    return out


def _ingest_file(conn: Any, path: Path, *, data_source: str = "eia_file_upload") -> dict[str, Any]:
    if pd is None:
        raise RuntimeError("pandas required")

    xl = pd.ExcelFile(path, engine="openpyxl" if path.suffix.lower() == ".xlsx" else "xlrd")
    file_stats: dict[str, Any] = {
        "file": path.name,
        "sheets": [],
        "rows_parsed": 0,
        "rows_upserted": 0,
        "errors": [],
    }

    upsert_sql = """
    INSERT INTO eia_historic_imports (
        data_source, source_file, source_sheet, period_year, period_month, line_num,
        importer_name, importer_country, origin_country, origin_name, product,
        commodity_family, volume, volume_unit, value_usd, port_code, port_city, port_state, raw
    ) VALUES (
        %(data_source)s, %(source_file)s, %(source_sheet)s, %(period_year)s, %(period_month)s,
        %(line_num)s, %(importer_name)s, %(importer_country)s, %(origin_country)s, %(origin_name)s,
        %(product)s, %(commodity_family)s, %(volume)s, %(volume_unit)s, %(value_usd)s,
        %(port_code)s, %(port_city)s, %(port_state)s, %(raw)s::jsonb
    )
    ON CONFLICT DO NOTHING
    """

    with conn.cursor() as cur:
        cur.execute(
            "DELETE FROM eia_historic_imports WHERE source_file = %s AND data_source = %s;",
            (path.name, data_source),
        )

    # Prefer Imports sheet naming variants
    sheet_order = []
    for preferred in ("IMPORTS", "Imports", "import"):
        if preferred in xl.sheet_names:
            sheet_order.append(preferred)
    for s in xl.sheet_names:
        if s not in sheet_order:
            sheet_order.append(s)

    for sheet in sheet_order:
        try:
            df = _read_sheet(path, sheet)
        except Exception as exc:
            file_stats["errors"].append(f"{sheet}: {exc}")
            continue

        records: list[dict[str, Any]] = []
        for _, series in df.iterrows():
            row = {str(k): series[k] for k in df.columns}
            rec = _row_to_record(
                row,
                source_file=path.name,
                source_sheet=sheet,
                data_source=data_source,
            )
            if rec:
                records.append(rec)

        upserted = 0
        with conn.cursor() as cur:
            for rec in records:
                cur.execute(upsert_sql, rec)
                upserted += cur.rowcount

        file_stats["sheets"].append(
            {"sheet": sheet, "rows_parsed": len(records), "rows_inserted": upserted}
        )
        file_stats["rows_parsed"] += len(records)
        file_stats["rows_upserted"] += upserted

    return file_stats


def ingest_eia_downloads_folder(
    conn: Any,
    folder_path: Optional[str] = None,
    *,
    data_source: str = "eia_file_upload",
) -> dict[str, Any]:
    """
    Walk ``folder_path`` (default ``EIA_DOWNLOADS_DIR``) and upsert all impa*.xls(x) files.
    Idempotent: duplicate grain rows are skipped (ON CONFLICT DO NOTHING).
    """
    folder = Path(folder_path or default_downloads_dir()).expanduser()
    ensure_eia_historic_imports_table(conn)

    summary: dict[str, Any] = {
        "status": "ok",
        "folder": str(folder),
        "files_found": 0,
        "files_processed": 0,
        "rows_parsed": 0,
        "rows_inserted": 0,
        "files": [],
        "errors": [],
    }

    if not folder.is_dir():
        summary["status"] = "error"
        summary["errors"].append(f"Folder not found: {folder}")
        return summary

    paths = _iter_import_files(folder)
    summary["files_found"] = len(paths)

    for path in paths:
        try:
            file_stats = _ingest_file(conn, path, data_source=data_source)
            summary["files"].append(file_stats)
            summary["files_processed"] += 1
            summary["rows_parsed"] += file_stats.get("rows_parsed", 0)
            summary["rows_inserted"] += file_stats.get("rows_upserted", 0)
        except Exception as exc:
            summary["errors"].append(f"{path.name}: {exc}")

    if summary["errors"] and summary["files_processed"] == 0:
        summary["status"] = "error"

    return summary


# ---------------------------------------------------------------------------
# Query helpers (API)
# ---------------------------------------------------------------------------

def query_summary(
    conn: Any,
    *,
    importer: Optional[str] = None,
    year_from: Optional[int] = None,
    year_to: Optional[int] = None,
    limit: int = 50,
) -> dict[str, Any]:
    ensure_eia_historic_imports_table(conn)
    clauses = ["1=1"]
    params: list[Any] = []

    if importer:
        clauses.append("importer_name ILIKE %s")
        params.append(f"%{importer.strip()}%")
    if year_from is not None:
        clauses.append("period_year >= %s")
        params.append(year_from)
    if year_to is not None:
        clauses.append("period_year <= %s")
        params.append(year_to)

    where = " AND ".join(clauses)

    with conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT COALESCE(MIN(period_year), 0) AS y_min,
                   COALESCE(MAX(period_year), 0) AS y_max,
                   COUNT(*)::bigint AS row_count,
                   COUNT(DISTINCT importer_name)::bigint AS importer_count
            FROM eia_historic_imports WHERE {where};
            """,
            params,
        )
        meta = cur.fetchone()

        cur.execute(
            f"""
            SELECT period_year AS year,
                   SUM(volume)::float AS volume_bbl,
                   COUNT(*)::bigint AS row_count
            FROM eia_historic_imports
            WHERE {where}
            GROUP BY period_year
            ORDER BY period_year;
            """,
            params,
        )
        by_year = [
            {"year": r[0], "volume_bbl": r[1], "row_count": r[2]}
            for r in cur.fetchall()
        ]

        cur.execute(
            f"""
            SELECT origin_country,
                   SUM(volume)::float AS volume_bbl,
                   COUNT(*)::bigint AS row_count
            FROM eia_historic_imports
            WHERE {where}
            GROUP BY origin_country
            ORDER BY volume_bbl DESC NULLS LAST
            LIMIT %s;
            """,
            [*params, limit],
        )
        top_origins = [
            {"origin_country": r[0], "volume_bbl": r[1], "row_count": r[2]}
            for r in cur.fetchall()
        ]

        cur.execute(
            f"""
            SELECT importer_name, SUM(volume)::float AS volume_bbl
            FROM eia_historic_imports
            WHERE {where}
            GROUP BY importer_name
            ORDER BY volume_bbl DESC NULLS LAST
            LIMIT 30;
            """,
            params,
        )
        top_importers = [
            {"importer_name": r[0], "volume_bbl": r[1]} for r in cur.fetchall()
        ]

    return {
        "year_min": meta[0] or None,
        "year_max": meta[1] or None,
        "row_count": meta[2],
        "importer_count": meta[3],
        "by_year": by_year,
        "top_origins": top_origins,
        "top_importers": top_importers,
        "data_source": "eia_file_upload",
        "provenance": "EIA Petroleum Supply Monthly — historic file import (not live AIS)",
    }


def query_series(
    conn: Any,
    *,
    importer: str,
    origin_country: Optional[str] = None,
    commodity_family: Optional[str] = None,
) -> dict[str, Any]:
    ensure_eia_historic_imports_table(conn)
    clauses = ["importer_name ILIKE %s"]
    params: list[Any] = [f"%{importer.strip()}%"]

    if origin_country:
        clauses.append("origin_country ILIKE %s")
        params.append(f"%{origin_country.strip()}%")
    if commodity_family:
        clauses.append("commodity_family = %s")
        params.append(commodity_family)

    where = " AND ".join(clauses)

    with conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT period_year, period_month,
                   SUM(volume)::float AS volume_bbl,
                   COUNT(*)::bigint AS row_count
            FROM eia_historic_imports
            WHERE {where}
            GROUP BY period_year, period_month
            ORDER BY period_year, period_month NULLS FIRST;
            """,
            params,
        )
        points = [
            {
                "year": r[0],
                "month": r[1],
                "volume_bbl": r[2],
                "row_count": r[3],
                "period": f"{r[0]}-{r[1]:02d}" if r[1] else str(r[0]),
            }
            for r in cur.fetchall()
        ]

    return {
        "importer": importer,
        "points": points,
        "provenance": "EIA file import — historic, not live AIS",
    }


def query_map_arcs(
    conn: Any,
    *,
    year: int,
    importer: Optional[str] = None,
    limit: int = 80,
) -> dict[str, Any]:
    ensure_eia_historic_imports_table(conn)
    clauses = ["period_year = %s"]
    params: list[Any] = [year]

    if importer:
        clauses.append("importer_name ILIKE %s")
        params.append(f"%{importer.strip()}%")

    where = " AND ".join(clauses)

    with conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT origin_country,
                   commodity_family,
                   SUM(volume)::float AS volume_bbl,
                   COUNT(*)::bigint AS row_count
            FROM eia_historic_imports
            WHERE {where}
            GROUP BY origin_country, commodity_family
            ORDER BY volume_bbl DESC NULLS LAST
            LIMIT %s;
            """,
            [*params, limit],
        )
        rows = cur.fetchall()

    arcs = [
        {
            "origin_country": r[0],
            "commodity_family": r[1] or "other",
            "volume_bbl": r[2],
            "row_count": r[3],
            "destination_country": "United States",
        }
        for r in rows
    ]

    return {
        "year": year,
        "importer": importer,
        "arcs": arcs,
        "provenance": "EIA file import — historic corridor (country centroids)",
    }
