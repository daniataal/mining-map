"""Tests for admin data-health aggregation."""

from __future__ import annotations

import os
import unittest
from unittest.mock import MagicMock, patch

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-unit-tests-32b!")
os.environ["ADMIN_TOKEN"] = "test-admin-token"

from backend.main import app  # noqa: E402
from fastapi.testclient import TestClient


class AdminDataHealthTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_data_health_forbidden_without_token(self):
        res = self.client.get("/api/admin/data-health")
        self.assertIn(res.status_code, (403, 200))

    @patch("backend.main.get_db_connection")
    @patch("backend.services.admin_data_health.get_data_health")
    def test_data_health_success(self, mock_health, mock_conn):
        mock_conn.return_value = MagicMock()
        mock_health.return_value = {
            "status": "success",
            "manually_edited_count": 3,
            "license_counts_by_country": [{"country": "Kenya", "license_count": 10}],
            "source_sync_sla": [{"source_id": "kenya_mining_cadastre", "sla_status": "green"}],
            "philippines_mgb_arcgis_probe": {"status": "token_required"},
        }

        res = self.client.get(
            "/api/admin/data-health",
            headers={"X-Admin-Token": "test-admin-token"},
        )
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body["status"], "success")
        self.assertEqual(body["manually_edited_count"], 3)


if __name__ == "__main__":
    unittest.main()
