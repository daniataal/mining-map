import unittest
from unittest import mock

from backend.services.port_authority_directory import (
    get_directory_by_locode,
    anchor_port_authority_hubs_to_osm,
    list_directory_coverage,
    load_port_directories,
    port_authority_linked_hub_ids,
    sync_port_authority_tenants_to_companies,
    _normalize_company_name,
)


class PortAuthorityDirectoryTests(unittest.TestCase):
    def test_load_port_directories_has_fujairah(self):
        payload = load_port_directories()
        locodes = [str(p.get("locode")).upper() for p in payload.get("ports") or []]
        self.assertIn("AEFJR", locodes)
        self.assertIn("NLRTM", locodes)

    def test_get_directory_by_locode_fujairah(self):
        directory = get_directory_by_locode("AEFJR")
        assert directory is not None
        self.assertEqual(directory["locode"], "AEFJR")
        self.assertEqual(directory["port_name"], "Fujairah")
        self.assertIn("disclaimer", directory)
        self.assertGreaterEqual(directory["stats"]["total_tenants"], 20)
        names = {t["name"] for t in directory["tenants"]}
        self.assertIn("VTTI", names)
        self.assertIn("VOPAK", names)
        self.assertIn("FOIZ", names)
        foiz = next(t for t in directory["tenants"] if t["name"] == "FOIZ")
        self.assertTrue(foiz.get("capacity_text"))
        self.assertTrue(foiz.get("curated_storage_external_id"))
        by_cat = directory["stats"]["tenant_count_by_category"]
        self.assertGreater(by_cat.get("tank_storage_and_refineries", 0), 5)
        self.assertGreater(by_cat.get("shipping_agents", 0), 5)

    def test_get_directory_by_locode_missing(self):
        self.assertIsNone(get_directory_by_locode("XXZZZ"))

    def test_list_directory_coverage(self):
        coverage = list_directory_coverage()
        self.assertGreaterEqual(coverage["port_count"], 6)
        self.assertTrue(any(p["locode"] == "AEFJR" for p in coverage["ports"]))

    def test_normalize_company_name(self):
        self.assertEqual(_normalize_company_name("Vopak  B.V."), "vopak b v")

    def test_anchor_port_authority_enriches_nearby_osm(self):
        linked = port_authority_linked_hub_ids()
        self.assertIn("curated_storage_vtti_fujairah_united_arab_emirates", linked)
        osm_tanks = [
            {
                "id": f"osm:node:99900{i}",
                "company": "Unnamed Storage Tank",
                "lat": 25.18 + i * 0.001,
                "lng": 56.34 + i * 0.002,
                "entityKind": "storage_terminal",
                "entitySubtype": "storage_tank",
                "sourceKind": "open_data",
                "confidenceScore": 0.55,
            }
            for i in range(30)
        ]
        anchored = anchor_port_authority_hubs_to_osm(osm_tanks, "2026-06-04T00:00:00+00:00")
        operators = {e.get("operatorName") for e in anchored if e.get("operatorName")}
        self.assertGreater(len(operators), 1, f"expected multiple FOIZ operators, got {operators}")
        self.assertTrue(any(e.get("portAuthorityLocode") == "AEFJR" for e in anchored))

    def test_sync_port_authority_tenants_to_companies(self):
        class FakeCursor:
            def __init__(self):
                self.calls = 0

            def execute(self, *args, **kwargs):
                self.calls += 1

            def fetchone(self):
                return (None,)

        cur = FakeCursor()
        with mock.patch(
            "backend.services.oil_live_graph_sync._upsert_company",
            return_value="company-uuid",
        ) as mock_upsert:
            result = sync_port_authority_tenants_to_companies(cur)
        self.assertGreater(result["port_authority_tenants_indexed"], 10)
        self.assertGreater(mock_upsert.call_count, 10)


if __name__ == "__main__":
    unittest.main()
