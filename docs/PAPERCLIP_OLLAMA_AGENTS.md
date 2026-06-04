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
| `cursor` | **CEO (default)** + Cursor Engineer — `paperclip-ceo-cursor.sh` |
| `gemini_local` | **Avoid** — free tier ~20 req/day on `gemini-2.5-flash` |
| **Antigravity Engineer** | `opencode_local` + Ollama — `bash scripts/paperclip-antigravity-ollama.sh` |

MCP in Cursor (`mining-map/.cursor/mcp.json`) talks to Paperclip; specialists run **inside** Paperclip wakes, not in the IDE.

## Recommended specialists

| Agent name | Model (`ollama/…`) | Adapter | Instructions | Use case |
|------------|-------------------|---------|--------------|----------|
| **Paperclip Triage** | `llama3.2:3b` | `opencode_local` | `.paperclip/agents/triage/AGENTS.md` | Status, assignee, one short comment |
| **Paperclip Docs** | `qwen2.5:3b` | `opencode_local` | `.paperclip/agents/docs-writer/AGENTS.md` | Issue doc / acceptance markdown |
| **Paperclip Status** | `phi3:mini` | `opencode_local` | `.paperclip/agents/status/AGENTS.md` | Progress comment, light PATCH |
| **Paperclip Diagnose** | `llama3.2:3b` | `opencode_local` | `.paperclip/agents/diagnose/AGENTS.md` | Single-file / error triage |

## Architect (fleet health lane)

| Agent name | Model | Role | Instructions |
|------------|-------|------|--------------|
| **Meridian Architect (Ollama)** | `qwen2.5:3b` | `researcher` | `.paperclip/agents/architect/AGENTS.md` |

Verifies agents/adapters, `paperclip2` branch, failed runs; opens remediation issues for CEO. Not product implementation.

```bash
ollama pull qwen2.5:3b
bash scripts/paperclip-ollama-architect.sh
```

Checklist: [.paperclip/MAD-ARCHITECT-CHECKLIST.md](../.paperclip/MAD-ARCHITECT-CHECKLIST.md).

## CTO (architecture lane)

| Agent name | Model (`ollama/…`) | Role | Instructions | Use case |
|------------|-------------------|------|--------------|----------|
| **CTO (Ollama)** | `qwen2.5-coder:7b-instruct` | `cto` | `.paperclip/agents/cto/AGENTS.md` | ADRs, compose/migrations review, security; **delegates** code to engineers |

Register:

```bash
ollama pull qwen2.5-coder:7b-instruct
bash scripts/paperclip-ollama-cto.sh
```

Checklist: [.paperclip/MAD-CTO-CHECKLIST.md](../.paperclip/MAD-CTO-CHECKLIST.md). After first hire, add the printed agent UUID to `~/ai-agent-stack/scripts/paperclip-ceo-delegation.md`.

## Product Manager (Codex CLI)

| Agent name | Model | Adapter | Instructions |
|------------|-------|---------|--------------|
| **Codex Product Manager** | `gpt-5.3-codex-spark` | `codex_local` | `.paperclip/agents/product-manager/AGENTS.md` |

Playbook: [.paperclip/PRODUCT-MANAGEMENT.md](../.paperclip/PRODUCT-MANAGEMENT.md) — backlog rubric, Phase 1 epics, issue templates.

```bash
bash scripts/paperclip-codex-pm.sh
```

Auth: `OPENAI_API_KEY` in `~/ai-agent-stack/.env` **or** `docker exec -it paperclip-safe codex login` (uses managed `codex-home`).

Example PATCH body: `.paperclip/agents/example-opencode-agent-patch.json`.

**Keep heartbeats off** for specialists, **Cursor Engineer**, Groq, and OpenRouter (`intervalSec: 0`). **CEO (Cursor)** uses a slow timer by default (`1800s`) to mint MAD issues — set `CURSOR_CEO_HEARTBEAT_SEC=0` for assign-only CEO.

```bash
bash scripts/paperclip-ceo-cursor.sh
```

Re-apply Cursor (disables 5-minute idle timer):

```bash
bash ~/ai-agent-stack/scripts/paperclip-cursor-agent.sh
```

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

## CEO hiring + Mac fleet caps

CEO (Cursor) **may** hire agents via `paperclipApiRequest` → `POST /api/companies/{id}/agent-hires` when under cap.

| Doc | Purpose |
|-----|---------|
| [.paperclip/CEO-FLEET-LIMITS.md](../.paperclip/CEO-FLEET-LIMITS.md) | Hard limits (agents, Ollama RAM, timers, API discipline) |
| [.paperclip/agents/ceo/CEO-HIRE-TEMPLATE.json](../.paperclip/agents/ceo/CEO-HIRE-TEMPLATE.json) | Minimal hire body (3B models, heartbeat 0) |

