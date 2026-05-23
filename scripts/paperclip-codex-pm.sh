#!/usr/bin/env bash
# Install Codex CLI Product Manager agent in Paperclip.
set -euo pipefail
AI_STACK="${AI_AGENT_STACK:-$HOME/ai-agent-stack}"
export TARGET_REPO="$(cd "$(dirname "$0")/.." && pwd)"
exec bash "$AI_STACK/scripts/paperclip-codex-pm.sh"
