"""Phase 9: CPV mapping, probe alerts, PDF export, global registers."""

from __future__ import annotations

import json
import os
import sys
import unittest
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-unit-tests-32b!")
os.environ["ADMIN_TOKEN"] = "test-admin-token"

from backend.main import app
from fastapi.testclient import TestClient


class CpvLicenseMappingTests(unittest.TestCase):
    def test_gold_maps_metals(self):
        from backend.services.cpv_commodity import license_commodity_to_cpv_bucket

        self.assertEqual(license_commodity_to_cpv_bucket("Gold"), "metals")

    def test_oil_maps_petroleum(self):
        from backend.services.cpv_commodity import license_commodity_to_cpv_bucket

        self.assertEqual(license_commodity_to_cpv_bucket("crude oil"), "petroleum")

    def test_copper_maps_metals(self):
        from backend.services.cpv_commodity import license_commodity_to_cpv_bucket

        self.assertEqual(license_commodity_to_cpv_bucket("Copper"), "metals")


class CompanyRegistersTests(unittest.TestCase):
    def test_ghana_register_link(self):
        from backend.services.company_registers import build_register_link

        link = build_register_link("Gold Fields", "Ghana")
        self.assertIsNotNone(link)
        assert link is not None
        self.assertIn("Ghana", link["label"])

    def test_canada_register_link(self):
        from backend.services.company_registers import build_register_link

        link = build_register_link("Barrick", "Canada")
        self.assertIsNotNone(link)
        assert link is not None
        self.assertIn("canada", link["url"].lower())


class ProbeAlertTests(unittest.TestCase):
    @patch("backend.services.sync_alert_store._maybe_notify_probe_webhook")
    def test_record_probe_status_change_on_reachable_flip(self, _webhook):
        from backend.services.sync_alert_store import record_probe_status_change

        conn = MagicMock()
        cur = MagicMock()
        conn.cursor.return_value.__enter__.return_value = cur
        cur.fetchone.return_value = (99,)

        alert_id = record_probe_status_change(
            conn,
            probe_key="kazakhstan_arcgis_hub",
            previous={"reachable": False, "status": "timeout"},
            current={"reachable": True, "status": "reachable", "message": "ok"},
        )
        self.assertEqual(alert_id, 99)
        cur.execute.assert_called()


class KazakhstanProbeEnhancementTests(unittest.TestCase):
    def test_discover_hydrocarbon_services(self):
        from backend.services.ingest.kazakhstan_arcgis_probe import discover_hydrocarbon_services

        services = [
            {"name": "Mining_Licenses", "type": "MapServer"},
            {"name": "Petroleum_Contract_Areas", "type": "FeatureServer"},
        ]
        found = discover_hydrocarbon_services(services)
        self.assertEqual(len(found), 1)
        self.assertIn("Petroleum", found[0]["name"])


class Phase9ApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    @patch("backend.main.get_db_connection")
    @patch("backend.main.ensure_schema_initialized")
    def test_entity_eu_procurement_includes_cpv_bucket(self, _schema, mock_conn):
        conn = MagicMock()
        mock_conn.return_value = conn
        row = {
            "company": "BHP",
            "country": "Australia",
            "commodity": "Gold",
            "license_type": "Mining Lease",
        }
        with patch("backend.main.RealDictCursor") as mock_cursor_cls:
            cur = MagicMock()
            mock_cursor_cls.return_value = cur
            conn.cursor.return_value.__enter__.return_value = cur
            cur.execute.return_value = None
            cur.fetchone.return_value = row
            with patch(
                "backend.services.eu_procurement_intel.collect_eu_procurement_for_company",
                return_value={"notices": [], "warnings": []},
            ):
                res = self.client.get(
                    "/entities/lic-gold/eu-procurement",
                    params={"entity_kind": "license"},
                )
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body.get("cpvBucket"), "metals")

    @patch("backend.main.get_db_connection")
    def test_deal_room_export_pdf_content_type(self, mock_conn):
        fake_services = MagicMock()
        fake_services.build_export_package.return_value = {
            "dealRoom": {"title": "PDF Test"},
            "entity": {"company": "Acme"},
            "routeSummary": {},
            "relatedUsaAwards": [],
            "relatedEuNotices": [],
            "risks": [],
            "markdown": "",
        }
        with patch("backend.main._load_deal_room_services", return_value=fake_services):
            with patch(
                "backend.services.deal_room_export_pdf.render_deal_room_export_pdf",
                return_value=(b"%PDF-1.4 fake", "application/pdf"),
            ):
                res = self.client.get("/api/deal-rooms/room-pdf/export.pdf")
        self.assertEqual(res.status_code, 200)
        self.assertIn("application/pdf", res.headers.get("content-type", ""))


if __name__ == "__main__":
    unittest.main()
