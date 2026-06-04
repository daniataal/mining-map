import unittest
from unittest.mock import MagicMock, patch

from backend.services.storage_terminal_intel import (
    _haversine_km,
    _resolve_port_directory,
    _tenants_for_terminal,
    build_storage_terminal_commercial_intel,
)


class StorageTerminalIntelTests(unittest.TestCase):
    def test_haversine_zero_distance(self):
        self.assertAlmostEqual(_haversine_km(25.1, 56.3, 25.1, 56.3), 0.0, places=3)

    @patch("backend.services.storage_terminal_intel.get_directory_by_locode")
    def test_resolve_port_by_locode(self, mock_get):
        mock_get.return_value = {"locode": "AEFJR", "port_name": "Fujairah", "tenants": []}
        directory, km = _resolve_port_directory({"locode": "AEFJR", "lat": 25.1, "lng": 56.3})
        self.assertEqual(km, 0.0)
        self.assertEqual(directory["locode"], "AEFJR")

    def test_tenants_prioritize_linked_hub(self):
        directory = {
            "tenants": [
                {
                    "name": "VTTI",
                    "category": "tank_storage_and_refineries",
                    "curated_storage_external_id": "curated_storage_vtti",
                    "category_label": "Tank storage",
                },
                {"name": "Agent Co", "category": "shipping_agents", "category_label": "Agents"},
            ]
        }
        entity = {"id": "curated_storage_vtti"}
        leads = _tenants_for_terminal(entity, directory)
        self.assertTrue(any(l["role"] == "port_listed_tenant" for l in leads))
        self.assertTrue(any(l["name"] == "VTTI" for l in leads))

    def test_build_intel_without_coords(self):
        conn = MagicMock()
        intel = build_storage_terminal_commercial_intel(
            conn,
            {"id": "osm:1", "company": "Tank"},
        )
        self.assertEqual(intel["nearbyGemPlants"], [])
        self.assertIn("GEM spatial match skipped", intel["limitations"][-1])


if __name__ == "__main__":
    unittest.main()
