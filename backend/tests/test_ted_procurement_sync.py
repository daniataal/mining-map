"""Tests for TED EU procurement sync."""

from __future__ import annotations

import os
import unittest
from unittest.mock import MagicMock, patch

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-unit-tests-32b!")

from backend.services.ingest import ted_procurement_sync as ted


SAMPLE_NOTICE = {
    "ND": "12345-2024",
    "TI": {"eng": "Sweden-Test: Mining services"},
    "CY": ["SWE"],
    "buyer-name": {"eng": ["SGU"]},
    "classification-cpv": ["09100000"],
    "publication-date": "2024-06-01+02:00",
    "links": {"html": {"ENG": "https://ted.europa.eu/en/notice/12345-2024"}},
}


class TedProcurementSyncTests(unittest.TestCase):
    def test_normalize_ted_notice(self):
        row = ted.normalize_ted_notice(SAMPLE_NOTICE)
        self.assertEqual(row["notice_id"], "12345-2024")
        self.assertEqual(row["country"], "Sweden")
        self.assertIn("Mining", row["title"])
        self.assertEqual(row["cpv"], "09100000")

    @patch("backend.services.ingest.ted_procurement_sync.fetch_ted_page")
    def test_sync_upserts_mocked(self, mock_fetch):
        mock_fetch.return_value = {
            "notices": [SAMPLE_NOTICE],
            "iterationNextToken": None,
        }
        conn = MagicMock()
        with patch("backend.services.ingest.ted_procurement_sync.upsert_notice", return_value=True) as mock_up:
            with patch("backend.services.ingest.ted_procurement_sync.start_sync_run", return_value=1):
                with patch("backend.services.ingest.ted_procurement_sync.finish_sync_run"):
                    result = ted.sync_ted_procurement(conn, max_notices=10, max_pages=1)
        self.assertEqual(result["status"], "success")
        self.assertEqual(result["notices_upserted"], 1)
        mock_up.assert_called()


if __name__ == "__main__":
    unittest.main()
