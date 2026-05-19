"""Tests for Poland PGI MIDAS mining sync."""

from __future__ import annotations

import json
import os
import unittest
from unittest.mock import MagicMock, patch

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-unit-tests-32b!")

from backend.services.ingest import poland_pgi_mining_sync as poland


SAMPLE_FEATURE = {
    "type": "Feature",
    "id": 1,
    "geometry": {
        "type": "Polygon",
        "coordinates": [
            [
                [18.55, 52.11],
                [18.56, 52.11],
                [18.56, 52.12],
                [18.55, 52.12],
                [18.55, 52.11],
            ]
        ],
    },
    "properties": {
        "ID_KONTURU": 99,
        "NR_REJESTR": "OG-123",
        "NAZWA_OG": "Test Mining Area",
        "KOPALINA": "Copper",
        "STATUS": "Active",
        "DATA_USTANOWIENIA": "2019-03-15",
    },
}


class PolandPgiMiningSyncTests(unittest.TestCase):
    def test_layer_source_id_deposits(self):
        self.assertEqual(poland.layer_source_id(0), "poland_pgi_deposits")
        self.assertEqual(poland.layer_source_id(1), "poland_pgi_midas_layer1")

    def test_normalize_midas_feature(self):
        row = poland.normalize_midas_feature(SAMPLE_FEATURE, layer_id=1)
        self.assertIsNotNone(row)
        assert row is not None
        self.assertEqual(row["country"], "Poland")
        self.assertEqual(row["company"], "Test Mining Area")
        self.assertIn("poland_pgi_midas_layer1", row["source_id"])
        self.assertAlmostEqual(row["lat"], 52.115, places=2)

    @patch("backend.services.ingest.open_data_sync.upsert_open_data_records")
    @patch("backend.services.ingest.poland_pgi_mining_sync.fetch_layer_features")
    def test_sync_poland_mocked(self, mock_fetch, mock_upsert):
        mock_fetch.return_value = [
            poland.normalize_midas_feature(SAMPLE_FEATURE, layer_id=1),
        ]
        mock_upsert.return_value = 1
        conn = MagicMock()
        result = poland.sync_poland_pgi_mining(conn, layer_ids=(1,), urlopen=MagicMock())
        self.assertEqual(result["status"], "success")
        self.assertEqual(result["records_written"], 1)


if __name__ == "__main__":
    unittest.main()
