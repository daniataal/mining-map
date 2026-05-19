import os
import unittest
from unittest.mock import MagicMock, patch

from backend.services.comtrade_sync_store import (
    ensure_comtrade_sync_tables,
    list_sync_runs,
)
from backend.services.ingest.comtrade_scheduled_sync import sync_comtrade_hs27


class ComtradeScheduledSyncTests(unittest.TestCase):
    def setUp(self):
        self._prev_key = os.environ.get("COMTRADE_API_KEY")
        self._prev_enabled = os.environ.get("COMTRADE_SYNC_ENABLED")
        os.environ["COMTRADE_API_KEY"] = "test-key"
        os.environ["COMTRADE_SYNC_ENABLED"] = "true"

    def tearDown(self):
        if self._prev_key is None:
            os.environ.pop("COMTRADE_API_KEY", None)
        else:
            os.environ["COMTRADE_API_KEY"] = self._prev_key
        if self._prev_enabled is None:
            os.environ.pop("COMTRADE_SYNC_ENABLED", None)
        else:
            os.environ["COMTRADE_SYNC_ENABLED"] = self._prev_enabled

    def test_skips_without_api_key(self):
        os.environ.pop("COMTRADE_API_KEY", None)
        conn = MagicMock()
        out = sync_comtrade_hs27(conn)
        self.assertEqual(out["status"], "skipped")

    @patch("backend.services.ingest.comtrade_scheduled_sync._load_ingest_helpers")
    @patch("backend.services.ingest.comtrade_scheduled_sync.start_sync_run", return_value=1)
    @patch("backend.services.ingest.comtrade_scheduled_sync.finish_sync_run")
    @patch("backend.services.ingest.comtrade_scheduled_sync.ensure_comtrade_sync_tables")
    def test_sync_upserts_and_logs_run(
        self,
        _ensure_tables,
        _finish,
        _start,
        mock_helpers,
    ):
        mock_ensure = MagicMock()
        mock_upsert = MagicMock(return_value=2)
        mock_fetch = MagicMock(
            return_value=[
                {
                    "reporter_m49": "682",
                    "reporter": "Saudi Arabia",
                    "hs_code": "2709",
                    "flow_type": "X",
                    "year": 2023,
                }
            ]
        )
        mock_helpers.return_value = (
            mock_ensure,
            mock_upsert,
            mock_fetch,
            [{"name": "Saudi Arabia", "m49": "682", "iso2": "SA"}],
            {"2709": "crude"},
        )
        conn = MagicMock()
        out = sync_comtrade_hs27(conn, year=2023, sleep_fn=lambda _: None)
        self.assertEqual(out["status"], "success")
        self.assertEqual(out["rows_upserted"], 2)
        mock_fetch.assert_called()
        mock_upsert.assert_called()

    def test_sync_runs_table_roundtrip(self):
        try:
            import psycopg2
        except ImportError:
            self.skipTest("psycopg2 not installed")
        try:
            conn = psycopg2.connect(
                host=os.getenv("DB_HOST", "localhost"),
                dbname=os.getenv("DB_NAME", "mining_db"),
                user=os.getenv("DB_USER", "postgres"),
                password=os.getenv("DB_PASSWORD", "password"),
            )
        except Exception as exc:
            self.skipTest(f"DB not available: {exc}")
        try:
            ensure_comtrade_sync_tables(conn)
            conn.commit()
            runs = list_sync_runs(conn, limit=1)
            self.assertIsInstance(runs, list)
        finally:
            conn.close()


if __name__ == "__main__":
    unittest.main()
