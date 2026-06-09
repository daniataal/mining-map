#!/usr/bin/env bash
# Validate Go bunker_fuel_suppliers graph-sync step after enabling OIL_GRAPH_SYNC_GO_BUNKER_FUEL_SUPPLIERS.
set -euo pipefail

DB_URL="${DATABASE_URL:-postgresql://postgres:password@localhost:5432/mining_db?sslmode=disable}"

echo "=== graphsync_bunker_fuel_suppliers sync state ==="
psql "$DB_URL" -t -c "
SELECT key,
       metadata->>'status' AS status,
       metadata->>'geocoded' AS geocoded,
       metadata->>'suppliers_indexed' AS indexed,
       updated_at
FROM oil_live_sync_state
WHERE key = 'graphsync_bunker_fuel_suppliers'
ORDER BY updated_at DESC
LIMIT 1;
" 2>/dev/null || echo "(table missing or no row yet — run worker or admin sync)"

echo
echo "=== bunker suppliers indexed ==="
psql "$DB_URL" -t -c "
SELECT COUNT(*)::int
FROM oil_companies
WHERE source = 'bunker_fuel_suppliers_curated';
" 2>/dev/null || true

echo
echo "=== geocode tiers ==="
psql "$DB_URL" -t -c "
SELECT metadata->>'geocode_tier' AS tier, COUNT(*)::int
FROM oil_companies
WHERE source = 'bunker_fuel_suppliers_curated'
GROUP BY 1
ORDER BY 2 DESC;
" 2>/dev/null || true

echo
echo "=== Singapore register geocoded (expect 39) ==="
psql "$DB_URL" -t -c "
SELECT COUNT(*)::int
FROM oil_companies
WHERE source = 'bunker_fuel_suppliers_curated'
  AND metadata->>'port_locode' = 'SGSIN'
  AND metadata->>'geocode_tier' = 'register_address_geocoded';
" 2>/dev/null || true

echo
echo "On-demand sync: POST /api/admin/bunker-fuel-suppliers/sync (proxies to Go when flag true)"
echo "Enable Go step: OIL_GRAPH_SYNC_GO_BUNKER_FUEL_SUPPLIERS=true on oil-live-intel-worker"
echo "Rollback: set flag=false and restart workers; Python sync resumes on admin POST"
