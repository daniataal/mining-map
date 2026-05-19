"""Tests for Philippines MGB ArcGIS probe."""

from __future__ import annotations

import json
import os
import unittest
from unittest.mock import MagicMock

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-unit-tests-32b!")

from backend.services.ingest import philippines_mgb_arcgis_probe as probe


class PhilippinesMgbArcgisProbeTests(unittest.TestCase):
    def test_probe_token_required_without_token(self):
        payload = json.dumps({"error": {"code": 498, "message": "Token Required"}}).encode("utf-8")
        mock_resp = MagicMock()
        mock_resp.read.return_value = payload
        mock_resp.__enter__.return_value = mock_resp

        def urlopen(_req, timeout=15):
            return mock_resp

        result = probe.probe_philippines_mgb_arcgis(urlopen=urlopen, timeout=5)
        self.assertFalse(result["reachable"])
        self.assertEqual(result["status"], "token_required")
        self.assertEqual(result["probe_key"], "philippines_mgb_arcgis")

    def test_probe_success_count(self):
        payload = json.dumps({"count": 42}).encode("utf-8")
        mock_resp = MagicMock()
        mock_resp.read.return_value = payload
        mock_resp.__enter__.return_value = mock_resp

        def urlopen(_req, timeout=15):
            return mock_resp

        result = probe.probe_philippines_mgb_arcgis(urlopen=urlopen, timeout=5)
        self.assertTrue(result["reachable"])
        self.assertEqual(result["feature_count"], 42)


if __name__ == "__main__":
    unittest.main()
