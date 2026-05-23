import json
import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from unittest import mock

from backend.services.maritime_intel import (
    _build_ais_subscription_plan,
    _build_maritime_vessel_feed_from_rows,
    _regions_for_worker_watch_mode,
    AISSTREAM_WATCH_REGIONS,
    PERSIAN_GULF_CORE_BBOX,
    GULF_OF_GUINEA_DEMO_BBOX,
    MARITIME_COASTAL_DEMO_AFRICA_SPECS,
    MARITIME_COASTAL_DEMO_SPARSE_THRESHOLD,
    _build_stored_feed_response,
    _parse_datetime,
    _normalize_requested_bbox,
    _ship_matches_scope,
    _should_merge_persian_gulf_demo_rows,
    build_counterparty_proxies,
    build_synthetic_maritime_demo_rows_for_bbox,
    build_synthetic_persian_gulf_demo_rows,
    classify_ais_ship_type,
    classify_evidence_type,
    filter_maritime_rows_by_bbox,
    haversine_km,
    load_maritime_gulf_demo_rows_from_file,
    load_maritime_africa_demo_rows_from_file,
    match_destination_to_port,
    merge_maritime_vessel_feeds,
    maritime_coastal_demo_merge_decision,
    MARITIME_WORKER_SUPPLEMENT_SPECS,
    parse_unlocode_coordinates,
    petroleum_vessel_priority,
    viewport_ais_coverage_gap,
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

    def test_build_ais_subscription_plan_worker_all_regions(self):
        with mock.patch.dict(os.environ, {"MARITIME_WORKER_WATCH_MODE": "all_regions"}, clear=False):
            plan = _build_ais_subscription_plan(None, worker_ingest=True)
        self.assertEqual(plan["geography_mode"], "all_regions")
        self.assertEqual(len(plan["boxes"]), len(AISSTREAM_WATCH_REGIONS))
        labels = " ".join(plan["region_labels"])
        self.assertIn("West Africa", labels)
        self.assertIn("South and East Africa", labels)

    def test_build_ais_subscription_plan_worker_global(self):
        with mock.patch.dict(os.environ, {"MARITIME_WORKER_WATCH_MODE": "global"}, clear=False):
            plan = _build_ais_subscription_plan(None, worker_ingest=True)
        self.assertEqual(plan["geography_mode"], "global")
        self.assertEqual(len(plan["boxes"]), 1)

    def test_regions_for_worker_watch_mode_includes_africa_boxes(self):
        regions = _regions_for_worker_watch_mode("all_regions")
        region_ids = {region["id"] for region in regions}
        self.assertIn("west_africa", region_ids)
        self.assertIn("gulf_of_guinea", region_ids)
        self.assertIn("south_africa_indian", region_ids)
        self.assertIn("east_africa_arabian_sea", region_ids)

    def test_worker_supplement_specs_cover_gulf_and_africa(self):
        supplement_ids = {spec["id"] for spec in MARITIME_WORKER_SUPPLEMENT_SPECS}
        self.assertIn("persian_gulf", supplement_ids)
        self.assertIn("gulf_of_guinea", supplement_ids)
        self.assertIn("horn_of_africa", supplement_ids)
        self.assertIn("red_sea_south", supplement_ids)
        self.assertIn("east_africa_indian", supplement_ids)

    def test_viewport_ais_coverage_gap_when_feed_healthy_but_view_empty(self):
        rows = [{"mmsi": str(i), "lat": 55.0, "lng": 3.0} for i in range(150)]
        self.assertTrue(
            viewport_ais_coverage_gap(rows, PERSIAN_GULF_CORE_BBOX, worker_ok=True),
        )
        self.assertFalse(
            viewport_ais_coverage_gap(rows, (50.0, -5.0, 62.0, 12.0), worker_ok=True),
        )
        self.assertFalse(
            viewport_ais_coverage_gap(rows, PERSIAN_GULF_CORE_BBOX, worker_ok=False),
        )

    def test_regions_for_worker_watch_mode_always_includes_persian_gulf(self):
        regions = _regions_for_worker_watch_mode("rotating")
        region_ids = {region["id"] for region in regions}
        self.assertIn("persian_gulf", region_ids)
        self.assertIn("malacca", region_ids)

    def test_persian_gulf_region_covers_user_viewport(self):
        region = next(item for item in AISSTREAM_WATCH_REGIONS if item["id"] == "persian_gulf")
        south, west, north, east = region["bbox"]
        self.assertLessEqual(south, 24.0)
        self.assertLessEqual(west, 48.0)
        self.assertGreaterEqual(north, 30.0)
        self.assertGreaterEqual(east, 58.0)
        self.assertEqual(PERSIAN_GULF_CORE_BBOX, region["bbox"])

    def test_merge_maritime_vessel_feeds_keeps_freshest_position(self):
        merged = merge_maritime_vessel_feeds(
            [
                {
                    "vessels": [
                        {"mmsi": "1", "lat": 25.0, "lng": 52.0, "observed_at": "2026-05-17T10:00:00+00:00"},
                    ],
                    "live_positions_enabled": True,
                },
                {
                    "vessels": [
                        {"mmsi": "1", "lat": 26.0, "lng": 53.0, "observed_at": "2026-05-17T11:00:00+00:00"},
                        {"mmsi": "2", "lat": 27.0, "lng": 54.0, "observed_at": "2026-05-17T11:00:00+00:00"},
                    ],
                    "live_positions_enabled": True,
                },
            ],
            max_vessels=10,
        )
        self.assertEqual(merged["returned_count"], 2)
        by_mmsi = {item["mmsi"]: item for item in merged["vessels"]}
        self.assertAlmostEqual(by_mmsi["1"]["lat"], 26.0)
        self.assertAlmostEqual(by_mmsi["2"]["lng"], 54.0)

    def test_ship_scope_does_not_exclude_non_tankers(self):
        self.assertTrue(_ship_matches_scope("Tanker", "oil_tankers"))
        self.assertTrue(_ship_matches_scope("Cargo", "oil_tankers"))
        self.assertTrue(_ship_matches_scope("Cargo", "all_vessels"))

    def test_petroleum_vessel_priority_ranks_tankers_highest(self):
        self.assertGreater(petroleum_vessel_priority(82, "Tanker"), petroleum_vessel_priority(75, "Cargo"))
        self.assertGreater(petroleum_vessel_priority(None, "LNG Carrier"), petroleum_vessel_priority(30, "Fishing"))

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

    def test_build_synthetic_persian_gulf_demo_rows_stays_in_core_bbox(self):
        rows = build_synthetic_persian_gulf_demo_rows(80)
        self.assertEqual(len(rows), 80)
        south, west, north, east = PERSIAN_GULF_CORE_BBOX
        for row in rows:
            lat = float(row["lat"])
            lng = float(row["lng"])
            self.assertGreaterEqual(lat, south)
            self.assertLessEqual(lat, north)
            self.assertGreaterEqual(lng, west)
            self.assertLessEqual(lng, east)
            self.assertTrue(str(row.get("mmsi", "")).startswith("999"))

    def test_build_synthetic_maritime_demo_rows_stays_in_guinea_bbox(self):
        rows = build_synthetic_maritime_demo_rows_for_bbox(
            GULF_OF_GUINEA_DEMO_BBOX,
            40,
            id_prefix="demo:guinea",
            vessel_name_prefix="Guinea Demo",
            source_label="Gulf of Guinea demo (synthetic)",
            source_url="https://example.invalid/demo",
            mmsi_start=998_010_000,
            prng_salt=11_035,
        )
        self.assertEqual(len(rows), 40)
        south, west, north, east = GULF_OF_GUINEA_DEMO_BBOX
        for row in rows:
            lat = float(row["lat"])
            lng = float(row["lng"])
            self.assertGreaterEqual(lat, south)
            self.assertLessEqual(lat, north)
            self.assertGreaterEqual(lng, west)
            self.assertLessEqual(lng, east)
            self.assertTrue(str(row.get("mmsi", "")).startswith("998010"))

    @mock.patch.dict(os.environ, {"MARITIME_ALLOW_DEMO_SEED": "1"}, clear=False)
    def test_maritime_coastal_demo_merge_decision_dev_coastal_opt_in(self):
        live = {"persian_gulf_hormuz": 50, "gulf_of_guinea": 50}
        d = maritime_coastal_demo_merge_decision(
            live_counts=live,
            reference_ingest_ok=True,
            coverage_gap_persian_gulf=False,
            include_coastal_demo=True,
            include_gulf_demo=False,
            env_coastal=False,
            env_gulf_only=False,
            sparse_threshold=MARITIME_COASTAL_DEMO_SPARSE_THRESHOLD,
        )
        self.assertTrue(d["merge_gulf"])
        self.assertEqual(len(d["merge_africa_region_ids"]), len(MARITIME_COASTAL_DEMO_AFRICA_SPECS))

    @mock.patch.dict(os.environ, {"MARITIME_ALLOW_DEMO_SEED": "1"}, clear=False)
    def test_maritime_coastal_demo_merge_decision_env_coastal_sparse(self):
        live = {
            "persian_gulf_hormuz": 2,
            "gulf_of_guinea": 0,
            "mozambique_channel": 50,
            "red_sea_south": 1,
            "horn_of_africa": 50,
            "east_africa_indian": 50,
        }
        d = maritime_coastal_demo_merge_decision(
            live_counts=live,
            reference_ingest_ok=True,
            coverage_gap_persian_gulf=False,
            include_coastal_demo=False,
            include_gulf_demo=False,
            env_coastal=True,
            env_gulf_only=False,
            sparse_threshold=12,
        )
        self.assertTrue(d["merge_gulf"])
        self.assertIn("gulf_of_guinea", d["merge_africa_region_ids"])
        self.assertIn("red_sea_south", d["merge_africa_region_ids"])
        self.assertNotIn("mozambique_channel", d["merge_africa_region_ids"])

    @mock.patch.dict(os.environ, {"MARITIME_ALLOW_DEMO_SEED": "1"}, clear=False)
    def test_maritime_coastal_demo_merge_decision_gulf_only_env(self):
        live = {"persian_gulf_hormuz": 0, "gulf_of_guinea": 0}
        d = maritime_coastal_demo_merge_decision(
            live_counts=live,
            reference_ingest_ok=True,
            coverage_gap_persian_gulf=True,
            include_coastal_demo=False,
            include_gulf_demo=False,
            env_coastal=False,
            env_gulf_only=True,
            sparse_threshold=12,
        )
        self.assertTrue(d["merge_gulf"])
        self.assertEqual(d["merge_africa_region_ids"], [])

    def test_load_maritime_africa_demo_rows_from_geojson_file(self):
        payload = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [4.2, 2.1]},
                    "properties": {"mmsi": "900222333", "vessel_name": "Africa Seed One", "ship_type_code": 71},
                }
            ],
        }
        with tempfile.NamedTemporaryFile("w", suffix=".geojson", delete=False, encoding="utf-8") as tmp:
            json.dump(payload, tmp)
            path = tmp.name
        try:
            rows = load_maritime_africa_demo_rows_from_file(path)
        finally:
            os.unlink(path)
        self.assertEqual(len(rows), 1)
        self.assertAlmostEqual(rows[0]["lat"], 2.1)
        self.assertAlmostEqual(rows[0]["lng"], 4.2)
        self.assertEqual(rows[0]["mmsi"], "900222333")
        self.assertIn("Africa", str(rows[0].get("source_label") or ""))

    def test_load_maritime_gulf_demo_rows_from_geojson_file(self):
        payload = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [52.0, 25.5]},
                    "properties": {"mmsi": "900111222", "vessel_name": "Seed One", "ship_type_code": 82},
                }
            ],
        }
        with tempfile.NamedTemporaryFile("w", suffix=".geojson", delete=False, encoding="utf-8") as tmp:
            json.dump(payload, tmp)
            path = tmp.name
        try:
            rows = load_maritime_gulf_demo_rows_from_file(path)
        finally:
            os.unlink(path)
        self.assertEqual(len(rows), 1)
        self.assertAlmostEqual(rows[0]["lat"], 25.5)
        self.assertAlmostEqual(rows[0]["lng"], 52.0)
        self.assertEqual(rows[0]["mmsi"], "900111222")

    def test_filter_maritime_rows_by_bbox(self):
        rows = [
            {"mmsi": "1", "lat": 10.0, "lng": 20.0},
            {"mmsi": "2", "lat": 50.0, "lng": 60.0},
        ]
        filtered = filter_maritime_rows_by_bbox(rows, (5.0, 15.0, 15.0, 25.0))
        self.assertEqual(len(filtered), 1)
        self.assertEqual(filtered[0]["mmsi"], "1")
        self.assertEqual(len(filter_maritime_rows_by_bbox(rows, None)), 2)

    def test_maritime_coastal_demo_merge_decision_blocked_without_allow_flag(self):
        live = {"persian_gulf_hormuz": 0, "gulf_of_guinea": 0}
        with mock.patch.dict(
            os.environ,
            {"MARITIME_ALLOW_DEMO_SEED": "0", "MARITIME_COASTAL_DEMO_SEED": "1", "MARITIME_GULF_DEMO_SEED": "1"},
            clear=False,
        ):
            d = maritime_coastal_demo_merge_decision(
                live_counts=live,
                reference_ingest_ok=True,
                coverage_gap_persian_gulf=True,
                include_coastal_demo=True,
                include_gulf_demo=True,
                env_coastal=True,
                env_gulf_only=True,
                sparse_threshold=12,
            )
        self.assertFalse(d["merge_gulf"])
        self.assertEqual(d["merge_africa_region_ids"], [])

    @mock.patch.dict(os.environ, {"MARITIME_ALLOW_DEMO_SEED": "1"}, clear=False)
    def test_should_merge_persian_gulf_demo_rows(self):
        self.assertTrue(
            _should_merge_persian_gulf_demo_rows(include_gulf_demo=True, demo_env=False, coverage_gap=False)
        )
        self.assertTrue(
            _should_merge_persian_gulf_demo_rows(include_gulf_demo=False, demo_env=True, coverage_gap=True)
        )
        self.assertFalse(
            _should_merge_persian_gulf_demo_rows(include_gulf_demo=False, demo_env=False, coverage_gap=True)
        )
        self.assertFalse(
            _should_merge_persian_gulf_demo_rows(include_gulf_demo=False, demo_env=True, coverage_gap=False)
        )

    def test_should_merge_persian_gulf_demo_rows_blocked_without_allow_flag(self):
        with mock.patch.dict(
            os.environ,
            {"MARITIME_ALLOW_DEMO_SEED": "0", "MARITIME_GULF_DEMO_SEED": "1"},
            clear=False,
        ):
            self.assertFalse(
                _should_merge_persian_gulf_demo_rows(
                    include_gulf_demo=True, demo_env=True, coverage_gap=True
                )
            )

    def test_build_maritime_vessel_feed_from_rows_no_demo_in_prod_defaults(self):
        with mock.patch.dict(
            os.environ,
            {"MARITIME_ALLOW_DEMO_SEED": "0", "MARITIME_COASTAL_DEMO_SEED": "1", "MARITIME_GULF_DEMO_SEED": "1"},
            clear=False,
        ):
            response = _build_maritime_vessel_feed_from_rows(
                all_rows=[],
                status={
                    "status": "ok",
                    "source": "AISStream regional watch",
                    "last_attempt_at": datetime.now(timezone.utc),
                    "last_success_at": datetime.now(timezone.utc),
                    "last_error": None,
                    "snapshot_count": 0,
                    "metadata": {},
                },
                normalized_scope="all_vessels",
                normalized_max_vessels=60,
                normalized_window=10,
                normalized_offset=0,
                normalized_bbox=PERSIAN_GULF_CORE_BBOX,
            )
        self.assertFalse(response.get("persian_gulf_demo_synthetic"))
        self.assertFalse(response.get("coastal_demo_synthetic"))
        self.assertEqual(response.get("coastal_demo_regions"), [])
        self.assertIsNone(response.get("persian_gulf_demo_mode"))
        demo_mmsi = [
            str(v.get("mmsi") or "")
            for v in response.get("vessels") or []
            if str(v.get("mmsi") or "").startswith("999") or str(v.get("mmsi") or "").startswith("998")
        ]
        self.assertEqual(demo_mmsi, [])

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

    def test_stored_feed_response_keeps_ship_type_from_payload_when_row_column_null(self):
        now = datetime.now(timezone.utc)
        response = _build_stored_feed_response(
            rows=[
                {
                    "mmsi": "987654321",
                    "vessel_name": "Payload Tanker",
                    "lat": 25.0,
                    "lng": 52.0,
                    "observed_at": now,
                    "source_label": "AISStream",
                    "source_url": "https://aisstream.io/documentation",
                    "ship_type_code": None,
                    "ship_type_label": None,
                    "payload": {
                        "id": "ais:987654321",
                        "ship_type_code": 82,
                        "ship_type_label": "Tanker",
                    },
                    "last_seen_at": now,
                }
            ],
            status={"status": "ok", "last_success_at": now, "metadata": {}},
            max_vessels=10,
            offset=0,
            total_available=1,
            capture_window_seconds=10,
            vessel_scope="all_vessels",
            bbox=None,
        )
        vessel = response["vessels"][0]
        self.assertEqual(vessel["ship_type_code"], 82)
        self.assertEqual(vessel["ship_type_label"], "Tanker")

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
        self.assertIn("aisstream_configured", response)
        self.assertTrue(response["stale"])
        self.assertEqual(response["total_available"], 0)
        self.assertEqual(response["returned_count"], 0)
        self.assertFalse(response["cap_applied"])
        self.assertEqual(response["worker"]["last_error"], "temporary websocket failure")
        self.assertEqual(response["requested_bbox"], [0.0, 0.0, 10.0, 10.0])


if __name__ == "__main__":
    unittest.main()
