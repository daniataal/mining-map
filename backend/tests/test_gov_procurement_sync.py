"""Tests for gov procurement DB persistence and sync."""

from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

from backend.services.gov_procurement_intel import build_commodity_feed_search_payload
from backend.services.gov_procurement_store import (
    collect_gov_procurement_from_db,
    ensure_gov_procurement_tables,
    normalize_recipient_key,
    upsert_award,
)
from backend.services.ingest.gov_procurement_sync import (
    fetch_commodity_feed_page,
    sync_entity_awards_to_db,
    sync_gov_procurement_data,
)


class GovProcurementStoreTests(unittest.TestCase):
    def test_normalize_recipient_key_prefers_uei(self):
        self.assertEqual(normalize_recipient_key(name="Acme", uei="ABC123"), "uei:ABC123")

    def test_ensure_tables_executes_ddl(self):
        conn = MagicMock()
        cursor = MagicMock()
        conn.cursor.return_value.__enter__.return_value = cursor
        ensure_gov_procurement_tables(conn)
        self.assertGreaterEqual(cursor.execute.call_count, 3)

    def test_upsert_award_executes_insert(self):
        cur = MagicMock()
        upsert_award(
            cur,
            {
                "award_id": "A-1",
                "recipient": "ACME Mining LLC",
                "uei": "UEI123",
                "value_usd": 1000.0,
                "agency": "DOE",
                "title": "Gold services",
                "category": "precious",
                "commodity": "Gold",
                "status": "ACTIVE",
                "source_url": "https://www.usaspending.gov/award/X",
            },
            commodity_tag="gold",
        )
        cur.execute.assert_called_once()
        sql = cur.execute.call_args[0][0]
        self.assertIn("INSERT INTO gov_procurement_awards", sql)

    def test_collect_from_db_maps_awards(self):
        conn = MagicMock()
        cursor = MagicMock()
        conn.cursor.return_value.__enter__.return_value = cursor
        cursor.description = [
            ("award_id",),
            ("commodity_tag",),
            ("recipient_name",),
            ("uei",),
            ("amount",),
            ("agency",),
            ("award_date",),
            ("naics",),
            ("description_snippet",),
            ("usaspending_url",),
            ("generated_internal_id",),
            ("recipient_id",),
            ("category",),
            ("commodity_label",),
            ("start_date",),
            ("end_date",),
            ("psc",),
            ("award_type",),
            ("status",),
            ("fetched_at",),
        ]
        cursor.fetchall.return_value = [
            (
                "A-1",
                "gold",
                "ACME Mining LLC",
                "UEI123",
                500000.0,
                "DOE",
                None,
                "212221",
                "Gold ore",
                "https://www.usaspending.gov/award/X",
                "GEN1",
                None,
                "precious",
                "Gold",
                None,
                None,
                None,
                None,
                "ACTIVE",
                None,
            )
        ]
        with patch(
            "backend.services.gov_procurement_store.find_recipient_keys_for_company",
            return_value=["name:acmeminingllc"],
        ):
            payload = collect_gov_procurement_from_db(conn, company_name="ACME Mining LLC", country="United States")
        self.assertEqual(payload["data_origin"], "database")
        self.assertEqual(len(payload["awards"]), 1)
        self.assertEqual(payload["awards"][0]["commodity"], "Gold")


class GovProcurementSyncTests(unittest.TestCase):
    def test_build_commodity_payload_has_filters(self):
        profile = {
            "id": "gold",
            "naics_require": ["212221"],
            "keywords": ["gold ore"],
            "psc_codes": [],
        }
        payload = build_commodity_feed_search_payload(profile, page=2)
        self.assertEqual(payload["page"], 2)
        self.assertIn("naics_codes", payload["filters"])

    def test_fetch_commodity_feed_page_mock(self):
        profile = {"id": "gold", "label": "Gold", "category": "precious"}

        def fake_post(url, payload, *, timeout):
            return {
                "results": [
                    {
                        "Award ID": "G-1",
                        "Description": "Gold ore contract",
                        "Award Amount": 250000,
                        "Awarding Agency": "DOE",
                        "Recipient Name": "ACME Mining LLC",
                        "NAICS": "212221",
                    }
                ]
            }

        awards, warnings = fetch_commodity_feed_page(profile, page=1, http_post=fake_post)
        self.assertEqual(len(awards), 1)
        self.assertEqual(awards[0]["commodity"], "Gold")
        self.assertEqual(warnings, [])

    def test_sync_gov_procurement_data_upserts(self):
        conn = MagicMock()
        cursor = MagicMock()
        conn.cursor.return_value.__enter__.return_value = cursor
        cursor.fetchone.return_value = (1,)

        fake_award = {
            "award_id": "G-1",
            "recipient": "ACME",
            "value_usd": 1.0,
            "agency": "DOE",
            "title": "Gold",
            "category": "precious",
            "commodity": "Gold",
            "status": "ACTIVE",
        }

        with patch(
            "backend.services.ingest.gov_procurement_sync.fetch_commodity_feed_page",
            return_value=([fake_award], []),
        ), patch(
            "backend.services.ingest.gov_procurement_sync.COMMODITY_FEED_PROFILES",
            [{"id": "gold", "label": "Gold", "category": "precious"}],
        ), patch(
            "backend.services.ingest.gov_procurement_sync.rebuild_recipient_aggregates",
            return_value=1,
        ):
            summary = sync_gov_procurement_data(conn, max_pages_per_profile=1)
        self.assertEqual(summary["status"], "ok")
        self.assertGreaterEqual(summary["records_upserted"], 1)

    def test_sync_entity_awards_to_db(self):
        conn = MagicMock()
        cursor = MagicMock()
        conn.cursor.return_value.__enter__.return_value = cursor
        fake_awards = [
            {
                "award_id": "E-1",
                "recipient": "ACME",
                "value_usd": 10.0,
                "agency": "DOE",
                "title": "Entity award",
                "category": "precious",
                "commodity": "Gold",
                "status": "ACTIVE",
            }
        ]
        with patch(
            "backend.services.ingest.gov_procurement_sync.fetch_usaspending_awards",
            return_value=(fake_awards, []),
        ), patch(
            "backend.services.ingest.gov_procurement_sync.rebuild_recipient_aggregates",
            return_value=1,
        ):
            summary = sync_entity_awards_to_db(conn, "ACME Mining", http_post=MagicMock())
        self.assertEqual(summary["records_upserted"], 1)


if __name__ == "__main__":
    unittest.main()
