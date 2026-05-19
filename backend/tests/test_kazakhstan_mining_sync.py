"""Tests for Kazakhstan egov mining register adapter."""

from __future__ import annotations

import json
import os
import unittest
from unittest.mock import MagicMock, patch

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-unit-tests-32b!")
os.environ["KZ_EGOV_API_KEY"] = "test-kz-key"

from backend.services.ingest import kazakhstan_mining_sync as kz


class KazakhstanMiningSyncTests(unittest.TestCase):
    def test_normalize_egov_row_maps_fields(self):
        raw = {
            "nomer_licenzii": "KZ-001",
            "naimenovanie": "Test Minerals LLP",
            "shirota": "48.0",
            "dolgota": "66.9",
            "oblast": "Karaganda",
            "poleznoe_iskopaemoe": "Copper",
            "status_licenzii": "Active",
        }
        row = kz.normalize_egov_row(raw, fallback_index=0)
        self.assertEqual(row["id"], "KZ-001")
        self.assertEqual(row["company"], "Test Minerals LLP")
        self.assertEqual(row["lat"], "48.0")
        self.assertEqual(row["lng"], "66.9")
        self.assertEqual(row["country"], "Kazakhstan")

    @patch("urllib.request.urlopen")
    def test_fetch_register_page_parses_list(self, mock_urlopen):
        payload = [{"license_number": "A1", "company": "Foo"}]
        mock_resp = MagicMock()
        mock_resp.read.return_value = json.dumps(payload).encode("utf-8")
        mock_resp.__enter__.return_value = mock_resp
        mock_urlopen.return_value = mock_resp

        rows = kz.fetch_register_page(size=10, from_offset=0)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["license_number"], "A1")

    @patch("backend.services.ingest.kazakhstan_mining_sync.fetch_register_page")
    @patch("backend.services.ingest.csv_fallback_import.import_csv_text")
    def test_sync_writes_via_csv_import(self, mock_import, mock_fetch):
        mock_fetch.return_value = [
            {
                "license_number": "KZ-99",
                "company": "Kazakh Co",
                "latitude": 51.1,
                "longitude": 71.4,
            }
        ]
        mock_import.return_value = {"written": 1, "records_written": 1}
        conn = MagicMock()
        result = kz.sync_kazakhstan_mining_register(conn, max_rows=10)
        self.assertEqual(result["status"], "success")
        mock_import.assert_called_once()


if __name__ == "__main__":
    unittest.main()
