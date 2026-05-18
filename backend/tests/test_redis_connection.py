"""Tests for Redis password wiring."""

import os
import unittest
from unittest import mock

from backend.services.redis_connection import redis_client_kwargs, redis_password


class RedisConnectionTests(unittest.TestCase):
    def test_password_from_env(self):
        with mock.patch.dict(os.environ, {"REDIS_HOST": "redis", "REDIS_PASSWORD": "s3cret"}, clear=False):
            self.assertEqual(redis_password(), "s3cret")
            self.assertEqual(redis_client_kwargs()["password"], "s3cret")

    def test_no_password_when_unset(self):
        with mock.patch.dict(os.environ, {"REDIS_HOST": "redis", "REDIS_PASSWORD": ""}, clear=False):
            self.assertEqual(redis_password(), "")
            self.assertNotIn("password", redis_client_kwargs())


if __name__ == "__main__":
    unittest.main()
