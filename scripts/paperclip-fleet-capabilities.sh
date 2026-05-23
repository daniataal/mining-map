#!/usr/bin/env bash
# Enable workbench capabilities for the full Paperclip fleet (repo, git, bash, web).
set -euo pipefail

AI_STACK="${AI_AGENT_STACK:-$HOME/ai-agent-stack}"
export REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

exec bash "$AI_STACK/scripts/paperclip-fleet-capabilities.sh"
