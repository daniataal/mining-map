"""Tests for sync SLA helpers."""

from __future__ import annotations

import os
import unittest
from datetime import datetime, timedelta, timezone

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-unit-tests-32b!")

from backend.services.sync_sla import enrich_sync_run_with_sla, sla_status_from_hours


class SyncSlaTests(unittest.TestCase):
    def test_sla_green_yellow_red(self):
        os.environ["SYNC_SLA_GREEN_HOURS"] = "24"
        os.environ["SYNC_SLA_YELLOW_HOURS"] = "72"
        os.environ["SYNC_SLA_RED_HOURS"] = "168"
        self.assertEqual(sla_status_from_hours(12), "green")
        self.assertEqual(sla_status_from_hours(48), "yellow")
        self.assertEqual(sla_status_from_hours(200), "red")

    def test_enrich_sync_run(self):
        now = datetime.now(timezone.utc)
        run = {
            "source_id": "kenya_mining_cadastre",
            "status": "success",
            "finished_at": now - timedelta(hours=30),
        }
        enriched = enrich_sync_run_with_sla(run, now=now)
        self.assertEqual(enriched["sla_status"], "yellow")
        self.assertIsNotNone(enriched["hours_since_sync"])


if __name__ == "__main__":
    unittest.main()
