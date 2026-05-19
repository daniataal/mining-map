"""Tests for Sweden SGU OGC mineral permits adapter."""

from __future__ import annotations

import json
import os
import unittest
from unittest.mock import MagicMock, patch

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-unit-tests-32b!")

from backend.services.ingest import sweden_sgu_mining_sync as se


SAMPLE_FEATURE = {
    "type": "Feature",
    "id": "bearbetningskoncessioner-beviljade.1",
    "geometry": {
        "type": "Polygon",
        "coordinates": [[[18.0, 65.0], [18.1, 65.0], [18.1, 65.1], [18.0, 65.1], [18.0, 65.0]]],
    },
    "properties": {
        "permitid": "99",
        "name": "Test Mine",
        "owners": "Test AB",
        "mineral": "gold",
        "permittype": "Bearbetningskoncession",
        "status": "Beviljad",
        "county": "Norrbotten",
        "municipal": "Test kommun",
        "appl_date": "2020-01-15Z",
    },
}


class SwedenSguMiningSyncTests(unittest.TestCase):
    def test_normalize_sgu_feature(self):
        rec = se.normalize_sgu_feature(SAMPLE_FEATURE, collection_id="bearbetningskoncessioner-beviljade")
        self.assertIsNotNone(rec)
        assert rec is not None
        self.assertEqual(rec["country"], "Sweden")
        self.assertEqual(rec["record_origin"], "open_data")
        self.assertTrue(rec["source_id"].startswith("sweden_sgu_"))
        self.assertIsNotNone(rec["lat"])
        self.assertIsNotNone(rec["lng"])

    @patch("backend.services.ingest.sweden_sgu_mining_sync.fetch_collection_page")
    @patch("backend.services.ingest.open_data_sync.upsert_open_data_records")
    def test_sync_upserts_records(self, mock_upsert, mock_page):
        mock_page.return_value = {"features": [SAMPLE_FEATURE], "numberReturned": 1}
        mock_upsert.return_value = 1
        conn = MagicMock()
        result = se.sync_sweden_sgu_mining(
            conn,
            collections=["bearbetningskoncessioner-beviljade"],
            max_per_collection=10,
        )
        self.assertEqual(result["status"], "success")
        self.assertGreaterEqual(result["records_written"], 1)
        mock_upsert.assert_called_once()


if __name__ == "__main__":
    unittest.main()
