# Paperclip agent templates (mining-map)

Short **AGENTS.md** bundles for Ollama-backed Paperclip specialists. Not used by Cursor directly.

| Directory | Role |
|-----------|------|
| `agents/ceo/` | CEO orchestration (Cursor — Paperclip API only) |
| `agents/cto/` | Architecture, ADRs, delegate to engineers |
| `agents/triage/` | Assign + one comment |
| `agents/docs-writer/` | Issue markdown drafts |
| `agents/status/` | Status summaries |
| `agents/diagnose/` | One-file triage |

Setup: [docs/PAPERCLIP_OLLAMA_AGENTS.md](../docs/PAPERCLIP_OLLAMA_AGENTS.md)

```bash
bash scripts/paperclip-branch-paperclip2.sh   # host + agents → branch paperclip2
bash scripts/paperclip-ceo-cursor.sh
bash scripts/paperclip-ollama-cto.sh
bash scripts/paperclip-ollama-specialists.sh
```
