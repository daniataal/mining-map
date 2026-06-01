"""Tests for BarentsWatch government AIS ingest adapter stub (MAD-61)."""

from __future__ import annotations

import json
import os
import unittest
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-unit-tests-32b!")

from backend.services.ingest import barentswatch_ais_sync as bw


class BarentsWatchAisSyncTests(unittest.TestCase):
    def test_normalize_position_maps_fields(self):
        raw = {
            "mmsi": 257789800,
            "name": "GRIEG ARTIC",
            "latitude": 59.141722,
            "longitude": 5.819193,
            "speedOverGround": 0.1,
            "courseOverGround": 63.8,
            "imoNumber": 9123456,
            "msgtime": "2022-11-02T13:46:12+00:00",
        }
        row = bw.normalize_position(raw)
        assert row is not None
        self.assertEqual(row["data_source"], "barentswatch")
        self.assertEqual(row["source_record_id"], "bw:257789800")
        self.assertEqual(row["vessel_name"], "GRIEG ARTIC")
        self.assertEqual(row["imo"], "9123456")
        self.assertEqual(row["source_type"], "government_ais")

    def test_normalize_position_rejects_missing_coords(self):
        self.assertIsNone(bw.normalize_position({"mmsi": 1}))

    @patch.dict(os.environ, {"BARENTSWATCH_CLIENT_ID": "", "BARENTSWATCH_CLIENT_SECRET": ""}, clear=False)
    def test_sync_skips_without_credentials(self):
        conn = MagicMock()
        result = bw.sync_barentswatch_ais(conn)
        self.assertEqual(result["status"], "skipped")
        self.assertIn("CLIENT", result["reason"])

    @patch.dict(
        os.environ,
        {
            "BARENTSWATCH_CLIENT_ID": "test@example.com:app",
            "BARENTSWATCH_CLIENT_SECRET": "secret",
        },
        clear=False,
    )
    @patch("backend.services.ingest.barentswatch_ais_sync.update_source_health")
    @patch("backend.services.vessel_position_observations.batch_upsert_observations")
    @patch("backend.services.vessel_position_observations.refresh_coverage_cells")
    def test_sync_upserts_positions(self, mock_coverage, mock_batch, mock_health):
        mock_batch.return_value = 1
        mock_coverage.return_value = {"status": "ok", "upserted": 1}
        conn = MagicMock()

        def _token():
            return "tok"

        def _positions(_token, *, max_vessels=500):
            return [
                {
                    "mmsi": 257789800,
                    "name": "TEST",
                    "latitude": 59.1,
                    "longitude": 5.8,
                    "msgtime": datetime(2026, 5, 23, 12, 0, tzinfo=timezone.utc).isoformat(),
                }
            ]

        result = bw.sync_barentswatch_ais(
            conn,
            fetch_token=_token,
            fetch_positions=_positions,
            max_vessels=10,
        )
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["upserted"], 1)
        mock_batch.assert_called_once()
        mock_health.assert_called()

    @patch("urllib.request.urlopen")
    def test_fetch_access_token(self, mock_urlopen):
        mock_resp = MagicMock()
        mock_resp.read.return_value = json.dumps({"access_token": "abc123"}).encode("utf-8")
        mock_resp.__enter__.return_value = mock_resp
        mock_urlopen.return_value = mock_resp

        token = bw.fetch_access_token(client_id="id", client_secret="sec")
        self.assertEqual(token, "abc123")


if __name__ == "__main__":
    unittest.main()
