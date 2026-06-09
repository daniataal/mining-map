# MadSan V2 Execution Log

| Phase | Status | Notes |
|-------|--------|-------|
| 0 Reports + scaffold | done | agent_reports, madsan/ tree, dev_bootstrap.sh |
| 1 Schema | done | 11 migrations `*.up.sql`, madsan_db on :5433 |
| 2 Ingestion | done | bunker_seed adapter, watch_folder, legacy_etl |
| 3 Scheduler/worker | done | cmd/worker, cmd/scheduler, cmd/ingest-once |
| 4 ETL legacy | done | Go-native default (`legacy_read.go`); Python `legacy_import.py` opt-in fallback |
| 5 Go API + auth | done | chi API :8088, JWT cookies |
| 5b Entitlements | done | plans, feature_flags, resolver |
| 6 Map + tiles | done | ST_AsMVT /tiles/* |
| 6b Realtime WS | done | viewport WebSocket hub |
| 7+ UI verticals | done | Next.js terminal, /deals, /admin, /legal |
| 9 Deal verification depth | done | compliance package: DD rules, corridor/sanctions, OpenSanctions screen; wired into deals.Verify |
| 6b Live AIS sync | done | legacy `oil_ais_positions` → `madsan_db.vessels`; WS snapshot/delta; live map overlay |
| 2b Evidence on ingest | done | sources registry, staging rows, evidence claims; backfill 226k rows |
| 9b Deal pack export | done | structured JSON + markdown + HTML; party evidence chain in pack |
| 3b Ingestion queue + admin | done | deduped enqueue, job stats, sources table, admin dashboard |
| 4b Legacy ETL wired | done | `legacy_import` job runs Python ETL → child `legacy_etl` batches; worker batch drain |
| 7b Map dossier panel | done | click feature → evidence chain; vessel/asset/company APIs; deals deep-link |
| 4c Go legacy import | done | native pgx reader for 4 legacy tables; default engine (Python opt-in) |
| 6c Metals vertical | done | live asset tiles; license summary API + terminal header |
| 7c Live energy tiles + signals | done | energy MVT from assets; dossier opportunity_score + signals |
| 8a Global search + signal persist | done | ⌘K palette; `/api/core/search`; AIS → `core_signals` (1h throttle) |
| 8b Signal history + search dedup | done | dossier `signal_history[]`; DISTINCT ON normalized_name in search |
| 8c Relationship graph | done | asset↔company links; dossier relationships; backfill cmd |
| 8d Import signals + map corridors | done | `import_snapshot` signals; rel lat/lng; corridor lines on map |
| 8e Vessel-terminal links + deal graph | done | AIS proximity/destination links; deal pack relationship_graph v1.1 |
| 9c Deal graph UI + roadmap audit | done | `/deals` graph preview; `madsan_v2_roadmap_status.md` |
| 10a Ticker stub + company dedup | done | `/api/core/ticker`; dedup clusters + admin scan; `madsan/README.md` |
| 10b Compose cutover (dev) | done | `compose_up.sh`; legacy AIS via host.docker.internal; Caddy profile |
| 10c Review queue merge resolve | done | `POST /api/admin/review-queue/{id}/resolve`; admin merge/dismiss UI |
| 10e EIA open-data ticker | done | EIA v2 WTI/Brent daily spot; 20m cache; tier badge in terminal |
| 10f Deploy env + OpenSanctions | done | `start_api.sh` sources `deploy/.env`; `OPENSANCTIONS_API_KEY` wired in config/compose/sync |
| 4d Splink prep export | done | pairwise CSV from SQL duplicate clusters; admin + CLI |
| 4e Legacy parity CLI | done | `cmd/legacy-parity`; JSON report; exit 1 on critical drift |
| 4f Petroleum type backfill cmd | done | `cmd/backfill-petroleum-types` with `--dry-run` / `--limit` |
| 10g Admin auth middleware | done | `requireAuth` on all `/api/admin/*` routes |
| 11a Admin runtime health | done | AIS sync stats + cached legacy parity on `/api/admin/health/runtime` + `/admin` UI |
| Data seed | done | 209 bunker suppliers + legacy ETL (5282 cos, 9595 vessels, 75955 assets) |
| Legacy ETL | done | mining-db via :5434 bridge; petroleum/licenses/vessels/companies |
| 4d+ Pairwise dedup scoring | done | `pair_score.go`; tiers `high_confidence` / `manual_review` / `skip`; cluster list + CSV |
| 4d++ Cross-name dedup (pg_trgm) | done | `cross_name_pairs.go`; migration `013_companies_trgm_index`; pairs CSV auto-enqueue |
| RBAC deals routes | done | `auth_middleware.go`; verify/pack/watch JWT + entitlements |
| 13 Prod compose overlay | done | `docker-compose.prod.yml` committed (`bc05055`); ARM64, limits, Caddy :80 |
| 14 Launch checklist | in progress | `madsan_v2_launch_checklist.md`; go-live blockers catalogued |
| DR backup fix | done | `backup_db.sh` via compose `madsan-db`; pre-cutover dump in `backups/` |

## 2026-06-09 evening — parallel session ships

Parallel agents landed dedup scoring, cross-name discovery, deals RBAC, DR backup, prod overlay docs, and launch checklist. **All uncommitted on branch** except prod compose (pushed `bc05055`).

### Shipped (local / branch)

- **Dedup review tiers** — `pair_score.go`: trigram + country agreement → `high_confidence` (≥85) / `manual_review` (60–84) / `skip` (<60); cluster API + Splink CSV export include `match_score` + `review_tier`
- **Cross-name discovery (pg_trgm)** — `cross_name_pairs.go` finds similar `normalized_name` pairs across differing names; migration `013_companies_trgm_index.up.sql` (`gin_trgm_ops` on `companies.normalized_name`)
- **Scan enqueue** — `POST /api/admin/dedup/companies/scan` enqueues same-name clusters to `manual_review_queue`; pairs CSV export also enqueues cross-name candidates (`X-Madsan-Cross-Name-Enqueued` header); admin dedup UI wired
- **Deals RBAC** — `auth_middleware.go` + router: `/api/deals/verify` + `deal_verification`, `/{id}/pack` + `deal_pack_export`, `/{id}/watch` require JWT; `/deals` UI gates on `/api/core/auth/me`
- **Backup fix** — `backup_db.sh` targets compose `madsan-db` (`localhost:5433`); `LEGACY=1` / `--legacy` for `mining-db`; verified dump `backups/madsan_v2_pre_20260609_221939.dump`
- **Prod compose** — `docker-compose.prod.yml`: ARM64, memory limits/reservations, healthchecks, named volumes, Caddy `:80`, no dev bind mounts (committed + pushed)
- **Launch checklist** — `madsan_v2_launch_checklist.md`: Phase 14 go-live blockers (legal, RLS, DR cron, k6, parity, TLS, PR hygiene)
- **Migration 013** — `013_companies_trgm_index.up.sql` (uncommitted; apply before cross-name scan at scale)
- **Tests** — `go test ./internal/dedup/... ./internal/api/...` pass (pair_score, cross_name_pairs, auth_middleware, splink_export)

### Blockers (honest)

- **Parity / legacy import still running** — `licenses` **green** after dedup-key parity fix (`bcb0f2a`; was false ~74% fail on raw rows). `legacy-parity` still **fails** on `petroleum_osm_features` (~70–81% under-imported); full Go **Legacy import (all)** with worker not finished — blocks Python `legacy_import.py` retirement
- **GitHub PR** — evening ships **not committed** (~21 changed/untracked files on `new-refactor-eng-style`); no reviewable PR to `main`; `gh pr` / CI gate not opened (auth/workflow TBD)
- **Go-live gaps** — prod volume seed, backup cron, TLS on Caddy, restore drill, k6 through Caddy `:80` — see launch checklist

## 2026-06-09 Phase 11a — admin runtime health panel

- `GET /api/admin/health/runtime` (auth): AIS sync enabled/interval, last batch, vessel freshness (24h/72h), coverage note
- Legacy parity drift summary via `ingestion.RunLegacyParity` with 5-minute in-memory cache
- `maritime.SyncStats` tracks per-batch success/error; wired into AIS syncer
- Admin `/admin`: **Runtime health** section with parity table and drift badges
- README: API highlight for health endpoint

## 2026-06-09 Phase 10f — deploy env loading + OpenSanctions key

- `scripts/start_api.sh` / `start_all.sh`: source `madsan/deploy/.env` when present (hybrid dev keys without manual export)
- `OPENSANCTIONS_API_KEY` in `internal/config`, `deploy/.env.example`, `sync_env_from_root.sh`, `docker-compose.yml`
- `compliance.NewScreener(apiKey)` + deals service wired from config; `Authorization: ApiKey` when set
- Admin enqueue note: legacy Python import is opt-in only (`MADSAN_LEGACY_PYTHON=true`); Go import is default

## 2026-06-09 Phase 4d — Splink prep company pair export

- `GET /api/admin/dedup/companies/pairs.csv?limit=200`: Splink-ready pairwise CSV from SQL duplicate clusters
- Columns: `unique_id_l/r`, names, countries, confidence, `normalized_name`, `sql_match_score`
- `cmd/export-company-pairs`: batch export via `MADSAN_DEDUP_CLUSTER_LIMIT`, `MADSAN_DEDUP_OUTPUT`
- Admin dedup section: **Export pairs CSV (Splink)** download link; no Python Splink install required

## 2026-06-09 Phase 10e — EIA open-data ticker

- `GET /api/core/ticker`: fetches EIA v2 daily spot (`RWTC` WTI, `RBRTE` Brent) when `EIA_API_KEY` set
- 20-minute in-memory cache; per-quote and top-level `tier` (`eia_open_data` vs `reference_stub`)
- VLSFO SG + Gold remain honest reference stubs; no fake live exchange tier
- Terminal ticker badge: **EIA OPEN DATA** (green) or **REF PRICES** (blue) with disclaimer tooltip
- Config: `EIA_API_KEY` in `deploy/.env.example`, compose backend env, `internal/config`

## 2026-06-09 Phase 10c — review queue merge resolve

- `POST /api/admin/review-queue/{id}/resolve` with `action`: `merge` | `dismiss`
- Merge: pick `canonical_company_id`; repoint assets (operator/owner), contacts, relationships, evidence, risk_flags, signals, documents, feedback; delete duplicate companies; mark queue resolved
- Admin `/admin`: per-member **Merge as canonical** + **Dismiss** on `duplicate_company` items; suggested canonical by confidence
- `internal/dedup/merge.go` transactional merge; supersede sibling pending rows for same `normalized_name`

## 2026-06-09 Phase 10b — compose cutover (dev)

- `docker-compose.yml`: api healthcheck, worker/scheduler, legacy URL, host-gateway
- `compose_up.sh` / `compose_down.sh`; `.env.example`; Caddy WS + `--profile proxy`
- Frontend Docker build arg `NEXT_PUBLIC_API_URL`; CORS for :3001/:9080

## 2026-06-09 Phase 10a — ticker stub + company dedup

- `GET /api/core/ticker`: reference_stub Brent/VLSFO/Gold; terminal ticker wired
- `internal/dedup`: SQL duplicate clusters by `normalized_name`; enqueue to `manual_review_queue`
- Admin: dedup metrics, cluster table, **Scan → review queue**; `cmd/scan-company-duplicates`
- `madsan/README.md` dev runbook

## 2026-06-09 Phase 9c — deal graph UI + roadmap audit

- `DealGraphPanel.tsx`: post-verify relationship graph on `/deals`
- `madsan_v2_roadmap_status.md`: north-star check, data counts, gaps, next 5 priorities
- Fixed deals page TypeScript types; terminal back-link

## 2026-06-09 Phase 8e — vessel-terminal links + deal graph

- `maritime/proximity.go`: destination match + 80km terminal proximity → `relationships`
- AIS sync + `cmd/backfill-vessel-links` for existing fleet
- Vessel dossier shows linked terminals; deal pack v1.1 includes `relationship_graph`
- Verify persists `claimed_vessel_mmsi` / `claimed_asset_id` in result JSON

## 2026-06-09 Phase 8d — import signals + map corridors

- `PersistImportSnapshot` on bunker/legacy ingest → `core_signals` (24h throttle)
- `cmd/backfill-signals` for existing companies/assets
- Relationship edges include coordinates; company dossier centroid from operated assets
- Map draws dashed corridor lines from selected entity to related assets; flyTo on rel click

## 2026-06-09 Phase 8c — relationship graph

- `relationships` table + asset `operator_company_id` FK wired into dossier API
- OSM `operator` tags + license `company` fields linked on legacy import
- `cmd/backfill-relationships` for existing assets
- Dossier panel: clickable relationship navigation

## 2026-06-09 Phase 8b — signal history + search dedup

- Dossier API: `signal_history[]` from `core_signals` (last 15, with payload labels)
- `EntityDossierPanel`: timeline UI for persisted AIS/signal events
- Search: `DISTINCT ON (normalized_name)` for companies; dedupe assets/vessels similarly

## 2026-06-09 Phase 8a — global search + signal persistence

- `GET /api/core/search`: companies, assets (vertical filter), vessels with coordinates
- `SearchPalette.tsx`: ⌘K command palette → dossier panel + map flyTo
- `PersistVesselAIS`: durable `core_signals` on fresh AIS upsert (hourly throttle per vessel)

## 2026-06-09 Phase 7c — signals + live energy tiles

- Energy MVT tiles query live `assets` (tank farms, terminals, refineries)
- `entity_signals.go`: AIS freshness, evidence depth, register tier, commodity fit
- Dossier API returns `signals[]` + `opportunity_score`; panel displays both

## 2026-06-09 Phase 4c — Go legacy import

- `legacy_read.go`: pgx reader for oil_vessels, oil_companies, licenses, petroleum_osm
- Direct upsert + evidence (no Python child jobs); `engine: go` in result_report
- Python fallback: `use_python: true` in payload or `MADSAN_LEGACY_PYTHON=true`

## 2026-06-09 Phase 6c — metals vertical

- Metals MVT tiles query live `assets` (mines/smelters)
- `/api/metals/licenses/summary` with country breakdown
- Metals mode shows mine/country counts in panel header

## 2026-06-09 — metals vertical petroleum leak fix

- Root cause: metals MVT/summary/search included `processing_plant`/`refinery`/`port`, so misclassified `legacy_petroleum_osm_features` rows (e.g. Shaybah Oil Field) appeared in metals mode.
- Query filters in `internal/assets/filters.go` exclude petroleum OSM + petroleum commodities from metals tiles/search; summary scoped to `legacy_licenses` only.
- Frontend resets layer state on vertical switch; energy layers + live AIS WS disabled in metals mode.
- Optional data cleanup: re-run Go `legacy_import` for `petroleum_osm_features` to rewrite `asset_type` to energy types (`terminal`, `tank_farm`, etc.) — not required for correct UI after query filters.

## 2026-06-09 Phase 7b — map dossier panel

- `GET /api/core/entities/{asset|company|vessel}/{id}` unified dossier
- `GET /api/energy/vessels/by-mmsi/{mmsi}` for live AIS overlay clicks
- Evidence includes `claim_value`; vessel tiles expose `mmsi`
- `EntityDossierPanel`: summary, evidence chain, deal verify deep-link

## 2026-06-09 Phase 4b — legacy ETL orchestration

- `legacy_import` job type: Go worker runs `etl/legacy_import.py` against mining-db :5434
- Enqueues batched `legacy_etl` child jobs; worker drains up to 10 jobs per tick
- Admin: "Legacy import (all)" + "Vessels refresh" (incremental, max 2000 rows)
- Config: `MADSAN_ETL_DIR`, `MADSAN_ETL_PYTHON`, `LEGACY_DATABASE_URL`

## 2026-06-09 Phase 3b — ingestion queue + admin

- `EnqueueDeduped`: no duplicate pending/running jobs per type+source
- Scheduler: bunker_seed weekly + deduped enqueue
- Admin API: sources list, enriched insights, `POST /api/admin/ingestion/enqueue`
- Admin UI: metric cards, sources/jobs tables, manual enqueue buttons
- `scripts/start_scheduler.sh`

## 2026-06-09 Phase 9b — deal pack export

- `deals.BuildPack`: deal summary, parties + registry evidence, DD sections
- `GET /api/deals/{id}/pack?format=json|markdown|html`
- `/deals` UI: download buttons after verify

## 2026-06-09 Phase 2b — evidence chain

- Ingestion writes `sources`, `staging_generic_records`, `evidence` per entity claim
- Migration `012_evidence_dedupe.up.sql` unique index on (source, entity, claim_type)
- `cmd/backfill-evidence` for existing 90k+ entities → **226,613 evidence rows**
- API: `GET /api/energy/companies/{id}` + asset dossier includes evidence[]
- Supplier panel: click supplier → evidence chain preview

## 2026-06-09 Phase 6b — live AIS

- `internal/maritime/ais_sync.go`: polls legacy DB every 30s, upserts positions into `vessels`
- WebSocket: viewport snapshot + bbox-filtered deltas (`/api/core/ws`)
- Vessel tiles read live `vessels` table (30s cache) instead of stale matview
- Frontend: `live-vessels` GeoJSON overlay on map
- Verified: first sync batch updated 2000 vessels from legacy AIS

## 2026-06-09 Phase 9 — deal verification

- `internal/compliance/`: `dd_rules.json`, `EvaluateDeal`, OpenSanctions screener
- `deals.Verify`: registry lookup, DD checks, sanctions screening, vessel/asset claims, persisted `verification_result`
- `/deals` UI: auth gate, score/red-flag summary, optional vessel MMSI field
- Verified: authenticated VLSFO deal → score 75, `dd_recommendation=review`, deal persisted

## 2026-06-09 runtime fixes

- PostGIS ARM: removed invalid `platform: linux/arm64` in compose
- golang-migrate: renamed SQL to `*.up.sql`
- chi timeout bug: `middleware.Timeout(60*time.Second)` (was 60ns)
- DB URL: `127.0.0.1:5433`, `ConnectURL(cfg.DatabaseURL)`
- Caddy ports moved to 9080/9443 (avoid mining-caddy conflict on 8080)

## Safety

- Never `docker compose down -v`
- Legacy volumes preserved: `mining-map_postgres_data`
- pg_dump: `madsan/scripts/backup_db.sh`
