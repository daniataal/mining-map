"""Tests for sync drift alert persistence."""

from __future__ import annotations

import os
import unittest
from unittest.mock import MagicMock, patch

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-unit-tests-32b!")

from backend.services import sync_alert_store as alerts


class SyncAlertStoreTests(unittest.TestCase):
    @patch("backend.services.sync_alert_store._maybe_notify_webhook")
    def test_record_drift_alert(self, _webhook):
        conn = MagicMock()
        cur = MagicMock()
        conn.cursor.return_value.__enter__.return_value = cur
        cur.fetchone.return_value = (42,)

        alert_id = alerts.record_drift_alert(
            conn,
            run_id=7,
            source_id="kenya_mining_cadastre",
            drift_warning={"type": "records_written_drop", "drop_pct": 25.0, "message": "drop"},
        )
        self.assertEqual(alert_id, 42)
        cur.execute.assert_called()


if __name__ == "__main__":
    unittest.main()
