"""Tests for OSM petroleum DB persistence and API fallback."""

from __future__ import annotations

import os
import unittest
from unittest.mock import MagicMock, patch

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-unit-tests-32b!")
os.environ["ADMIN_TOKEN"] = "test-admin-token"

from backend.main import app  # noqa: E402
from fastapi.testclient import TestClient


class PetroleumOsmSyncTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    @patch("backend.services.petroleum_osm_store.layer_has_cached_features", return_value=True)
    @patch("backend.services.petroleum_osm_store.get_layer_geojson_from_db")
    @patch("backend.main.get_db_connection")
    def test_osm_layer_reads_db_first(self, mock_conn, mock_db_geojson, _has_cache):
        mock_db_geojson.return_value = {
            "type": "FeatureCollection",
            "features": [{"type": "Feature", "id": "osm/way/1"}],
            "layer_id": "pipelines",
            "feature_count": 1,
            "source": "database",
        }
        mock_conn.return_value = MagicMock()

        res = self.client.get("/api/petroleum/osm-layers/pipelines")
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body.get("source"), "database")
        self.assertEqual(body.get("feature_count"), 1)
        mock_db_geojson.assert_called_once()

    def test_admin_petroleum_osm_sync_requires_token(self):
        res = self.client.post(
            "/api/admin/petroleum-osm/sync",
            headers={"X-Admin-Token": "wrong"},
        )
        self.assertEqual(res.status_code, 403)

    @patch("backend.main.get_db_connection")
    @patch("backend.services.petroleum_osm_store.sync_all_layers")
    @patch("backend.services.petroleum_osm_store.ensure_petroleum_osm_tables")
    def test_admin_petroleum_osm_sync_success(self, _ensure, mock_sync, mock_conn):
        conn = MagicMock()
        mock_conn.return_value = conn
        mock_sync.return_value = {"layers": [], "status": "success"}

        res = self.client.post(
            "/api/admin/petroleum-osm/sync",
            headers={"X-Admin-Token": "test-admin-token"},
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json().get("status"), "success")


class PetroleumOsmStoreUnitTests(unittest.TestCase):
    @patch("backend.services.petroleum_osm_store.fetch_overpass_elements")
    def test_sync_layer_tiles_upserts(self, mock_fetch):
        from backend.services.petroleum_osm_store import sync_layer_tiles

        mock_fetch.return_value = [
            {
                "type": "way",
                "id": 99,
                "tags": {"name": "Test Pipe", "man_made": "pipeline"},
                "geometry": [
                    {"lat": 1.0, "lon": 2.0},
                    {"lat": 1.1, "lon": 2.1},
                ],
            }
        ]
        conn = MagicMock()
        cur = MagicMock()
        conn.cursor.return_value.__enter__.return_value = cur

        out = sync_layer_tiles(
            conn,
            "pipelines",
            tiles=[("test_tile", (0.0, 0.0, 2.0, 3.0))],
            sleep_fn=lambda _: None,
        )
        self.assertEqual(out["features_upserted"], 1)
        conn.commit.assert_called()


if __name__ == "__main__":
    unittest.main()
