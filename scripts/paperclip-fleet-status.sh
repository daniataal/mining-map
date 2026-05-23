#!/usr/bin/env bash
# Fleet status from mining-map (loads ai-agent-stack .env).
set -euo pipefail
AI_STACK="${AI_AGENT_STACK:-$HOME/ai-agent-stack}"
exec bash "$AI_STACK/scripts/paperclip-fleet-guard.sh" "$@"
