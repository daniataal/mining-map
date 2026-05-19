"""Phase 8 API tests: registry links, trade flows, deal export HTML, Mapbox-off catalog."""

from __future__ import annotations

import os
import sys
import unittest
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-unit-tests-32b!")
os.environ["ADMIN_TOKEN"] = "test-admin-token"

from backend.main import app  # noqa: E402
from fastapi.testclient import TestClient


class Phase8ApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_company_registry_links_opencorporates(self):
        res = self.client.get(
            "/api/companies/Acme%20Mining/registry-links",
            params={"country": "Germany"},
        )
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertIn("links", body)
        labels = [l["label"] for l in body["links"]]
        self.assertTrue(any("OpenCorporates" in x for x in labels))
        self.assertTrue(any("Germany" in x or "Unternehmensregister" in x for x in labels))
        self.assertIn("manual", body["opencorporates_disclaimer"].lower())

    def test_eu_register_helper_uk(self):
        from backend.services.eu_company_registers import build_eu_register_link

        link = build_eu_register_link("Shell plc", "United Kingdom")
        self.assertIsNotNone(link)
        assert link is not None
        self.assertIn("company-information.service.gov.uk", link["url"])
        self.assertFalse(link["api_backed"])

    @patch("backend.main.get_db_connection")
    @patch("backend.main.ensure_schema_initialized")
    def test_entity_trade_flows(self, _schema, mock_conn):
        conn = MagicMock()
        mock_conn.return_value = conn
        with patch(
            "backend.services.entity_trade_flows.collect_entity_trade_flows",
            return_value={
                "entityId": "lic-1",
                "entityKind": "license",
                "company": "Aramco",
                "country": "Saudi Arabia",
                "commodity": "crude oil",
                "hs_codes": ["2709"],
                "flows": [{"year": 2022, "hs_code": "2709", "flow_type": "X"}],
                "flow_count": 1,
                "warnings": [],
            },
        ):
            res = self.client.get(
                "/entities/lic-1/trade-flows",
                params={"entity_kind": "license"},
            )
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body["flowCount"], 1)
        self.assertEqual(body["hsCodes"], ["2709"])

    @patch("backend.main.get_db_connection")
    def test_deal_room_export_html(self, mock_conn):
        fake_services = MagicMock()
        fake_services.build_export_package.return_value = {
            "dealRoom": {"title": "Test Room"},
            "entity": {"company": "Acme", "country": "Ghana"},
            "routeSummary": {"status": "attached"},
            "relatedUsaAwards": [],
            "relatedEuNotices": [],
            "risks": [],
            "decision": "review",
            "confidence": 0.7,
            "exportedAt": "2026-05-19T00:00:00Z",
            "markdown": "# Test",
        }
        with patch("backend.main._load_deal_room_services", return_value=fake_services):
            res = self.client.get("/api/deal-rooms/room-1/export", params={"format": "html"})
        self.assertEqual(res.status_code, 200)
        self.assertIn("text/html", res.headers.get("content-type", ""))
        self.assertIn(b"Test Room", res.content)

    @patch("backend.main.get_db_connection")
    def test_deal_room_export_pdf_route(self, mock_conn):
        fake_services = MagicMock()
        fake_services.build_export_package.return_value = {
            "dealRoom": {"title": "PDF Room"},
            "entity": {},
            "routeSummary": {},
            "relatedUsaAwards": [],
            "relatedEuNotices": [],
            "risks": [],
            "markdown": "",
        }
        with patch("backend.main._load_deal_room_services", return_value=fake_services):
            res = self.client.get("/api/deal-rooms/room-2/export.pdf")
        self.assertEqual(res.status_code, 200)
        self.assertIn(b"PDF Room", res.content)

    def test_petroleum_catalog_mapbox_disabled(self):
        from backend.services import petroleum_infrastructure as pi

        with patch.object(pi, "_mapbox_disabled", return_value=True):
            catalog = pi.get_petroleum_layer_catalog()
            self.assertTrue(catalog.get("mapbox_disabled"))
            self.assertEqual(catalog.get("layers"), [])
            geo = pi.get_petroleum_layer_geojson("oil_pipelines")
            self.assertEqual(geo.get("features"), [])


class ArcgisProbeWorkerTests(unittest.TestCase):
    @patch("backend.arcgis_probe_sync_worker._db_connection")
    def test_run_once_persists_both_probes(self, mock_db):
        conn = MagicMock()
        mock_db.return_value = conn
        with patch(
            "backend.services.ingest.kazakhstan_arcgis_probe.run_and_persist_probe",
            return_value={"probe_key": "kazakhstan_arcgis_hub", "reachable": False},
        ) as mock_kz, patch(
            "backend.services.ingest.philippines_mgb_arcgis_probe.run_and_persist_probe",
            return_value={"probe_key": "philippines_mgb_arcgis", "reachable": False},
        ) as mock_ph:
            from backend.arcgis_probe_sync_worker import run_once

            out = run_once()
        self.assertEqual(out["status"], "ok")
        mock_kz.assert_called_once()
        mock_ph.assert_called_once()
        conn.commit.assert_called_once()


if __name__ == "__main__":
    unittest.main()
