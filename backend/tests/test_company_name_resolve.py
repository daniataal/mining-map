import unittest
from unittest.mock import MagicMock

from backend.services.company_name_resolve import normalize_company_name, resolve_company_name


class CompanyNameResolveTests(unittest.TestCase):
    def test_normalize(self):
        self.assertEqual(normalize_company_name("VTTI  B.V."), "vtti b v")

    def test_resolve_exact(self):
        conn = MagicMock()
        cur = MagicMock()
        conn.cursor.return_value.__enter__.return_value = cur
        cur.fetchone.side_effect = [
            ("uuid-1", "VTTI", "vtti", "United Arab Emirates", None, "port_authority_curated", 0.7),
        ]
        out = resolve_company_name(conn, name="VTTI", country="United Arab Emirates")
        self.assertTrue(out["found"])
        self.assertEqual(out["match_confidence"], "exact")
        self.assertEqual(out["company_id"], "uuid-1")

    def test_resolve_not_found(self):
        conn = MagicMock()
        cur = MagicMock()
        conn.cursor.return_value.__enter__.return_value = cur
        cur.fetchone.side_effect = [None, None]
        cur.fetchall.return_value = []
        out = resolve_company_name(conn, name="Unknown Corp XYZ", country="")
        self.assertFalse(out["found"])


if __name__ == "__main__":
    unittest.main()
