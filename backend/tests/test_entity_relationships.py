import json
import unittest

from backend.services.entity_relationships import build_license_relationship_candidates
from backend.services.maritime_intel import build_maritime_relationships


class EntityRelationshipTests(unittest.TestCase):
    def test_build_license_relationship_candidates_parses_percentages_and_operator(self):
        relationships = build_license_relationship_candidates(
            {
                "id": "kenya:test-1",
                "company": "Company A",
                "record_origin": "open_data",
                "source_name": "Kenya Mining Cadastre Portal",
                "source_url": "https://example.com/source",
                "source_record_url": "https://example.com/source?record=1",
                "raw_payload": json.dumps(
                    {
                        "Parties": "Company A (60%); Company B (40%)",
                        "operator": "Company A / Company B JV",
                    }
                ),
            }
        )

        role_pairs = {(item["relationship_type"], item["target_name"]) for item in relationships}
        self.assertIn(("license_holder", "Company A"), role_pairs)
        self.assertIn(("license_holder", "Company B"), role_pairs)
        self.assertIn(("operator", "Company A / Company B JV"), role_pairs)

        pct_map = {
            item["target_name"]: item["ownership_pct"]
            for item in relationships
            if item["relationship_type"] == "license_holder"
        }
        self.assertEqual(pct_map["Company A"], 60.0)
        self.assertEqual(pct_map["Company B"], 40.0)

    def test_build_license_relationship_candidates_uses_company_field_for_csv_fallback(self):
        relationships = build_license_relationship_candidates(
            {
                "id": "user_csv:licenses_export:15814",
                "company": "Engineers & Planners Ghana Limited",
                "record_origin": "user_import_csv",
                "source_name": "User-provided CSV fallback (licenses_export.csv)",
                "raw_payload": json.dumps(
                    {
                        "company": "Engineers & Planners Ghana Limited",
                        "license_type": "Support Service (Class A)",
                    }
                ),
            }
        )

        self.assertEqual(len(relationships), 1)
        self.assertEqual(relationships[0]["relationship_type"], "license_holder")
        self.assertEqual(relationships[0]["target_name"], "Engineers & Planners Ghana Limited")
        self.assertEqual(relationships[0]["extracted_from"], "company")

    def test_build_maritime_relationships_keeps_owner_and_operator_separate(self):
        relationships = build_maritime_relationships(
            identity={
                "owner": "Fleet Owner Ltd",
                "operator": "A/B Marine Operators",
                "confidence": 0.66,
                "matched_by": "imo",
                "flag": "Panama",
                "registry_port": "Monrovia",
                "source_label": "Wikidata",
                "source_url": "https://query.wikidata.org/",
            },
            vessel_name="MT Example",
            imo="9123456",
            mmsi="",
        )

        self.assertEqual(
            [(item["relationship_type"], item["target_name"]) for item in relationships],
            [("owner", "Fleet Owner Ltd"), ("operator", "A/B Marine Operators")],
        )


if __name__ == "__main__":
    unittest.main()
