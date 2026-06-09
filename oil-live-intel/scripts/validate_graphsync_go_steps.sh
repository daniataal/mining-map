#!/usr/bin/env bash
# Validate Go graph-sync cold steps after enabling OIL_GRAPH_SYNC_GO_* flags.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

echo "=== oil_live_sync_state (graphsync_* keys) ==="
docker exec mining-db psql -U postgres -d mining_db -c "
  SELECT key,
         metadata->>'status' AS status,
         metadata->>'implementation' AS impl,
         updated_at
  FROM oil_live_sync_state
  WHERE key LIKE 'graphsync_%' OR key = 'last_eurostat_sync'
  ORDER BY updated_at DESC
  LIMIT 20;
" 2>/dev/null || echo "(db container not running)"

echo ""
echo "=== Worker logs (last graph-sync-go lines) ==="
docker logs oil-live-intel-worker 2>&1 | grep -E '\[graph-sync-go\]' | tail -10 || echo "(container not running or no Go graph-sync logs yet)"

echo ""
echo "CPU steps (default true in compose):"
echo "  OIL_GRAPH_SYNC_GO_TERMINAL_OPERATORS"
echo "  OIL_GRAPH_SYNC_GO_LICENSES"
echo "  OIL_GRAPH_SYNC_GO_TRADE_FLOWS"
echo "  OIL_GRAPH_SYNC_GO_PORT_CALLS"
echo "  OIL_GRAPH_SYNC_GO_TED"
echo "  OIL_GRAPH_SYNC_GO_BUNKER_FUEL_SUPPLIERS"
echo "IO step (opt-in): OIL_GRAPH_SYNC_GO_EUROSTAT_TRADE"
echo ""
echo "Rollback: set flag=false on oil-live-intel-worker AND oil-live-graph-sync-worker, then restart both."
