# MadSan V2 — Roadmap Status (2026-06-09)

North star: **discover → verify → price → execute** (honest tiers, evidence chains, map-first UX).

## On-track assessment

| Pillar | Target | Status | Evidence |
|--------|--------|--------|----------|
| Discover | Global search, map layers, suppliers | **On track** | ⌘K search, energy/metals MVT, live AIS overlay, 76k assets |
| Verify | Dossiers, deals, sanctions, packs | **On track** | Entity dossier + evidence, DD rules, OpenSanctions, pack v1.1 + relationship graph |
| Price | Signals, opportunity score, freshness | **Partial** | EIA daily crude spot when keyed; VLSFO/Gold stub |
| Execute | Portal, billing, compliance gates | **Not started** | Supplier portal scaffold only; no billing/KYC cutover |

**Verdict:** MVP intelligence loop (discover → verify) is **shippable for internal DD**. Price feeds and execute path remain Phase 10+.

## Live data (madsan_db :5433)

| Table | Rows | Notes |
|-------|------|-------|
| companies | ~18.7k | Includes operator stubs from OSM backfill |
| assets | ~76k | Energy OSM + license cadastre |
| vessels | ~9.6k | Live AIS sync from legacy |
| evidence | ~227k | Provenance claims |
| relationships | ~16k | Company↔asset + vessel↔terminal |
| core_signals | ~18k | AIS + import snapshots |

## Phase completion

### Done (greenfield `madsan/`)

- Schema + migrations, Go API :8088, JWT auth, entitlements scaffold
- Ingestion: bunker seed, watch folder, Postgres job queue, worker/scheduler
- Legacy bridge: Go-native import (default), Python fallback
- Map: MapLibre terminal, vector tiles, WS live vessels, corridor lines
- Dossiers: company/asset/vessel, signals, signal history, relationships
- Deals: verify, sanctions, pack export (json/md/html), relationship graph in pack
- Admin console, metals vertical, global search

### Partial

| Item | Gap | Next step |
|------|-----|-----------|
| 16-step ingestion pipeline | Jobs poll `ingestion_jobs`; no Splink/River | Splink dedup queue or keep SQL DISTINCT for MVP |
| Python ETL | Fallback only | Parity test → retire `legacy_import.py` |
| Matviews | `map_energy_assets` may lag live tiles | Drop or refresh-on-ingest only |
| RBAC | Cookie auth MVP | Middleware on admin/deals routes |
| Price ticker | EIA crude when keyed | VLSFO/Gold stub; ICE/exchange feed deferred |
| `madsan/` in git | Untracked | User-approved initial commit |
| Compose cutover | **Done (dev)** | `compose_up.sh` — db+api+worker+scheduler+frontend; optional Caddy `:9080` |

### Not started (original plan)

- River job queue
- Splink entity resolution
- MCR v2, Comtrade/EIA ingest
- Billing, observability, production launch checklist
- Full supplier portal workflow

## Architecture alignment

| Mandate | Compliance |
|---------|------------|
| Go permanent backend | New APIs/workers in Go ✅ |
| Legacy Python transitional | AIS via Go; legacy read Go-default ✅ |
| Honest coverage disclaimers | Gulf AIS, inferred vessel-terminal links ✅ |
| Postgres + PostGIS source of truth | All intelligence in madsan_db ✅ |
| Map not tables-only | Tiles + dossier + corridors ✅ |

## Next priorities (ordered)

1. **4d** — Splink batch dedup (current: SQL clusters + `manual_review_queue`)
2. **10d** — Git initial commit of `madsan/` (user approval)
3. **4e** — Retire Python `legacy_import.py` after parity tests
4. **10f** — Production compose tuning (resource limits, secrets, observability)

## Risks

- **API OOM (exit 137):** restart via `start_api.sh`; consider limiting AIS batch size
- **Duplicate companies:** 18.7k rows with ETL duplicates; search deduped, DB not merged
- **Inferred links:** vessel-terminal and operator links are intelligence hints, not facts
- **OpenSanctions:** screening is review-tier, not confirmation

## Runtime (dev)

```bash
./madsan/scripts/start_api.sh          # :8088
cd madsan/backend && go run ./cmd/worker
cd madsan/frontend && npm run dev      # :3000
```

DB: `deploy-madsan-db-1` :5433 · Legacy: `mining-db` :5434
