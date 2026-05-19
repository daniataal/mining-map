"""Tests for license_sync_store helpers."""

from __future__ import annotations

import unittest
from datetime import datetime, timezone
from unittest.mock import MagicMock

from backend.services.license_sync_store import (
    finish_license_sync_run,
    list_license_sync_runs,
    list_license_sync_runs_from_rows,
    start_license_sync_run,
)


class LicenseSyncStoreTests(unittest.TestCase):
    def test_start_and_finish_run(self):
        conn = MagicMock()
        cursor = MagicMock()
        conn.cursor.return_value.__enter__.return_value = cursor
        cursor.fetchone.return_value = (42,)

        run_id = start_license_sync_run(conn, source_id="kenya_mining_cadastre")
        self.assertEqual(run_id, 42)
        finish_license_sync_run(
            conn,
            42,
            status="success",
            records_fetched=10,
            records_written=8,
            records_skipped_manual=1,
        )
        self.assertGreaterEqual(cursor.execute.call_count, 2)

    def test_list_runs_serializes_timestamps(self):
        conn = MagicMock()
        cursor = MagicMock()
        conn.cursor.return_value.__enter__.return_value = cursor
        started = datetime(2026, 5, 19, 12, 0, tzinfo=timezone.utc)
        cursor.fetchall.return_value = [
            (1, "kenya_mining_cadastre", started, None, "running", 0, 0, 0, None),
        ]

        runs = list_license_sync_runs(conn, limit=5)
        self.assertEqual(len(runs), 1)
        self.assertEqual(runs[0]["source_id"], "kenya_mining_cadastre")
        self.assertEqual(runs[0]["started_at"], started.isoformat())

    def test_list_runs_from_rows_helper(self):
        started = datetime(2026, 1, 1, tzinfo=timezone.utc)
        rows = list_license_sync_runs_from_rows(
            [(2, "zambia_mining_active", started, started, "success", 5, 5, 0, None)]
        )
        self.assertEqual(rows[0]["id"], 2)
        self.assertEqual(rows[0]["status"], "success")


if __name__ == "__main__":
    unittest.main()
