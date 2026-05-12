import unittest
from datetime import datetime

from backend.services.ingest.open_data_sync import (
    OPEN_DATA_SOURCES,
    _normalize_date,
    arcgis_geometry_centroid,
    normalize_feature,
)


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


if __name__ == "__main__":
    unittest.main()
