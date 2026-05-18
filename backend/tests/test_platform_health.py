"""Tests for platform health aggregation."""

import unittest
from unittest import mock

from backend.services.platform_health import build_platform_health


class PlatformHealthTests(unittest.TestCase):
    @mock.patch(
        "backend.services.platform_health.get_ai_provider_status",
        return_value={
            "groq": "configured",
            "openrouter": "missing",
            "pollinations_enabled": False,
            "ready": True,
            "env": {"GROQ_API_KEY": "SET", "OPENROUTER_API_KEY": "MISSING", "DISABLE_POLLINATIONS_FALLBACK": "SET"},
        },
    )
    def test_build_platform_health_ok(self, _mock_ai):
        body = build_platform_health(
            redis_enabled=True,
            redis_ping=lambda: mock.Mock(ping=mock.Mock(return_value=True)),
            get_snapshot_meta=lambda: {"available": True, "stale": False},
            get_maritime_stats=lambda: {"worker": {"status": "ok"}, "redis_snapshot": {}},
        )
        self.assertEqual(body["api"], "ok")
        self.assertEqual(body["status"], "ok")
        self.assertTrue(body["redis"]["ok"])
        self.assertIn("ai_providers", body)
        self.assertIn("ready", body["ai_providers"])

    @mock.patch(
        "backend.services.platform_health.get_ai_provider_status",
        return_value={
            "groq": "configured",
            "openrouter": "missing",
            "pollinations_enabled": False,
            "ready": True,
            "env": {},
        },
    )
    def test_build_platform_health_degraded_when_redis_down(self, _mock_ai):
        body = build_platform_health(
            redis_enabled=True,
            redis_ping=lambda: None,
            get_snapshot_meta=lambda: {"available": False, "stale": True},
            get_maritime_stats=lambda: {"worker": {"status": "error"}},
        )
        self.assertEqual(body["status"], "degraded")
        self.assertFalse(body["redis"]["ok"])

    def test_build_platform_health_degraded_when_ai_not_ready(self):
        with mock.patch(
            "backend.services.platform_health.get_ai_provider_status",
            return_value={
                "groq": "missing",
                "openrouter": "missing",
                "pollinations_enabled": False,
                "ready": False,
                "env": {
                    "GROQ_API_KEY": "MISSING",
                    "OPENROUTER_API_KEY": "MISSING",
                    "DISABLE_POLLINATIONS_FALLBACK": "SET",
                },
            },
        ):
            body = build_platform_health(
                redis_enabled=True,
                redis_ping=lambda: mock.Mock(ping=mock.Mock(return_value=True)),
                get_snapshot_meta=lambda: {"available": True, "stale": False},
                get_maritime_stats=lambda: {"worker": {"status": "ok"}, "redis_snapshot": {}},
            )
        self.assertEqual(body["status"], "degraded")
        self.assertFalse(body["ai_providers"]["ready"])


if __name__ == "__main__":
    unittest.main()
