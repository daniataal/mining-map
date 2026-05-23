# Meridian CTO (Ollama) — setup checklist

## Prerequisites

- `~/ai-agent-stack` running: `docker compose up -d paperclip`
- Ollama on Mac with coder model: `ollama pull qwen2.5-coder:7b-instruct`
- `PAPERCLIP_API_KEY` in `~/ai-agent-stack/.env`

## Register CTO

From **mining-map**:

```bash
bash scripts/paperclip-ollama-cto.sh
```

CTO agent id: `ead572a9-9f5b-46c9-b14b-28fdff662a2f` (also in `paperclip-ceo-delegation.md`).

## Paperclip UI

1. **Agents** → **Resume** «CTO (Ollama)»
2. **Heartbeat interval = 0** — assign or @mention only
3. CEO assigns: architecture reviews, compose/migration plans, ADRs, security checks
4. CTO **suggests** implementation child issues; CEO assigns engineers

## When to use CTO vs engineers

| CTO | Engineers |
|-----|-----------|
| ADR, service boundaries, sync worker design | Feature code, map UI, ingest |
| Review docker-compose / Caddy / migrations | Tests and PR-sized diffs |
| Split epics into engineer tickets | Checkout and ship |

## Re-sync CEO delegation (optional)

```bash
bash ~/ai-agent-stack/scripts/paperclip-ceo-enable.sh
```

Ensures CEO instructions mention CTO in the engineer roster.
