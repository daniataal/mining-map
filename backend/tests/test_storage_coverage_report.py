import unittest

from backend.services.storage_coverage_report import (
    build_storage_coverage_report,
    write_gap_queue,
)
from backend.services.storage_terminals_seed import normalize_curated_terminal, CuratedStorageTerminal


class StorageCoverageReportTests(unittest.TestCase):
    def test_build_report_country_and_gap_port(self):
        eapc = normalize_curated_terminal(
            CuratedStorageTerminal(
                name="EAPC Ashkelon Oil Terminal",
                country="Israel",
                region="Ashkelon",
                lat=31.6406,
                lng=34.5414,
                operator="EAPC",
                retain_near_osm=True,
            ),
            "2026-06-04T00:00:00+00:00",
        )
        south = {
            "id": "osm:way:1",
            "lat": 31.62,
            "lng": 34.52,
            "country": "Israel",
            "company": "Paz tank",
        }
        report = build_storage_coverage_report([south, eapc])
        self.assertGreaterEqual(report["totals"]["entities"], 2)
        israel = next((r for r in report["by_country"] if r["country"] == "Israel"), None)
        self.assertIsNotNone(israel)
        kinds = {g["kind"] for g in report["gap_candidates"]}
        self.assertIn("curated_gap_fill", kinds)

    def test_write_gap_queue_from_report(self, tmp_path=None):
        report = {
            "gap_candidates": [
                {
                    "kind": "port_sparse_osm",
                    "lat": 26.707,
                    "lng": 50.061,
                    "locode": "SARTA",
                }
            ]
        }
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "queue.json"
            out = write_gap_queue(report, path=path)
            payload = out.read_text(encoding="utf-8")
            self.assertIn("mena", payload)
            self.assertIn("tiles", payload)


if __name__ == "__main__":
    unittest.main()
