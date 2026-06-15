#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MADSAN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MARK="# madsan-v2-backup"
LINE="30 2 * * * cd ${MADSAN_ROOT} && ./scripts/backup_db.sh >> backups/backup_cron.log 2>&1 ${MARK}"
mkdir -p "${MADSAN_ROOT}/backups"
[[ "${1:-}" == "--dry-run" ]] && { echo "$LINE"; exit 0; }
if crontab -l 2>/dev/null | grep -Fq "$MARK"; then echo "already installed"; exit 0; fi
( crontab -l 2>/dev/null || true; echo "$LINE" ) | crontab -
echo "Installed backup cron for ${MADSAN_ROOT}"
