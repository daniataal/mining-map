import unittest
from pathlib import Path

from backend.services.repo_data_paths import repo_data_dir, repo_data_file


class RepoDataPathsTests(unittest.TestCase):
    def test_repo_data_dir_finds_storage_seed(self):
        data_dir = repo_data_dir()
        seed = repo_data_file("storage_terminals_seed.json")
        self.assertTrue(seed.is_file(), f"missing seed at {seed}")
        self.assertEqual(seed.parent, data_dir)

    def test_seed_has_uae_curated_rows(self):
        import json

        payload = json.loads(repo_data_file("storage_terminals_seed.json").read_text(encoding="utf-8"))
        countries = {
            str(row.get("country") or "")
            for row in payload.get("entities") or []
            if isinstance(row, dict)
        }
        self.assertIn("United Arab Emirates", countries)
        self.assertIn("Israel", countries)


if __name__ == "__main__":
    unittest.main()
