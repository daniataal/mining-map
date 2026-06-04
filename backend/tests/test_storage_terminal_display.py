import json
import unittest
from unittest.mock import MagicMock, patch

from backend.services.storage_terminal_display import (
    STORAGE_DISPLAY_ENRICHMENT_VERSION,
    build_full_display_entity,
    ensure_storage_terminal_display_tables,
    load_display_by_id,
    materialize_storage_displays,
    overlay_materialized_on_entities,
    upsert_storage_terminal_display,
)


class StorageTerminalDisplayTests(unittest.TestCase):
    def test_ensure_storage_terminal_display_tables_executes_ddl(self):
        conn = MagicMock()
        cur = MagicMock()
        conn.cursor.return_value.__enter__.return_value = cur

        ensure_storage_terminal_display_tables(conn)

        self.assertGreaterEqual(cur.execute.call_count, 2)
        ddl = " ".join(str(call.args[0]) for call in cur.execute.call_args_list).lower()
        self.assertIn("storage_terminal_display", ddl)

    @patch("backend.services.storage_terminal_display._enrich_orphan_tanks_with_site_context", side_effect=lambda rows: rows)
    @patch("backend.services.storage_terminal_display.build_full_display_entity")
    @patch("backend.services.storage_terminal_display.normalize_storage_terminal")
    @patch("backend.services.storage_terminal_display._load_osm_elements_for_materialize")
    @patch("backend.services.storage_terminal_display.storage_display_materialize_enabled", return_value=True)
    def test_materialize_upserts_enriched_display(
        self,
        _mock_enabled,
        mock_load_elements,
        mock_normalize,
        mock_build_display,
        _mock_site,
    ):
        element = {"type": "node", "id": 42, "lat": 25.0, "lon": 55.0, "tags": {}}
        mock_load_elements.return_value = ([element], "2026-06-04T12:00:00Z")
        sparse = {
            "id": "osm:node:42",
            "lat": 25.0,
            "lng": 55.0,
            "company": "Unnamed Storage Terminal",
            "operatorName": None,
        }
        mock_normalize.return_value = sparse
        mock_build_display.return_value = {
            **sparse,
            "operatorName": "ADNOC",
            "curatedEnrichmentSourceId": "curated_storage_ruwais_uae",
        }

        conn = MagicMock()
        cur = MagicMock()
        conn.cursor.return_value.__enter__.return_value = cur

        summary = materialize_storage_displays(conn, limit=10)

        self.assertEqual(summary["status"], "success")
        self.assertEqual(summary["written"], 1)
        upsert_sql = str(cur.execute.call_args_list[-1].args[0])
        self.assertIn("INSERT INTO storage_terminal_display", upsert_sql)

    @patch("backend.services.storage_terminal_display._db_connect")
    def test_load_display_by_id_returns_display_ready(self, mock_connect):
        conn = MagicMock()
        cur = MagicMock()
        mock_connect.return_value = conn
        conn.cursor.return_value.__enter__.return_value = cur
        cur.fetchone.return_value = (
            {
                "id": "osm:node:99",
                "operatorName": "Vopak",
                "company": "Test",
            },
            STORAGE_DISPLAY_ENRICHMENT_VERSION,
        )

        result = load_display_by_id(conn, "osm:node:99")

        self.assertIsNotNone(result)
        assert result is not None
        self.assertTrue(result.get("displayReady"))
        self.assertEqual(result["operatorName"], "Vopak")

    @patch("backend.services.storage_terminal_display.load_displays_by_bbox")
    @patch("backend.services.storage_terminal_display._db_connect")
    @patch("backend.services.storage_terminal_display.storage_display_read_enabled", return_value=True)
    def test_overlay_replaces_osm_entity_in_viewport(
        self,
        _mock_read,
        mock_connect,
        mock_load_bbox,
    ):
        mock_connect.return_value = MagicMock()
        mock_load_bbox.return_value = {
            "osm:node:1": {
                "id": "osm:node:1",
                "company": "Materialized Hub",
                "operatorName": "ADNOC",
                "lat": 25.0,
                "lng": 55.0,
                "evidence": [{"id": "e1"}],
            }
        }
        entities = [{"id": "osm:node:1", "company": "Sparse", "lat": 25.0, "lng": 55.0}]
        bbox = (24.0, 54.0, 26.0, 56.0)

        merged = overlay_materialized_on_entities(entities, bbox=bbox, summary=True)

        self.assertEqual(len(merged), 1)
        self.assertTrue(merged[0].get("displayReady"))
        self.assertEqual(merged[0]["operatorName"], "ADNOC")
        self.assertNotIn("evidence", merged[0])

    @patch("backend.services.storage_terminals._enrich_storage_entity_for_detail")
    @patch("backend.services.storage_terminal_display.load_display_by_id")
    @patch("backend.services.storage_terminal_display.storage_display_read_enabled", return_value=True)
    @patch("backend.services.storage_terminals._db_connect")
    @patch("backend.services.storage_terminals._fresh_cache", return_value=None)
    @patch("backend.services.storage_terminals.get_storage_terminals")
    def test_get_storage_terminal_details_uses_materialized_without_enrich(
        self,
        _mock_list,
        _mock_cache,
        mock_db_connect,
        _mock_read_flag,
        mock_load_display,
        mock_enrich_detail,
    ):
        from backend.services.storage_terminals import get_storage_terminal_details

        mock_db_connect.return_value = MagicMock()
        mock_load_display.return_value = {
            "id": "osm:node:777",
            "operatorName": "ADNOC",
            "displayReady": True,
            "evidence": [],
        }

        result = get_storage_terminal_details("osm:node:777")

        self.assertIsNotNone(result)
        self.assertEqual(result["operatorName"], "ADNOC")
        mock_enrich_detail.assert_not_called()

    @patch("backend.services.storage_terminals_seed.enrich_osm_from_reference_hubs")
    @patch("backend.services.storage_terminals_seed.load_curated_storage_terminals")
    def test_build_full_display_entity_curated_operator(
        self,
        mock_load_curated,
        mock_enrich_hubs,
    ):
        sparse = {
            "id": "osm:node:99",
            "lat": 25.0,
            "lng": 55.0,
            "company": "Unnamed Storage Terminal",
            "operatorName": None,
        }
        hub = {
            "id": "curated_storage_fujairah_uae",
            "sourceKind": "curated_reference",
            "lat": 25.01,
            "lng": 55.01,
            "operatorName": "Vopak",
        }
        mock_load_curated.return_value = [hub]
        mock_enrich_hubs.return_value = [
            {**sparse, "operatorName": "Vopak", "curatedEnrichmentSourceId": hub["id"]}
        ]

        enriched = build_full_display_entity(sparse, "2026-06-04T00:00:00Z")

        self.assertEqual(enriched["operatorName"], "Vopak")
        self.assertEqual(enriched["curatedEnrichmentSourceId"], hub["id"])


if __name__ == "__main__":
    unittest.main()
