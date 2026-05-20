import unittest
from unittest.mock import patch

from backend.services.storage_terminals import (
    WORLD_TILES,
    _commodity_hints_from_tags,
    _overpass_urls,
    _should_cache_storage_response,
    infer_terminal_subtype,
    normalize_storage_terminal,
)


class StorageTerminalTests(unittest.TestCase):
    def test_overpass_urls_prefers_configured_endpoint(self):
        with patch.dict("os.environ", {"STORAGE_OVERPASS_URL": "https://example.test/interpreter"}, clear=False):
            urls = _overpass_urls()
        self.assertEqual(urls[0], "https://example.test/interpreter")

    def test_should_not_cache_when_all_tiles_failed(self):
        warnings = [f"{name}: timeout" for name, _ in WORLD_TILES]
        self.assertFalse(_should_cache_storage_response([], warnings))
        self.assertTrue(_should_cache_storage_response([{"id": "x"}], warnings))

    def test_infer_terminal_subtype_explicit_petroleum_terminal(self):
        subtype, confidence, note = infer_terminal_subtype(
            {"industrial": "petroleum_terminal", "name": "Ruwais Terminal"}
        )
        self.assertEqual(subtype, "storage_terminal")
        self.assertGreaterEqual(confidence, 0.9)
        self.assertIn("petroleum_terminal", note)

    def test_infer_terminal_subtype_named_tank_farm_proxy(self):
        subtype, confidence, note = infer_terminal_subtype(
            {"industrial": "oil", "name": "Fujairah Tank Farm"}
        )
        self.assertEqual(subtype, "tank_farm")
        self.assertGreaterEqual(confidence, 0.75)
        self.assertIn("tank farm", note.lower())

    def test_commodity_hints_extracts_refined_and_lpg(self):
        hints = _commodity_hints_from_tags(
            {"product": "diesel; gasoline", "content": "LPG"}
        )
        self.assertIn("refined_products", hints)
        self.assertIn("lpg", hints)

    @patch("backend.services.storage_terminals.find_nearest_ports")
    @patch("backend.services.storage_terminals.resolve_country")
    def test_normalize_storage_terminal_keeps_provenance(
        self,
        mock_resolve_country,
        mock_find_nearest_ports,
    ):
        mock_resolve_country.return_value = ("United Arab Emirates", "AE")
        mock_find_nearest_ports.return_value = [
            {
                "name": "Ruwais",
                "unlocode": "AERUW",
                "country_iso2": "AE",
                "distance_km": 12.4,
                "confidence": 0.65,
                "source_label": "UN/LOCODE",
                "source_url": "https://unece.org/trade/cefact/UNLOCODE-Download",
            }
        ]

        entity = normalize_storage_terminal(
            {
                "type": "way",
                "id": 12345,
                "center": {"lat": 24.1, "lon": 52.7},
                "tags": {
                    "name": "Ruwais Oil Terminal",
                    "industrial": "petroleum_terminal",
                    "operator": "ADNOC",
                    "capacity": "2.3 million m3",
                    "product": "crude oil",
                },
            },
            "2026-05-12T21:00:00Z",
        )

        assert entity is not None
        self.assertEqual(entity["entityKind"], "storage_terminal")
        self.assertEqual(entity["entitySubtype"], "storage_terminal")
        self.assertEqual(entity["company"], "Ruwais Oil Terminal")
        self.assertEqual(entity["country"], "United Arab Emirates")
        self.assertEqual(entity["operatorName"], "ADNOC")
        self.assertEqual(entity["sourceName"], "OpenStreetMap via Overpass")
        self.assertEqual(entity["nearbyPort"]["name"], "Ruwais")
        self.assertIn("OpenStreetMap", entity["sourceLabels"])
        self.assertIn("petroleum", entity["commodityHints"])
        self.assertEqual(entity["evidenceCount"], 2)


if __name__ == "__main__":
    unittest.main()
