# MadSan V2 — Phase 14 Go-Live Blockers

**Synced:** 2026-06-09 · Source: `madsan_v2_roadmap_status.md`, `madsan_v2_compose_rebuild_plan.md`, `LEGACY_ETL_DEPRECATION.md`

**Verdict:** Internal DD MVP is shippable on dev/hybrid. **Production go-live blocked** until parity green, DR fixed, TLS, and PR merge.

Status key: **done** · **partial** · **blocked**

---

## 1. Legal & compliance

- [~] **partial** — `/legal` page (Phase 12c): intelligence-not-advice, data tiers & evidence, sanctions screening limits, corrections via admin review queue, explicit no-counsel sign-off (`frontend/src/app/legal/page.tsx`)
- [~] **partial** — Deal pack + `/deals` UI carry “not legal/trading advice” disclaimers
- [~] **partial** — OpenSanctions screening labeled review-tier (not confirmation) in pack + verify flow
- [ ] **blocked** — External legal/compliance sign-off on prod copy (disclaimer, privacy, sanctions use)
- [ ] **blocked** — Terms of use / cookie consent if exposing beyond internal users

---

## 2. Auth & RLS (tenant isolation)

- [x] **done** — JWT cookie auth + entitlements resolver (`006_auth_tenancy`, `007_entitlements`)
- [x] **done** — Admin routes gated (`requireAuth` on `/api/admin/*`)
- [~] **partial** — Deals RBAC: `/api/deals/verify`, `/{id}/pack`, `/{id}/watch` require JWT + entitlements (**uncommitted** on branch)
- [~] **partial** — App-layer `tenant_id` FKs on companies/deals/documents; no query-level enforcement on public map/search APIs
- [~] **partial** — Postgres RLS scaffold (`014_rls_scaffold.up.sql`): `usage_events` RLS + deny stub for `madsan_rls` role; `app_current_tenant_id()` helper; table COMMENT policy sketches. **Applied on dev** (2026-06-09); owner (`postgres`) bypasses — no API behavior change yet
- [~] **partial** — Go tenant GUC stub: `withTenantGUC` middleware after JWT on `/api/admin/*` and authenticated `/api/deals/*`; `database.BindRequestTenantRLS` runs `SET LOCAL app.tenant_id` on a request-scoped tx when claims carry `tid`. Handlers still use shared pool until `madsan_rls` cutover
- [ ] **blocked** — RLS cutover: grant `madsan_rls` to API pool, route tenant queries through request tx / `madsan_rls` role, replace deny policy, extend to deals/documents/memberships; **defer `companies` until map/search audit**
- [ ] **blocked** — Portal/billing route auth (execute pillar not started)

### RLS verify steps (`014` on dev)

1. **Apply:** `go run ./cmd/migrate` from `madsan/backend` (or API startup auto-migrate). **Done on dev** 2026-06-09.
2. **Confirm scaffold:**  
   `psql -d madsan_db -c "SELECT relrowsecurity FROM pg_class WHERE relname = 'usage_events';"` → `t`.  
   `psql -d madsan_db -c "\dRp+ usage_events"` → `usage_events_deny_default` for `madsan_rls` only.
3. **No regression:** existing API INSERT to `usage_events` (entitlements) still works as `postgres` owner.
4. **Middleware stub (shipped):** authenticated routes chain `requireAuth` → `withTenantGUC` → handler. With a live DB, `BindRequestTenantRLS` sets `app.tenant_id` via `set_config(..., true)` on a request-scoped tx; verify with logged-in request + `SELECT current_setting('app.tenant_id', true)` inside handler when wired to request tx.
5. **Future cutover:** create `madsan_rls` LOGIN, `GRANT` on tenant tables, point API pool at `madsan_rls`, migrate handlers to `database.RequestTxFromContext` (or equivalent), swap deny policy for `tenant_id = app_current_tenant_id()`.

---

## 3. DR & backup

