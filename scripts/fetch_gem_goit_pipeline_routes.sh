#!/usr/bin/env bash
# Fetch GEM GOIT/GGIT pipeline route GeoJSON (per ProjectID) for join with the xlsx workbook.
# License: CC BY 4.0 — Global Energy Monitor, GOIT March 2025 release.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ROUTES_ROOT="${GEM_GOIT_ROUTES_DIR:-$REPO_ROOT/data/gem/goit-pipeline-routes}"
ROUTES_PATH="$ROUTES_ROOT/data/individual-routes/liquid-pipelines"
ZIP_URL="${GEM_GOIT_ROUTES_ZIP_URL:-https://github.com/GlobalEnergyMonitor/GOIT-GGIT-pipeline-routes/archive/refs/heads/main.zip}"

mkdir -p "$(dirname "$ROUTES_PATH")"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "[gem-goit] downloading route archive..."
curl -fsSL "$ZIP_URL" -o "$TMP/routes.zip"
unzip -q "$TMP/routes.zip" -d "$TMP"

EXTRACTED="$(find "$TMP" -maxdepth 1 -type d -name 'GOIT-GGIT-pipeline-routes-*' | head -1)"
SRC="$EXTRACTED/data/individual-routes/liquid-pipelines"
if [[ ! -d "$SRC" ]]; then
  echo "[gem-goit] error: expected data/individual-routes/liquid-pipelines in archive" >&2
  exit 1
fi

echo "[gem-goit] installing routes into $ROUTES_PATH"
rm -rf "$ROUTES_PATH"
mkdir -p "$(dirname "$ROUTES_PATH")"
cp -R "$SRC" "$ROUTES_PATH"

count="$(find "$ROUTES_PATH" -maxdepth 1 -name '*.geojson' | wc -l | tr -d ' ')"
echo "[gem-goit] route files: $count (oil/NGL liquid-pipelines)"
echo "[gem-goit] pair with workbook: GEM-GOIT-Oil-NGL-Pipelines-2025-03.xlsx (or GEM_GOIT_PIPELINES_XLSX_PATH)"
