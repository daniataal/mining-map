#!/usr/bin/env bash
# Fix OpenClaw Operator for Paperclip (gateway token + Ollama model).
set -euo pipefail

AI_STACK="${AI_AGENT_STACK:-$HOME/ai-agent-stack}"

if [[ ! -f "$AI_STACK/scripts/paperclip-openclaw-fix.sh" ]]; then
  echo "Missing $AI_STACK/scripts/paperclip-openclaw-fix.sh" >&2
  exit 1
fi

bash "$AI_STACK/scripts/paperclip-openclaw-fix.sh"
bash "$AI_STACK/scripts/paperclip-openclaw-ollama.sh"

echo ""
echo "Done. Paperclip UI → Resume OpenClaw Operator → **new run** (not Retry)."
