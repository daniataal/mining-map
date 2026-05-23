# MAD-16 — CEO checklist (Ollama specialists)

Repo engineering (**MAD-17**, commit `88b38c1`) is **done**. Complete MAD-16 in Paperclip by registering agents on your Mac.

## Prerequisites

- `~/ai-agent-stack` running: `docker compose up -d paperclip openclaw`
- Ollama on host: `http://127.0.0.1:11434`
- Models pulled: `llama3.2:3b`, `qwen2.5:3b`, `phi3:mini` (see [docs/PAPERCLIP_OLLAMA_AGENTS.md](../docs/PAPERCLIP_OLLAMA_AGENTS.md))
- `PAPERCLIP_API_KEY` in `~/ai-agent-stack/.env`

## Register agents

From this repo (`mining-map` / Meridian workspace):

```bash
bash scripts/paperclip-ollama-specialists.sh
```

## Paperclip UI

1. **Agents** → Resume each: Paperclip Triage, Docs, Status, Diagnose
2. Keep **heartbeats off** (`intervalSec: 0`) — assign/@mention only
3. Leave **Cursor Engineer** on `cursor` adapter for code; **CEO** orchestrates

## Close MAD-16

When four specialists show `opencode_local` + Ollama model in Paperclip:

- Set **MAD-16** → **done**
- Optional: delegate triage/docs issues to specialists
