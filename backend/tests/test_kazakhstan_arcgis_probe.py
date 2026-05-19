"""Tests for Kazakhstan ArcGIS hub probe."""

from __future__ import annotations

import json
import os
import unittest
from unittest.mock import MagicMock

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-unit-tests-32b!")

from backend.services.ingest import kazakhstan_arcgis_probe as probe


class KazakhstanArcgisProbeTests(unittest.TestCase):
    def test_probe_success(self):
        payload = json.dumps({"services": [{"name": "test"}]}).encode("utf-8")
        mock_resp = MagicMock()
        mock_resp.read.return_value = payload
        mock_resp.__enter__.return_value = mock_resp

        def urlopen(_req, timeout=12):
            return mock_resp

        result = probe.probe_kazakhstan_arcgis_hub(urlopen=urlopen, timeout=5)
        self.assertTrue(result["reachable"])
        self.assertEqual(result["service_count"], 1)

    def test_probe_timeout(self):
        def urlopen(_req, timeout=12):
            raise TimeoutError("timed out")

        result = probe.probe_kazakhstan_arcgis_hub(urlopen=urlopen, timeout=1)
        self.assertFalse(result["reachable"])
        self.assertEqual(result["status"], "timeout")


if __name__ == "__main__":
    unittest.main()
