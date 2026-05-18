"""Tests for platform health aggregation."""

import unittest
from unittest import mock

from backend.services.platform_health import build_platform_health


class PlatformHealthTests(unittest.TestCase):
    def test_build_platform_health_ok(self):
        body = build_platform_health(
            redis_enabled=True,
            redis_ping=lambda: mock.Mock(ping=mock.Mock(return_value=True)),
            get_snapshot_meta=lambda: {"available": True, "stale": False},
            get_maritime_stats=lambda: {"worker": {"status": "ok"}, "redis_snapshot": {}},
        )
        self.assertEqual(body["api"], "ok")
        self.assertEqual(body["status"], "ok")
        self.assertTrue(body["redis"]["ok"])

    def test_build_platform_health_degraded_when_redis_down(self):
        body = build_platform_health(
            redis_enabled=True,
            redis_ping=lambda: None,
            get_snapshot_meta=lambda: {"available": False, "stale": True},
            get_maritime_stats=lambda: {"worker": {"status": "error"}},
        )
        self.assertEqual(body["status"], "degraded")
        self.assertFalse(body["redis"]["ok"])


if __name__ == "__main__":
    unittest.main()
