"""Tests for jodi_oil sync state recording."""

from __future__ import annotations

import unittest


class TestRecordJodiSync(unittest.TestCase):
    def test_writes_sync_state(self) -> None:
        try:
            from backend.services.jodi_oil import _record_jodi_sync
        except ImportError:
            from services.jodi_oil import _record_jodi_sync  # type: ignore

        executed: list[str] = []

        class _Cur:
            def execute(self, sql: str, params: tuple) -> None:
                executed.append(sql)

            def __enter__(self) -> "_Cur":
                return self

            def __exit__(self, *args: object) -> None:
                return None

        class _Conn:
            def cursor(self) -> _Cur:
                return _Cur()

        _record_jodi_sync(_Conn(), {"status": "skipped", "reason": "no csv"})
        self.assertEqual(len(executed), 1)
        self.assertIn("last_jodi_sync", executed[0])


if __name__ == "__main__":
    unittest.main()
