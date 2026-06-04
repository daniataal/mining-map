import unittest
from unittest.mock import patch

from backend.services.storage_terminals import get_storage_terminals
from backend.services.storage_terminals_seed import (
    CuratedStorageTerminal,
    _FUJAIRAH_AIRPORT_LAT,
    _FUJAIRAH_AIRPORT_LNG,
    _haversine_km,
    drop_curated_near_osm_duplicates,
    drop_curated_when_osm_present_nearby,
    enrich_osm_from_curated_reference,
    load_curated_storage_terminals,
    load_seed_records,
    normalize_curated_terminal,
)


class StorageTerminalsSeedTests(unittest.TestCase):
    def test_adnoc_fujairah_curated_not_on_airport(self):
        records = load_seed_records()
        adnoc = next(r for r in records if r.name == "ADNOC Fujairah Storage")
        entity = normalize_curated_terminal(adnoc, "2026-06-04T00:00:00+00:00")
        dist = _haversine_km(
            float(entity["lat"]),
            float(entity["lng"]),
            _FUJAIRAH_AIRPORT_LAT,
            _FUJAIRAH_AIRPORT_LNG,
        )
        self.assertGreater(dist, 2.5, f"ADNOC pin still {dist:.2f} km from Fujairah airport")

    @patch("backend.services.storage_terminals_seed.find_nearest_ports")
    @patch("backend.services.storage_terminals_seed.resolve_country")
    def test_fujairah_airport_vicinity_seed_gets_nudged(
        self,
        mock_resolve_country,
        mock_find_nearest_ports,
    ):
        mock_resolve_country.return_value = ("United Arab Emirates", "AE")
        mock_find_nearest_ports.return_value = []
        entity = normalize_curated_terminal(
            CuratedStorageTerminal(
                name="ADNOC Fujairah Storage",
                country="United Arab Emirates",
                region="Fujairah",
                lat=25.11,
                lng=56.33,
            ),
            "2026-06-04T00:00:00+00:00",
        )
        self.assertTrue(entity.get("geoApproximated"))
        dist = _haversine_km(
            float(entity["lat"]),
            float(entity["lng"]),
            _FUJAIRAH_AIRPORT_LAT,
            _FUJAIRAH_AIRPORT_LNG,
        )
        self.assertGreater(dist, 2.5)

    def test_load_seed_records_returns_major_hubs(self):
        records = load_seed_records()
        self.assertGreaterEqual(len(records), 150)
        countries = {record.country for record in records}
        self.assertGreaterEqual(len(countries), 70)
        names = {record.name for record in records}
        self.assertIn("Fujairah Oil Industry Zone (FOIZ)", names)
        self.assertIn("Cushing Crude Oil Storage Hub", names)
        self.assertIn("Jurong Island Tank Storage", names)
        self.assertIn("Santos Port Petroleum Storage", names)
        self.assertIn("Mongstad Refinery Storage", names)
        self.assertIn("Alexandria Petroleum Storage", names)
        self.assertIn("Map Ta Phut Tank Terminal", names)
        self.assertIn("EAPC Ashkelon Oil Terminal", names)

    def test_drop_curated_when_osm_present_keeps_ashkelon_gap_fill(self):
        """Southern Paz OSM tanks must not suppress northern EAPC curated hub."""
        eapc = normalize_curated_terminal(
            CuratedStorageTerminal(
                name="EAPC Ashkelon Oil Terminal",
                country="Israel",
                region="Ashkelon",
                lat=31.6406,
                lng=34.5414,
                operator="EAPC",
                retain_near_osm=True,
            ),
            "2026-06-04T00:00:00+00:00",
        )
        south_osm = {
            "id": "osm:way:ashkelon_south_paz",
            "lat": 31.62,
            "lng": 34.52,
        }
        merged = drop_curated_when_osm_present_nearby(
            [south_osm, eapc],
            distance_km=8.0,
        )
        ids = {entity["id"] for entity in merged}
        self.assertIn(eapc["id"], ids)
        self.assertIn(south_osm["id"], ids)
        dist = _haversine_km(
            float(eapc["lat"]),
            float(eapc["lng"]),
            float(south_osm["lat"]),
            float(south_osm["lng"]),
        )
        self.assertLess(dist, 8.0)

    def test_drop_curated_when_osm_present_drops_dense_unflagged_farm(self):
        curated = {
            "id": "curated_storage_rotterdam_europoort_tank_storage_netherlands",
            "lat": 51.906,
            "lng": 4.326,
            "sourceKind": "curated_reference",
        }
        osm_rows = [
            {"id": f"osm:way:{i}", "lat": 51.905 + i * 0.0001, "lng": 4.325 + i * 0.0001}
            for i in range(3)
        ]
        merged = drop_curated_when_osm_present_nearby([*osm_rows, curated], distance_km=8.0)
        ids = {entity["id"] for entity in merged}
        self.assertNotIn(curated["id"], ids)

    def test_drop_curated_when_osm_present_keeps_sparse_unflagged(self):
        curated = {
            "id": "curated_storage_test_sparse_hub_netherlands",
            "lat": 51.906,
            "lng": 4.326,
            "sourceKind": "curated_reference",
        }
        osm = {"id": "osm:way:1", "lat": 51.905, "lng": 4.325}
        merged = drop_curated_when_osm_present_nearby([osm, curated], distance_km=8.0)
        ids = {entity["id"] for entity in merged}
        self.assertIn(curated["id"], ids)

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

    @patch("backend.services.storage_terminals_seed.find_nearest_ports", return_value=[])
    @patch("backend.services.storage_terminals_seed.resolve_country", return_value=("United Arab Emirates", "AE"))
    def test_enrich_osm_from_curated_reference_fills_sparse_uae_node(self, *_mocks):
        curated = normalize_curated_terminal(
            CuratedStorageTerminal(
                name="ADNOC Sas Al Nakhl / Umm Al Nar Storage Hub",
                country="United Arab Emirates",
                region="Abu Dhabi | Sas Al Nakhl",
                lat=24.43,
                lng=54.51,
                operator="ADNOC",
                commodity="crude oil, refined products",
                capacity_text="Multi-tank crude & products hub",
                source_record_url="https://www.adnoc.ae/",
            ),
            "2026-05-30T00:00:00Z",
        )
        sparse_osm = {
            "id": "osm:node:999",
            "company": "Unnamed Storage Terminal",
            "lat": 24.4284,
            "lng": 54.5072,
            "sourceKind": None,
            "country": "Unknown",
            "region": "Unknown",
            "confidenceScore": 0.58,
            "sourceName": "OpenStreetMap (offline bulk seed)",
        }
        enriched = enrich_osm_from_curated_reference([sparse_osm, curated])
        osm = next(entity for entity in enriched if entity["id"] == "osm:node:999")

        self.assertEqual(osm["operatorName"], "ADNOC")
        self.assertEqual(osm["capacityText"], "Multi-tank crude & products hub")
        self.assertEqual(osm["country"], "United Arab Emirates")
        self.assertEqual(osm["siteContextName"], "ADNOC Sas Al Nakhl / Umm Al Nar Storage Hub")
        self.assertEqual(osm["curatedEnrichmentSourceId"], curated["id"])
        self.assertLess(osm["curatedEnrichmentDistanceKm"], 4.0)
        self.assertEqual(osm["enrichmentSourceUrl"], "https://www.adnoc.ae/")
        self.assertGreater(osm["confidenceScore"], 0.58)

        deduped = drop_curated_near_osm_duplicates(enriched)
        ids = {entity["id"] for entity in deduped}
        self.assertIn("osm:node:999", ids)
        self.assertNotIn(curated["id"], ids)

    @patch("backend.services.storage_terminals_gov_seed.load_government_storage_reference_hubs", return_value=[])
    @patch("backend.services.storage_terminals_oil_db.load_oil_terminal_reference_hubs", return_value=[])
    @patch("backend.services.storage_terminals._load_bulk_osm_seed_elements", return_value=[])
    @patch("backend.services.storage_terminals.fetch_overpass_elements")
    @patch("backend.services.storage_terminals._load_storage_terminals_from_db")
    def test_get_storage_terminals_includes_curated_seed_when_overpass_empty(
        self,
        mock_load_db,
        mock_fetch_overpass,
        _mock_bulk,
        _mock_oil,
        _mock_gov,
    ):
        mock_load_db.return_value = ([], None)
        mock_fetch_overpass.return_value = []

        from backend.services import storage_terminals as module

        module._storage_cache["loaded_at"] = 0.0
        module._storage_cache["response"] = None

        response = get_storage_terminals(force_refresh=True)
        curated = [entity for entity in response["entities"] if entity.get("sourceKind") == "curated_reference"]
        self.assertGreaterEqual(len(curated), 150)
        self.assertGreaterEqual(response["stats"]["total"], 150)
        self.assertGreaterEqual(response["stats"]["by_source"]["curated_reference"], 150)


if __name__ == "__main__":
    unittest.main()
