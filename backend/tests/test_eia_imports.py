"""Mocked tests for EIA crude imports + refinery throughput (no network)."""

from __future__ import annotations

import os
import unittest
from unittest.mock import MagicMock, patch

try:
    from backend.services import eia_imports as eia_mod
except ImportError:  # pragma: no cover
    from services import eia_imports as eia_mod  # type: ignore


class _FakeResponse:
    def __init__(self, payload, status_code=200):
        self.status_code = status_code
        self._payload = payload
        self.text = ""

    def json(self):
        return self._payload


class CrudeImportsTests(unittest.TestCase):
    def setUp(self):
        self._prev = os.environ.pop("EIA_API_KEY", None)

    def tearDown(self):
        if self._prev is not None:
            os.environ["EIA_API_KEY"] = self._prev
        else:
            os.environ.pop("EIA_API_KEY", None)

    def test_skip_without_key(self):
        out = eia_mod.sync_eia_crude_imports(MagicMock())
        self.assertEqual(out["status"], "skipped")
        self.assertIn("EIA_API_KEY", out.get("reason", ""))

    def test_aggregates_and_upserts(self):
        os.environ["EIA_API_KEY"] = "test-key"
        sample_response = {
            "response": {
                "data": [
                    {
                        "period": "2026-04",
                        "originName": "Saudi Arabia",
                        "destinationName": "United States",
                        "quantity": 12000,
                    },
                    {
                        "period": "2026-03",
                        "originName": "Saudi Arabia",
                        "destinationName": "United States",
                        "quantity": 14000,
                    },
                    {
                        "period": "2026-04",
                        "originName": "Canada",
                        "destinationName": "United States",
                        "quantity": 100000,
                    },
                ]
            }
        }
        conn = MagicMock()

        with patch.object(eia_mod, "requests") as mock_requests, patch(
            "backend.ingest_oil_trades.ensure_table", return_value=None, create=True
        ) as _et, patch(
            "backend.ingest_oil_trades.upsert_rows", return_value=2, create=True
        ) as mock_upsert:
            mock_requests.get.return_value = _FakeResponse(sample_response)
            out = eia_mod.sync_eia_crude_imports(conn)

        self.assertEqual(out["status"], "ok")
        self.assertEqual(out["data_source"], "eia")
        self.assertEqual(out["origins"], 2)
        self.assertEqual(out["rows_upserted"], 2)
        # Verify the upsert payload structure.
        args, _ = mock_upsert.call_args
        rows = args[1]
        self.assertTrue(all(r["hs_code"] == "2709" for r in rows))
        self.assertTrue(all(r["flow_type"] == "M" for r in rows))
        self.assertTrue(all(r["reporter_iso2"] == "US" for r in rows))
        self.assertTrue(all(r["data_source"] == "eia" for r in rows))
        # Saudi Arabia origin should sum kbbl_sum 26000 (12k + 14k).
        sa = next(r for r in rows if r["partner"] == "Saudi Arabia")
        # bbl = 26_000 * 1000; weight_kg = bbl * 136
        self.assertEqual(sa["net_weight_kg"], int(round(26_000 * 1000 * 136.0)))


class RefineryThroughputTests(unittest.TestCase):
    def setUp(self):
        self._prev = os.environ.pop("EIA_API_KEY", None)

    def tearDown(self):
        if self._prev is not None:
            os.environ["EIA_API_KEY"] = self._prev
        else:
            os.environ.pop("EIA_API_KEY", None)

    def test_skip_without_key(self):
        out = eia_mod.sync_eia_refinery_throughput(MagicMock())
        self.assertEqual(out["status"], "skipped")

    def test_creates_table_and_upserts(self):
        os.environ["EIA_API_KEY"] = "test-key"
        sample_response = {
            "response": {
                "data": [
                    {
                        "period": "2026-05-10",
                        "duoarea": "R10",
                        "series": "WPULEUS3",  # util
                        "value": 91.2,
                    },
                    {
                        "period": "2026-05-10",
                        "duoarea": "R10",
                        "series": "WCRRIP3",  # crude input
                        "value": 16.5,
                    },
                ]
            }
        }
        conn = MagicMock()
        cur = MagicMock()
        cur.__enter__.return_value = cur
        cur.__exit__.return_value = False
        conn.cursor.return_value = cur

        with patch.object(eia_mod, "requests") as mock_requests:
            mock_requests.get.return_value = _FakeResponse(sample_response)
            out = eia_mod.sync_eia_refinery_throughput(conn)

        self.assertEqual(out["status"], "ok")
        self.assertGreaterEqual(out["rows_upserted"], 1)
        # The CREATE TABLE IF NOT EXISTS must be emitted.
        ddl_calls = [
            c
            for c in cur.execute.call_args_list
            if "CREATE TABLE IF NOT EXISTS oil_refinery_throughput" in str(c.args[0])
        ]
        self.assertEqual(len(ddl_calls), 1)


class PaddStorageTests(unittest.TestCase):
    def setUp(self):
        self._prev = os.environ.pop("EIA_API_KEY", None)

    def tearDown(self):
        if self._prev is not None:
            os.environ["EIA_API_KEY"] = self._prev
        else:
            os.environ.pop("EIA_API_KEY", None)

    def test_skip_without_key(self):
        out = eia_mod.sync_eia_padd_storage(MagicMock())
        self.assertEqual(out["status"], "skipped")

    def test_parse_latest_padd_rows(self):
        rows = [
            {"series": "WCRSTP21", "period": "2026-05-16", "value": 120.5},
            {"series": "WCRSTP21", "period": "2026-05-23", "value": 121.2},
            {"series": "WCRSTP31", "period": "2026-05-23", "value": 260.4},
        ]
        parsed = eia_mod._parse_latest_padd_storage_rows(rows)
        self.assertEqual(parsed["PADD2"]["stocks_million_bbl"], 121.2)
        self.assertEqual(parsed["PADD3"]["stocks_million_bbl"], 260.4)

    def test_sync_writes_cache_and_db(self):
        os.environ["EIA_API_KEY"] = "test-key"
        sample_response = {
            "response": {
                "data": [
                    {"series": "WCRSTP21", "period": "2026-05-23", "value": 118.7},
                    {"series": "WCRSTP31", "period": "2026-05-23", "value": 255.1},
                ]
            }
        }
        conn = MagicMock()
        cur = MagicMock()
        cur.__enter__.return_value = cur
        cur.__exit__.return_value = False
        conn.cursor.return_value = cur

        with patch.object(eia_mod, "requests") as mock_requests, patch.object(
            eia_mod, "EIA_PADD_STORAGE_CACHE_PATH",
            eia_mod.REPO_ROOT / "data" / "cache" / "eia_padd_storage_test.json",
        ) as cache_path:
            mock_requests.get.return_value = _FakeResponse(sample_response)
            out = eia_mod.sync_eia_padd_storage(conn)

        self.assertEqual(out["status"], "ok")
        self.assertEqual(out["padds"], 2)
        self.assertTrue(cache_path.is_file())
        cached = eia_mod.read_eia_padd_storage_cache(cache_path)
        self.assertIn("PADD2", cached)
        cache_path.unlink(missing_ok=True)


if __name__ == "__main__":
    unittest.main()
