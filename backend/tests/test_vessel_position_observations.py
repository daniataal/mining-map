"""Tests for vessel_position_observations upsert (mocked DB)."""

from __future__ import annotations

from datetime import datetime, timezone
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


def test_upsert_sql_uses_source_key_conflict():
    conn = _mock_conn_with_table()
    observed = datetime(2026, 5, 21, 12, 0, tzinfo=timezone.utc)
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
    sql = conn.cursor.return_value.__enter__.return_value.execute.call_args[0][0]
    assert "ON CONFLICT (data_source, source_record_id)" in sql
    assert "DO UPDATE SET" in sql


def test_upsert_idempotent_same_source_key():
    conn = _mock_conn_with_table()
    observed = datetime(2026, 5, 21, 12, 0, tzinfo=timezone.utc)
    base = dict(
        mmsi=636023100,
        data_source="maritime_redis",
        source_record_id="redis:636023100",
        observed_at=observed,
    )
    vpo.upsert_observation(conn, lat=25.0, lng=55.0, **base)
    vpo.upsert_observation(conn, lat=25.1, lng=55.2, **base)
    cur = conn.cursor.return_value.__enter__.return_value
    assert cur.execute.call_count == 2
    assert cur.execute.call_args_list[0][0][0] == cur.execute.call_args_list[1][0][0]


def test_mirror_skips_when_redis_empty(monkeypatch):
    conn = _mock_conn_with_table()
    try:
        from backend.services import maritime_snapshot
    except ImportError:
        from services import maritime_snapshot  # type: ignore
    monkeypatch.setattr(maritime_snapshot, "get_global_maritime_snapshot", lambda: None)

    result = vpo.mirror_maritime_redis_snapshot(conn)
    assert result["status"] == "skipped"
    assert result["upserted"] == 0


def test_mirror_upserts_redis_rows(monkeypatch):
    conn = _mock_conn_with_table()
    snapshot = {
        "rows": [
            {
                "mmsi": "636023100",
                "lat": 26.1,
                "lng": 56.2,
                "observed_at": "2026-05-21T10:00:00+00:00",
                "vessel_name": "MT REDIS",
                "speed_knots": 9.0,
            }
        ]
    }
    try:
        from backend.services import maritime_snapshot
    except ImportError:
        from services import maritime_snapshot  # type: ignore
    monkeypatch.setattr(maritime_snapshot, "get_global_maritime_snapshot", lambda: snapshot)
    mock_upsert = MagicMock()
    monkeypatch.setattr(vpo, "upsert_observation", mock_upsert)

    result = vpo.mirror_maritime_redis_snapshot(conn, limit=100)
    assert result["status"] == "ok"
    assert result["upserted"] == 1
    mock_upsert.assert_called_once()
    call = mock_upsert.call_args
    assert call[0][2] == vpo.DATA_SOURCE_MARITIME_REDIS
    assert call[0][3] == "redis:636023100"
