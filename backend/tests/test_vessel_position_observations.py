"""Tests for vessel_position_observations upsert (mocked DB)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from unittest.mock import MagicMock

import pytest

try:
    from backend.services import vessel_position_observations as vpo
except ImportError:
    from services import vessel_position_observations as vpo  # type: ignore


def _mock_conn_with_table(exists: bool = True) -> MagicMock:
    conn = MagicMock()
    cur = MagicMock()
    cur.fetchone.return_value = (exists,)
    conn.cursor.return_value.__enter__ = MagicMock(return_value=cur)
    conn.cursor.return_value.__exit__ = MagicMock(return_value=False)
    return conn


def test_upsert_sql_uses_source_key_conflict(monkeypatch):
    conn = _mock_conn_with_table()
    observed = datetime(2026, 5, 21, 12, 0, tzinfo=timezone.utc)
    captured_sql: list[str] = []

    def _capture_execute_values(cur, sql, values, **kwargs):
        captured_sql.append(sql)

    if vpo.execute_values is not None:
        monkeypatch.setattr(vpo, "execute_values", _capture_execute_values)
    vpo.upsert_observation(
        conn,
        636023100,
        "maritime_redis",
        "redis:636023100",
        25.5,
        55.1,
        observed,
        sog=10.5,
        vessel_name="MT TEST",
    )
    if vpo.execute_values is not None:
        sql = captured_sql[0]
    else:
        sql = conn.cursor.return_value.__enter__.return_value.execute.call_args[0][0]
    assert "ON CONFLICT (data_source, source_record_id)" in sql
    assert "DO UPDATE SET" in sql


def test_upsert_idempotent_same_source_key(monkeypatch):
    conn = _mock_conn_with_table()
    observed = datetime(2026, 5, 21, 12, 0, tzinfo=timezone.utc)
    base = dict(
        mmsi=636023100,
        data_source="maritime_redis",
        source_record_id="redis:636023100",
        observed_at=observed,
    )
    calls: list[str] = []

    def _capture_execute_values(cur, sql, values, **kwargs):
        calls.append(sql)

    if vpo.execute_values is not None:
        monkeypatch.setattr(vpo, "execute_values", _capture_execute_values)
    vpo.upsert_observation(conn, lat=25.0, lng=55.0, **base)
    vpo.upsert_observation(conn, lat=25.1, lng=55.2, **base)
    if vpo.execute_values is not None:
        assert len(calls) == 2
        assert calls[0] == calls[1]
    else:
        cur = conn.cursor.return_value.__enter__.return_value
        assert cur.execute.call_count == 2
        assert cur.execute.call_args_list[0][0][0] == cur.execute.call_args_list[1][0][0]


def test_mirror_retired():
    conn = _mock_conn_with_table()
    result = vpo.mirror_maritime_redis_snapshot(conn)
    assert result["status"] == "retired"
    assert result["upserted"] == 0