Check fleet before hire:

```bash
bash scripts/paperclip-fleet-status.sh
bash scripts/paperclip-fleet-status.sh --check   # exit 1 if blocked
```

Env overrides in `~/ai-agent-stack/.env`: `PAPERCLIP_FLEET_MAX_TOTAL`, `PAPERCLIP_FLEET_MAX_OLLAMA`, `PAPERCLIP_FLEET_MAX_HEARTBEAT_AGENTS`.

**Prefer** assigning existing agents or `paperclip-ollama-specialists.sh` over API sprawl.

## Cursor MCP (IDE)

`mining-map/.cursor/mcp.json` runs Paperclip MCP via Docker. Tools include `paperclipListAgents`, `paperclipGetAgent`, `paperclipApiRequest` — use `paperclipApiRequest` for `agent-hires` when CEO is under fleet cap; see `CEO-FLEET-LIMITS.md`.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `parseBoolean is not defined` on opencode_local | `bash scripts/paperclip-fix-adapters.sh` then **new run** (not Retry) |
| CEO `EACCES` on `cursor-home/.config` | Same `paperclip-fix-adapters.sh` (permissions + adapter patch) |
| Issues stuck `blocked` / stranded recovery | CEO follows `.paperclip/CEO-RECOVERY.md` → `todo` + reassign after fix |
| `connection refused` to Ollama from container | Ollama running on Mac; `OLLAMA_BASE_URL=http://host.docker.internal:11434` |
| OpenCode picks wrong model | Re-run `bash ~/ai-agent-stack/scripts/paperclip-opencode-providers.sh` |
| Huge token use | Re-run `paperclip-minimal-context.sh` path: `paperclip_install_minimal_skill` |
| `403 Board access required` | Agent token cannot create secrets; use default `local-env` keys in `.env` |
| Invalid `.cursor/cli.json` | Repo file must be **permissions only** — see `.paperclip-mad13-unblock.md` |

## Git branch `paperclip2`

All repo-touching agents work on **`paperclip2`** only (not `main` / `Paperclip`):

```bash
bash scripts/paperclip-branch-paperclip2.sh
```

See [.paperclip/GIT-BRANCH.md](../.paperclip/GIT-BRANCH.md).

## OpenClaw Operator (research)

Paperclip talks to the **OpenClaw gateway** (`openclaw_gateway` adapter). The gateway runs its **own** embedded agent, which defaulted to **`openai/gpt-5.5`** with no API key — hence `No API key found for provider "openai"`.

Fix (local Ollama, free):

```bash
ollama pull llama3.2:3b
bash scripts/paperclip-openclaw-fix.sh
```

Then **Resume** OpenClaw Operator and start a **new run** (not Retry).

## Hosted lanes (Groq / OpenRouter) — lightweight

Groq free tier allows **~6k TPM**; OpenRouter free keys have **low credits**. These agents must stay ultra-light:

| Setting | Groq Fast Analyst | OpenRouter Engineer |
|---------|-------------------|---------------------|
| Default model | `groq/llama-3.1-8b-instant` | `openrouter/qwen/qwen3-coder:free` (fallback: `meta-llama/llama-3.2-3b-instruct:free` + bash denied) |
| Skill | `paperclip-minimal` (~1 KB) only | same |
| Session resume | **off** | **off** |
| Wake payload | compact (truncated) | compact |
| Heartbeat | `0` (assign only) | `0` (assign only) |

Re-apply after image rebuild:

```bash
bash scripts/paperclip-fix-hosted-lanes.sh
# or: bash ~/ai-agent-stack/scripts/paperclip-hosted-agents.sh
```

Use **New run** in Paperclip after a failure — **Retry** reuses bloated session history.

Override cheap model:

```bash
OPENROUTER_MODEL=openrouter/google/gemma-2-9b-it:free bash ~/ai-agent-stack/scripts/paperclip-openrouter-agent.sh
```

## Related

- CEO roster IDs: `~/ai-agent-stack/scripts/paperclip-ceo-delegation.md`
- Obsidian + Paperclip runbook: `~/ai-agent-stack/obsidian-vault/10_Runbooks/paperclip-obsidian.md`
- Agent knowledge layers (Obsidian + graphify): [AGENT_KNOWLEDGE_LAYERS.md](AGENT_KNOWLEDGE_LAYERS.md)
- Meridian agent rules: `AGENTS.md`, `.cursor/rules/obsidian-brain.mdc`, `.cursor/rules/graphify.mdc`
