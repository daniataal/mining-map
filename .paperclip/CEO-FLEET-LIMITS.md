# CEO — fleet limits (MacBook + Ollama + APIs)

Read this **before** `POST …/agent-hires` or asking humans to add agents.

## Hard caps (default — do not exceed without human approval in a comment)

| Limit | Default | Why |
|-------|---------|-----|
| **Total agents** | **16** | Paperclip + Docker overhead |
| **Ollama `opencode_local` agents** | **10** | Each wake loads a model into Mac RAM |
| **Agents with heartbeat `intervalSec > 0`** | **2** (CEO + optional) | Idle wakes burn tokens/RAM |
| **New Ollama hires per CEO day** | **1** | Avoid roster sprawl |
| **Concurrent Ollama runs** | **1** | Ollama on Mac serializes; 2+ = swap/thrash |

Override only if human comments on the hire issue: `FLEET_OVERRIDE=1`.

Env (host `~/ai-agent-stack/.env`): `PAPERCLIP_FLEET_MAX_TOTAL`, `PAPERCLIP_FLEET_MAX_OLLAMA`, `PAPERCLIP_FLEET_MAX_NEW_HIRES_PER_DAY`.

## Before any hire

1. `paperclipListAgents` (or `GET /api/companies/{companyId}/agents`).
2. Run mental checklist:
   - Can an **existing** agent take this work? (assign issue — **preferred**)
   - Is backlog empty because work is unassigned, not because you need a new role?
3. `bash scripts/paperclip-fleet-status.sh` (from repo) — if **BLOCKED**, do not hire; open issue for human.

## Allowed adapters for CEO-created agents

| Adapter | When | Mac RAM |
|---------|------|---------|
| `opencode_local` + **≤3B Ollama** | New specialist chore only | Yes — **sparse** |
| `cursor` | **Never** hire via API — use existing Cursor Engineer | Uses Cursor cloud |
| `openclaw_gateway` | **Never** hire via API — run `paperclip-openclaw-fix.sh` | Gateway Ollama |
| Groq / OpenRouter | **Never** hire via API — scripts set TPM/credit limits | Remote |
| `gemini_local` | **Do not use** for engineers — free tier ~20 req/day | Remote quota |

## Gemini / Antigravity

**Antigravity Engineer** must run on **Ollama**, not Gemini:

```bash
bash scripts/paperclip-antigravity-ollama.sh
```

`gemini-2.5-flash` free tier exhausts in minutes if heartbeat is enabled. CEO should assign repo work to **OpenRouter Engineer**, **Cursor Engineer**, or **Antigravity (Ollama)** after migration—not `gemini_local`.

## Ollama model allowlist (new hires)

| OK | Not OK without human |
|----|----------------------|
| `llama3.2:3b` | `qwen2.5-coder:7b-instruct` (CTO only — 1 slot) |
| `qwen2.5:3b` | `llama3.1`, 8B+ |
| `phi3:mini` | Multiple different 7B models |

**Rule:** Prefer reusing an existing **3B** specialist over pulling a new model tag.

## Required fields on every `opencode_local` hire

- `reportsTo`: CEO agent id
- `adapterType`: `opencode_local`
- `adapterConfig.model`: `ollama/<tag>` from allowlist
- `adapterConfig.cwd`: `/workspace/shared` (not full repo — reduces context)
- `runtimeConfig.heartbeat.intervalSec`: **0**
- `runtimeConfig.heartbeat.maxConcurrentRuns`: **1**
- `runtimeConfig.heartbeat.wakeOnDemand`: **true**
- Minimal skill only (see `CEO-HIRE-TEMPLATE.json`) — **no** `promptTemplate` on hire POST (422 risk)
- `instructionsBundle.files.AGENTS.md`: short role file from `.paperclip/agents/<role>/AGENTS.md`

After hire: human or **Meridian Architect** verifies agent **Resumed**, heartbeat 0, model loads.

## Prefer scripts over raw API

| Need | Command (human or issue for Architect) |
|------|----------------------------------------|
| Standard specialists | `bash scripts/paperclip-ollama-specialists.sh triage` |
| Architect / CTO | `bash scripts/paperclip-ollama-architect.sh` / `…-cto.sh` |
| Hosted lanes | `bash scripts/paperclip-fix-hosted-lanes.sh` |

CEO may use API hire only for **one-off** roles with new `AGENTS.md` when under cap and script path does not exist.

## API discipline

- **Writes:** always `X-Paperclip-Run-Id` from heartbeat context.
- **Issues:** max **3** new issues per wake (existing rule).
- **Hires:** max **1** per wake; never hire + assign 3 engineers in same wake.
- **Groq:** never assign large context issues (6k TPM).
- **OpenRouter:** free models only unless human added credits.
- **Cursor Engineer:** `intervalSec` must stay **0** (assign-only).

## When at cap

Create issue: `MAD: Fleet at cap — decommission or reassign` → **Meridian Architect**, not a new agent.

## Decommission (reduce load)

`PATCH /api/agents/{id}` → pause agent or set `runtimeConfig.heartbeat.enabled: false`; do not delete without human.
