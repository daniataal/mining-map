import unittest
from unittest.mock import patch

from backend.services.storage_terminals_gov_seed import (
    enrich_osm_from_government_reference,
    load_government_storage_reference_hubs,
)


class StorageTerminalsGovSeedTests(unittest.TestCase):
    def test_load_government_storage_reference_hubs(self):
        hubs = load_government_storage_reference_hubs("2026-06-03T00:00:00Z")
        self.assertGreaterEqual(len(hubs), 15)
        self.assertTrue(all(hub.get("sourceKind") == "government_open" for hub in hubs))
        names = {hub.get("company") for hub in hubs}
        self.assertIn("Cushing OK Crude Oil Hub (EIA PADD 2)", names)
        self.assertIn("Bryan Mound SPR Site (DOE)", names)

    def test_enrich_osm_from_government_reference_fills_sparse_us_node(self):
        hubs = load_government_storage_reference_hubs("2026-06-03T00:00:00Z")
        cushing = next(h for h in hubs if "Cushing" in str(h.get("company")))
        sparse_osm = {
            "id": "osm:node:555",
            "company": "Unnamed Storage Terminal",
            "lat": 35.986,
            "lng": -96.77,
            "country": "Unknown",
            "confidenceScore": 0.55,
        }
        enriched = enrich_osm_from_government_reference([sparse_osm], [cushing])
        osm = enriched[0]
        self.assertTrue(osm.get("operatorName"))
        self.assertIn("United States", str(osm.get("country")))
        self.assertEqual(osm.get("referenceEnrichmentKind"), "government_open")

    def test_eia_overlay_updates_padd_hub_capacity(self):
        try:
            from backend.services.eia_imports import write_eia_padd_storage_cache
        except ImportError:
            from services.eia_imports import write_eia_padd_storage_cache  # type: ignore
        from backend.services import eia_imports as eia_mod

        cache_path = eia_mod.REPO_ROOT / "data" / "cache" / "eia_padd_storage_test_overlay.json"
        with patch.object(eia_mod, "EIA_PADD_STORAGE_CACHE_PATH", cache_path):
            write_eia_padd_storage_cache(
                {
                    "PADD2": {
                        "padd": "PADD2",
                        "series_id": "WCRSTP21",
                        "stocks_million_bbl": 118.7,
                        "period": "2026-05-23",
                    }
                },
                fetched_at="2026-05-23T00:00:00Z",
            )
            hubs = load_government_storage_reference_hubs("2026-06-03T00:00:00Z")
        cushing = next(h for h in hubs if h.get("eiaPadd") == "PADD2")
        self.assertIn("118.7 million bbl", str(cushing.get("capacityText")))
        self.assertIn("EIA live storage", cushing.get("sourceLabels") or [])
        cache_path.unlink(missing_ok=True)


if __name__ == "__main__":
    unittest.main()
