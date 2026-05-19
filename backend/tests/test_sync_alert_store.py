"""Tests for sync drift alert persistence."""

from __future__ import annotations

import os
import unittest
from unittest.mock import MagicMock, patch

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-unit-tests-32b!")

from backend.services import sync_alert_store as alerts


class SyncAlertStoreTests(unittest.TestCase):
    @patch("backend.services.sync_alert_store._maybe_notify_webhook")
    @patch("backend.services.sync_alert_store._maybe_notify_email_stub")
    def test_record_drift_alert(self, _email, _webhook):
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

    def test_mark_alert_read(self):
        conn = MagicMock()
        cur = MagicMock()
        conn.cursor.return_value.__enter__.return_value = cur
        cur.fetchone.return_value = (5,)

        updated = alerts.mark_alert_read(conn, 5)
        self.assertTrue(updated)

    def test_mark_all_alerts_read(self):
        conn = MagicMock()
        cur = MagicMock()
        conn.cursor.return_value.__enter__.return_value = cur
        cur.fetchall.return_value = [(1,), (2,)]

        count = alerts.mark_all_alerts_read(conn)
        self.assertEqual(count, 2)

    @patch("backend.services.sync_alert_store.smtplib.SMTP")
    def test_email_sent_when_smtp_configured(self, mock_smtp_cls):
        mock_smtp = MagicMock()
        mock_smtp_cls.return_value.__enter__.return_value = mock_smtp
        with patch.dict(
            os.environ,
            {
                "SMTP_HOST": "smtp.example.com",
                "SMTP_FROM": "alerts@example.com",
                "SMTP_TO": "admin@example.com",
            },
            clear=False,
        ):
            alerts._maybe_notify_email_stub(
                run_id=1,
                source_id="test_source",
                drift_warning={"message": "drop"},
            )
        mock_smtp.send_message.assert_called_once()

    @patch("backend.services.sync_alert_store.urllib.request.urlopen")
    def test_webhook_includes_admin_url_and_drop_pct(self, mock_urlopen):
        mock_urlopen.return_value.__enter__.return_value = MagicMock()
        with patch.dict(
            os.environ,
            {
                "SYNC_ALERT_WEBHOOK_URL": "https://hooks.example.com/drift",
                "APP_PUBLIC_URL": "https://app.example.com",
                "ADMIN_DATA_HEALTH_PATH": "/admin?tab=data-health",
            },
            clear=False,
        ):
            alerts._maybe_notify_webhook(
                run_id=9,
                source_id="kenya_mining_cadastre",
                drift_warning={"drop_pct": 33.5, "message": "big drop"},
            )
        posted = mock_urlopen.call_args[0][0]
        import json

        body = json.loads(posted.data.decode("utf-8"))
        self.assertEqual(body["source_id"], "kenya_mining_cadastre")
        self.assertEqual(body["drop_pct"], 33.5)
        self.assertEqual(body["admin_ui_url"], "https://app.example.com/admin?tab=data-health")


if __name__ == "__main__":
    unittest.main()
