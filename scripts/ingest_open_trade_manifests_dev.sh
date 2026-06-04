#!/usr/bin/env bash
# Dev helper: ingest UK + Brazil open CSV dirs into trade_manifest_rows (customs_open).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "=== Open trade manifest ingest (UK + Brazil) ==="

"$ROOT/scripts/ingest_uk_manifests_dev.sh"
echo ""
"$ROOT/scripts/ingest_brazil_manifests_dev.sh"

BASE_URL="${BASE_URL:-http://127.0.0.1:8080}"
echo ""
echo "Done. Verify:"
echo "  curl -s \"$BASE_URL/api/oil-live/sync-status\" | jq '{trade_manifest_row_count,manifest_by_tier}'"
echo "  curl -s \"$BASE_URL/api/oil-live/trade-manifests?bol_tier=customs_open&limit=5\" | jq '.items | length'"
