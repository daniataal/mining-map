"""UK open customs manifest ingest (MAD-4x-c)."""

from __future__ import annotations

import os
import tempfile
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from backend.services.trade_manifest_ingest import (
    UK_SYNC_ENABLED,
    _ingest_single_csv,
    sync_uk_open_trade_rows,
)


@pytest.fixture
def mock_conn():
    conn = MagicMock()
    cur = MagicMock()
    conn.cursor.return_value.__enter__ = MagicMock(return_value=cur)
    conn.cursor.return_value.__exit__ = MagicMock(return_value=False)
    return conn, cur


def test_uk_sync_disabled(monkeypatch, mock_conn):
    conn, _ = mock_conn
    import backend.services.trade_manifest_ingest as mod

    monkeypatch.setattr(mod, "UK_SYNC_ENABLED", False)
    out = sync_uk_open_trade_rows(conn)
    assert out["status"] == "skipped"


def test_ingest_sample_csv_sets_customs_open_tier(mock_conn):
    conn, cur = mock_conn
    sample = Path(__file__).resolve().parents[2] / "data" / "uk_trade_manifests" / "sample_open_trade.csv"
    if not sample.is_file():
        pytest.skip("sample CSV missing")
    n = _ingest_single_csv(conn, sample, data_source="uk_hmrc_open", tier="customs_open")
    assert n == 1
    args = cur.execute.call_args[0][1]
    assert args[1] == "customs_open"
    assert args[0] == "uk_hmrc_open"


def test_ingest_csv_dir_empty_when_missing(mock_conn):
    conn, _ = mock_conn
    from backend.services.trade_manifest_ingest import _ingest_manifest_csv_dir

    assert _ingest_manifest_csv_dir(conn, "/nonexistent/path/xyz", data_source="uk_hmrc_open", tier="customs_open") == 0
