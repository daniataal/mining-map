"""Tests for license sync drift detection."""

from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

from backend.services.license_sync_store import evaluate_sync_drift


class LicenseSyncDriftTests(unittest.TestCase):
    def test_no_warning_without_previous_run(self):
        conn = MagicMock()
        cursor = MagicMock()
        cursor.fetchone.return_value = None
        conn.cursor.return_value.__enter__.return_value = cursor

        warning = evaluate_sync_drift(
            conn,
            run_id=2,
            source_id="kenya_mining_cadastre",
            records_written=100,
        )
        self.assertIsNone(warning)

    @patch("backend.services.sync_alert_store.record_drift_alert")
    def test_warning_when_drop_exceeds_threshold(self, _record_alert):
        conn = MagicMock()
        cursor = MagicMock()
        cursor.fetchone.return_value = (1000,)
        conn.cursor.return_value.__enter__.return_value = cursor

        warning = evaluate_sync_drift(
            conn,
            run_id=5,
            source_id="kenya_mining_cadastre",
            records_written=500,
        )
        self.assertIsNotNone(warning)
        self.assertEqual(warning["type"], "records_written_drop")
        self.assertGreater(warning["drop_pct"], 20)


if __name__ == "__main__":
    unittest.main()
