#!/usr/bin/env bash
# Re-apply lightweight Groq + OpenRouter Paperclip agents (low token / free models).
set -euo pipefail

AI_STACK="${AI_AGENT_STACK:-$HOME/ai-agent-stack}"

if [[ ! -f "$AI_STACK/scripts/paperclip-hosted-agents.sh" ]]; then
  echo "Missing $AI_STACK/scripts/paperclip-hosted-agents.sh" >&2
  exit 1
fi

echo "==> Lightweight hosted lanes (Groq triage + OpenRouter executor)"
bash "$AI_STACK/scripts/paperclip-hosted-agents.sh"

echo ""
echo "Done. In Paperclip: Resume agents → start a **new run** (do not Retry failed runs)."
