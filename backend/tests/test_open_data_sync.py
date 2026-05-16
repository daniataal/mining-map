import unittest
from datetime import datetime

from backend.services.ingest.open_data_sync import (
    OPEN_DATA_SOURCES,
    _build_syncable_source_coverage,
    _build_syncable_africa_coverage,
    _normalize_date,
    AFRICA_COVERAGE_OVERRIDES,
    arcgis_geometry_centroid,
    get_source_registry_index,
    infer_world_macro_region,
    normalize_feature,
)
from backend.services.ingest.csv_fallback_import import normalize_csv_row


class OpenDataSyncTests(unittest.TestCase):
    def test_arcgis_geometry_centroid_polygon(self):
        lat, lng = arcgis_geometry_centroid(
            {
                "rings": [
                    [
                        [10.0, 20.0],
                        [14.0, 20.0],
                        [14.0, 24.0],
                        [10.0, 24.0],
                        [10.0, 20.0],
                    ]
                ]
            }
        )
        self.assertAlmostEqual(lat, 21.6)
        self.assertAlmostEqual(lng, 11.6)

    def test_normalize_date_handles_epoch_millis(self):
        result = _normalize_date(1661990400000)
        self.assertEqual(result, datetime(2022, 9, 1, 0, 0))

    def test_normalize_feature_keeps_provenance(self):
        kenya_source = next(source for source in OPEN_DATA_SOURCES if source.source_id == "kenya_mining_cadastre")
        record = normalize_feature(
            kenya_source,
            {
                "attributes": {
                    "guidShape": "shape-123",
                    "Code": "PL/2018/0188",
                    "Parties": "Joseph Kamau Mbiriri (100%)",
                    "Type": "Prospecting Licence",
                    "Status": "Pending Technical Committee Review",
                    "Commodities": "Gemstones except diamond, Non precious mineral",
                    "DteGranted": 891388800000,
                },
                "geometry": {
                    "rings": [
                        [
                            [36.0, -1.0],
                            [37.0, -1.0],
                            [37.0, 0.0],
                            [36.0, 0.0],
                            [36.0, -1.0],
                        ]
                    ]
                },
            },
        )

        self.assertEqual(record["id"], "kenya_mining_cadastre:shape-123")
        self.assertEqual(record["country"], "Kenya")
        self.assertEqual(record["sector"], "mining")
        self.assertEqual(record["record_origin"], "open_data")
        self.assertEqual(record["source_name"], "Kenya Mining Cadastre Portal")
        self.assertEqual(record["license_type"], "Prospecting Licence")
        self.assertIn("Gemstones", record["commodity"])
        self.assertIsNotNone(record["raw_payload"])
        self.assertAlmostEqual(record["lat"], -0.6)
        self.assertAlmostEqual(record["lng"], 36.4)

    def test_syncable_africa_coverage_includes_zambia_and_south_africa(self):
        coverage = _build_syncable_africa_coverage()
        self.assertEqual(coverage[("Kenya", "mining")]["status"], "official_syncable")
        self.assertEqual(coverage[("Zambia", "mining")]["status"], "official_syncable")
        self.assertEqual(coverage[("Zambia", "oil_and_gas")]["status"], "official_syncable")
        self.assertEqual(coverage[("South Africa", "oil_and_gas")]["status"], "official_syncable")

    def test_syncable_world_coverage_includes_new_world_sources(self):
        coverage = _build_syncable_source_coverage()
        self.assertEqual(coverage[("New Zealand", "oil_and_gas")]["status"], "official_syncable")
        self.assertEqual(coverage[("Canada", "mining")]["status"], "official_syncable")
        self.assertEqual(coverage[("Canada", "oil_and_gas")]["status"], "official_syncable")
        self.assertEqual(coverage[("Norway", "oil_and_gas")]["status"], "official_syncable")
        self.assertEqual(coverage[("Finland", "mining")]["status"], "official_syncable")
        self.assertEqual(coverage[("Australia", "mining")]["status"], "official_syncable")

    def test_infer_world_macro_region_buckets(self):
        self.assertEqual(infer_world_macro_region("Norway"), "europe")
        self.assertEqual(infer_world_macro_region("Saudi Arabia"), "middle_east")
        self.assertEqual(infer_world_macro_region("Japan"), "asia_pacific")
        self.assertEqual(infer_world_macro_region("Kenya"), "africa")
        self.assertEqual(infer_world_macro_region("Global"), "other")

    def test_overrides_mark_restricted_and_portal_only_countries(self):
        self.assertEqual(
            AFRICA_COVERAGE_OVERRIDES["Namibia"]["mining"]["status"],
            "official_api_restricted",
        )
        self.assertEqual(
            AFRICA_COVERAGE_OVERRIDES["Ghana"]["mining"]["status"],
            "official_portal_only",
        )

    def test_normalize_csv_row_marks_user_import_provenance(self):
        record = normalize_csv_row(
            {
                "id": "15814",
                "company": "420 ORGANIK",
                "license_type": "MINE OPENCAST",
                "commodity": "DIAMONDS ALLUVIAL",
                "status": "Operating",
                "date_issued": "",
                "country": "South Africa",
                "region": "VENTERSDORP NORTH-WEST",
                "lat": "-26.3167",
                "lng": "26.8167",
                "matched_location": "",
                "phone_number": "",
                "contact_person": "",
            },
            "user_csv:licenses_export",
            "User-provided CSV fallback (licenses_export.csv)",
        )

        assert record is not None
        self.assertEqual(record["id"], "user_csv:licenses_export:15814")
        self.assertEqual(record["country"], "South Africa")
        self.assertEqual(record["sector"], "mining")
        self.assertEqual(record["record_origin"], "user_import_csv")
        self.assertEqual(record["source_id"], "user_csv:licenses_export")
        self.assertEqual(record["source_name"], "User-provided CSV fallback (licenses_export.csv)")
        self.assertAlmostEqual(record["lat"], -26.3167)
        self.assertAlmostEqual(record["lng"], 26.8167)

    def test_normalize_csv_row_accepts_main_commodity_header(self):
        record = normalize_csv_row(
            {
                "id": "42",
                "company": "Atlas Mixed Metals",
                "license_type": "Exploration",
                "main commodity": "Copper; Silver",
                "status": "Imported",
                "country": "Ghana",
                "region": "Ashanti",
                "lat": "6.70",
                "lng": "-1.62",
            },
            "user_csv:mixed_metals",
            "User-provided CSV fallback (mixed.csv)",
        )

        assert record is not None
        self.assertEqual(record["commodity"], "Copper; Silver")
        self.assertEqual(record["sector"], "mining")

    def test_normalize_feature_supports_global_fallback_country_and_record_url(self):
        mrds_source = next(source for source in OPEN_DATA_SOURCES if source.source_id == "usgs_mrds_global")
        record = normalize_feature(
            mrds_source,
            {
                "attributes": {
                    "DEP_ID": "12345",
                    "SITE_NAME": "Example Prospect",
                    "COUNTRY": "Peru",
                    "DEV_STAT": "Prospect",
                    "CODE_LIST": "CU,AU",
                    "URL": "https://mrdata.usgs.gov/mrds/record/12345",
                },
                "geometry": {"x": -76.2, "y": -12.1},
            },
        )

        self.assertEqual(record["country"], "Peru")
        self.assertEqual(record["record_origin"], "global_open_fallback")
        self.assertEqual(record["source_record_url"], "https://mrdata.usgs.gov/mrds/record/12345")
        self.assertEqual(record["license_type"], "Mine / occurrence")
        self.assertEqual(record["status"], "Prospect")
        self.assertIn("CU", record["commodity"])

    def test_source_registry_marks_official_and_fallback_sources(self):
        registry = get_source_registry_index()
        self.assertEqual(registry["british_columbia_mineral_tenure"]["source_kind"], "official_registry")
        self.assertEqual(registry["british_columbia_mineral_tenure"]["coverage_state"], "official_syncable")
        self.assertEqual(registry["usgs_mrds_global"]["source_kind"], "global_open_fallback")
        self.assertEqual(registry["usgs_mrds_global"]["coverage_state"], "global_fallback_only")


if __name__ == "__main__":
    unittest.main()
