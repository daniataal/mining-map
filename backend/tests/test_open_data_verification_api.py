"""API tests for open-data verification endpoints (sync runs, manual-edit, annotations)."""

from __future__ import annotations

import os
import unittest
from unittest.mock import MagicMock, patch

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-unit-tests-32b!")
os.environ["ADMIN_TOKEN"] = "test-admin-token"

from backend.main import app, create_access_token  # noqa: E402
from fastapi.testclient import TestClient


class OpenDataVerificationApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.user_token = create_access_token(
            data={"sub": "tester", "role": "user", "id": "user-1"}
        )
        self.admin_token = create_access_token(
            data={"sub": "admin", "role": "admin", "id": "admin-1"}
        )

    def test_sync_runs_requires_auth(self):
        res = self.client.get("/api/open-data/sync-runs")
        self.assertEqual(res.status_code, 401)

    @patch("backend.main.get_db_connection")
    @patch("backend.main.ensure_schema_initialized")
    def test_sync_runs_with_bearer(self, _schema, mock_conn):
        conn = MagicMock()
        mock_conn.return_value = conn
        with patch(
            "backend.services.license_sync_store.list_license_sync_runs",
            return_value=[{"id": 1, "source_id": "kenya_mining_cadastre", "status": "success"}],
        ):
            res = self.client.get(
                "/api/open-data/sync-runs",
                headers={"Authorization": f"Bearer {self.user_token}"},
            )
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body["status"], "success")
        self.assertEqual(body["count"], 1)

    @patch("backend.main.get_db_connection")
    def test_manual_edit_marks_license(self, mock_conn):
        conn = MagicMock()
        cursor = MagicMock()
        mock_conn.return_value = conn
        conn.cursor.return_value = cursor
        cursor.fetchone.return_value = {"id": "lic-1"}

        res = self.client.patch(
            "/api/licenses/lic-1/manual-edit",
            headers={"Authorization": f"Bearer {self.user_token}"},
            json={"manually_edited": True, "manually_edited_fields": ["company", "lat"]},
        )
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.json()["manually_edited"])
        conn.commit.assert_called_once()

    def test_annotations_put_requires_auth(self):
        res = self.client.put(
            "/api/licenses/lic-1/annotations",
            json={"annotation": {"stage": "Qualified"}},
        )
        self.assertEqual(res.status_code, 401)

    @patch("backend.main.get_db_connection")
    def test_list_annotations_bulk(self, mock_conn):
        conn = MagicMock()
        cursor = MagicMock()
        mock_conn.return_value = conn
        conn.cursor.return_value = cursor
        cursor.fetchall.return_value = [
            {"license_id": "lic-1", "payload": {"stage": "New"}, "updated_at": None},
        ]

        res = self.client.get(
            "/api/licenses/annotations",
            headers={"Authorization": f"Bearer {self.user_token}"},
        )
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body["count"], 1)
        self.assertIn("lic-1", body["annotations"])

    @patch("backend.main.get_db_connection")
    def test_annotations_put_success(self, mock_conn):
        conn = MagicMock()
        cursor = MagicMock()
        mock_conn.return_value = conn
        conn.cursor.return_value = cursor
        cursor.fetchone.return_value = {"id": "lic-1"}

        res = self.client.put(
            "/api/licenses/lic-1/annotations",
            headers={"Authorization": f"Bearer {self.user_token}"},
            json={"annotation": {"stage": "Qualified", "notes": "Site visit done"}},
        )
        self.assertEqual(res.status_code, 200)
        conn.commit.assert_called_once()

    def test_export_requires_auth(self):
        with patch("backend.main.get_db_connection") as mock_conn:
            mock_conn.return_value = MagicMock()
            res = self.client.get("/licenses/export")
        self.assertEqual(res.status_code, 401)

    @patch("backend.main.get_db_connection")
    def test_export_with_auth(self, mock_conn):
        conn = MagicMock()
        cursor = MagicMock()
        mock_conn.return_value = conn
        conn.cursor.return_value = cursor
        cursor.fetchall.return_value = []

        res = self.client.get(
            "/licenses/export",
            headers={"Authorization": f"Bearer {self.user_token}"},
        )
        self.assertEqual(res.status_code, 200)
        self.assertIn("text/csv", res.headers.get("content-type", ""))

    @patch("backend.main.get_db_connection")
    def test_export_with_provenance_flag(self, mock_conn):
        conn = MagicMock()
        cursor = MagicMock()
        mock_conn.return_value = conn
        conn.cursor.return_value = cursor
        cursor.fetchall.return_value = [
            {
                "id": "lic-1",
                "company": "Co",
                "country": "Kenya",
                "region": "",
                "commodity": "Gold",
                "license_type": "License",
                "status": "Active",
                "lat": 1.0,
                "lng": 2.0,
                "phone_number": "",
                "contact_person": "",
                "public_business_phone": None,
                "public_business_phone_source": None,
                "public_business_phone_source_type": None,
                "date_issued": None,
                "sector": "mining",
                "record_origin": "open_data",
                "source_id": "kenya",
                "source_name": "Kenya",
                "source_url": None,
                "source_record_url": None,
                "source_updated_at": None,
                "last_synced_at": None,
                "manually_edited": False,
            }
        ]

        res = self.client.get(
            "/licenses/export?include_provenance=true",
            headers={"Authorization": f"Bearer {self.user_token}"},
        )
        self.assertEqual(res.status_code, 200)
        body = res.text
        self.assertIn("record_origin", body)
        self.assertIn("source_id", body)

    def test_import_validation_summary(self):
        csv_text = "company,country\n,,\n"
        res = self.client.post(
            "/licenses/import-text",
            json={"csv": csv_text},
        )
        self.assertEqual(res.status_code, 422)
        detail = res.json().get("detail") or {}
        self.assertIn("message", detail)
        self.assertGreaterEqual(detail.get("error_count", 0), 1)


if __name__ == "__main__":
    unittest.main()
