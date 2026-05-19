"""Phase 6 API tests: sync alert read, coverage country filter, EU entity procurement."""

from __future__ import annotations

import os
import unittest
from unittest.mock import MagicMock, patch

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-unit-tests-32b!")
os.environ["ADMIN_TOKEN"] = "test-admin-token"

from backend.main import app, create_access_token  # noqa: E402
from fastapi.testclient import TestClient


class Phase6ApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.admin_token = create_access_token(
            data={"sub": "admin", "role": "admin", "id": "admin-1"}
        )

    @patch("backend.main.get_db_connection")
    @patch("backend.main.ensure_schema_initialized")
    def test_mark_sync_alert_read(self, _schema, mock_conn):
        conn = MagicMock()
        mock_conn.return_value = conn
        with patch("backend.services.sync_alert_store.mark_alert_read", return_value=True):
            res = self.client.patch(
                "/api/open-data/sync-alerts/5/read",
                headers={"X-Admin-Token": "test-admin-token"},
            )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["status"], "success")

    @patch("backend.main.get_db_connection")
    @patch("backend.main.ensure_schema_initialized")
    def test_mark_all_sync_alerts_read(self, _schema, mock_conn):
        conn = MagicMock()
        mock_conn.return_value = conn
        with patch("backend.services.sync_alert_store.mark_all_alerts_read", return_value=3):
            res = self.client.post(
                "/api/open-data/sync-alerts/mark-all-read",
                headers={"Authorization": f"Bearer {self.admin_token}"},
            )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["marked_count"], 3)

    @patch("backend.services.ingest.open_data_sync.get_world_coverage")
    @patch("backend.main.ensure_schema_initialized")
    def test_coverage_world_country_filter(self, _schema, mock_coverage):
        mock_coverage.return_value = {
            "countries": [{"country": "Ghana", "macro_region": "africa", "sectors": {}}],
            "country_filter": "Ghana",
        }
        res = self.client.get("/api/open-data/coverage/world?country=Ghana")
        self.assertEqual(res.status_code, 200)
        mock_coverage.assert_called_once()
        self.assertEqual(mock_coverage.call_args.kwargs.get("country"), "Ghana")

    @patch("backend.main.get_db_connection")
    @patch("backend.main.ensure_schema_initialized")
    def test_entity_eu_procurement(self, _schema, mock_conn):
        conn = MagicMock()
        mock_conn.return_value = conn
        cursor = MagicMock()
        conn.cursor.return_value.__enter__.return_value = cursor
        cursor.fetchone.return_value = {"company": "Boliden AB", "country": "Sweden"}

        with patch(
            "backend.services.eu_procurement_intel.collect_eu_procurement_for_company",
            return_value={
                "source": "TED",
                "source_url": "https://ted.europa.eu/",
                "scope": "EU",
                "query_company": "Boliden AB",
                "country_filter": "Sweden",
                "limitations": [],
                "warnings": [],
                "notices": [{"notice_id": "1-2024", "title": "Mining services"}],
                "summary": {"notice_count": 1, "countries": ["Sweden"]},
            },
        ):
            res = self.client.get(
                "/entities/lic-1/eu-procurement",
                params={"entity_kind": "license"},
            )
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body["queryCompany"], "Boliden AB")
        self.assertEqual(len(body["notices"]), 1)

    def test_eu_cpv_buckets(self):
        res = self.client.get("/api/eu-procurement/cpv-buckets")
        self.assertEqual(res.status_code, 200)
        buckets = res.json().get("buckets") or []
        ids = {b["id"] for b in buckets}
        self.assertIn("mining", ids)
        self.assertIn("petroleum", ids)

    @patch("backend.main.get_db_connection")
    def test_admin_poland_mining_sync(self, mock_conn):
        conn = MagicMock()
        mock_conn.return_value = conn
        with patch(
            "backend.services.ingest.poland_pgi_mining_sync.sync_poland_pgi_mining",
            return_value={"status": "success", "records_written": 10},
        ):
            res = self.client.post(
                "/api/admin/poland-mining/sync",
                headers={"X-Admin-Token": "test-admin-token"},
            )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["records_written"], 10)


if __name__ == "__main__":
    unittest.main()
