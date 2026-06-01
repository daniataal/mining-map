#!/usr/bin/env bash
# Ensure host + Paperclip project use branch paperclip2; re-sync agent instructions.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AI_STACK="${AI_AGENT_STACK:-$HOME/ai-agent-stack}"
export PAPERCLIP_GIT_BRANCH="${PAPERCLIP_GIT_BRANCH:-paperclip2}"
export TARGET_REPO="${TARGET_REPO:-$REPO_ROOT}"

# shellcheck source=/dev/null
source "$AI_STACK/scripts/paperclip-git-branch.sh"
paperclip_ensure_host_branch
paperclip_patch_project_repo_ref

echo "==> Agent instructions include branch $PAPERCLIP_GIT_BRANCH (.paperclip/GIT-BRANCH.md)"

# Re-apply agents so env + instructions stay in sync
[[ -f "$AI_STACK/scripts/paperclip-ceo-cursor.sh" ]] && bash "$AI_STACK/scripts/paperclip-ceo-cursor.sh" 2>/dev/null || true
[[ -f "$AI_STACK/scripts/paperclip-cursor-agent.sh" ]] && bash "$AI_STACK/scripts/paperclip-cursor-agent.sh" 2>/dev/null || true
[[ -f "$REPO_ROOT/scripts/paperclip-ollama-architect.sh" ]] && bash "$REPO_ROOT/scripts/paperclip-ollama-architect.sh" 2>/dev/null || true
[[ -f "$REPO_ROOT/scripts/paperclip-ollama-cto.sh" ]] && bash "$REPO_ROOT/scripts/paperclip-ollama-cto.sh" 2>/dev/null || true
[[ -f "$AI_STACK/scripts/paperclip-openrouter-agent.sh" ]] && bash "$AI_STACK/scripts/paperclip-openrouter-agent.sh" 2>/dev/null || true
[[ -f "$AI_STACK/scripts/paperclip-groq-agent.sh" ]] && bash "$AI_STACK/scripts/paperclip-groq-agent.sh" 2>/dev/null || true
bash "$REPO_ROOT/scripts/paperclip-ollama-specialists.sh" 2>/dev/null || true

echo ""
echo "All Paperclip repo agents should run on branch: $PAPERCLIP_GIT_BRANCH"
