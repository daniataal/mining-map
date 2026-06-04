"""Tests for DB-first company-intel read path."""

from __future__ import annotations

import os
import unittest
from unittest.mock import MagicMock, patch

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-unit-tests-32b!")

from backend.services import company_intel_store as store  # noqa: E402


class CompanyIntelStoreTests(unittest.TestCase):
    @patch("backend.services.company_intel_store.query_stored_trade_flows")
    @patch("backend.services.company_intel_store._read_sync_state")
    def test_fetch_from_postgres_shapes_trade_flows(self, mock_sync, mock_query):
        mock_sync.return_value = {"last_sync": "2026-01-01T00:00:00+00:00", "stale": False}
        mock_query.return_value = [
            {
                "flow_type": "X",
                "trade_value_usd": 1000,
                "net_weight_kg": 500,
                "partner": "World",
                "year": 2023,
                "data_source": "eurostat",
                "bol_tier": "macro",
            }
        ]
        conn = MagicMock()

        out = store.fetch_company_intel_from_postgres(
            conn,
            country="Saudi Arabia",
            commodity="crude oil",
            hs_code="2709",
            codes={"iso2": "SA", "m49": "682"},
        )

        self.assertEqual(out["read_path"], "postgres")
        trade = out["trade_data"]
        self.assertEqual(trade["source_key"], "postgres")
        self.assertEqual(len(trade["flows"]), 1)
        self.assertEqual(trade["flows"][0]["flow"], "Export")
        self.assertFalse(trade.get("coverage_gap"))

    @patch("backend.services.company_intel_store.query_stored_trade_flows", return_value=[])
    @patch("backend.services.company_intel_store._query_eia_historic_imports", return_value=[])
    @patch("backend.services.company_intel_store._read_sync_state")
    def test_empty_postgres_marks_coverage_gap(self, mock_sync, _eia, _query):
        mock_sync.return_value = {"last_sync": None, "stale": True}
        conn = MagicMock()

        out = store.fetch_company_intel_from_postgres(
            conn,
            country="Norway",
            commodity="crude oil",
            hs_code="2709",
        )

        trade = out["trade_data"]
        self.assertTrue(trade.get("coverage_gap"))
        self.assertIn("graph-sync", trade.get("hint", ""))


class CompanyIntelApiTests(unittest.TestCase):
    def setUp(self):
        os.environ["ADMIN_TOKEN"] = "test-admin-token"
        from backend.main import app  # noqa: E402

        self.client = __import__("fastapi.testclient", fromlist=["TestClient"]).TestClient(app)

    @patch("backend.main.get_db_connection")
    @patch("backend.services.company_intel_store.fetch_company_intel_from_postgres")
    def test_company_intel_defaults_to_postgres(self, mock_fetch, mock_conn):
        mock_conn.return_value = MagicMock()
        mock_fetch.return_value = {
            "read_path": "postgres",
            "sync_state": {"last_sync": "2026-02-01T00:00:00+00:00", "stale": False},
            "trade_data": {
                "source_key": "postgres",
                "flows": [{"flow": "Export", "trade_value_usd": 1, "year": 2023}],
            },
        }

        res = self.client.get("/api/company-intel?country=Saudi%20Arabia&commodity=crude%20oil")
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body.get("read_path"), "postgres")
        self.assertEqual(body.get("trade_flows", {}).get("source_key"), "postgres")


if __name__ == "__main__":
    unittest.main()
