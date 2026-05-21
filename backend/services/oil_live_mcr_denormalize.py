"""
Post-build denormalisation of party enrichment onto MCR rows.

After the synthetic BOL engine has rebuilt ``meridian_cargo_records`` (and
graph-sync has run the OpenSanctions + GLEIF + Wikidata batches), copy
``oil_companies.lei`` and ``oil_companies.sanctions_status`` onto the
shipper / consignee sides of each MCR. This lets the popup, drawer, and
DealExecutionPack render LEI / sanctions chips without an extra JOIN
every time.

Worker B's migration 013 adds these columns to ``meridian_cargo_records``:

* ``shipper_lei TEXT``, ``consignee_lei TEXT``
* ``shipper_sanctions_status TEXT``, ``consignee_sanctions_status TEXT``

Until the migration is applied, this writer fails soft and returns
``status='skipped'``.

Idempotent — safe to re-run on every graph-sync.
"""

from __future__ import annotations

import logging
from typing import Any

LOG = logging.getLogger("meridian.mcr_denormalize")


def _is_undefined_column(exc: Exception) -> bool:
    name = type(exc).__name__
    if name == "UndefinedColumn":
        return True
    pgcode = getattr(exc, "pgcode", "") or ""
    return pgcode == "42703"


def _required_columns_present(cur: Any) -> bool:
    """
    Check the four denorm columns on meridian_cargo_records and at least
    ``lei`` + ``sanctions_status`` on oil_companies. We return True only
    when everything is wired so the UPDATE doesn't blow up.
    """
    try:
        cur.execute(
            """
            SELECT
              SUM(CASE WHEN table_name='meridian_cargo_records' AND column_name='shipper_lei' THEN 1 ELSE 0 END),
              SUM(CASE WHEN table_name='meridian_cargo_records' AND column_name='consignee_lei' THEN 1 ELSE 0 END),
              SUM(CASE WHEN table_name='meridian_cargo_records' AND column_name='shipper_sanctions_status' THEN 1 ELSE 0 END),
              SUM(CASE WHEN table_name='meridian_cargo_records' AND column_name='consignee_sanctions_status' THEN 1 ELSE 0 END),
              SUM(CASE WHEN table_name='oil_companies' AND column_name='lei' THEN 1 ELSE 0 END),
              SUM(CASE WHEN table_name='oil_companies' AND column_name='sanctions_status' THEN 1 ELSE 0 END)
            FROM information_schema.columns
            WHERE table_schema = 'public'
            """
        )
        row = cur.fetchone() or ()
        return all(int(x or 0) >= 1 for x in row)
    except Exception:
        return False


def denormalize_mcr_party_enrichment(conn: Any) -> dict[str, Any]:
    """
    Copy ``oil_companies.lei`` / ``oil_companies.sanctions_status`` onto
    the matching shipper / consignee columns on ``meridian_cargo_records``.

    Returns counters; never raises. Safe to call before migration 013 has
    been applied — returns ``status='skipped'`` in that case.
    """
    if conn is None:
        return {"status": "skipped", "reason": "no db connection"}

    summary: dict[str, Any] = {
        "status": "ok",
        "shipper_updated": 0,
        "consignee_updated": 0,
        "errors": [],
        "skipped_missing_columns": False,
    }

    try:
        with conn.cursor() as cur:
            if not _required_columns_present(cur):
                summary["status"] = "skipped"
                summary["skipped_missing_columns"] = True
                summary["reason"] = (
                    "denorm columns missing on meridian_cargo_records / oil_companies "
                    "— apply migration 013"
                )
                LOG.warning(
                    "denormalize_mcr_party_enrichment skipped: migration 013 not applied"
                )
                return summary

            try:
                cur.execute(
                    """
                    UPDATE meridian_cargo_records mcr
                    SET shipper_lei = c.lei,
                        shipper_sanctions_status = c.sanctions_status,
                        updated_at = now()
                    FROM oil_companies c
                    WHERE mcr.shipper_company_id = c.id
                      AND (
                        mcr.shipper_lei IS DISTINCT FROM c.lei
                        OR mcr.shipper_sanctions_status IS DISTINCT FROM c.sanctions_status
                      )
                    """
                )
                summary["shipper_updated"] = int(cur.rowcount or 0)
            except Exception as exc:
                if _is_undefined_column(exc):
                    try:
                        conn.rollback()
                    except Exception:
                        pass
                    summary["status"] = "skipped"
                    summary["skipped_missing_columns"] = True
                    summary["reason"] = "denorm columns missing"
                    return summary
                raise

            try:
                cur.execute(
                    """
                    UPDATE meridian_cargo_records mcr
                    SET consignee_lei = c.lei,
                        consignee_sanctions_status = c.sanctions_status,
                        updated_at = now()
                    FROM oil_companies c
                    WHERE mcr.consignee_company_id = c.id
                      AND (
                        mcr.consignee_lei IS DISTINCT FROM c.lei
                        OR mcr.consignee_sanctions_status IS DISTINCT FROM c.sanctions_status
                      )
                    """
                )
                summary["consignee_updated"] = int(cur.rowcount or 0)
            except Exception as exc:
                if _is_undefined_column(exc):
                    try:
                        conn.rollback()
                    except Exception:
                        pass
                    summary["status"] = "skipped"
                    summary["skipped_missing_columns"] = True
                    summary["reason"] = "denorm columns missing"
                    return summary
                raise
        conn.commit()
    except Exception as exc:
        try:
            conn.rollback()
        except Exception:
            pass
        LOG.exception("denormalize_mcr_party_enrichment failed: %s", exc)
        summary["status"] = "error"
        summary["errors"].append(str(exc))
        return summary

    return summary


__all__ = ["denormalize_mcr_party_enrichment"]
