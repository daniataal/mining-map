import unittest

from backend.services.trade_manifest_ingest import validate_manifest_csv_headers


class BrazilManifestHeaderTests(unittest.TestCase):
    def test_valid_brazil_headers(self):
        out = validate_manifest_csv_headers(
            ["importer_name", "exporter_name", "hs_code", "year"],
            data_source="brazil_comex_open",
        )
        self.assertTrue(out["valid"])
        self.assertIn("hs_code", out["headers"])

    def test_reject_without_party(self):
        out = validate_manifest_csv_headers(
            ["hs_code", "year", "port_name"],
            data_source="brazil_comex_open",
        )
        self.assertFalse(out["valid"])
        self.assertIn("importer", out.get("reason", "").lower())


if __name__ == "__main__":
    unittest.main()
