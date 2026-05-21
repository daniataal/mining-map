import unittest
from unittest.mock import patch

from backend.services.storage_terminals import get_storage_terminals
from backend.services.storage_terminals_seed import (
    CuratedStorageTerminal,
    drop_curated_near_osm_duplicates,
    load_curated_storage_terminals,
    load_seed_records,
    normalize_curated_terminal,
)


class StorageTerminalsSeedTests(unittest.TestCase):
    def test_load_seed_records_returns_major_hubs(self):
        records = load_seed_records()
        self.assertGreaterEqual(len(records), 30)
        names = {record.name for record in records}
        self.assertIn("Fujairah Oil Industry Zone (FOIZ)", names)
        self.assertIn("Cushing Crude Oil Storage Hub", names)
        self.assertIn("Jurong Island Tank Storage", names)

    @patch("backend.services.storage_terminals_seed.find_nearest_ports")
    @patch("backend.services.storage_terminals_seed.resolve_country")
    def test_normalize_curated_terminal_marks_provenance(
        self,
        mock_resolve_country,
        mock_find_nearest_ports,
    ):
        mock_resolve_country.return_value = ("United Arab Emirates", "AE")
        mock_find_nearest_ports.return_value = []

        entity = normalize_curated_terminal(
            CuratedStorageTerminal(
                name="Fujairah Oil Industry Zone (FOIZ)",
                country="United Arab Emirates",
                region="Fujairah",
                lat=25.128,
                lng=56.337,
                operator="VTTI",
                commodity="crude oil",
                source_record_url="https://www.foiz.ae/",
            ),
            "2026-05-20T12:00:00Z",
        )

        self.assertTrue(entity["id"].startswith("curated_storage_"))
        self.assertEqual(entity["sourceKind"], "curated_reference")
        self.assertEqual(entity["recordOrigin"], "curated_reference")
        self.assertEqual(entity["operatorName"], "VTTI")
        self.assertEqual(entity["sourceName"], "Curated major global petroleum storage terminals")

    def test_drop_curated_near_osm_duplicates_prefers_osm(self):
        entities = [
            {
                "id": "osm:way:1",
                "company": "Rotterdam Europoort Tank Storage",
                "lat": 51.905,
                "lng": 4.325,
                "sourceKind": None,
            },
            {
                "id": "curated_storage_rotterdam_europoort_tank_storage_netherlands",
                "company": "Rotterdam Europoort Tank Storage",
                "lat": 51.906,
                "lng": 4.326,
                "sourceKind": "curated_reference",
            },
            {
                "id": "curated_storage_cushing_crude_oil_storage_hub_united_states",
                "company": "Cushing Crude Oil Storage Hub",
                "lat": 35.985,
                "lng": -96.769,
                "sourceKind": "curated_reference",
            },
        ]
        deduped = drop_curated_near_osm_duplicates(entities)
        ids = {entity["id"] for entity in deduped}
        self.assertIn("osm:way:1", ids)
        self.assertIn("curated_storage_cushing_crude_oil_storage_hub_united_states", ids)
        self.assertNotIn("curated_storage_rotterdam_europoort_tank_storage_netherlands", ids)

    @patch("backend.services.storage_terminals._load_bulk_osm_seed_elements", return_value=[])
    @patch("backend.services.storage_terminals.fetch_overpass_elements")
    @patch("backend.services.storage_terminals._load_storage_terminals_from_db")
    def test_get_storage_terminals_includes_curated_seed_when_overpass_empty(
        self,
        mock_load_db,
        mock_fetch_overpass,
        _mock_bulk,
    ):
        mock_load_db.return_value = ([], None)
        mock_fetch_overpass.return_value = []

        from backend.services import storage_terminals as module

        module._storage_cache["loaded_at"] = 0.0
        module._storage_cache["response"] = None

        response = get_storage_terminals(force_refresh=True)
        curated = [entity for entity in response["entities"] if entity.get("sourceKind") == "curated_reference"]
        self.assertGreaterEqual(len(curated), 30)
        self.assertGreaterEqual(response["stats"]["total"], 30)
        self.assertGreaterEqual(response["stats"]["by_source"]["curated_reference"], 30)


if __name__ == "__main__":
    unittest.main()
