#!/usr/bin/env bash
# Switch Paperclip CEO to Cursor adapter (orchestration — creates/assigns MAD issues).
set -euo pipefail

AI_STACK="${AI_AGENT_STACK:-$HOME/ai-agent-stack}"

if [[ ! -f "$AI_STACK/scripts/paperclip-ceo-cursor.sh" ]]; then
  echo "Missing $AI_STACK/scripts/paperclip-ceo-cursor.sh" >&2
  exit 1
fi

export CURSOR_CEO=1
exec bash "$AI_STACK/scripts/paperclip-ceo-cursor.sh"
