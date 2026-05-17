"""Unit tests for U.S. federal procurement (USAspending) intelligence."""

from __future__ import annotations

import unittest
from datetime import date, timedelta

from backend.services.gov_procurement_intel import (
    build_procurement_summary,
    build_usaspending_search_payload,
    collect_gov_procurement,
    fetch_usaspending_awards,
    infer_commodity_and_category,
    normalize_usaspending_row,
    serialize_gov_procurement_response,
)


class InferCommodityTests(unittest.TestCase):
    def test_gold_naics(self):
        commodity, category = infer_commodity_and_category(naics="212221")
        self.assertEqual(commodity, "Gold")
        self.assertEqual(category, "precious")

    def test_oil_description(self):
        commodity, category = infer_commodity_and_category(
            description="Strategic Petroleum Reserve crude replenishment"
        )
        self.assertEqual(commodity, "Oil")
        self.assertEqual(category, "fuels")

    def test_manganese_keyword(self):
        commodity, category = infer_commodity_and_category(
            description="Metallurgical grade manganese stockpiling"
        )
        self.assertEqual(commodity, "Manganese")
        self.assertEqual(category, "strategic")


class NormalizeRowTests(unittest.TestCase):
    def test_maps_core_fields(self):
        row = normalize_usaspending_row(
            {
                "Award ID": "ABC-123",
                "Description": "Gold ore refining services",
                "Award Amount": 1_500_000,
                "Awarding Agency": "Department of Energy",
                "Funding Agency": "Department of Energy",
                "Start Date": "2024-01-15",
                "End Date": (date.today() + timedelta(days=400)).isoformat(),
                "Recipient Name": "ACME Mining LLC",
                "Recipient UEI": "UEI123",
                "Recipient DUNS Number": "123456789",
                "NAICS": "212221",
                "generated_internal_id": "CONT_AWS_123",
            },
            recipient_name="ACME Mining LLC",
        )
        self.assertEqual(row["award_id"], "ABC-123")
        self.assertEqual(row["commodity"], "Gold")
        self.assertEqual(row["category"], "precious")
        self.assertEqual(row["status"], "ACTIVE")
        self.assertEqual(row["uei"], "UEI123")
        self.assertIn("usaspending.gov/award/", row["source_url"] or "")


class SummaryTests(unittest.TestCase):
    def test_portfolio_percentages(self):
        awards = [
            {"value_usd": 60, "category": "precious", "agency": "DOE", "status": "ACTIVE"},
            {"value_usd": 40, "category": "fuels", "agency": "DLA", "status": "COMPLETED"},
        ]
        summary = build_procurement_summary(awards)
        self.assertEqual(summary["total_awarded_usd"], 100.0)
        self.assertEqual(summary["active_contract_count"], 1)
        self.assertEqual(summary["portfolio_by_category_pct"]["precious"], 60.0)
        self.assertEqual(summary["portfolio_by_category_pct"]["fuels"], 40.0)


class PayloadTests(unittest.TestCase):
    def test_search_payload_includes_recipient_and_period(self):
        from backend.services.gov_procurement_intel import CONTRACT_AWARD_FIELDS

        payload = build_usaspending_search_payload(
            "ACME Mining",
            award_type_codes=["A", "B", "C", "D"],
            fields=CONTRACT_AWARD_FIELDS,
            limit=25,
        )
        self.assertEqual(payload["filters"]["recipient_search_text"], ["ACME Mining"])
        self.assertEqual(payload["filters"]["award_type_codes"], ["A", "B", "C", "D"])
        self.assertEqual(payload["limit"], 25)
        self.assertIn("Award Amount", payload["fields"])


class FetchTests(unittest.TestCase):
    def test_http_post_mock(self):
        def fake_post(url, payload, *, timeout):
            self.assertIn("spending_by_award", url)
            self.assertEqual(payload["filters"]["recipient_search_text"], ["ACME Mining"])
            if payload["filters"]["award_type_codes"] == ["A", "B", "C", "D"]:
                return {
                    "results": [
                        {
                            "Award ID": "X1",
                            "Description": "Silver supply contract",
                            "Award Amount": 500000,
                            "Awarding Agency": "Treasury",
                            "NAICS": "212222",
                        }
                    ]
                }
            return {"results": []}

        awards, warnings = fetch_usaspending_awards("ACME Mining", http_post=fake_post)
        self.assertEqual(len(awards), 1)
        self.assertEqual(awards[0]["commodity"], "Silver")
        self.assertEqual(warnings, [])

    def test_empty_company_short_circuits(self):
        awards, warnings = fetch_usaspending_awards("  ")
        self.assertEqual(awards, [])
        self.assertTrue(any("required" in w.lower() for w in warnings))


class CollectTests(unittest.TestCase):
    def test_non_us_country_adds_scope_note(self):
        def fake_post(url, payload, *, timeout):
            return {"results": []}

        payload = collect_gov_procurement(
            company_name="Ashanti Gold",
            country="Ghana",
            http_post=fake_post,
        )
        self.assertTrue(
            any("Ghana" in note for note in payload["limitations"]),
            payload["limitations"],
        )
        serialized = serialize_gov_procurement_response(payload)
        self.assertEqual(serialized["source"], "USAspending.gov")
        self.assertEqual(serialized["awards"], [])


if __name__ == "__main__":
    unittest.main()
