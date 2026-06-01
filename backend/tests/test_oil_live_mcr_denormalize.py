"""Mocked tests for MCR party-enrichment denormalisation (no DB)."""

from __future__ import annotations

import unittest
from unittest.mock import MagicMock

try:
    from backend.services import oil_live_mcr_denormalize as mod
except ImportError:  # pragma: no cover
    from services import oil_live_mcr_denormalize as mod  # type: ignore


class DenormalizeTests(unittest.TestCase):
    def _mock_conn(self, *, columns_present: bool, shipper_rows=3, consignee_rows=2):
        conn = MagicMock()
        cur = MagicMock()
        cur.__enter__.return_value = cur
        cur.__exit__.return_value = False
        conn.cursor.return_value = cur

        # fetchone returns the column-count vector for _required_columns_present.
        if columns_present:
            cur.fetchone.return_value = (1, 1, 1, 1, 1, 1)
        else:
            cur.fetchone.return_value = (0, 0, 0, 0, 1, 1)

        def _execute(*_args, **_kwargs):
            sql = _args[0] if _args else ""
            if "UPDATE meridian_cargo_records mcr" in sql and "shipper_lei" in sql:
                cur.rowcount = shipper_rows
            elif "UPDATE meridian_cargo_records mcr" in sql and "consignee_lei" in sql:
                cur.rowcount = consignee_rows
            else:
                cur.rowcount = 0

        cur.execute.side_effect = _execute
        return conn, cur

    def test_skip_when_columns_missing(self):
        conn, _ = self._mock_conn(columns_present=False)
        out = mod.denormalize_mcr_party_enrichment(conn)
        self.assertEqual(out["status"], "skipped")
        self.assertTrue(out["skipped_missing_columns"])

    def test_updates_both_sides(self):
        conn, cur = self._mock_conn(columns_present=True, shipper_rows=4, consignee_rows=3)
        out = mod.denormalize_mcr_party_enrichment(conn)
        self.assertEqual(out["status"], "ok")
        self.assertEqual(out["shipper_updated"], 4)
        self.assertEqual(out["consignee_updated"], 3)
        # commit must be called once.
        self.assertEqual(conn.commit.call_count, 1)

    def test_no_db_connection(self):
        out = mod.denormalize_mcr_party_enrichment(None)
        self.assertEqual(out["status"], "skipped")


if __name__ == "__main__":
    unittest.main()
