#!/usr/bin/env bash
# Parity validation for Go graph-sync terminal_operators step.
# Requires: psql access to mining_db; optional oil-live-intel-worker with
# OIL_GRAPH_SYNC_GO_TERMINAL_OPERATORS=true.
set -euo pipefail

DB_URL="${DATABASE_URL:-postgresql://postgres:password@localhost:5432/mining_db?sslmode=disable}"

echo "=== Distinct terminal operators (upsert-eligible, len>=2) ==="
psql "$DB_URL" -t -A -c "
  SELECT COUNT(*) FROM (
    SELECT DISTINCT TRIM(operator_name), COALESCE(country, '')
    FROM oil_terminals
    WHERE operator_name IS NOT NULL AND TRIM(operator_name) <> ''
      AND LENGTH(TRIM(operator_name)) >= 2
  ) sub;
"

echo ""
echo "=== Go sync state (oil_live_sync_state.graphsync_terminal_operators) ==="
psql "$DB_URL" -c "
  SELECT key, value, metadata, updated_at
  FROM oil_live_sync_state
  WHERE key = 'graphsync_terminal_operators';
" 2>/dev/null || echo "(table missing or no row yet — run worker with OIL_GRAPH_SYNC_GO_TERMINAL_OPERATORS=true)"

echo ""
echo "=== Python graph-sync last run (if present) ==="
psql "$DB_URL" -t -A -c "
  SELECT metadata->'steps'->'terminal_operators'
  FROM oil_live_sync_state
  WHERE key = 'graph_sync_last_run'
  LIMIT 1;
" 2>/dev/null || echo "(no graph_sync_last_run row)"

echo ""
echo "=== Worker logs (last graph-sync-go lines) ==="
docker logs oil-live-intel-worker 2>&1 | grep -E '\[graph-sync-go\]' | tail -5 || echo "(container not running or no Go graph-sync logs yet)"

echo ""
echo "Enable Go step: set OIL_GRAPH_SYNC_GO_TERMINAL_OPERATORS=true in .env and restart oil-live-intel-worker"
echo "Rollback: set OIL_GRAPH_SYNC_GO_TERMINAL_OPERATORS=false and restart worker"
echo "Go unit parity: OILLIVE_TEST_DB=\"\$DB_URL\" go test ./internal/services/graphsync/ -run Parity -v"
