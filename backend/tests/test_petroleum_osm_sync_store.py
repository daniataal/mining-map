"""Tests for petroleum OSM sync run logging."""

from __future__ import annotations

import os
import unittest
from unittest.mock import MagicMock, patch

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-unit-tests-32b!")

from backend.services import petroleum_osm_sync_store as store


class PetroleumOsmSyncStoreTests(unittest.TestCase):
    def test_ensure_tables_executes(self):
        conn = MagicMock()
        cur = MagicMock()
        conn.cursor.return_value.__enter__.return_value = cur
        store.ensure_petroleum_osm_sync_tables(conn)
        self.assertTrue(cur.execute.called)

    @patch("backend.services.petroleum_osm_store.sync_layer_tiles")
    @patch("backend.services.petroleum_osm_sync_store.finish_sync_run")
    @patch("backend.services.petroleum_osm_sync_store.start_sync_run", return_value=1)
    def test_sync_all_layers_logs_run(self, _start, mock_finish, mock_tile):
        from backend.services import petroleum_osm_store as osm_store

        mock_tile.return_value = {"features_upserted": 3, "errors": []}
        conn = MagicMock()
        summary = osm_store.sync_all_layers(conn, layer_ids=["pipelines"], log_run=True)
        self.assertEqual(summary.get("features_upserted"), 3)
        mock_finish.assert_called_once()


if __name__ == "__main__":
    unittest.main()
