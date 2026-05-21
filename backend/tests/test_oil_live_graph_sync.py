"""Unit tests for oil_live_graph_sync helpers (no DB required)."""

from __future__ import annotations

import pytest

try:
    from backend.services.oil_live_graph_sync import (
        _commodity_from_text,
        _ensure_demo_opportunities,
        _merge_company_metadata,
        _normalize_name,
        _seed_port_calls_if_sparse,
    )
except ImportError:
    from services.oil_live_graph_sync import (
        _commodity_from_text,
        _ensure_demo_opportunities,
        _merge_company_metadata,
        _normalize_name,
        _seed_port_calls_if_sparse,
    )


def test_normalize_name():
    assert _normalize_name("  Aramco Trading  ") == "aramco trading"


@pytest.mark.parametrize(
    "text,expected",
    [
        ("crude oil export", "crude"),
        ("diesel import", "refined"),
        ("LNG terminal", "gas"),
        ("sulfur bulk", "sulfur"),
    ],
)
def test_commodity_from_text(text, expected):
    assert _commodity_from_text(text) == expected


def test_demo_seed_disabled_skips_helpers(monkeypatch):
    monkeypatch.setenv("OIL_LIVE_DISABLE_DEMO_SEED", "1")
    cur = object()
    assert _ensure_demo_opportunities(cur) == {
        "skipped": True,
        "reason": "OIL_LIVE_DISABLE_DEMO_SEED",
    }
    assert _seed_port_calls_if_sparse(cur) == {
        "skipped": True,
        "reason": "OIL_LIVE_DISABLE_DEMO_SEED",
    }


def test_merge_company_metadata_roles_and_sources():
    merged = _merge_company_metadata(
        {"roles": ["terminal_operator"], "sources": [{"name": "osm_storage"}]},
        {"license_id": "lic-1"},
        source="licenses",
        company_type="supplier_license",
    )
    assert merged["roles"] == ["terminal_operator", "supplier_license"]
    names = [s["name"] for s in merged["sources"]]
    assert names == ["osm_storage", "licenses"]


def test_graph_sync_summary_includes_census_step(monkeypatch):
    """Census trade step appears in graph-sync summary when key is configured."""
    from contextlib import ExitStack
    from unittest.mock import MagicMock, patch

    monkeypatch.setenv("CENSUS_API_KEY", "test-census-key")
    monkeypatch.setenv("OIL_GRAPH_SYNC_ENABLED", "true")

    conn = MagicMock()
    cur = MagicMock()
    cur.fetchone.side_effect = [
        (True,),  # oil_terminals exists (ensure_commercial_graph_tables)
        (False,),  # need_008
        (False,),  # need_010
        (False,),  # need_011 metadata column
        (True,),  # oil_terminals exists (run body)
    ]
    conn.cursor.return_value.__enter__ = MagicMock(return_value=cur)
    conn.cursor.return_value.__exit__ = MagicMock(return_value=False)

    mod = "backend.services.oil_live_graph_sync"
    try:
        import backend.services.oil_live_graph_sync as graph_sync_mod
    except ImportError:
        mod = "services.oil_live_graph_sync"
        import services.oil_live_graph_sync as graph_sync_mod  # type: ignore

    monkeypatch.setattr(graph_sync_mod, "GRAPH_SYNC_ENABLED", True)

    patches = {
        "ensure_commercial_graph_tables": None,
        "_import_storage_terminals": {"terminals_imported": 0},
        "_index_licenses": {"license_events": 0},
        "_index_terminal_operators": {"operators_indexed": 0},
        "_seed_port_calls_if_sparse": {"status": "skipped"},
        "_mirror_trade_flows": 0,
        "_sync_census_trade_flows": {
            "status": "ok",
            "rows_upserted": 42,
            "data_source": "census_api",
        },
        "_sync_usitc_trade_flows": {"status": "skipped"},
        "_sync_eia_crude_imports": {
            "status": "skipped",
            "reason": "EIA_API_KEY unset",
        },
        "_sync_eia_refinery_throughput": {"status": "skipped"},
        "_run_gleif_batch": {"status": "skipped", "skipped_missing_columns": True},
        "_run_wikidata_batch": {"status": "skipped", "skipped_missing_columns": True},
        "_run_opensanctions_batch": {
            "status": "skipped",
            "skipped_missing_columns": True,
        },
        "_denormalize_mcr_party_enrichment": {
            "status": "skipped",
            "skipped_missing_columns": True,
        },
        "_mirror_port_calls": 0,
        "_mirror_ted_notices": 0,
        "_mirror_gov_awards": 0,
        "_ensure_demo_opportunities": {"open_opportunities": 0},
        "_trigger_synthetic_bol_rebuild": {"status": "ok"},
        "_table_exists": True,
        "_record_graph_sync_at": None,
    }

    with ExitStack() as stack:
        for attr, return_value in patches.items():
            stack.enter_context(patch(f"{mod}.{attr}", return_value=return_value))
        summary = graph_sync_mod.run_full_graph_sync(conn, rebuild_synthetic_bol=True)

    assert summary["census_api_key_configured"] is True
    assert summary["steps"]["census_trade"]["rows_upserted"] == 42
    # Phase 4a/4b/4c hook surface area
    for key in (
        "eia_crude_imports",
        "eia_refinery_throughput",
        "gleif_batch",
        "wikidata_enrich",
        "opensanctions_screening",
        "mcr_party_denormalize",
    ):
        assert key in summary["steps"], f"missing step: {key}"
    assert summary["status"] == "ok"