- [x] **done** — `scripts/backup_db.sh` backs up `madsan_db` via compose `madsan-db` (`localhost:5433`); `LEGACY=1` or `--legacy` for `mining_db` / `mining-db`
- [x] **done** — `scripts/restore_madsan_db.sh`: dry-run by default; drill target `madsan_db_restore_test`; prod `madsan_db` requires `FORCE=1`
- [~] **partial** — Cron example: `scripts/backup_cron.example` (daily `backup_db.sh`); **not installed** on prod VM yet
- [~] **partial** — `deploy/rollback.md` (stop V2, restore from `backups/`; never `down -v`)
- [x] **done** — Restore drill executed on dev (2026-06-09); see drill log below

### DR verify steps (restore drill)

1. **Backup:** `./madsan/scripts/backup_db.sh` → confirm `backups/madsan_v2_pre_<stamp>.dump` exists.
2. **Dry-run:** `./madsan/scripts/restore_madsan_db.sh` → prints latest dump + target `madsan_db_restore_test` (no writes).
3. **Drill execute:** ensure `madsan-db` is up, then  
   `DRY_RUN=0 ./madsan/scripts/restore_madsan_db.sh`  
   (optional explicit dump path as first arg).
4. **Spot-check:** script prints row counts for `companies`, `deals`, `documents`; compare to live `madsan_db` via  
   `docker compose -f madsan/deploy/docker-compose.yml exec -T madsan-db psql -U postgres -d madsan_db -c "SELECT COUNT(*) FROM companies;"`.
5. **Cleanup (optional):**  
   `docker compose -f madsan/deploy/docker-compose.yml exec -T madsan-db psql -U postgres -d postgres -c 'DROP DATABASE IF EXISTS madsan_db_restore_test;'`
6. **Prod disaster recovery only** (never for drills): stop writers, then  
   `DRY_RUN=0 FORCE=1 TARGET_DB=madsan_db ./madsan/scripts/restore_madsan_db.sh <dump>`  
   — overwrites production; log timestamp + operator in runbook.
7. **Record:** note dump file, restore duration, row-count parity, and date in this checklist or ops log (closes RTO/RPO item).

**Drill log (2026-06-09):** Executed `DRY_RUN=0 ./madsan/scripts/restore_madsan_db.sh` against `backups/madsan_v2_pre_20260609_221939.dump` (79 MB) → `madsan_db_restore_test` in ~17 s; `pg_restore` completed with no fatal errors. Spot-check vs live `madsan_db`: `companies` 37,190 (restore) vs 48,668 (live), `assets` 94,564 vs 124,888, `deals` 1/1, `documents` 0/0 — drift expected because live DB continued ingesting after the 22:19 backup; restore faithfully reproduced backup snapshot. RTO drill target met on dev; RPO bounded by backup cadence (cron not yet on prod VM).

### Backup cron (prod VM)

1. Verify manually from standalone prod checkout (see `deploy/DEPLOY.md`):

```bash
cd /opt/madsan && ./scripts/backup_db.sh
ls -lh backups/madsan_v2_pre_*.dump
```

2. `crontab -e` — paste (or run `./scripts/install_backup_cron.sh`; see `scripts/backup_cron.example`):

```cron
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# Daily 02:30 local — madsan_db via compose madsan-db
30 2 * * * cd /opt/madsan && ./scripts/backup_db.sh >> backups/backup_cron.log 2>&1
```

3. Prerequisites: cron user can run `docker` + `docker compose`; `madsan-db` up before first run.
4. After first scheduled run: check `backups/backup_cron.log` and newest `madsan_v2_pre_*.dump`.
5. Optional retention (example — 14 days):  
   `find /opt/madsan/backups -name 'madsan_v2_pre_*.dump' -mtime +14 -delete`

---

## 4. k6 load / smoke

- [x] **done** — `scripts/k6_smoke.js`: health + MVT tile; p95 &lt; 2s; header documents prod gate via Caddy `:80`
- [~] **partial** — Prod command documented; not wired in CI yet
- [ ] **blocked** — Default `BASE` is dev (`localhost:8088`) — prod gate **must** set `MADSAN_API_URL=http://<vm>:80`
- [ ] **blocked** — No baseline run logged against prod overlay stack

