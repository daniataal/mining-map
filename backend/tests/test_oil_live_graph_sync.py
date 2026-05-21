"""Unit tests for oil_live_graph_sync helpers (no DB required)."""

from __future__ import annotations

import pytest

try:
    from backend.services.oil_live_graph_sync import (
        _commodity_from_text,
        _merge_company_metadata,
        _normalize_name,
    )
except ImportError:
    from services.oil_live_graph_sync import (
        _commodity_from_text,
        _merge_company_metadata,
        _normalize_name,
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

    with patch(f"{mod}.ensure_commercial_graph_tables", return_value=None), patch(
        f"{mod}._import_storage_terminals",
        return_value={"terminals_imported": 0},
    ), patch(f"{mod}._index_licenses", return_value={"license_events": 0}), patch(
        f"{mod}._index_terminal_operators",
        return_value={"operators_indexed": 0},
    ), patch(
        f"{mod}._seed_port_calls_if_sparse",
        return_value={"status": "skipped"},
    ), patch(
        f"{mod}._mirror_trade_flows",
        return_value=0,
    ), patch(
        f"{mod}._sync_census_trade_flows",
        return_value={"status": "ok", "rows_upserted": 42, "data_source": "census_api"},
    ), patch(
        f"{mod}._sync_usitc_trade_flows",
        return_value={"status": "skipped"},
    ), patch(f"{mod}._mirror_port_calls", return_value=0), patch(
        f"{mod}._mirror_ted_notices",
        return_value=0,
    ), patch(
        f"{mod}._mirror_gov_awards",
        return_value=0,
    ), patch(
        f"{mod}._ensure_demo_opportunities",
        return_value={"open_opportunities": 0},
    ), patch(
        f"{mod}._trigger_synthetic_bol_rebuild",
        return_value={"status": "ok"},
    ), patch(f"{mod}._table_exists", return_value=True), patch(
        f"{mod}._record_graph_sync_at",
        return_value=None,
    ):
        summary = graph_sync_mod.run_full_graph_sync(conn, rebuild_synthetic_bol=True)

    assert summary["census_api_key_configured"] is True
    assert summary["steps"]["census_trade"]["rows_upserted"] == 42
    assert summary["status"] == "ok"
