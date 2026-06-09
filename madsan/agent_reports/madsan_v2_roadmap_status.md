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
- **Git:** `madsan/` committed on branch `new-refactor-eng-style` (~159 tracked files)
- **Admin health:** `/admin` runtime panel + `GET /api/admin/health/runtime` (AIS sync, legacy parity drift)
- **Metals fix:** petroleum OSM rows excluded from metals tiles/search/summary; vertical switch resets layers
- **EIA ticker:** WTI/Brent daily spot via EIA v2 when `EIA_API_KEY` set; honest stub tier otherwise
- **Splink prep:** SQL duplicate clusters → pairwise CSV export (`/api/admin/dedup/companies/pairs.csv`, CLI)
- **Pairwise dedup scoring:** `pair_score.go` — trigram + country agreement; tiers `high_confidence` / `manual_review` / `skip`; cluster list + CSV export include `match_score` + `review_tier`
- **Cross-name dedup discovery:** `cross_name_pairs.go` + migration `013_companies_trgm_index` — pg_trgm similarity pairs across differing `normalized_name` (uncommitted)
- **Deals RBAC:** `/api/deals/verify`, `/{id}/pack`, `/{id}/watch` require JWT + entitlements (`deal_verification`, `deal_pack_export`); deals UI gates on `/api/core/auth/me`
- **Legacy import (Go default):** `legacy_import` jobs via `processLegacyImportGo`; daily scheduler enqueue; Python opt-in only (`MADSAN_LEGACY_PYTHON`)
- **Parity gate:** `cmd/legacy-parity` CLI (exit 0/1) + cached admin Runtime health panel; 5% threshold on critical tables (`oil_vessels`, `licenses`, `petroleum_osm_features`)

### Partial

| Item | Gap | Next step |
|------|-----|-----------|
| 16-step ingestion pipeline | Jobs poll `ingestion_jobs`; no Splink/River | Human merge queue from scored pairs; Splink batch automation deferred |
| Python ETL | Fallback only | Parity gate green in staging → retire `legacy_import.py` |
| Matviews | `map_energy_assets` may lag live tiles | Drop or refresh-on-ingest only |
| RBAC | Cookie auth MVP | Admin ✅ · Deals ✅ · portal/billing routes next |
| Price ticker | EIA crude when keyed | VLSFO/Gold stub; ICE/exchange feed deferred |
| Compose cutover | Prod overlay ready | Seed named volumes + Caddy deploy on ARM VM |
| Production launch | Checklist not run | Phase 14 — observability, backup cron, TLS |

### Not started (original plan)

- River job queue
- Splink entity resolution (automated merge from scored pairs)
- MCR v2, Comtrade ingest
- Billing, full observability stack
- Full supplier portal workflow

## Execution plan sync

Aligned with `madsan_v2_execution_log.md` and `madsan_v2_compose_rebuild_plan.md`:

| Phase | Item | Status |
|-------|------|--------|
| **3** | Scheduler + worker + job queue | **Done** |
| 10b | Dev compose (`compose_up.sh`) | Done |
| 10e | EIA open-data ticker | Done |
| 4d | Splink prep export | Done |
| **4d+** | Pairwise dedup scoring (clusters + CSV) | **Done** (uncommitted on branch) |
| 11a | Admin runtime health | Done |
| **4e** | Legacy parity gate (CLI + admin panel) | **Done** (gate; Python retirement pending green run) |
| **RBAC** | Deals route auth + entitlements | **Done** (uncommitted on branch) |
| **13** | Prod compose overlay (`docker-compose.prod.yml`) | **Done** — limits, reservations, healthchecks, `linux/arm64`, named volumes, Caddy :80, no dev bind mounts |
| **14** | Production launch checklist | **In progress** (observability, TLS, volume seed, backup) |

## Architecture alignment

| Mandate | Compliance |
|---------|------------|
| Go permanent backend | New APIs/workers in Go ✅ |
| Legacy Python transitional | AIS via Go; legacy read Go-default ✅ |
| Honest coverage disclaimers | Gulf AIS, inferred vessel-terminal links ✅ |
| Postgres + PostGIS source of truth | All intelligence in madsan_db ✅ |
| Map not tables-only | Tiles + dossier + corridors ✅ |

## Next priorities (ordered)

1. **14** — Production launch checklist (TLS on Caddy, volume seed for `/raw`/`/etl`, `backup_db.sh` cron, smoke test via Caddy :80)
2. **4e** — Retire Python `legacy_import.py` after parity gate green in staging (admin panel + `legacy-parity` CLI)
3. **4f** — Petroleum asset type backfill against live DB (`backfill-petroleum-types` dry-run → apply)
4. **Dedup merge** — Route `high_confidence` pairs into review queue; human merge workflow

## Risks

- **API OOM (exit 137):** prod overlay caps API at 1536m; monitor AIS batch size via admin health
- **Duplicate companies:** 18.7k rows with ETL duplicates; search deduped, DB not merged until review queue actions
- **Inferred links:** vessel-terminal and operator links are intelligence hints, not facts
- **OpenSanctions:** screening is review-tier, not confirmation
- **Prod volumes:** `madsan_raw_data` / `madsan_etl_data` named volumes start empty — seed before legacy import jobs
- **Parity drift:** negative drift on critical tables blocks Python retirement; run Legacy import (all) with worker up

## Runtime

**Dev (hybrid or full Docker):**

```bash
./madsan/scripts/compose_up.sh              # dev stack :8088 / :3001
./madsan/scripts/start_api.sh               # API only on host
cd madsan/frontend && npm run dev           # :3000
```

**Prod overlay (~23 GiB ARM VM):**

```bash
cp madsan/deploy/.env.example madsan/deploy/.env   # secrets + LEGACY_DATABASE_URL
docker compose -f madsan/deploy/docker-compose.yml \
  -f madsan/deploy/docker-compose.prod.yml \
  --profile proxy up -d --build
# Browser → http://<vm>:80  (Caddy); set NEXT_PUBLIC_API_URL to same origin
```

Seed named volumes once (if ingestion needs host files):

```bash
docker run --rm -v madsan_raw_data:/dest -v "$PWD/madsan/raw":/src:ro alpine cp -a /src/. /dest/
docker run --rm -v madsan_etl_data:/dest -v "$PWD/madsan/etl":/src:ro alpine cp -a /src/. /dest/
```

**Parity check (before Python retirement):**

```bash
cd madsan/backend && go run ./cmd/legacy-parity   # exit 0 = gate pass
```

DB (dev): `deploy-madsan-db-1` :5433 · Legacy: `mining-db` :5434
