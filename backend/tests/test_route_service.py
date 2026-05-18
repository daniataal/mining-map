"""Tests for the dedicated route-service microservice."""

from __future__ import annotations

import os
import sys
import unittest
from unittest.mock import patch

# route_service lives next to services/ under backend/
_BACKEND_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _BACKEND_ROOT not in sys.path:
    sys.path.insert(0, _BACKEND_ROOT)


class RouteServiceTests(unittest.TestCase):
    def test_health_reports_hub_catalog(self) -> None:
        from route_service.app import health

        payload = health()
        self.assertEqual(payload.get("status"), "ok")
        self.assertGreater(payload["hubs"]["maritime"], 10)
        self.assertIn("osrm_cache", payload)

    @patch("route_service.app.plan_route")
    def test_plan_endpoint_delegates_to_planner(self, plan_route_mock) -> None:
        from route_service.app import RoutePlanRequest, create_plan

        plan_route_mock.return_value = {
            "recommended": {"id": "sea_primary", "route": {"legs": []}},
            "alternatives": [],
            "route": {"legs": []},
            "cost_breakdown": {"total_cost_usd": 1000},
            "limitations": [],
        }
        payload = RoutePlanRequest(
            product="gold",
            quantity_tons=50,
            origin={"name": "Tema", "lat": 5.64, "lng": 0.018, "kind": "port"},
            destination={"name": "Haifa", "lat": 32.819, "lng": 34.99, "kind": "port"},
            preferred_methods=["sea"],
            pipeline_layer_enabled=False,
        )
        result = create_plan(payload)
        plan_route_mock.assert_called_once()
        self.assertIn("recommended", result)


if __name__ == "__main__":
    unittest.main()
