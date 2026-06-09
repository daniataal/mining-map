#!/usr/bin/env bash
# Merge config/production.env (committed feature flags) with deploy secrets → backend.env
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PRODUCTION_ENV="${PRODUCTION_ENV:-$ROOT/config/production.env}"
OUTPUT="${1:-$ROOT/backend.env}"

if [[ ! -f "$PRODUCTION_ENV" ]]; then
  echo "render_backend_env: missing $PRODUCTION_ENV" >&2
  exit 1
fi

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

cp "$PRODUCTION_ENV" "$tmpdir/base.env"
overlay="$tmpdir/overlay.env"
: > "$overlay"

append_kv() {
  local key="$1"
  local val="${2-}"
  printf '%s=%s\n' "$key" "$val" >> "$overlay"
}

append_if_set() {
  local key="$1"
  local val="${2-}"
  if [[ -n "$val" ]]; then
    append_kv "$key" "$val"
  fi
}

# GitHub secret name aliases → runtime env names (see .env.example).
GROQ_EFFECTIVE="${GROQ_AI_API_KEY:-${GROQ_API_KEY:-}}"
OPENROUTER_EFFECTIVE="${OPENROUTER_AI_API_KEY:-${OPENROUTER_API_KEY:-}}"
MAPBOX_EFFECTIVE="${MAPBOX_ACCESS_TOKEN:-${MAPBOX_TOKEN:-}}"
COMTRADE_EFFECTIVE="${COMTRADE_API_KEY:-}"
GOOGLE_CSE_EFFECTIVE="${GOOGLE_CSE_CX:-${GOOGLE_CSE_ID:-}}"

# --- Secrets overlay (empty values allowed so health checks can report MISSING) ---
append_kv AISSTREAM_API_KEY "${AISSTREAM_API_KEY:-}"
append_kv ADMIN_TOKEN "${ADMIN_TOKEN:-}"
append_kv MAPBOX_ACCESS_TOKEN "$MAPBOX_EFFECTIVE"
append_kv GROQ_API_KEY "$GROQ_EFFECTIVE"
append_kv OPENROUTER_API_KEY "$OPENROUTER_EFFECTIVE"
append_kv COMTRADE_API_KEY "$COMTRADE_EFFECTIVE"
append_if_set COMTRADE_API_KEY_SECONDARY "${COMTRADE_API_KEY_SECONDARY:-}"
append_kv EIA_API_KEY "${EIA_API_KEY:-}"
append_kv CENSUS_API_KEY "${CENSUS_API_KEY:-}"
append_kv USITC_DATAWEB_API_KEY "${USITC_DATAWEB_API_KEY:-}"
append_kv KZ_EGOV_API_KEY "${KZ_EGOV_API_KEY:-}"
append_kv OPENSANCTIONS_API_KEY "${OPENSANCTIONS_API_KEY:-}"
append_kv COURTLISTENER_API_KEY "${COURTLISTENER_API_KEY:-}"
append_if_set SYNC_ALERT_WEBHOOK_URL "${SYNC_ALERT_WEBHOOK_URL:-}"
append_kv OIL_INTEL_INTERNAL_KEY "${OIL_INTEL_INTERNAL_KEY:-oil-intel-dev}"
append_kv SECRET_KEY "${SECRET_KEY:-}"
append_if_set SHIPVAULT_REFRESH_TOKEN "${SHIPVAULT_REFRESH_TOKEN:-}"
append_if_set SHIPVAULT_SESSION_JSON "${SHIPVAULT_SESSION_JSON:-}"
append_if_set SHIPVAULT_BEARER_TOKEN "${SHIPVAULT_BEARER_TOKEN:-}"
append_if_set SHIPVAULT_EMAIL "${SHIPVAULT_EMAIL:-}"
append_if_set SHIPVAULT_PASSWORD "${SHIPVAULT_PASSWORD:-}"
append_if_set SHIPVAULT_FIREBASE_API_KEY "${SHIPVAULT_FIREBASE_API_KEY:-}"
append_if_set BARENTSWATCH_CLIENT_ID "${BARENTSWATCH_CLIENT_ID:-}"
append_if_set BARENTSWATCH_CLIENT_SECRET "${BARENTSWATCH_CLIENT_SECRET:-}"
append_if_set GOOGLE_CSE_API_KEY "${GOOGLE_CSE_API_KEY:-}"
append_if_set GOOGLE_CSE_CX "$GOOGLE_CSE_EFFECTIVE"
append_if_set SERPAPI_API_KEY "${SERPAPI_API_KEY:-}"

