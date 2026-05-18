import json
import os
import unittest
from unittest import mock

from backend.services import maritime_snapshot as snapshot


class MaritimeSnapshotTests(unittest.TestCase):
    def test_serialize_deserialize_round_trip(self):
        payload = {
            "version": snapshot.MARITIME_SNAPSHOT_VERSION,
            "updated_at": "2026-05-18T12:00:00+00:00",
            "count": 1,
            "regions": ["persian_gulf"],
            "rows": [{"mmsi": "123", "lat": 25.0, "lng": 52.0}],
            "status": {"status": "ok"},
        }
        raw = snapshot.serialize_snapshot(payload)
        restored = snapshot.deserialize_snapshot(raw)
        self.assertIsNotNone(restored)
        assert restored is not None
        self.assertEqual(restored["count"], 1)
        self.assertEqual(restored["rows"][0]["mmsi"], "123")

    def test_deserialize_rejects_wrong_version(self):
        raw = json.dumps({"version": 99, "rows": []})
        self.assertIsNone(snapshot.deserialize_snapshot(raw))

    @mock.patch.object(snapshot, "_get_redis_client")
    def test_publish_and_get_global(self, mock_client_factory):
        store: dict[str, str] = {}

        class FakeRedis:
            def set(self, key, value, ex=None):
                store[key] = value

            def get(self, key):
                return store.get(key)

            def ping(self):
                return True

        mock_client_factory.return_value = FakeRedis()
        rows = [
            {"mmsi": "111", "lat": 26.0, "lng": 53.0, "last_seen_at": "2026-05-18T12:00:00+00:00"},
            {"mmsi": "222", "lat": 55.0, "lng": 3.0, "last_seen_at": "2026-05-18T12:00:00+00:00"},
        ]
        with mock.patch.dict(
            os.environ,
            {"REDIS_HOST": "localhost", "MARITIME_SNAPSHOT_REDIS_KEY": "test:maritime:global"},
            clear=False,
        ):
            snapshot._redis_init_attempted = False
            snapshot._redis_client = None
            published = snapshot.publish_maritime_snapshot(rows, {"status": "ok", "source": "test"})
            self.assertTrue(published)
            loaded = snapshot.get_global_maritime_snapshot()
        self.assertIsNotNone(loaded)
        assert loaded is not None
        self.assertEqual(loaded["count"], 2)
        self.assertGreaterEqual(len(loaded.get("regions") or []), 1)

    @mock.patch.object(snapshot, "get_global_maritime_snapshot", return_value=None)
    def test_get_snapshot_meta_when_missing(self, _mock_get):
        meta = snapshot.get_snapshot_meta()
        self.assertFalse(meta["available"])
        self.assertTrue(meta["stale"])


if __name__ == "__main__":
    unittest.main()