---

## 5. Prod compose & volume seed

- [x] **done** — `docker-compose.prod.yml`: ARM64, memory limits, healthchecks, internal DB/API/frontend, Caddy `:80`, named volumes
- [x] **done** — `scripts/seed_prod_volumes.sh` copies `madsan/raw` → `madsan_raw_data`, `madsan/etl` → `madsan_etl_data`
- [ ] **blocked** — Named volumes **start empty** on first prod deploy — seed not executed on target VM yet
- [ ] **blocked** — Full prod stack smoke (`compose … prod.yml --profile proxy up`) not verified on ARM VM
- [~] **partial** — `NEXT_PUBLIC_API_URL` must match Caddy origin (documented in `.env.example`; prod value TBD)

### Volume seed (once per VM, before legacy import)

From MadSan repo root on the prod VM (`/opt/madsan`; stack may be down — volumes are Docker-managed):

```bash
chmod +x scripts/seed_prod_volumes.sh
./scripts/seed_prod_volumes.sh          # copy host trees into named volumes
./scripts/seed_prod_volumes.sh --dry-run # preview only
```

Manual equivalent (same volumes):

```bash
docker run --rm -v madsan_raw_data:/dest -v "$PWD/raw":/src:ro alpine cp -a /src/. /dest/
docker run --rm -v madsan_etl_data:/dest -v "$PWD/etl":/src:ro alpine cp -a /src/. /dest/
```

Verify: `docker run --rm -v madsan_raw_data:/v alpine ls /v | head` (expect `bunker_fuel_suppliers_seed.json` symlink target or seed files).

### Prod stack smoke (k6 via Caddy :80)

After `docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.prod.yml --profile proxy up -d` (from `/opt/madsan`):

```bash
MADSAN_API_URL=http://<vm-ip-or-hostname>:80 k6 run scripts/k6_smoke.js
```

Hits `GET /health` and `GET /tiles/energy-assets/4/8/5.mvt` **through Caddy** (not `:8088` direct); pass when p95 &lt; 2s. Log run date + VM in this checklist when green.

---

## 6. Legacy parity gate (Python retirement)

- [x] **done** — `cmd/legacy-parity` CLI + admin Runtime health panel (5% threshold, 5m cache)
- [x] **done** — `licenses` parity **green** — compare **dedup keys** (legacy importable rows: geolocated, non-empty `company`, key = `normalized_name` + `asset_type` + `country_code`; matches Go upsert). Fix `bcb0f2a` — prior ~74% “under-import” was stale raw-row mismatch, not missing data (~45,506 keys, ~0.01% drift; see `LEGACY_ETL_DEPRECATION.md`).
- [x] **done** — Critical parity tables green on dev (2026-06-10): `oil_vessels`, `licenses`, `petroleum_osm_features` (dedup-key measurement fix in `legacy_parity.go`)
- [~] **partial** — Phase A intelligence tables (`eia_historic_imports`, `oil_port_calls`, `oil_sts_events`, …): code in `legacy-phase-a` / `legacy_intelligence.go`; **re-run `go run ./cmd/legacy-parity` after import** on target DB
- [~] **partial** — Dev snapshot green (`legacy-parity` exit 0, 2026-06-10); prod-like end-to-end not verified
- [~] **in progress** — 30-day no-Python soak started **2026-06-10** (ends ~2026-07-10); admin parity UI confirm with auth

---

## 7. GitHub PR & branch hygiene

- [~] **partial** — Greenfield `madsan/` on branch `new-refactor-eng-style` (~159 tracked files committed)
- [ ] **blocked** — Significant **uncommitted** work: dedup scoring, cross-name pairs, deals RBAC, auth middleware, prod compose, migration `013`
- [ ] **blocked** — No open `gh pr` to merge into main — prod cutover needs reviewable PR + CI
- [ ] **blocked** — Parity gate + k6 smoke should be PR check gates before merge

---

## 8. TLS & edge (Caddy)

