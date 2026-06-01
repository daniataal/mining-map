"""Tests for OSM petroleum Overpass layers."""

from __future__ import annotations

import json
import unittest
from unittest.mock import MagicMock, patch

from backend.services import petroleum_osm_overpass as osm


class PetroleumOsmOverpassTests(unittest.TestCase):
    def test_catalog_lists_layers(self):
        catalog = osm.get_osm_layer_catalog()
        ids = {layer["id"] for layer in catalog["layers"]}
        self.assertIn("pipelines", ids)
        self.assertIn("refineries", ids)

    @patch("backend.services.petroleum_osm_overpass.fetch_overpass_elements")
    def test_geojson_from_pipeline_way(self, mock_fetch):
        mock_fetch.return_value = [
            {
                "type": "way",
                "id": 42,
                "tags": {"man_made": "pipeline", "name": "Test Pipe"},
                "geometry": [
                    {"lat": 1.0, "lon": 2.0},
                    {"lat": 1.1, "lon": 2.1},
                ],
            }
        ]
        payload = osm.get_osm_layer_geojson("pipelines", bbox=(0, 0, 5, 5))
        self.assertEqual(payload["feature_count"], 1)
        self.assertEqual(payload["features"][0]["geometry"]["type"], "LineString")

    def test_element_to_feature_preserves_pipeline_operational_tags(self):
        feat = osm._element_to_feature(
            "pipelines",
            {
                "type": "way",
                "id": 98483828,
                "tags": {
                    "man_made": "pipeline",
                    "name": "Example Pipe",
                    "operator": "Acme Pipelines",
                    "owner": "Acme Holdings",
                    "substance": "oil",
                    "diameter": "48 in",
                    "ref": "LINE-1",
                    "wikipedia": "en:Example",
                },
                "geometry": [
                    {"lat": 1.0, "lon": 2.0},
                    {"lat": 1.1, "lon": 2.1},
                ],
            },
        )
        self.assertIsNotNone(feat)
        props = feat["properties"]
        self.assertEqual(props["operator"], "Acme Pipelines")
        self.assertEqual(props["owner"], "Acme Holdings")
        self.assertEqual(props["substance"], "oil")
        self.assertEqual(props["diameter"], "48 in")
        self.assertEqual(props["ref"], "LINE-1")
        self.assertEqual(props["wikipedia"], "en:Example")
        self.assertEqual(props["osm_id"], 98483828)
        self.assertEqual(props["pipeline_substance"], "oil")

    def test_element_to_feature_classifies_water_by_name(self):
        feat = osm._element_to_feature(
            "pipelines",
            {
                "type": "way",
                "id": 296661798,
                "tags": {
                    "man_made": "pipeline",
                    "name": "مشروع المياه القطري",
                    "name:ar": "مشروع المياه القطري",
                },
                "geometry": [
                    {"lat": 32.788, "lon": 35.284},
                    {"lat": 32.787, "lon": 35.283},
                ],
            },
        )
        self.assertIsNotNone(feat)
        self.assertEqual(feat["properties"]["pipeline_substance"], "water")

    @patch("backend.services.petroleum_osm_overpass.urlopen")
    def test_fetch_overpass_parses_elements(self, mock_urlopen):
        body = {"elements": [{"type": "node", "id": 1, "lat": 1, "lon": 2, "tags": {}}]}
        mock_resp = MagicMock()
        mock_resp.read.return_value = json.dumps(body).encode("utf-8")
        mock_resp.__enter__.return_value = mock_resp
        mock_urlopen.return_value = mock_resp

        elements = osm.fetch_overpass_elements("refineries", (0, 0, 1, 1))
        self.assertEqual(len(elements), 1)


if __name__ == "__main__":
    unittest.main()
