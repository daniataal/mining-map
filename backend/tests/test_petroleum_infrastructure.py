import unittest
from unittest.mock import patch

from backend.services import petroleum_infrastructure as pi


class PetroleumInfrastructureTests(unittest.TestCase):
    def test_normalize_bbox_rejects_invalid(self):
        self.assertIsNone(pi._normalize_bbox((10, 0, 5, 1)))

    def test_pick_zoom_scales_with_span(self):
        bbox = (20.0, 45.0, 30.0, 60.0)
        self.assertGreaterEqual(pi._pick_zoom(None, bbox), 5)

    def test_exploration_filter(self):
        self.assertTrue(pi._is_exploration({"Type": "EXPLORATION AREAS"}))
        self.assertFalse(pi._is_production({"Type": "EXPLORATION AREAS"}))

    def test_production_filter(self):
        self.assertTrue(pi._is_production({"Type": "PRODUCTION FIELD"}))
        self.assertFalse(pi._is_exploration({"Type": "PRODUCTION FIELD"}))

    def test_mvt_point_transform(self):
        geometry = {"type": "Point", "coordinates": [2048, 2048]}
        out = pi._transform_geometry(4, 10, 7, geometry)
        lng, lat = out["coordinates"]
        self.assertTrue(-180 <= lng <= 180)
        self.assertTrue(-90 <= lat <= 90)

    def test_catalog_lists_six_layers(self):
        catalog = pi.get_petroleum_layer_catalog()
        self.assertEqual(len(catalog["layers"]), 6)
        ids = {layer["id"] for layer in catalog["layers"]}
        self.assertIn("exploration", ids)
        self.assertIn("gas_pipelines", ids)

    @patch("backend.services.petroleum_infrastructure._collect_from_tileset")
    def test_get_layer_geojson_unknown_raises(self, _mock_collect):
        with self.assertRaises(KeyError):
            pi.get_petroleum_layer_geojson("not_a_layer", bbox=(0, 0, 1, 1))

    @patch("backend.services.petroleum_infrastructure._collect_from_tileset")
    def test_get_exploration_geojson(self, mock_collect):
        mock_collect.return_value = [
            {
                "type": "Feature",
                "id": "abc",
                "geometry": {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 0]]]},
                "properties": {"Name": "Block A", "Type": "EXPLORATION AREAS"},
            }
        ]
        payload = pi.get_petroleum_layer_geojson("exploration", bbox=(20, 45, 30, 60))
        self.assertEqual(payload["feature_count"], 1)
        self.assertEqual(payload["layer_id"], "exploration")
        mock_collect.assert_called_once()
