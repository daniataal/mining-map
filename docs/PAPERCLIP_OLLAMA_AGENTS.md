# Paperclip + Ollama specialist agents (Mac)

Small **local** models for Paperclip chores (triage, short docs, status comments)—**not** full Meridian engineering heartbeats. **Cursor Engineer** stays on the `cursor` adapter for code.

## Architecture (this repo + ai-agent-stack)

| Layer | Location |
|-------|----------|
| Paperclip UI / API | `http://127.0.0.1:3100` — Docker `paperclip-safe` in `~/ai-agent-stack` |
| Ollama on Mac | `http://127.0.0.1:11434` — containers use `http://host.docker.internal:11434` |
| Specialist instructions | `mining-map/.paperclip/agents/*/AGENTS.md` |
| Setup script | `mining-map/scripts/paperclip-ollama-specialists.sh` |
| Shared API helpers | `~/ai-agent-stack/scripts/paperclip-lib.sh` |
| Minimal skill (~1 KB) | `~/ai-agent-stack/scripts/paperclip-skill-minimal/` |

**Adapters (Paperclip):**

| Adapter | Use |
|---------|-----|
| `opencode_local` | Ollama / Groq / OpenRouter via OpenCode in container |
| `cursor` | Cursor Engineer — primary repo work |
| `openclaw_gateway` | Research + Obsidian (separate from these specialists) |
| `gemini_local` | CEO when `OLLAMA_CEO=0` |

MCP in Cursor (`mining-map/.cursor/mcp.json`) talks to Paperclip; specialists run **inside** Paperclip wakes, not in the IDE.

## Recommended specialists

| Agent name | Model (`ollama/…`) | Adapter | Instructions | Use case |
|------------|-------------------|---------|--------------|----------|
| **Paperclip Triage** | `llama3.2:3b` | `opencode_local` | `.paperclip/agents/triage/AGENTS.md` | Status, assignee, one short comment |
| **Paperclip Docs** | `qwen2.5:3b` | `opencode_local` | `.paperclip/agents/docs-writer/AGENTS.md` | Issue doc / acceptance markdown |
| **Paperclip Status** | `phi3:mini` | `opencode_local` | `.paperclip/agents/status/AGENTS.md` | Progress comment, light PATCH |
| **Paperclip Diagnose** | `llama3.2:3b` | `opencode_local` | `.paperclip/agents/diagnose/AGENTS.md` | Single-file / error triage |

Example PATCH body: `.paperclip/agents/example-opencode-agent-patch.json`.

**Keep heartbeats off** for specialists (`intervalSec: 0`, wake on assign/@mention). CEO (`paperclip-ceo-ollama.sh`) and **Cursor Engineer** own scheduled / heavy work.

## Mac setup — pull models

You currently have `qwen2.5-coder:7b-instruct` (fine for OpenClaw; too heavy for four parallel specialists). Pull small models:

```bash
ollama pull llama3.2:3b
ollama pull qwen2.5:3b
ollama pull phi3:mini
```

Optional embed models (already installed): `nomic-embed-text`, `mxbai-embed-large`.

Verify:

```bash
ollama list
curl -s http://127.0.0.1:11434/api/tags | head
```

Ensure `~/ai-agent-stack/.env` includes:

```bash
OLLAMA_BASE_URL=http://host.docker.internal:11434
PAPERCLIP_API_KEY=<agent key from Paperclip UI>
```

Stack up:

```bash
cd ~/ai-agent-stack && docker compose up -d paperclip openclaw
```

## Register agents (automated)

From **mining-map** (no sudo — loads `ai-agent-stack/.env`):

```bash
bash scripts/paperclip-ollama-specialists.sh
# or subset:
bash scripts/paperclip-ollama-specialists.sh triage docs
```

This script:

1. Installs minimal Paperclip skill in `paperclip-safe`
2. Syncs Ollama provider via `paperclip-opencode-providers.sh`
3. `PATCH` existing agents or `POST /api/companies/{id}/agent-hires`
4. Copies each `AGENTS.md` into the agent’s Paperclip instructions path

## Manual API (if script fails)

```bash
source ~/ai-agent-stack/scripts/paperclip-lib.sh
paperclip_load_env ~/ai-agent-stack
TOKEN="$(paperclip_agent_token)"
CID="$(paperclip_company_id)"

# List agents
paperclip_curl_json GET "/api/companies/$CID/agents" "$TOKEN" | jq '.[].name,.id'

# Patch one agent (see example JSON)
paperclip_curl_json PATCH "/api/agents/<AGENT_UUID>" "$TOKEN" "$(cat .paperclip/agents/example-opencode-agent-patch.json)"
```

Hire new agent:

```http
POST /api/companies/{companyId}/agent-hires
Authorization: Bearer $PAPERCLIP_API_KEY
Content-Type: application/json

{ ... body from example-opencode-agent-patch.json ... }
```

## Paperclip UI (required)

After running the script:

1. Open **http://127.0.0.1:3100** → **Agents**
2. **Resume** each specialist (paused agents show “Cancelled due to agent pause”)
3. Confirm **heartbeat interval = 0** (or disabled timer) — only **wake on demand**
4. Assign issues to a specialist, or @mention in a comment
5. **Approvals** — approve if the board requires it for new hires
6. Leave **CEO** on Ollama/Gemini orchestration; **Cursor Engineer** on `cursor` adapter for MAD implementation

Do **not** point specialists at full-repo Meridian heartbeats (Live Data ingest, graph-sync, etc.).

## Cursor MCP (IDE)

`mining-map/.cursor/mcp.json` runs Paperclip MCP via Docker. Tools include `paperclipListAgents`, `paperclipGetAgent`, `paperclipApiRequest` — there is **no** “create agent” MCP tool; use the bash script or UI.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `connection refused` to Ollama from container | Ollama running on Mac; `OLLAMA_BASE_URL=http://host.docker.internal:11434` |
| OpenCode picks wrong model | Re-run `bash ~/ai-agent-stack/scripts/paperclip-opencode-providers.sh` |
| Huge token use | Re-run `paperclip-minimal-context.sh` path: `paperclip_install_minimal_skill` |
| `403 Board access required` | Agent token cannot create secrets; use default `local-env` keys in `.env` |
| Invalid `.cursor/cli.json` | Repo file must be **permissions only** — see `.paperclip-mad13-unblock.md` |

## Related

- CEO roster IDs: `~/ai-agent-stack/scripts/paperclip-ceo-delegation.md`
- Obsidian + Paperclip runbook: `~/ai-agent-stack/obsidian-vault/10_Runbooks/paperclip-obsidian.md`
- Meridian agent rules: `AGENTS.md`, `.cursor/rules/obsidian-brain.mdc`
