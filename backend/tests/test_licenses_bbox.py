import unittest

from backend.license_bbox import licenses_bbox_tuple_if_valid


class TestLicensesBbox(unittest.TestCase):
    def test_valid_box(self):
        self.assertEqual(
            licenses_bbox_tuple_if_valid(-10.0, 10.0, -20.0, 20.0),
            (-10.0, 10.0, -20.0, 20.0),
        )

    def test_partial_params_ignored(self):
        self.assertIsNone(licenses_bbox_tuple_if_valid(1.0, 2.0, 3.0, None))
        self.assertIsNone(licenses_bbox_tuple_if_valid(None, None, None, None))

    def test_non_degenerate(self):
        self.assertIsNone(licenses_bbox_tuple_if_valid(0.0, 0.0, 0.0, 1.0))
        self.assertIsNone(licenses_bbox_tuple_if_valid(0.0, 1.0, 0.5, 0.5))
        self.assertIsNone(licenses_bbox_tuple_if_valid(2.0, 1.0, 0.0, 1.0))

    def test_dateline_wrap_ignored(self):
        self.assertIsNone(licenses_bbox_tuple_if_valid(-10.0, 10.0, 170.0, -170.0))


if __name__ == "__main__":
    unittest.main()
