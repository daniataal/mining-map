import unittest

from backend.services.storage_terminals import (
    _apply_viewport_filter,
    _entity_in_bbox,
    _parse_storage_bbox,
)


class StorageTerminalsBboxTests(unittest.TestCase):
    def test_parse_bbox_optional(self):
        self.assertIsNone(_parse_storage_bbox(None, None, None, None))
        bbox = _parse_storage_bbox(31.6, 34.5, 31.7, 34.6)
        self.assertEqual(bbox, (31.6, 34.5, 31.7, 34.6))

    def test_parse_bbox_requires_all_fields(self):
        with self.assertRaises(ValueError):
            _parse_storage_bbox(31.6, None, 31.7, 34.6)

    def test_entity_in_bbox(self):
        entity = {"lat": 31.64, "lng": 34.54}
        self.assertTrue(_entity_in_bbox(entity, (31.6, 34.5, 31.7, 34.6)))
        self.assertFalse(_entity_in_bbox(entity, (32.0, 34.5, 33.0, 35.0)))

    def test_apply_viewport_filter_limit(self):
        entities = [
            {"id": f"osm:way:{i}", "lat": 31.64 + i * 0.001, "lng": 34.54}
            for i in range(10)
        ]
        filtered, gap = _apply_viewport_filter(
            entities,
            bbox=(31.6, 34.5, 31.7, 34.6),
            limit=3,
        )
        self.assertFalse(gap)
        self.assertEqual(len(filtered), 3)

    def test_apply_viewport_coverage_gap(self):
        entities = [{"id": "osm:way:1", "lat": 51.9, "lng": 4.5}]
        filtered, gap = _apply_viewport_filter(
            entities,
            bbox=(31.6, 34.5, 31.7, 34.6),
            limit=100,
        )
        self.assertTrue(gap)
        self.assertEqual(len(filtered), 0)


if __name__ == "__main__":
    unittest.main()
