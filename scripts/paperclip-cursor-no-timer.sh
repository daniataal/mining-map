#!/usr/bin/env bash
# Disable Cursor Engineer idle heartbeat (default: wake on assign / @mention only).
set -euo pipefail

AI_STACK="${AI_AGENT_STACK:-$HOME/ai-agent-stack}"
export CURSOR_HEARTBEAT_SEC=0

exec bash "$AI_STACK/scripts/paperclip-cursor-agent.sh"
