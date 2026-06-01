#!/usr/bin/env bash
# Copy local EIA impa*.xls(x) to production VM for eia-historic-sync-worker.
#
# Usage (from repo root on your laptop):
#   VM_HOST=user@your-vm-ip ./scripts/rsync-eia-downloads-to-vm.sh
#   VM_HOST=user@1.2.3.4 VM_PATH=/opt/mining-map ./scripts/rsync-eia-downloads-to-vm.sh
#
# After sync on VM:
#   cd /opt/mining-map && docker compose -f docker-compose.prod.yml up -d eia-historic-sync-worker
#   docker compose -f docker-compose.prod.yml logs eia-historic-sync-worker --tail 30

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${ROOT}/data/eia_downloads/"
HOST="${VM_HOST:-}"
DEST_PATH="${VM_PATH:-/opt/mining-map}/data/eia_downloads/"

if [[ -z "$HOST" ]]; then
  echo "Set VM_HOST=user@host (SSH target) and re-run." >&2
  exit 1
fi

if [[ ! -d "$SRC" ]]; then
  echo "Missing $SRC — add impa*.xls(x) first." >&2
  exit 1
fi

count=$(find "$SRC" -maxdepth 1 \( -name 'impa*.xls' -o -name 'impa*.xlsx' \) 2>/dev/null | wc -l | tr -d ' ')
if [[ "${count:-0}" -lt 1 ]]; then
  echo "No impa*.xls(x) in $SRC" >&2
  exit 1
fi

echo "Syncing $count EIA file(s) to ${HOST}:${DEST_PATH}"
ssh "$HOST" "mkdir -p '${DEST_PATH}'"
rsync -avz --progress "${SRC}" "${HOST}:${DEST_PATH}"
echo "Done. On VM: docker compose -f docker-compose.prod.yml up -d eia-historic-sync-worker"
