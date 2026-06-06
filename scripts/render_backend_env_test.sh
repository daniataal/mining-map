#!/usr/bin/env bash
# Smoke test for scripts/render_backend_env.sh (no secrets required).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp)"
trap 'rm -f "$OUT"' EXIT

CENSUS_API_KEY=test-census COMTRADE_API_KEY=test-comtrade \
  "$ROOT/scripts/render_backend_env.sh" "$OUT"

grep -q '^OIL_GRAPH_SYNC_GO_LICENSES=true$' "$OUT" || {
  echo "FAIL: Go graph-sync flag missing from rendered env"
  exit 1
}
grep -q '^CENSUS_API_KEY=test-census$' "$OUT" || {
  echo "FAIL: secret overlay missing"
  exit 1
}
grep -q '^CENSUS_TRADE_SYNC_ENABLED=true$' "$OUT" || {
  echo "FAIL: auto-enable did not flip CENSUS_TRADE_SYNC_ENABLED"
  exit 1
}
grep -q '^COMTRADE_SYNC_ENABLED=true$' "$OUT" || {
  echo "FAIL: auto-enable did not flip COMTRADE_SYNC_ENABLED"
  exit 1
}

echo "OK: render_backend_env.sh"
