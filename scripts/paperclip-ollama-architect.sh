#!/usr/bin/env bash
# Register/update Meridian Architect (Ollama) — fleet health / agent ops.
# Requires: ~/ai-agent-stack running, PAPERCLIP_API_KEY in ai-agent-stack/.env
#
# Usage (from mining-map):
#   bash scripts/paperclip-ollama-architect.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AI_STACK="${AI_AGENT_STACK:-$HOME/ai-agent-stack}"

if [[ ! -f "$AI_STACK/scripts/paperclip-lib.sh" ]]; then
  echo "Missing $AI_STACK/scripts/paperclip-lib.sh — set AI_AGENT_STACK or install ai-agent-stack." >&2
  exit 1
fi

# shellcheck source=/dev/null
source "$AI_STACK/scripts/paperclip-lib.sh"
# shellcheck source=/dev/null
source "$AI_STACK/scripts/paperclip-minimal-context.sh"

paperclip_load_env "$AI_STACK"
: "${PAPERCLIP_API_KEY:?Set PAPERCLIP_API_KEY in $AI_STACK/.env}"

OLLAMA_BASE="${OLLAMA_BASE_URL:-http://host.docker.internal:11434}"
OLLAMA_BASE="${OLLAMA_BASE%/}"
CEO_ID="$(paperclip_ceo_id)"
TOKEN="$(paperclip_agent_token)"
COMPANY_ID="$(paperclip_company_id)"

AGENT_NAME="${OLLAMA_ARCHITECT_NAME:-Meridian Architect (Ollama)}"
MODEL_TAG="${OLLAMA_ARCHITECT_MODEL:-qwen2.5:3b}"
ICON="${OLLAMA_ARCHITECT_ICON:-radar}"
HEARTBEAT_SEC="${OLLAMA_ARCHITECT_HEARTBEAT_SEC:-0}"
INST_FILE="$REPO_ROOT/.paperclip/agents/architect/AGENTS.md"

if [[ ! -f "$INST_FILE" ]]; then
  echo "Missing $INST_FILE" >&2
  exit 1
fi

bash "$AI_STACK/scripts/paperclip-permissions-fix.sh" 2>/dev/null || true
bash "$AI_STACK/scripts/paperclip-adapter-runtime-patch.sh" 2>/dev/null || true
if declare -F paperclip_wait_ready >/dev/null 2>&1; then
  paperclip_wait_ready || true
else
  for i in $(seq 1 15); do curl -sf -o /dev/null "http://127.0.0.1:3100/" 2>/dev/null && break; sleep 2; done
fi
bash "$AI_STACK/scripts/paperclip-opencode-providers.sh"
paperclip_install_minimal_skill "$AI_STACK"

export MINIMAL_JSON="$(paperclip_minimal_adapter_json)"
export PAPERCLIP_GIT_BRANCH="${PAPERCLIP_GIT_BRANCH:-paperclip2}"
export OLLAMA_BASE CEO_ID HEARTBEAT_SEC AGENT_NAME MODEL_TAG ICON

agent_id=""
is_new=0
if agent_id="$(paperclip_agent_exists "$AGENT_NAME" 2>/dev/null)"; then
  echo "==> Patch $AGENT_NAME ($agent_id)"
else
  echo "==> Hire $AGENT_NAME (new agent)"
  is_new=1
fi

agent_home="/paperclip/instances/default/agents/pending/opencode-home"
if [[ -n "$agent_id" ]]; then
  agent_home="$(paperclip_opencode_agent_home "$agent_id")"
  paperclip_prepare_opencode_agent_home "$agent_id" 1
fi

export AGENT_HOME="$agent_home"
patch_body="$(python3 <<'PY'
import json, os

raw = os.environ["MODEL_TAG"].strip()
while raw.startswith("ollama/ollama/"):
    raw = raw[len("ollama/"):]
model = raw if raw.startswith("ollama/") else f"ollama/{raw}"
minimal = json.loads(os.environ["MINIMAL_JSON"])
home = os.environ["AGENT_HOME"]
hb = int(os.environ.get("HEARTBEAT_SEC", "0") or "0")

env = {
    "HOME": {"type": "plain", "value": home},
    "XDG_CONFIG_HOME": {"type": "plain", "value": f"{home}/.config"},
    "XDG_DATA_HOME": {"type": "plain", "value": "/paperclip/.local/share"},
    "OLLAMA_HOST": {"type": "plain", "value": os.environ["OLLAMA_BASE"]},
    "GEMINI_API_KEY": {"type": "plain", "value": ""},
    "GOOGLE_API_KEY": {"type": "plain", "value": ""},
    "ANTHROPIC_API_KEY": {"type": "plain", "value": ""},
    "PAPERCLIP_GIT_BRANCH": {"type": "plain", "value": os.environ.get("PAPERCLIP_GIT_BRANCH", "paperclip2")},
}

adapter = {
    "cwd": "/workspace/repo",
    "command": "opencode",
    "model": model,
    "dangerouslySkipPermissions": True,
    "env": env,
    **minimal,
}

body = {
    "name": os.environ["AGENT_NAME"],
    "role": "researcher",
    "title": "Architect",
    "icon": os.environ["ICON"],
    "reportsTo": os.environ["CEO_ID"],
    "capabilities": (
        f"Fleet architect ({model}) — verifies Paperclip agents/adapters/branch policy; "
        "creates remediation issues for CEO. Assignment/@mention only."
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

if [[ "$is_new" -eq 0 ]]; then
  paperclip_curl_json PATCH "/api/agents/$agent_id" "$TOKEN" "$patch_body" >/dev/null
else
  export patch_body
  hire_body="$(INST="$(cat "$INST_FILE")" python3 -c '
import json, os
b = json.loads(os.environ["patch_body"])
adapter = dict(b["adapterConfig"])
for key in ("promptTemplate", "bootstrapPromptTemplate", "paperclipRuntimeSkills", "paperclipSkillSync"):
    adapter.pop(key, None)
b["adapterConfig"] = adapter
b["instructionsBundle"] = {"files": {"AGENTS.md": os.environ["INST"]}}
print(json.dumps(b))
')"
  paperclip_submit_hire "$hire_body" >/dev/null
  agent_id="$(paperclip_agent_exists "$AGENT_NAME")"
  paperclip_prepare_opencode_agent_home "$agent_id"
  paperclip_curl_json PATCH "/api/agents/$agent_id" "$TOKEN" "$patch_body" >/dev/null
fi

DELEGATION="$AI_STACK/scripts/paperclip-ceo-delegation.md"
container_inst="/paperclip/instances/default/companies/${COMPANY_ID}/agents/${agent_id}/instructions"
docker exec -i paperclip-safe tee "${container_inst}/AGENTS.md" >/dev/null <"$INST_FILE"
docker exec -i paperclip-safe tee "${container_inst}/CEO-DELEGATION.md" >/dev/null <"$DELEGATION"

echo "    agent id: $agent_id"
echo "    instructions → ${container_inst}/AGENTS.md"
echo "    model ollama/$MODEL_TAG @ $OLLAMA_BASE"
echo "    heartbeat: ${HEARTBEAT_SEC}s (0 = assign/@mention only)"
echo ""
echo "Done. Paperclip UI → Agents → Resume \"${AGENT_NAME}\"."
echo "CEO: assign periodic \"fleet health check\" issues to this agent."
