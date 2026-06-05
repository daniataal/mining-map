"""Tests for rate limit helper (in-memory path; no Redis required)."""

import os
import unittest
from unittest import mock

from starlette.requests import Request

from backend.services import rate_limit


class RateLimitTests(unittest.TestCase):
    def setUp(self):
        rate_limit.reset_memory_store_for_tests()
        self._env = mock.patch.dict(
            os.environ,
            {
                "RATE_LIMIT_ENABLED": "1",
                "REDIS_HOST": "",
                "RATE_LIMIT_RPM": "3",
                "RATE_LIMIT_ROUTE_RPM": "5",
            },
            clear=False,
        )
        self._env.start()
        rate_limit.RATE_LIMIT_ENABLED = True
        rate_limit.RATE_LIMIT_RPM = 3
        rate_limit.RATE_LIMIT_ROUTE_RPM = 5

    def tearDown(self):
        self._env.stop()
        rate_limit.reset_memory_store_for_tests()

    @staticmethod
    def _request(path: str, auth: str | None = None, ip: str = "203.0.113.10") -> Request:
        headers = []
        if auth:
            headers.append((b"authorization", auth.encode()))
        scope = {
            "type": "http",
            "method": "POST",
            "path": path,
            "headers": headers,
            "client": (ip, 12345),
            "server": ("test", 80),
            "scheme": "http",
            "query_string": b"",
        }
        return Request(scope)

    def test_path_limit_buckets(self):
        self.assertEqual(rate_limit.path_limit("/api/agents/route-intelligence"), ("agents", 3))
        self.assertEqual(rate_limit.path_limit("/api/routing/plans"), ("routing", 5))
        self.assertEqual(rate_limit.path_limit("/licenses/export"), ("export", 3))
        self.assertEqual(rate_limit.path_limit("/api/deal-rooms/abc/export.pdf"), ("export", 3))
        self.assertIsNone(rate_limit.path_limit("/licenses"))

    def test_client_key_prefers_bearer_token(self):
        req = self._request("/api/agents/jobs/x", auth="Bearer secret-token")
        self.assertTrue(rate_limit.client_key(req).startswith("user:"))

    def test_allow_request_enforces_limit_in_memory(self):
        key = "ip:203.0.113.10"
        self.assertTrue(rate_limit.allow_request(key, "agents", 2))
        self.assertTrue(rate_limit.allow_request(key, "agents", 2))
        self.assertFalse(rate_limit.allow_request(key, "agents", 2))


if __name__ == "__main__":
    unittest.main()
