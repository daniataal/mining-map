"""Unit tests for U.S. federal procurement (USAspending) intelligence."""

from __future__ import annotations

import unittest
from datetime import date, timedelta

from backend.services.gov_procurement_intel import (
    aggregate_companies_from_awards,
    build_commodity_feed_search_payload,
    build_procurement_summary,
    build_usaspending_search_payload,
    collect_commodity_feed,
    collect_gov_procurement,
    fetch_commodity_feed_awards,
    fetch_usaspending_awards,
    infer_commodity_and_category,
    normalize_usaspending_row,
    serialize_commodity_feed_response,
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

    def test_sulphur_keyword(self):
        commodity, category = infer_commodity_and_category(description="Elemental sulphur supply")
        self.assertEqual(commodity, "Sulphur")
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


class CommodityFeedTests(unittest.TestCase):
    def test_all_commodity_profiles_use_usaspending_naics_lengths(self):
        from backend.services.gov_procurement_intel import COMMODITY_FEED_PROFILES

        for profile in COMMODITY_FEED_PROFILES:
            payload = build_commodity_feed_search_payload(profile)
            naics = (payload["filters"].get("naics_codes") or {}).get("require") or []
            for code in naics:
                self.assertIn(
                    len(code),
                    (2, 4, 6),
                    f"profile {profile.get('id')!r} NAICS {code!r} must be length 2, 4, or 6",
                )

    def test_feed_payload_uses_naics_and_keywords(self):
        profile = {
            "id": "gold",
            "naics_require": ["212221"],
            "keywords": ["gold ore"],
            "psc_codes": [],
        }
        payload = build_commodity_feed_search_payload(profile, limit=20)
        self.assertEqual(payload["filters"]["naics_codes"], {"require": ["212221"]})
        self.assertEqual(payload["filters"]["keywords"], ["gold ore"])
        self.assertNotIn("recipient_search_text", payload["filters"])
        self.assertEqual(payload["limit"], 20)

    def test_fetch_feed_mock(self):
        def fake_post(url, payload, *, timeout):
            keywords = payload["filters"].get("keywords") or []
            if "gold ore" in keywords:
                return {
                    "results": [
                        {
                            "Award ID": "G-1",
                            "Recipient Name": "ACME Mining LLC",
                            "Description": "Gold ore supply",
                            "Award Amount": 2_000_000,
                            "Awarding Agency": "DOE",
                            "NAICS": "212221",
                            "generated_internal_id": "CONT_G1",
                        }
                    ]
                }
            return {"results": []}

        awards, warnings = fetch_commodity_feed_awards(
            profiles=[
                {
                    "id": "gold",
                    "label": "Gold",
                    "category": "precious",
                    "naics_require": ["212221"],
                    "keywords": ["gold ore"],
                    "psc_codes": [],
                }
            ],
            http_post=fake_post,
        )
        self.assertEqual(len(awards), 1)
        self.assertEqual(awards[0]["commodity"], "Gold")
        self.assertEqual(warnings, [])

    def test_aggregate_companies(self):
        awards = [
            {
                "recipient": "ACME Mining LLC",
                "uei": "UEI1",
                "value_usd": 100,
                "commodity": "Gold",
                "category": "precious",
                "status": "ACTIVE",
                "agency": "DOE",
                "award_id": "A1",
                "title": "Gold contract",
            },
            {
                "recipient": "ACME Mining LLC",
                "uei": "UEI1",
                "value_usd": 50,
                "commodity": "Gold",
                "category": "precious",
                "status": "COMPLETED",
                "agency": "DLA",
                "award_id": "A2",
                "title": "Gold follow-on",
            },
        ]
        companies = aggregate_companies_from_awards(awards)
        self.assertEqual(len(companies), 1)
        self.assertEqual(companies[0]["total_awarded_usd"], 150.0)
        self.assertEqual(companies[0]["award_count"], 2)
        self.assertEqual(companies[0]["active_award_count"], 1)

    def test_collect_commodity_feed_live_mock(self):
        def fake_post(url, payload, *, timeout):
            return {
                "results": [
                    {
                        "Award ID": "G-2",
                        "Recipient Name": "Beta Mining",
                        "Description": "Gold ore",
                        "Award Amount": 100,
                        "Awarding Agency": "DOE",
                        "NAICS": "212221",
                    }
                ]
            }

        payload = collect_commodity_feed(
            commodity="gold",
            http_post=fake_post,
        )
        self.assertEqual(len(payload["companies"]), 1)
        self.assertEqual(payload["companies"][0]["name"], "Beta Mining")
        serialized = serialize_commodity_feed_response(payload)
        self.assertEqual(serialized["companies"][0]["name"], "Beta Mining")


if __name__ == "__main__":
    unittest.main()
