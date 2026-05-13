import unittest
from datetime import datetime, timedelta, timezone

from backend.services.maritime_intel import (
    _build_ais_subscription_plan,
    _build_stored_feed_response,
    _parse_datetime,
    _normalize_requested_bbox,
    _ship_matches_scope,
    build_counterparty_proxies,
    classify_ais_ship_type,
    classify_evidence_type,
    haversine_km,
    match_destination_to_port,
    parse_unlocode_coordinates,
)


class MaritimeIntelTests(unittest.TestCase):
    def test_parse_unlocode_coordinates(self):
        lat, lng = parse_unlocode_coordinates("2428N 05422E")
        self.assertAlmostEqual(lat, 24.4667, places=3)
        self.assertAlmostEqual(lng, 54.3667, places=3)

    def test_haversine_km_zero_distance(self):
        self.assertAlmostEqual(haversine_km(1.0, 2.0, 1.0, 2.0), 0.0, places=4)

    def test_classify_ais_ship_type(self):
        self.assertEqual(classify_ais_ship_type(82), (82, "Tanker"))
        self.assertEqual(classify_ais_ship_type(75), (75, "Cargo"))
        self.assertEqual(classify_ais_ship_type(None), (None, "Unknown"))

    def test_classify_evidence_type_counterparty(self):
        title = "Buyer signs LNG supply deal after tanker discharge"
        self.assertEqual(classify_evidence_type(title), "counterparty_signal")

    def test_normalize_requested_bbox_clamps_and_rounds(self):
        bbox = _normalize_requested_bbox((-95.0, -181.0, 91.23456, 181.98765))
        self.assertEqual(bbox, (-85.0, -180.0, 85.0, 180.0))

    def test_build_ais_subscription_plan_uses_viewport_bbox_when_reasonable(self):
        plan = _build_ais_subscription_plan((10.0, 20.0, 25.0, 38.0))
        self.assertEqual(plan["geography_mode"], "viewport_bbox")
        self.assertEqual(plan["boxes"], [[[25.0, 20.0], [10.0, 38.0]]])
        self.assertEqual(plan["requested_bbox"], [10.0, 20.0, 25.0, 38.0])

    def test_build_ais_subscription_plan_samples_regions_for_wide_view(self):
        plan = _build_ais_subscription_plan((-40.0, -120.0, 55.0, 140.0))
        self.assertEqual(plan["geography_mode"], "sampled_viewport_regions")
        self.assertGreaterEqual(len(plan["boxes"]), 1)
        self.assertGreaterEqual(len(plan["region_labels"]), 1)

    def test_ship_scope_matches_tankers_only_by_default(self):
        self.assertTrue(_ship_matches_scope("Tanker", "oil_tankers"))
        self.assertFalse(_ship_matches_scope("Cargo", "oil_tankers"))
        self.assertTrue(_ship_matches_scope("Cargo", "all_vessels"))

    def test_parse_datetime_accepts_trailing_utc_suffix(self):
        parsed = _parse_datetime("2026-05-13 11:42:00 +0000 UTC")
        self.assertIsNotNone(parsed)
        assert parsed is not None
        self.assertEqual(parsed.tzinfo, timezone.utc)
        self.assertEqual(parsed.year, 2026)

    def test_build_counterparty_proxies_keeps_destination_and_port_proxy(self):
        proxies = build_counterparty_proxies(
            commodity="crude oil",
            matched_port={
                "name": "Ruwais",
                "country_iso2": "AE",
                "confidence": 0.82,
                "source_label": "UN/LOCODE",
                "source_url": "https://unece.org/trade/cefact/UNLOCODE-Download",
            },
            nearest_ports=[
                {
                    "name": "Jebel Ali",
                    "confidence": 0.55,
                    "source_label": "UN/LOCODE",
                    "source_url": "https://unece.org/trade/cefact/UNLOCODE-Download",
                }
            ],
            evidence=[],
        )
        self.assertEqual(len(proxies), 2)
        self.assertEqual(proxies[0]["proxy_type"], "destination_port_proxy")
        self.assertEqual(proxies[1]["proxy_type"], "nearest_port_proxy")

    def test_match_destination_to_port_handles_empty(self):
        self.assertIsNone(match_destination_to_port(""))

    def test_stored_feed_response_marks_fresh_worker_snapshots_live(self):
        now = datetime.now(timezone.utc)
        response = _build_stored_feed_response(
            rows=[
                {
                    "mmsi": "123456789",
                    "vessel_name": "Test Tanker",
                    "lat": 5.5,
                    "lng": 1.2,
                    "observed_at": now,
                    "source_label": "AISStream",
                    "source_url": "https://aisstream.io/documentation",
                    "ship_type_code": 82,
                    "ship_type_label": "Tanker",
                    "payload": {"destination": "Tema"},
                    "last_seen_at": now,
                }
            ],
            status={
                "status": "ok",
                "source": "AISStream regional watch",
                "last_attempt_at": now,
                "last_success_at": now,
                "last_error": None,
                "snapshot_count": 1,
                "metadata": {"geography_mode": "default_regions"},
            },
            max_vessels=60,
            offset=0,
            total_available=1,
            capture_window_seconds=10,
            vessel_scope="oil_tankers",
            bbox=None,
        )

        self.assertEqual(len(response["vessels"]), 1)
        self.assertTrue(response["live_positions_enabled"])
        self.assertFalse(response["stale"])
        self.assertEqual(response["total_available"], 1)
        self.assertEqual(response["returned_count"], 1)
        self.assertFalse(response["cap_applied"])
        self.assertEqual(response["worker"]["status"], "ok")
        self.assertEqual(response["vessels"][0]["last_seen_at"], now.isoformat())

    def test_stored_feed_response_exposes_stale_worker_snapshots(self):
        old_seen = datetime.now(timezone.utc) - timedelta(hours=2)
        response = _build_stored_feed_response(
            rows=[],
            status={
                "status": "error",
                "source": "AISStream",
                "last_attempt_at": old_seen,
                "last_success_at": old_seen,
                "last_error": "temporary websocket failure",
                "snapshot_count": 0,
                "metadata": {},
            },
            max_vessels=60,
            offset=0,
            total_available=0,
            capture_window_seconds=10,
            vessel_scope="all_vessels",
            bbox=(0.0, 0.0, 10.0, 10.0),
        )

        self.assertFalse(response["live_positions_enabled"])
        self.assertTrue(response["stale"])
        self.assertEqual(response["total_available"], 0)
        self.assertEqual(response["returned_count"], 0)
        self.assertFalse(response["cap_applied"])
        self.assertEqual(response["worker"]["last_error"], "temporary websocket failure")
        self.assertEqual(response["requested_bbox"], [0.0, 0.0, 10.0, 10.0])


if __name__ == "__main__":
    unittest.main()
