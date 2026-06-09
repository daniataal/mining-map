#!/usr/bin/env bash
# Lightweight VM health probe for cron / external monitoring (exit non-zero on failure).
#
# Usage:
#   ./scripts/vm-health-check.sh
#   VM_HEALTH_MODE=caddy-only ./scripts/vm-health-check.sh   # Tier-3 scale (no :8000/:8095)
#
# Modes (VM_HEALTH_MODE):
#   auto       — Caddy probes required; direct :8000/:8095 warn-only if down (default)
#   caddy-only — Caddy paths only (use with docker-compose.prod.scale.yml)
#   full       — all probes must pass

set -euo pipefail

BACKEND_PORT="${MINING_MAP_BACKEND_PORT:-8000}"
OIL_INTEL_PORT="${MINING_MAP_OIL_INTEL_PORT:-8095}"
CADDY_PORT="${MINING_MAP_CADDY_PORT:-8080}"
CONNECT_TIMEOUT="${VM_HEALTH_CONNECT_TIMEOUT:-5}"
MAX_TIME="${VM_HEALTH_MAX_TIME:-15}"
MODE="${VM_HEALTH_MODE:-auto}"
LOG_TAG="[vm-health-check]"

failures=0
warnings=0

probe() {
  local severity="$1"
  local name="$2"
  local url="$3"
  local code
  code=$(curl -sf -o /dev/null -w "%{http_code}" \
    --connect-timeout "$CONNECT_TIMEOUT" --max-time "$MAX_TIME" "$url" 2>/dev/null || echo "000")
  if [[ "$code" =~ ^2 ]]; then
    echo "$LOG_TAG OK  $name HTTP $code"
    return 0
  fi
  if [[ "$severity" == "required" ]]; then
    echo "$LOG_TAG FAIL $name HTTP ${code:-err} ($url)" >&2
    failures=$((failures + 1))
  else
    echo "$LOG_TAG WARN $name HTTP ${code:-err} ($url)" >&2
    warnings=$((warnings + 1))
  fi
  return 1
}

# User-facing path (works Tier 1 and Tier 3 scale via Caddy → backend-a/b, oil-live-a/b)
probe required caddy-oil-live "http://127.0.0.1:${CADDY_PORT}/api/oil-live/health/live"
probe required caddy-platform "http://127.0.0.1:${CADDY_PORT}/api/health"
probe required caddy-entry "http://127.0.0.1:${CADDY_PORT}/"

if [[ "$MODE" == "caddy-only" ]]; then
  :
elif [[ "$MODE" == "full" ]]; then
  probe required backend "http://127.0.0.1:${BACKEND_PORT}/docs"
  probe required oil-live-intel "http://127.0.0.1:${OIL_INTEL_PORT}/api/oil-live/health/live"
else
  probe optional backend "http://127.0.0.1:${BACKEND_PORT}/docs" || true
  probe optional oil-live-intel "http://127.0.0.1:${OIL_INTEL_PORT}/api/oil-live/health/live" || true
fi

if [[ "$failures" -gt 0 ]]; then
  echo "$LOG_TAG OVERALL: FAIL ($failures probe(s), ${warnings} warn)" >&2
  exit 1
fi

echo "$LOG_TAG OVERALL: OK (${warnings} warn)"
exit 0
