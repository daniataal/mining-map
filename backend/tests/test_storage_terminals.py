import os
import time
import unittest
from unittest.mock import patch

from backend.services.storage_terminals import (
    WORLD_TILES,
    _commodity_hints_from_tags,
    _db_snapshot_is_globally_complete,
    _element_from_db_row,
    _element_geometry_bounds,
    _enrich_orphan_tanks_with_site_context,
    _enrich_storage_entity_for_detail,
    _extract_operator_owner,
    _geojson_centroid_and_bounds,
    _overpass_urls,
    _parse_storage_terminal_osm_id,
    _should_cache_storage_response,
    build_overpass_query,
    get_storage_terminal_details,
    get_storage_terminals,
    infer_terminal_subtype,
    normalize_storage_terminal,
)


class StorageTerminalTests(unittest.TestCase):
    def test_overpass_urls_prefers_configured_endpoint(self):
        with patch.dict("os.environ", {"STORAGE_OVERPASS_URL": "https://example.test/interpreter"}, clear=False):
            urls = _overpass_urls()
        self.assertEqual(urls[0], "https://example.test/interpreter")

    def test_overpass_urls_includes_default_endpoints(self):
        with patch.dict("os.environ", {}, clear=False):
            for key in ("STORAGE_OVERPASS_URL", "OVERPASS_URL"):
                os.environ.pop(key, None)
            urls = _overpass_urls()
        self.assertIn("https://overpass.kumi.systems/api/interpreter", urls)
        self.assertIn("https://overpass-api.de/api/interpreter", urls)

    @patch("backend.services.storage_terminals_seed.load_curated_storage_terminals", return_value=[])
    @patch("backend.services.storage_terminals._load_bulk_osm_seed_elements")
    @patch("backend.services.storage_terminals.fetch_overpass_elements")
    @patch("backend.services.storage_terminals._load_storage_terminals_from_db")
    def test_get_storage_terminals_uses_bulk_seed_when_overpass_empty(
        self,
        mock_load_db,
        mock_fetch_overpass,
        mock_bulk_seed,
        _mock_curated,
    ):
        mock_load_db.return_value = ([], None)
        mock_fetch_overpass.side_effect = RuntimeError("timeout")
        mock_bulk_seed.return_value = [
            {
                "type": "node",
                "id": 4242,
                "lat": 51.9,
                "lon": 4.4,
                "tags": {"industrial": "petroleum_terminal", "name": "Bulk Seed Terminal"},
            }
        ]

        from backend.services import storage_terminals as module

        module._storage_cache["loaded_at"] = 0.0
        module._storage_cache["response"] = None

        response = get_storage_terminals(force_refresh=True)
        osm_entities = [entity for entity in response["entities"] if str(entity.get("id", "")).startswith("osm:")]
        self.assertGreaterEqual(len(osm_entities), 1)
        self.assertIn("bulk seed", " ".join(response.get("limitations", [])).lower())

    @patch.dict("os.environ", {"STORAGE_SKIP_LIVE_OVERPASS": "false"}, clear=False)
    @patch("backend.services.storage_terminals_seed.load_curated_storage_terminals", return_value=[])
    @patch("backend.services.storage_terminals._load_bulk_osm_seed_elements", return_value=[])
    @patch("backend.services.storage_terminals.fetch_overpass_elements")
    @patch("backend.services.storage_terminals._load_storage_terminals_from_db")
    def test_force_refresh_failure_keeps_previous_cache(
        self,
        mock_load_db,
        mock_fetch_overpass,
        _mock_bulk,
        _mock_curated,
    ):
        mock_load_db.return_value = ([], None)
        mock_fetch_overpass.side_effect = RuntimeError("timeout")

        from backend.services import storage_terminals as module

        module._storage_cache["loaded_at"] = time.time()
        module._storage_cache["response"] = {
            "entities": [{"id": "osm:node:1", "company": "Cached Terminal", "lat": 1.0, "lng": 2.0}],
            "data_source": "cache",
            "data_as_of": "2026-05-20T00:00:00Z",
            "limitations": [],
            "stats": {"total": 1},
            "source_labels": [],
            "coverage_note": "",
        }

        response = get_storage_terminals(force_refresh=True)
        self.assertTrue(response.get("cached"))
        self.assertEqual(response["entities"][0]["company"], "Cached Terminal")

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

    def test_infer_terminal_subtype_fuel_depot(self):
        subtype, confidence, note = infer_terminal_subtype({"industrial": "fuel", "name": "Antwerp Depot"})
        self.assertEqual(subtype, "fuel_depot")
        self.assertGreaterEqual(confidence, 0.8)
        self.assertIn("fuel depot", note.lower())

    def test_infer_terminal_subtype_petroleum_storage_tank(self):
        subtype, confidence, note = infer_terminal_subtype(
            {
                "man_made": "storage_tank",
                "substance": "diesel",
                "operator": "Vopak",
            }
        )
        self.assertEqual(subtype, "storage_tank")
        self.assertGreaterEqual(confidence, 0.7)
        self.assertIn("storage tank", note.lower())

    def test_infer_terminal_subtype_rejects_fuel_only_storage_tank(self):
        subtype, confidence, _note = infer_terminal_subtype(
            {"man_made": "storage_tank", "substance": "fuel"},
        )
        self.assertEqual(subtype, "")
        self.assertEqual(confidence, 0.0)

    def test_infer_terminal_subtype_rejects_cooling_storage_tank(self):
        subtype, confidence, _note = infer_terminal_subtype(
            {
                "man_made": "storage_tank",
                "substance": "fuel",
                "description": "cooling water tank",
            },
        )
        self.assertEqual(subtype, "")
        self.assertEqual(confidence, 0.0)

    def test_infer_terminal_subtype_oil_silo(self):
        subtype, confidence, note = infer_terminal_subtype(
            {"man_made": "silo", "product": "soybean oil"}
        )
        self.assertEqual(subtype, "storage_tank")
        self.assertGreaterEqual(confidence, 0.55)

    def test_extract_operator_owner_prefers_explicit_tags(self):
        operator, owner = _extract_operator_owner(
            {"operator": "ADNOC", "owner": "Abu Dhabi"}
        )
        self.assertEqual(operator, "ADNOC")
        self.assertEqual(owner, "Abu Dhabi")

    def test_build_overpass_query_includes_broader_storage_tags(self):
        query = build_overpass_query((50.0, 3.0, 52.0, 5.0))
        self.assertIn('industrial"="fuel"', query)
        self.assertIn('man_made"="storage_tank"', query)
        self.assertIn('man_made"="silo"', query)
        self.assertIn('substance', query)
        self.assertIn('landuse"="industrial"', query)
        self.assertIn('industrial"="refinery"', query)
        self.assertIn('industrial"="oil"', query)

    def test_infer_terminal_subtype_adnoc_landuse_industrial(self):
        subtype, confidence, note = infer_terminal_subtype(
            {
                "landuse": "industrial",
                "name:en": "Abu Dhabi National Oil Company",
                "name": "Abu Dhabi National Oil Company",
            }
        )
        self.assertEqual(subtype, "storage_terminal")
        self.assertGreaterEqual(confidence, 0.68)
        self.assertIn("industrial landuse", note.lower())

    @patch("backend.services.storage_terminals.find_nearest_ports")
    @patch("backend.services.storage_terminals.resolve_country")
    def test_normalize_storage_terminal_adnoc_landuse_polygon(
        self,
        mock_resolve_country,
        mock_find_nearest_ports,
    ):
        mock_resolve_country.return_value = ("United Arab Emirates", "AE")
        mock_find_nearest_ports.return_value = []

        entity = normalize_storage_terminal(
            {
                "type": "way",
                "id": 217437068,
                "center": {"lat": 24.43, "lon": 54.51},
                "tags": {
                    "landuse": "industrial",
                    "name:en": "Abu Dhabi National Oil Company",
                    "name": "Abu Dhabi National Oil Company",
                    "operator": "ADNOC",
                },
            },
            "2026-06-03T00:00:00Z",
        )

        assert entity is not None
        self.assertEqual(entity["entitySubtype"], "storage_terminal")
        self.assertEqual(entity["company"], "Abu Dhabi National Oil Company")
        self.assertEqual(entity["operatorName"], "ADNOC")

    def test_enrich_orphan_tank_gets_site_context(self):
        site = {
            "id": "osm:way:217437068",
            "company": "Abu Dhabi National Oil Company",
            "entitySubtype": "storage_terminal",
            "country": "United Arab Emirates",
            "lat": 24.43,
            "lng": 54.51,
            "sourceRecordUrl": "https://www.openstreetmap.org/way/217437068",
            "confidenceNote": "Named industrial landuse polygon with petroleum identity in OSM tags.",
            "evidence": [],
        }
        orphan_tank = {
            "id": "osm:node:2265554182",
            "company": "Unnamed Storage Terminal",
            "entitySubtype": "storage_tank",
            "country": "United Arab Emirates",
            "lat": 24.431,
            "lng": 54.512,
            "confidenceNote": "Mapped petroleum storage tank; may be one tank within a larger site.",
            "evidence": [{"id": "osm:node:2265554182:facility"}],
        }

        enriched = _enrich_orphan_tanks_with_site_context([site, orphan_tank])
        tank = next(item for item in enriched if item["id"] == orphan_tank["id"])

        self.assertEqual(tank["company"], "Unnamed Storage Terminal")
        self.assertEqual(tank["siteContextName"], "Abu Dhabi National Oil Company")
        self.assertEqual(tank["siteContextSource"], "osm:way:217437068")
        self.assertTrue(tank["siteContextInferred"])
        self.assertIn("Inferred nearby site context", tank["confidenceNote"])
        self.assertEqual(tank["evidenceCount"], 2)

    def test_enrich_orphan_tank_inside_site_polygon_gets_operator(self):
        site = {
            "id": "osm:way:217437068",
            "company": "Abu Dhabi National Oil Company",
            "operatorName": "ADNOC",
            "entitySubtype": "storage_terminal",
            "country": "United Arab Emirates",
            "lat": 24.43,
            "lng": 54.51,
            "siteBounds": {"south": 24.42, "north": 24.44, "west": 54.49, "east": 54.53},
            "sourceRecordUrl": "https://www.openstreetmap.org/way/217437068",
            "evidence": [],
        }
        orphan_tank = {
            "id": "osm:node:2265554182",
            "company": "Unnamed Storage Terminal",
            "entitySubtype": "storage_tank",
            "country": "United Arab Emirates",
            "lat": 24.431,
            "lng": 54.512,
            "evidence": [{"id": "osm:node:2265554182:facility"}],
        }

        enriched = _enrich_orphan_tanks_with_site_context([site, orphan_tank])
        tank = next(item for item in enriched if item["id"] == orphan_tank["id"])

        self.assertEqual(tank["operatorName"], "ADNOC")
        self.assertEqual(tank["siteContextName"], "Abu Dhabi National Oil Company")
        self.assertFalse(tank["siteContextInferred"])
        self.assertIn("site polygon", tank["confidenceNote"].lower())

    def test_geojson_polygon_centroid_and_bounds(self):
        lat, lng, bounds = _geojson_centroid_and_bounds(
            {
                "type": "Polygon",
                "coordinates": [[[54.49, 24.42], [54.53, 24.42], [54.53, 24.44], [54.49, 24.44], [54.49, 24.42]]],
            }
        )
        self.assertAlmostEqual(lat, 24.43, places=2)
        self.assertAlmostEqual(lng, 54.51, places=2)
        assert bounds is not None
        self.assertEqual(bounds["south"], 24.42)

    def test_element_from_db_row_preserves_site_bounds(self):
        element = _element_from_db_row(
            "way",
            217437068,
            {"landuse": "industrial", "operator": "ADNOC"},
            {"type": "Polygon", "coordinates": []},
            lat=24.43,
            lng=54.51,
            bounds={"south": 24.42, "north": 24.44, "west": 54.49, "east": 54.53},
        )
        assert element is not None
        self.assertIn("siteBounds", element)

    def test_build_overpass_query_includes_expanded_industrial_patterns(self):
        query = build_overpass_query(WORLD_TILES[0][1])
        self.assertIn('industrial"="petrochemical"', query)
        self.assertIn('man_made"="works"', query)
        self.assertIn('landuse"="industrial"]["owner"', query)

    def test_db_snapshot_rejects_regional_only_cache(self):
        regional = [
            {"lat": 51.9, "lon": 4.4},
            {"lat": 51.95, "lon": 4.45},
        ]
        self.assertFalse(_db_snapshot_is_globally_complete(regional))

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
            include_nearby_port=True,
        )

        assert entity is not None
        self.assertEqual(entity["entityKind"], "storage_terminal")
        self.assertEqual(entity["entitySubtype"], "storage_terminal")
        self.assertEqual(entity["company"], "Ruwais Oil Terminal")
        self.assertEqual(entity["country"], "United Arab Emirates")
        self.assertEqual(entity["operatorName"], "ADNOC")
        self.assertIsNone(entity.get("ownerName"))
        self.assertEqual(entity["sourceName"], "OpenStreetMap via Overpass")
        self.assertEqual(entity["nearbyPort"]["name"], "Ruwais")
        self.assertIn("OpenStreetMap", entity["sourceLabels"])
        self.assertIn("petroleum", entity["commodityHints"])
        self.assertEqual(entity["evidenceCount"], 2)

    @patch("backend.services.storage_terminals.find_nearest_ports")
    @patch("backend.services.storage_terminals.resolve_country")
    def test_normalize_storage_terminal_uses_owner_when_operator_missing(
        self,
        mock_resolve_country,
        mock_find_nearest_ports,
    ):
        mock_resolve_country.return_value = ("Netherlands", "NL")
        mock_find_nearest_ports.return_value = []

        entity = normalize_storage_terminal(
            {
                "type": "node",
                "id": 99,
                "lat": 51.9,
                "lon": 4.4,
                "tags": {
                    "man_made": "storage_tank",
                    "substance": "diesel",
                    "owner": "Vopak",
                },
            },
            "2026-05-12T21:00:00Z",
        )

        assert entity is not None
        self.assertEqual(entity["entitySubtype"], "storage_tank")
        self.assertIsNone(entity["operatorName"])
        self.assertEqual(entity["ownerName"], "Vopak")
        self.assertEqual(entity["company"], "Vopak")

    def test_parse_storage_terminal_osm_id(self):
        self.assertEqual(_parse_storage_terminal_osm_id("osm:node:4242"), ("node", 4242))
        self.assertIsNone(_parse_storage_terminal_osm_id("curated_storage_rotterdam_netherlands"))
        self.assertIsNone(_parse_storage_terminal_osm_id("osm:invalid:id"))

    @patch("backend.services.storage_terminals._enrich_orphan_tanks_with_site_context", side_effect=lambda rows: rows)
    @patch("backend.services.storage_terminals_seed.enrich_osm_from_reference_hubs")
    @patch("backend.services.storage_terminals_seed.load_curated_storage_terminals")
    def test_enrich_storage_entity_for_detail_applies_curated_hub(
        self,
        mock_load_curated,
        mock_enrich_hubs,
        _mock_site_context,
    ):
        sparse = {
            "id": "osm:node:99",
            "lat": 25.0,
            "lng": 55.0,
            "company": "Unnamed Storage Terminal",
            "operatorName": None,
            "capacityText": None,
            "confidenceScore": 0.6,
        }
        hub = {
            "id": "curated_storage_fujairah_uae",
            "sourceKind": "curated_reference",
            "lat": 25.01,
            "lng": 55.01,
            "operatorName": "Vopak",
            "capacityText": "~2M bbl (public reference)",
        }
        mock_load_curated.return_value = [hub]
        mock_enrich_hubs.return_value = [
            {
                **sparse,
                "operatorName": "Vopak",
                "capacityText": "2M bbl",
                "curatedEnrichmentSourceId": hub["id"],
                "referenceEnrichmentKind": "curated_reference",
            }
        ]

        enriched = _enrich_storage_entity_for_detail(sparse, "2026-06-04T00:00:00Z")
        self.assertEqual(enriched["operatorName"], "Vopak")
        self.assertEqual(enriched["curatedEnrichmentSourceId"], hub["id"])

    @patch("backend.services.storage_terminals._enrich_storage_entity_for_detail")
    @patch("backend.services.storage_terminals._load_storage_terminal_element_from_db")
    @patch("backend.services.storage_terminals._fresh_cache", return_value=None)
    @patch("backend.services.storage_terminals.get_storage_terminals")
    def test_get_storage_terminal_details_loads_from_db_when_not_cached(
        self,
        _mock_list,
        _mock_cache,
        mock_load_db,
        mock_enrich_detail,
    ):
        element = {
            "type": "node",
            "id": 777,
            "lat": 51.9,
            "lon": 4.4,
            "tags": {"industrial": "petroleum_terminal", "name": "Test Terminal", "operator": "Shell"},
        }
        mock_load_db.return_value = (element, "2026-06-04T12:00:00Z")
        normalized = normalize_storage_terminal(element, "2026-06-04T12:00:00Z", include_nearby_port=True)
        assert normalized is not None
        mock_enrich_detail.return_value = {**normalized, "operatorName": "Shell Enriched"}

        from backend.services import storage_terminals as module

        module._storage_cache["loaded_at"] = 0.0
        module._storage_cache["response"] = None

        with (
            patch("backend.services.storage_terminal_display.storage_display_read_enabled", return_value=False),
            patch("backend.services.storage_terminal_display.STORAGE_DISPLAY_WRITE_THROUGH", False),
        ):
            result = get_storage_terminal_details("osm:node:777")
        self.assertIsNotNone(result)
        self.assertEqual(result["operatorName"], "Shell Enriched")
        self.assertIn("evidence", result)
        self.assertIn("rawPayload", result)
        mock_load_db.assert_called_once_with("osm:node:777")
        mock_enrich_detail.assert_called_once()


if __name__ == "__main__":
    unittest.main()
