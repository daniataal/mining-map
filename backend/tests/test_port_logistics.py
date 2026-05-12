import unittest
from unittest.mock import patch

from backend.services.port_logistics import (
    _infer_subtype,
    _normalize_nearby_infrastructure,
    _normalize_unlocode_row,
)


class PortLogisticsTests(unittest.TestCase):
    def test_infer_subtype_marks_maritime_terminal(self):
        subtype, confidence, note = _infer_subtype(
            "1-------",
            "Ruwais Oil Terminal",
            "",
        )
        self.assertEqual(subtype, "terminal")
        self.assertGreaterEqual(confidence, 0.9)
        self.assertIn("maritime", note.lower())

    def test_infer_subtype_marks_named_multimodal_depot(self):
        subtype, confidence, note = _infer_subtype(
            "-----6--",
            "Mojo Dry Port",
            "Container depot",
        )
        self.assertEqual(subtype, "depot")
        self.assertGreaterEqual(confidence, 0.85)
        self.assertIn("depot", note.lower())

    @patch("backend.services.port_logistics.find_nearest_ports")
    def test_normalize_unlocode_row_keeps_locode_and_provenance(self, mock_find_nearest_ports):
        mock_find_nearest_ports.return_value = [
            {
                "name": "Tema",
                "unlocode": "GHTEM",
                "country_iso2": "GH",
                "distance_km": 14.2,
                "confidence": 0.55,
                "source_label": "UN/LOCODE",
                "source_url": "https://unece.org/trade/cefact/UNLOCODE-Download",
            }
        ]

        row = {
            "Country": "GH",
            "Location": "MDP",
            "Name": "Tema Logistics Depot",
            "Subdivision": "AA",
            "Status": "RL",
            "Function": "-----6--",
            "Coordinates": "0538N 00001E",
            "Remarks": "Container depot",
        }

        entity = _normalize_unlocode_row(row, "2026-05-12T21:00:00Z")
        assert entity is not None
        self.assertEqual(entity["id"], "unlocode:GHMDP")
        self.assertEqual(entity["entityKind"], "logistics_node")
        self.assertEqual(entity["entitySubtype"], "depot")
        self.assertEqual(entity["locode"], "GHMDP")
        self.assertEqual(entity["sourceName"], "UN/LOCODE")
        self.assertEqual(entity["nearbyPort"]["name"], "Tema")
        self.assertIn("UN/LOCODE", entity["sourceLabels"])

    def test_normalize_nearby_infrastructure_keeps_osm_context(self):
        item = _normalize_nearby_infrastructure(
            {
                "type": "way",
                "id": 12345,
                "center": {"lat": 5.64, "lon": 0.02},
                "tags": {
                    "name": "Tema Container Terminal",
                    "industrial": "port",
                    "cargo": "container",
                    "operator": "MPS",
                },
            },
            5.63,
            0.01,
        )
        assert item is not None
        self.assertEqual(item["kind"], "port_area")
        self.assertEqual(item["label"], "Tema Container Terminal")
        self.assertEqual(item["source_label"], "OpenStreetMap")
        self.assertIn("container", item["summary"])


if __name__ == "__main__":
    unittest.main()
