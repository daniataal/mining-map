#!/usr/bin/env bash
# Migrate Antigravity Engineer off gemini_local (free quota ~20/day) → opencode_local + Ollama.
#
# Usage (from mining-map):
#   bash scripts/paperclip-antigravity-ollama.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AI_STACK="${AI_AGENT_STACK:-$HOME/ai-agent-stack}"

# shellcheck source=/dev/null
source "$AI_STACK/scripts/paperclip-lib.sh"
# shellcheck source=/dev/null
source "$AI_STACK/scripts/paperclip-minimal-context.sh"

paperclip_load_env "$AI_STACK"
: "${PAPERCLIP_API_KEY:?Set PAPERCLIP_API_KEY in $AI_STACK/.env}"

AGENT_ID="${PAPERCLIP_ANTIGRAVITY_AGENT_ID:-e36590ab-8e35-4457-b07c-9bd8dce57724}"
AGENT_NAME="${PAPERCLIP_ANTIGRAVITY_NAME:-Antigravity Engineer}"
MODEL_TAG="${OLLAMA_ANTIGRAVITY_MODEL:-qwen2.5:3b}"
HEARTBEAT_SEC="${OLLAMA_ANTIGRAVITY_HEARTBEAT_SEC:-0}"
CEO_ID="$(paperclip_ceo_id)"
TOKEN="$(paperclip_agent_token)"
OLLAMA_BASE="${OLLAMA_BASE_URL:-http://host.docker.internal:11434}"
OLLAMA_BASE="${OLLAMA_BASE%/}"
INST_FILE="$REPO_ROOT/.paperclip/agents/antigravity/AGENTS.md"

echo "==> $AGENT_NAME → opencode_local + ollama/$MODEL_TAG (heartbeat ${HEARTBEAT_SEC}s)"
echo "    (Gemini free tier exhausted — do not re-enable gemini_local heartbeat)"

bash "$AI_STACK/scripts/paperclip-permissions-fix.sh" 2>/dev/null || true
bash "$AI_STACK/scripts/paperclip-opencode-providers.sh" 2>/dev/null || true
paperclip_install_minimal_skill "$AI_STACK"

paperclip_prepare_opencode_agent_home "$AGENT_ID" 1

export MINIMAL_JSON="$(paperclip_minimal_adapter_json)"
export EXECUTOR_JSON="$(paperclip_executor_opencode_json)"
AGENT_HOME="$(paperclip_opencode_agent_home "$AGENT_ID")"
export OLLAMA_BASE CEO_ID HEARTBEAT_SEC AGENT_HOME MODEL_TAG AGENT_NAME PAPERCLIP_GIT_BRANCH="${PAPERCLIP_GIT_BRANCH:-paperclip2}"
export MINIMAL_JSON EXECUTOR_JSON

PATCH_BODY="$(INST="$(cat "$INST_FILE")" python3 <<'PY'
import json, os

raw = os.environ["MODEL_TAG"].strip()
model = raw if "/" in raw else f"ollama/{raw}"
if model.startswith("ollama/ollama/"):
    model = model.replace("ollama/ollama/", "ollama/", 1)
home = os.environ["AGENT_HOME"]
minimal = json.loads(os.environ["MINIMAL_JSON"])
executor = json.loads(os.environ["EXECUTOR_JSON"])
hb = int(os.environ.get("HEARTBEAT_SEC", "0") or "0")

env = {
    "HOME": {"type": "plain", "value": home},
    "XDG_CONFIG_HOME": {"type": "plain", "value": f"{home}/.config"},
    "XDG_DATA_HOME": {"type": "plain", "value": "/paperclip/.local/share"},
    "OLLAMA_HOST": {"type": "plain", "value": os.environ["OLLAMA_BASE"]},
    "GEMINI_API_KEY": {"type": "plain", "value": ""},
    "GOOGLE_API_KEY": {"type": "plain", "value": ""},
    "PAPERCLIP_GIT_BRANCH": {"type": "plain", "value": os.environ.get("PAPERCLIP_GIT_BRANCH", "paperclip2")},
}

adapter = {
    "cwd": "/workspace/repo",
    "command": "opencode",
    "model": model,
    "dangerouslySkipPermissions": True,
    "env": env,
    **executor,
}

body = {
    "name": os.environ["AGENT_NAME"],
    "role": "engineer",
    "title": "Engineer",
    "icon": "rocket",
    "reportsTo": os.environ["CEO_ID"],
    "capabilities": (
        f"Repo engineer via Ollama ({model}) — Gemini quota retired; assign/@mention only. "
        "Branch paperclip2; minimal Paperclip skill."
    ),
    "adapterType": "opencode_local",
    "adapterConfig": adapter,
    "runtimeConfig": {
        "heartbeat": {
            "enabled": True,
            "intervalSec": hb,
            "wakeOnDemand": True,
            "maxConcurrentRuns": 1,
        },
        "modelProfiles": {
            "cheap": {"enabled": False, "adapterConfig": {"model": model, "env": env}},
        },
    },
}
print(json.dumps(body))
PY
)"

paperclip_curl_json PATCH "/api/agents/$AGENT_ID" "$TOKEN" "$PATCH_BODY" >/dev/null

CID="$(paperclip_company_id)"
docker exec -i paperclip-safe tee \
  "/paperclip/instances/default/companies/${CID}/agents/${AGENT_ID}/instructions/AGENTS.md" \
  >/dev/null <"$INST_FILE"

echo "    patched $AGENT_ID"
echo ""
echo "Done. Paperclip → Resume $AGENT_NAME → **New run** (not Retry)."
echo "CEO: do not assign to gemini_local until billing/quota fixed."
