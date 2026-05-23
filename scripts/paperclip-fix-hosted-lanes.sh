#!/usr/bin/env bash
# Re-apply hosted Paperclip lanes (OpenRouter, Groq, Codex PM, Cursor Engineer).
# Run from mining-map repo root — not from inside scripts/.
#
# Usage:
#   cd ~/Gold\ Project\ /mining-map   # or your mining-map path
#   bash scripts/paperclip-fix-hosted-lanes.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AI_STACK="${AI_AGENT_STACK:-$HOME/ai-agent-stack}"

echo "==> Hosted lanes fix (repo: $REPO_ROOT)"
echo "    ai-agent-stack: $AI_STACK"

bash "$AI_STACK/scripts/paperclip-permissions-fix.sh"
bash "$AI_STACK/scripts/paperclip-adapter-runtime-patch.sh" 2>/dev/null || true
bash "$AI_STACK/scripts/paperclip-opencode-providers.sh" 2>/dev/null || true

if [[ -n "${OPENROUTER_API_KEY:-}" ]] || grep -q '^OPENROUTER_API_KEY=' "$AI_STACK/.env" 2>/dev/null; then
  echo "==> OpenRouter Engineer"
  bash "$AI_STACK/scripts/paperclip-openrouter-agent.sh" || echo "    (OpenRouter skip — check OPENROUTER_API_KEY)"
else
  echo "==> Skip OpenRouter (no OPENROUTER_API_KEY in $AI_STACK/.env)"
fi

if [[ -n "${GROQ_API_KEY:-}" ]] || grep -q '^GROQ_API_KEY=' "$AI_STACK/.env" 2>/dev/null; then
  echo "==> Groq Fast Analyst"
  bash "$AI_STACK/scripts/paperclip-groq-agent.sh" || echo "    (Groq skip — check GROQ_API_KEY)"
else
  echo "==> Skip Groq (no GROQ_API_KEY in $AI_STACK/.env)"
fi

if [[ -f "$REPO_ROOT/scripts/paperclip-codex-pm.sh" ]]; then
  echo "==> Codex Product Manager"
  bash "$REPO_ROOT/scripts/paperclip-codex-pm.sh" 2>/dev/null || echo "    (Codex PM skip — auth or PAPERCLIP_API_KEY)"
fi

if [[ -f "$AI_STACK/scripts/paperclip-cursor-agent.sh" ]]; then
  echo "==> Cursor Engineer"
  bash "$AI_STACK/scripts/paperclip-cursor-agent.sh" 2>/dev/null || true
fi

if [[ -f "$REPO_ROOT/scripts/paperclip-antigravity-ollama.sh" ]]; then
  echo "==> Antigravity Engineer (Ollama)"
  bash "$REPO_ROOT/scripts/paperclip-antigravity-ollama.sh" 2>/dev/null || true
fi

echo ""
echo "Done. Paperclip → Resume each agent → **New run** (not Retry)."
