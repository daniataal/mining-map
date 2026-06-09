"""Tests for GEM GGIT gas pipeline ingest (no workbook required)."""

from pathlib import Path
from unittest import TestCase

from backend.services.ingest import gem_ggit_gas_pipelines_import as mod


class GemGgitGasImportTests(TestCase):
    def test_missing_workbook_skips_cleanly(self):
        summary = mod.ingest_gem_ggit_gas_pipelines(
            conn=None,  # type: ignore[arg-type]
            workbook_path=Path("/tmp/nonexistent-ggit-gas.xlsx"),
        )
        self.assertEqual(summary["status"], "skipped")
        self.assertEqual(summary["reason"], "workbook_missing")

    def test_auto_ingest_respects_disable_flag(self):
        import os

        os.environ["GEM_GGIT_GAS_PIPELINES_AUTO_INGEST"] = "0"
        self.addCleanup(lambda: os.environ.pop("GEM_GGIT_GAS_PIPELINES_AUTO_INGEST", None))
        out = mod.try_auto_ingest_gem_ggit_gas_pipelines(conn=None)  # type: ignore[arg-type]
        self.assertEqual(out["status"], "skipped")
