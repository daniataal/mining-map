import unittest

from backend.services.storage_terminals_oil_db import (
    normalize_oil_terminal_reference_row,
)
from backend.services.storage_terminals_seed import (
    enrich_osm_from_oil_terminal_reference,
    enrich_osm_from_reference_hubs,
)


class StorageTerminalsOilDbTests(unittest.TestCase):
    def test_normalize_oil_terminal_reference_row(self):
        hub = normalize_oil_terminal_reference_row(
            {
                "id": "11111111-1111-1111-1111-111111111111",
                "name": "Rotterdam Europoort Tank Storage",
                "terminal_type": "storage_terminal",
                "operator_name": "Vopak",
                "owner_name": "Shell",
                "country": "Netherlands",
                "city": "Rotterdam",
                "products": ["crude oil", "refined products"],
                "source": "osm_storage_import",
                "source_url": "https://www.vopak.com/",
                "confidence": 0.72,
                "lat": 51.905,
                "lng": 4.325,
                "metadata": {"capacity": "~2 million m³"},
            }
        )
        self.assertIsNotNone(hub)
        assert hub is not None
        self.assertEqual(hub["sourceKind"], "oil_terminal_reference")
        self.assertEqual(hub["operatorName"], "Vopak")
        self.assertEqual(hub["capacityText"], "~2 million m³")
        self.assertTrue(hub["id"].startswith("oil_terminal:"))

    def test_enrich_osm_from_oil_terminal_reference_fills_gaps(self):
        sparse_osm = {
            "id": "osm:node:42",
            "company": "Unnamed Storage Terminal",
            "lat": 51.906,
            "lng": 4.326,
            "country": "Unknown",
            "confidenceScore": 0.55,
        }
        oil_hub = normalize_oil_terminal_reference_row(
            {
                "id": "22222222-2222-2222-2222-222222222222",
                "name": "Rotterdam Europoort Tank Storage",
                "terminal_type": "storage_terminal",
                "operator_name": "Vopak",
                "country": "Netherlands",
                "city": "Rotterdam",
                "products": ["crude oil"],
                "source": "osm_storage_import",
                "confidence": 0.7,
                "lat": 51.905,
                "lng": 4.325,
                "metadata": {},
            }
        )
        assert oil_hub is not None
        enriched = enrich_osm_from_oil_terminal_reference([sparse_osm], [oil_hub])
        osm = enriched[0]
        self.assertEqual(osm["operatorName"], "Vopak")
        self.assertEqual(osm["country"], "Netherlands")
        self.assertEqual(osm["referenceEnrichmentKind"], "oil_terminal_reference")

    def test_curated_enrichment_takes_precedence_metadata(self):
        sparse_osm = {
            "id": "osm:node:7",
            "company": "Unnamed Storage Terminal",
            "lat": 24.4284,
            "lng": 54.5072,
            "country": "Unknown",
            "confidenceScore": 0.58,
        }
        curated = {
            "id": "curated_storage_adnoc",
            "company": "ADNOC Sas Al Nakhl / Umm Al Nar Storage Hub",
            "operatorName": "ADNOC",
            "country": "United Arab Emirates",
            "lat": 24.43,
            "lng": 54.51,
            "sourceKind": "curated_reference",
        }
        oil_hub = normalize_oil_terminal_reference_row(
            {
                "id": "33333333-3333-3333-3333-333333333333",
                "name": "Other UAE Terminal",
                "terminal_type": "storage_terminal",
                "operator_name": "Other Operator",
                "country": "United Arab Emirates",
                "products": ["crude oil"],
                "source": "osm_storage_import",
                "confidence": 0.6,
                "lat": 24.429,
                "lng": 54.508,
                "metadata": {},
            }
        )
        assert oil_hub is not None
        after_curated = enrich_osm_from_reference_hubs(
            [sparse_osm],
            [curated],
            enrichment_kind="curated_reference",
            source_label="Curated reference",
            evidence_type="curated_enrichment",
            summary_prefix="Curated",
        )
        after_oil = enrich_osm_from_oil_terminal_reference(after_curated, [oil_hub])
        osm = after_oil[0]
        self.assertEqual(osm["operatorName"], "ADNOC")
        self.assertEqual(osm["curatedEnrichmentSourceId"], "curated_storage_adnoc")
        self.assertEqual(osm["referenceEnrichmentKind"], "curated_reference")


if __name__ == "__main__":
    unittest.main()