- [~] **partial** — Dev Caddy reverse proxy + WS (`deploy/Caddyfile`, profile `:9080` dev / `:80` prod HTTP)
- [x] **done** — TLS template: `deploy/Caddyfile.prod.tls.example` (Let's Encrypt site block + mount/volume notes)
- [ ] **blocked** — TLS **not applied** on prod VM yet (still HTTP-only `deploy/Caddyfile`)
- [ ] **blocked** — Browser smoke via `http://<vm>:80/health` through Caddy not logged
- [~] **partial** — Prod secrets: `MADSAN_JWT_SECRET=change-me-in-production` in `.env.example` — must rotate before expose

### TLS cutover steps (Caddy + Let's Encrypt)

1. **DNS:** `A`/`AAAA` for prod hostname → VM public IP.
2. **Firewall:** allow inbound TCP **80** (ACME HTTP-01 + redirect) and **443** (HTTPS).
3. **Env:** in `madsan/deploy/.env` set `NEXT_PUBLIC_API_URL=https://<your-hostname>` (matches browser origin).
4. **Caddyfile:** copy/adapt `deploy/Caddyfile.prod.tls.example` — replace `madsan.example.com` with prod hostname.
5. **Compose mount:** in `docker-compose.prod.yml` `caddy` service, swap volume to TLS file and persist cert state:

```yaml
    volumes:
      - ./Caddyfile.prod.tls.example:/etc/caddy/Caddyfile:ro
      - madsan_caddy_data:/data
      - madsan_caddy_config:/config
```

Add under top-level `volumes:` if missing: `madsan_caddy_data`, `madsan_caddy_config` (named).

6. **Redeploy Caddy only** (no worker restart required for TLS-only change):

```bash
docker compose -f madsan/deploy/docker-compose.yml \
  -f madsan/deploy/docker-compose.prod.yml \
  --profile proxy up -d caddy
```

7. **Verify:** `curl -sS https://<hostname>/health` → 200; `docker compose … logs caddy | tail` shows cert obtain/renew.
8. **k6 post-TLS:** `MADSAN_API_URL=https://<hostname> k6 run madsan/scripts/k6_smoke.js`
9. **Rollback:** remount `deploy/Caddyfile` (HTTP `:80` only); remove TLS volume mounts; redeploy `caddy`.

---

## 9. Observability (Phase 14 scope)

- [~] **partial** — Admin runtime health: AIS sync stats, vessel freshness, parity drift (`GET /api/admin/health/runtime`)
- [ ] **blocked** — No Prometheus/Grafana/log aggregation stack (roadmap: “full observability stack” not started)
- [~] **partial** — API OOM risk documented (1536m cap; monitor AIS batch via admin health)

---

## Go-live sequence (when unblocked)

1. Commit + open PR (`new-refactor-eng-style` → main); CI runs `go test`, `legacy-parity`, k6 smoke.
2. Install backup cron (§3); run restore drill (`DRY_RUN=0 ./madsan/scripts/restore_madsan_db.sh`); record in §3.
3. Deploy prod overlay on ARM VM; `./madsan/scripts/seed_prod_volumes.sh`; set prod `.env` secrets.
4. Enqueue Legacy import (all); re-run parity until exit 0.
5. k6 through Caddy `:80` (§5); manual smoke (map, dossier, deals auth, admin health).
6. TLS cutover (§8); legal sign-off; run RLS migrate (`014`) then staged cutover to `madsan_rls` if multi-tenant prod.

---

## References

| Doc | Purpose |
|-----|---------|
| `madsan_v2_roadmap_status.md` | Phase status, live row counts, risks |
| `madsan_v2_compose_rebuild_plan.md` | Stack topology, prod overlay |
| `docs/LEGACY_ETL_DEPRECATION.md` | Parity thresholds + cutover checklist |
| `deploy/rollback.md` | Rollback without volume destroy |
| `deploy/Caddyfile.prod.tls.example` | Let's Encrypt Caddy site block + mount notes |
| `scripts/seed_prod_volumes.sh` | One-shot prod volume seed from `madsan/raw` + `madsan/etl` |
| `scripts/backup_cron.example` | Cron template for daily `backup_db.sh` |
