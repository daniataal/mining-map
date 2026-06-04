# Paperclip agent templates (mining-map)

Short **AGENTS.md** bundles for Ollama-backed Paperclip specialists. Not used by Cursor directly.

| Directory | Role |
|-----------|------|
| `agents/ceo/` | CEO orchestration (Cursor — issues + capped agent hires) |
| `CEO-FLEET-LIMITS.md` | Mac/Ollama/API caps before CEO hires agents |
| [docs/MERIDIAN_PLATFORM_ARCHITECTURE.md](../docs/MERIDIAN_PLATFORM_ARCHITECTURE.md) | Platform rearchitecture — data planes, UX, phases |
| `agents/architect/` | Fleet health — agents/adapters/branch policy |
| `agents/cto/` | Architecture, ADRs, delegate to engineers |
| `agents/triage/` | Assign + one comment |
| `agents/docs-writer/` | Issue markdown drafts |
| `agents/status/` | Status summaries |
| `agents/diagnose/` | One-file triage |
| `agents/product-manager/` | Codex PM — backlog, PRDs, epic splits |
| `PRODUCT-MANAGEMENT.md` | PM playbook, rubric, Phase 1 epics |
| `templates/epic-feature.md` | Epic issue template |

Agent knowledge layering (Obsidian + graphify): [docs/AGENT_KNOWLEDGE_LAYERS.md](../docs/AGENT_KNOWLEDGE_LAYERS.md)

Setup: [docs/PAPERCLIP_OLLAMA_AGENTS.md](../docs/PAPERCLIP_OLLAMA_AGENTS.md)

```bash
bash scripts/paperclip-codex-pm.sh            # Codex Product Manager
bash scripts/paperclip-fleet-capabilities.sh    # repo + bash + web for all agents
bash scripts/paperclip-branch-paperclip2.sh     # host + agents → branch paperclip2
bash scripts/paperclip-fix-adapters.sh
bash scripts/paperclip-fleet-status.sh
bash scripts/paperclip-ceo-cursor.sh
bash scripts/paperclip-ollama-architect.sh
bash scripts/paperclip-ollama-cto.sh
bash scripts/paperclip-ollama-specialists.sh
```
