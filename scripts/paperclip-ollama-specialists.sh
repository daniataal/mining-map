#!/usr/bin/env bash
# Register/update Meridian Paperclip specialists → opencode_local + Ollama (small models).
# Requires: ~/ai-agent-stack running (paperclip-safe), PAPERCLIP_API_KEY in ai-agent-stack/.env
#
# Usage (from mining-map):
#   bash scripts/paperclip-ollama-specialists.sh
#   bash scripts/paperclip-ollama-specialists.sh triage docs   # subset
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
HEARTBEAT_SEC="${OLLAMA_SPECIALIST_HEARTBEAT_SEC:-0}"

bash "$AI_STACK/scripts/paperclip-permissions-fix.sh" 2>/dev/null || true
bash "$AI_STACK/scripts/paperclip-adapter-runtime-patch.sh" 2>/dev/null || true
bash "$AI_STACK/scripts/paperclip-opencode-providers.sh"
paperclip_install_minimal_skill "$AI_STACK"

export MINIMAL_JSON="$(paperclip_minimal_adapter_json)"
export OLLAMA_BASE CEO_ID HEARTBEAT_SEC

# name | ollama tag | subdir under .paperclip/agents | icon
ALL_AGENTS=(
  "Paperclip Triage|llama3.2:3b|triage|list"
  "Paperclip Docs|qwen2.5:3b|docs-writer|file-text"
  "Paperclip Status|phi3:mini|status|message-square"
  "Paperclip Diagnose|llama3.2:3b|diagnose|stethoscope"
)

FILTER=()
if [[ $# -gt 0 ]]; then
  for a in "$@"; do
    case "$a" in
      docs) FILTER+=("docs-writer") ;;
      *) FILTER+=("$a") ;;
    esac
  done
fi

want() {
  local key="$1"
  shift
  [[ $# -eq 0 ]] && return 0
  for a in "$@"; do
    [[ "$a" == "$key" ]] && return 0
  done
  return 1
}

upsert_agent() {
  local name="$1" model_tag="$2" subdir="$3" icon="$4"
  local key="${subdir%%/*}"

  if [[ ${#FILTER[@]} -gt 0 ]] && ! want "$key" "${FILTER[@]}"; then
    echo "==> Skip $name (not in filter)"
    return 0
  fi

  local inst_file="$REPO_ROOT/.paperclip/agents/$subdir/AGENTS.md"
  if [[ ! -f "$inst_file" ]]; then
    echo "Missing $inst_file" >&2
    return 1
  fi

  local agent_id="" is_new=0
  if agent_id="$(paperclip_agent_exists "$name" 2>/dev/null)"; then
    echo "==> Patch $name ($agent_id)"
  else
    echo "==> Hire $name (new agent)"
    is_new=1
  fi

  local agent_home="/paperclip/instances/default/agents/pending/opencode-home"
  if [[ -n "$agent_id" ]]; then
    agent_home="$(paperclip_opencode_agent_home "$agent_id")"
    paperclip_prepare_opencode_agent_home "$agent_id" 1
  fi

  export AGENT_NAME="$name" MODEL_TAG="$model_tag" ICON="$icon" AGENT_HOME="$agent_home"
  local patch_body
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
    "title": os.environ["AGENT_NAME"],
    "icon": os.environ["ICON"],
    "reportsTo": os.environ["CEO_ID"],
    "capabilities": f"Ollama specialist ({model}) — assignment/@mention only; minimal Paperclip skill.",
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
    local hire_body
    hire_body="$(INST="$(cat "$inst_file")" python3 -c '
import json, os
b = json.loads(os.environ["patch_body"])
b["instructionsBundle"] = {"files": {"AGENTS.md": os.environ["INST"]}}
print(json.dumps(b))
')"
    paperclip_submit_hire "$hire_body" >/dev/null
    agent_id="$(paperclip_agent_exists "$name")"
    paperclip_prepare_opencode_agent_home "$agent_id"
    paperclip_curl_json PATCH "/api/agents/$agent_id" "$TOKEN" "$patch_body" >/dev/null
  fi

  local container_inst="/paperclip/instances/default/companies/${COMPANY_ID}/agents/${agent_id}/instructions/AGENTS.md"
  docker exec -i paperclip-safe tee "$container_inst" >/dev/null <"$inst_file"
  echo "    instructions → $container_inst"
  echo "    model ollama/$model_tag @ $OLLAMA_BASE"
}

echo "==> Ollama specialists (heartbeat interval ${HEARTBEAT_SEC}s — 0 = assign/@mention only)"
for row in "${ALL_AGENTS[@]}"; do
  IFS='|' read -r n m s i <<<"$row"
  upsert_agent "$n" "$m" "$s" "$i"
done

echo ""
echo "Done. In Paperclip UI → Agents: Resume each specialist. Assign issues manually or @mention."
echo "Do NOT enable long-interval heartbeats on these lanes (CEO/Cursor own Meridian work)."