# GitHub repository variables (non-secret tuning) override production.env when set.
append_if_set SHIPVAULT_CACHE_TTL_DAYS "${SHIPVAULT_CACHE_TTL_DAYS:-}"
append_if_set SHIPVAULT_BACKFILL_ENABLED "${SHIPVAULT_BACKFILL_ENABLED:-}"
append_if_set SHIPVAULT_BACKFILL_LIMIT "${SHIPVAULT_BACKFILL_LIMIT:-}"
append_if_set SHIPVAULT_BACKFILL_INTERVAL_HOURS "${SHIPVAULT_BACKFILL_INTERVAL_HOURS:-}"

# --- Auto-enable: flip feature flags on when credentials are present ---
if [[ -n "${COMTRADE_EFFECTIVE:-}" ]]; then
  append_kv COMTRADE_SYNC_ENABLED true
fi
if [[ -n "${CENSUS_API_KEY:-}" ]]; then
  append_kv CENSUS_TRADE_SYNC_ENABLED true
fi
if [[ -n "${USITC_DATAWEB_API_KEY:-}" ]]; then
  append_kv USITC_TRADE_SYNC_ENABLED true
fi
if [[ -n "${EIA_API_KEY:-}" ]]; then
  append_kv EIA_HISTORIC_SYNC_ENABLED true
  append_kv EIA_HISTORIC_AUTO_INGEST true
fi
if [[ -n "${KZ_EGOV_API_KEY:-}" ]]; then
  append_kv KZ_EGOV_SYNC_ENABLED true
fi
if [[ -n "${BARENTSWATCH_CLIENT_ID:-}" && -n "${BARENTSWATCH_CLIENT_SECRET:-}" ]]; then
  append_kv BARENTSWATCH_AIS_SYNC_ENABLED true
fi
if [[ -n "${SHIPVAULT_REFRESH_TOKEN:-}" || -n "${SHIPVAULT_SESSION_JSON:-}" || -n "${SHIPVAULT_BEARER_TOKEN:-}" ]]; then
  append_kv SHIPVAULT_BACKFILL_ENABLED "${SHIPVAULT_BACKFILL_ENABLED:-true}"
fi

# Merge base + overlay; overlay wins on duplicate keys.
awk -F= '
  function trim(s) { sub(/^[ \t]+/, "", s); sub(/[ \t]+$/, "", s); return s }
  /^[ \t]*#/ { next }
  /^[ \t]*$/ { next }
  {
    eq = index($0, "=")
    if (eq < 1) next
    key = trim(substr($0, 1, eq - 1))
    val = substr($0, eq + 1)
    map[key] = val
  }
  END {
    for (k in map) print k "=" map[k]
  }
' "$tmpdir/base.env" "$overlay" | sort > "$OUTPUT"

echo "render_backend_env: wrote $(wc -l < "$OUTPUT" | tr -d " ") keys to $OUTPUT"

# Deploy visibility — SET/MISSING for critical secrets (no values printed).
check_keys=(
  AISSTREAM_API_KEY ADMIN_TOKEN SECRET_KEY OIL_INTEL_INTERNAL_KEY
  GROQ_API_KEY OPENROUTER_API_KEY MAPBOX_ACCESS_TOKEN
  COMTRADE_API_KEY CENSUS_API_KEY USITC_DATAWEB_API_KEY EIA_API_KEY
)
for key in "${check_keys[@]}"; do
  val="$(grep -E "^${key}=" "$OUTPUT" | tail -1 | cut -d= -f2- || true)"
  if [[ -n "$val" ]]; then
    echo "  ${key}=SET"
  else
    echo "  ${key}=MISSING"
  fi
done

if [[ -z "${SECRET_KEY:-}" ]]; then
  echo "WARN: SECRET_KEY is MISSING — set GitHub secret SECRET_KEY before production use" >&2
fi
if [[ -z "${OIL_INTEL_INTERNAL_KEY:-}" ]]; then
  echo "WARN: OIL_INTEL_INTERNAL_KEY unset — using oil-intel-dev default" >&2
fi
