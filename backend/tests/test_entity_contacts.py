import unittest

from backend.services.entity_contacts import build_license_contact_candidates


class EntityContactExtractionTests(unittest.TestCase):
    def test_extracts_source_backed_public_contacts(self):
        row = {
            "id": "kenya_mining_cadastre:shape-123",
            "record_origin": "open_data",
            "source_name": "Kenya Mining Cadastre Portal",
            "source_url": "https://portal.miningcadastre.go.ke/arcgis/rest/services/example",
            "source_record_url": "https://portal.miningcadastre.go.ke/arcgis/rest/services/example?record=shape-123",
            "source_updated_at": "2026-05-12T10:00:00",
            "phone_number": "+254 20 555 0101",
            "raw_payload": {
                "contact_phone": "+254 20 555 0101",
                "contact_email": "permits@example.go.ke",
                "contact:website": "cadastre.example.go.ke",
                "registered_address": "Mining House, Nairobi",
            },
        }

        contacts = build_license_contact_candidates(row)

        self.assertEqual(
            [contact["contact_type"] for contact in contacts],
            ["phone", "email", "website", "address"],
        )
        self.assertEqual(contacts[0]["source_type"], "official_open_data")
        self.assertEqual(contacts[0]["source_name"], "Kenya Mining Cadastre Portal")
        self.assertEqual(contacts[0]["source_url"], row["source_record_url"])
        self.assertIn(contacts[0]["extracted_from"], {"licenses.phone_number", "contact_phone"})
        self.assertEqual(contacts[1]["value"], "permits@example.go.ke")
        self.assertEqual(contacts[2]["value"], "cadastre.example.go.ke")
        self.assertEqual(contacts[3]["value"], "Mining House, Nairobi")

    def test_skips_unprovenanced_contacts(self):
        row = {
            "id": "manual-row-1",
            "record_origin": "manual",
            "source_name": None,
            "source_url": None,
            "source_record_url": None,
            "phone_number": "+1 202 555 0188",
            "raw_payload": {"contact_email": "ops@example.com"},
        }

        self.assertEqual(build_license_contact_candidates(row), [])

    def test_syncs_license_phone_number_column(self):
        row = {
            "id": "lic-phone-only",
            "record_origin": "open_data",
            "source_name": "National Mining Registry",
            "source_url": "https://registry.example.gov/license/lic-phone-only",
            "phone_number": "+1 202 555 0199",
            "raw_payload": {},
        }

        contacts = build_license_contact_candidates(row)

        self.assertEqual(len(contacts), 1)
        self.assertEqual(contacts[0]["contact_type"], "phone")
        self.assertEqual(contacts[0]["value"], "+1 202 555 0199")
        self.assertEqual(contacts[0]["extracted_from"], "licenses.phone_number")
        self.assertEqual(contacts[0]["source_type"], "official_open_data")

    def test_splits_multivalue_fields(self):
        row = {
            "id": "port-node-1",
            "record_origin": "open_data",
            "source_name": "Official Port Directory",
            "source_url": "https://example.gov/ports/1",
            "source_record_url": "https://example.gov/ports/1",
            "raw_payload": {
                "contact_phone": "+233 30 000 0001; +233 30 000 0002",
                "contact_email": "ops@example.org; logistics@example.org",
            },
        }

        contacts = build_license_contact_candidates(row)

        self.assertEqual(
            [contact["value"] for contact in contacts if contact["contact_type"] == "phone"],
            ["+233 30 000 0001", "+233 30 000 0002"],
        )
        self.assertEqual(
            [contact["value"] for contact in contacts if contact["contact_type"] == "email"],
            ["logistics@example.org", "ops@example.org"],
        )


if __name__ == "__main__":
    unittest.main()
