"""Mocked tests for GLEIF batch enrichment (no network)."""

from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

try:
    from backend.services import gleif_batch as gb_mod
except ImportError:  # pragma: no cover
    from services import gleif_batch as gb_mod  # type: ignore


class GleifBatchTests(unittest.TestCase):
    def _mock_conn(self, *, has_columns=True, rows=None):
        conn = MagicMock()
        cur = MagicMock()
        cur.__enter__.return_value = cur
        cur.__exit__.return_value = False
        conn.cursor.return_value = cur
        cur.fetchone.return_value = (1,) if has_columns else None
        cur.fetchall.return_value = rows or []
        return conn, cur

    def test_skip_when_missing_columns(self):
        conn, _ = self._mock_conn(has_columns=False)
        out = gb_mod.enrich_companies_with_lei(conn, limit=10, sleep_seconds=0)
        self.assertEqual(out["status"], "skipped")
        self.assertTrue(out["skipped_missing_columns"])

    def test_writes_lei_on_success(self):
        rows = [("id-1", "Acme Mining Corp"), ("id-2", "ZZZ Unknown LLC")]
        conn, cur = self._mock_conn(has_columns=True, rows=rows)

        def _lookup(name):
            if name == "Acme Mining Corp":
                return {
                    "status": "success",
                    "matches": [
                        {"lei": "549300LEIVAL0001", "legal_name": "ACME MINING CORP"}
                    ],
                }
            return {"status": "success", "matches": []}

        with patch.object(gb_mod, "lookup_lei", side_effect=_lookup):
            out = gb_mod.enrich_companies_with_lei(conn, limit=10, sleep_seconds=0)

        self.assertEqual(out["status"], "ok")
        self.assertEqual(out["candidates"], 2)
        self.assertEqual(out["lei_written"], 1)
        self.assertEqual(out["no_match"], 1)


if __name__ == "__main__":
    unittest.main()
