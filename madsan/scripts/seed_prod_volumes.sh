#!/usr/bin/env bash
# MadSan V2 — seed prod named volumes from repo checkout (run once per VM).
#
# Prod overlay mounts madsan_raw_data → /raw and madsan_etl_data → /etl on worker/scheduler.
# Named volumes start empty on first deploy; copy host trees before legacy import / bunker_seed jobs.
#
# Usage (from repo root):
#   ./madsan/scripts/seed_prod_volumes.sh
#   ./madsan/scripts/seed_prod_volumes.sh --dry-run
#
# Requires: docker, readable madsan/raw and madsan/etl on the host.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MADSAN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RAW_SRC="${MADSAN_ROOT}/raw"
ETL_SRC="${MADSAN_ROOT}/etl"
RAW_VOL="${MADSAN_RAW_VOLUME:-madsan_raw_data}"
ETL_VOL="${MADSAN_ETL_VOLUME:-madsan_etl_data}"
DRY_RUN=0

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help)
      sed -n '1,12p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown option: $arg (try --dry-run)" >&2
      exit 1
      ;;
  esac
done

if [[ ! -d "$RAW_SRC" ]]; then
  echo "ERROR: missing $RAW_SRC" >&2
  exit 1
fi
if [[ ! -d "$ETL_SRC" ]]; then
  echo "ERROR: missing $ETL_SRC" >&2
  exit 1
fi

run_seed() {
  local vol="$1"
  local src="$2"
  local label="$3"
  if [[ "$DRY_RUN" == "1" ]]; then
    echo "[dry-run] would seed ${vol} from ${src} (${label})"
    return 0
  fi
  echo "==> Seeding ${vol} from ${src}"
  docker run --rm \
    -v "${vol}:/dest" \
    -v "${src}:/src:ro" \
    alpine cp -a /src/. /dest/
  echo "OK: ${vol}"
}

run_seed "$RAW_VOL" "$RAW_SRC" "raw ingestion (bunker_seed, watch_folder)"
run_seed "$ETL_VOL" "$ETL_SRC" "legacy ETL staging"

if [[ "$DRY_RUN" == "1" ]]; then
  echo "Dry-run complete — no volumes modified."
else
  echo ""
  echo "Verify (optional):"
  echo "  docker run --rm -v ${RAW_VOL}:/v alpine ls -la /v | head"
  echo "  docker run --rm -v ${ETL_VOL}:/v alpine ls -la /v | head"
fi
