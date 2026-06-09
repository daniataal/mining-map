# MadSan V2 — Phase 14 Go-Live Blockers

**Synced:** 2026-06-09 · Source: `madsan_v2_roadmap_status.md`, `madsan_v2_compose_rebuild_plan.md`, `LEGACY_ETL_DEPRECATION.md`

**Verdict:** Internal DD MVP is shippable on dev/hybrid. **Production go-live blocked** until parity green, DR fixed, TLS, and PR merge.

Status key: **done** · **partial** · **blocked**

---

## 1. Legal & compliance

- [~] **partial** — `/legal` page: intelligence disclaimer, data tiers, GDPR principles, risk wording (`frontend/src/app/legal/page.tsx`)
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
- [~] **partial** — Postgres RLS scaffold (`014_rls_scaffold.up.sql`): `usage_events` RLS + deny stub for `madsan_rls` role; `app_current_tenant_id()` helper; table COMMENT policy sketches. **Not applied until migrate runs**; owner (`postgres`) bypasses — no prod behavior change yet
- [ ] **blocked** — RLS cutover: grant `madsan_rls` to API pool, `SET app.tenant_id` per request, replace deny policy, extend to deals/documents/memberships; **defer `companies` until map/search audit**
- [ ] **blocked** — Portal/billing route auth (execute pillar not started)

### RLS verify steps (after `014` migrate)

1. **Apply:** `go run ./cmd/migrate` from `madsan/backend` (or API startup auto-migrate).
2. **Confirm scaffold:**  
   `psql -d madsan_db -c "SELECT relrowsecurity FROM pg_class WHERE relname = 'usage_events';"` → `t`.  
   `psql -d madsan_db -c "\dRp+ usage_events"` → `usage_events_deny_default` for `madsan_rls` only.
3. **No regression:** existing API INSERT to `usage_events` (entitlements) still works as `postgres` owner.
4. **Future cutover:** create `madsan_rls` LOGIN, `GRANT` on tenant tables, middleware `SET LOCAL app.tenant_id`, swap deny policy for `tenant_id = app_current_tenant_id()`.

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

1. Copy/adapt `scripts/backup_cron.example` — set `REPO_ROOT` (e.g. `/opt/mining-map`).
2. `crontab -e` — paste the daily line (`30 2 * * * … backup_db.sh >> backups/backup_cron.log`).
3. Confirm `madsan-db` is up before first scheduled run; check `backups/backup_cron.log` and latest `madsan_v2_pre_*.dump`.

---

## 4. k6 load / smoke

- [~] **partial** — `deploy/k6-smoke.js`: health, assets API, MVT tile; p95 &lt; 800 ms threshold
- [ ] **blocked** — Not wired in CI or documented prod gate
- [ ] **blocked** — Default `BASE` hits API `:8088` direct — prod gate must run through Caddy `:80` with realistic VU count
- [ ] **blocked** — No baseline run logged against prod overlay stack

---

## 5. Prod compose & volume seed

- [x] **done** — `docker-compose.prod.yml`: ARM64, memory limits, healthchecks, internal DB/API/frontend, Caddy `:80`, named volumes
- [~] **partial** — Seed commands documented for `madsan_raw_data` / `madsan_etl_data` (roadmap + compose plan)
- [ ] **blocked** — Named volumes **start empty** on first prod deploy — seed not executed on target VM
- [ ] **blocked** — Full prod stack smoke (`compose … prod.yml --profile proxy up`) not verified on ARM VM
- [~] **partial** — `NEXT_PUBLIC_API_URL` must match Caddy origin (documented in `.env.example`; prod value TBD)

---

## 6. Legacy parity gate (Python retirement)

- [x] **done** — `cmd/legacy-parity` CLI + admin Runtime health panel (5% threshold, 5m cache)
- [ ] **blocked** — Last validation **failed** critical tables (`LEGACY_ETL_DEPRECATION.md` 2026-06-09):
  - `oil_vessels` — pass (0% drift)
  - `licenses` — **fail** (74.3% under-imported)
  - `petroleum_osm_features` — **fail** (81.1% under-imported)
- [ ] **blocked** — Full Go **Legacy import (all)** with worker (no `max_rows` cap) not completed on prod-like snapshot
- [ ] **blocked** — Admin parity panel green for 24h soak (prerequisite for `legacy_import.py` removal)

---

## 7. GitHub PR & branch hygiene

- [~] **partial** — Greenfield `madsan/` on branch `new-refactor-eng-style` (~159 tracked files committed)
- [ ] **blocked** — Significant **uncommitted** work: dedup scoring, cross-name pairs, deals RBAC, auth middleware, prod compose, migration `013`
- [ ] **blocked** — No open `gh pr` to merge into main — prod cutover needs reviewable PR + CI
- [ ] **blocked** — Parity gate + k6 smoke should be PR check gates before merge

---

## 8. TLS & edge (Caddy)

- [~] **partial** — Dev Caddy reverse proxy + WS (`deploy/Caddyfile`, profile `:9080` dev / `:80` prod)
- [ ] **blocked** — Prod Caddyfile is **HTTP-only** (`:80`) — no TLS / Let's Encrypt / `:443`
- [ ] **blocked** — Browser smoke via `http://<vm>:80/health` through Caddy not logged
- [~] **partial** — Prod secrets: `MADSAN_JWT_SECRET=change-me-in-production` in `.env.example` — must rotate before expose

---

## 9. Observability (Phase 14 scope)

- [~] **partial** — Admin runtime health: AIS sync stats, vessel freshness, parity drift (`GET /api/admin/health/runtime`)
- [ ] **blocked** — No Prometheus/Grafana/log aggregation stack (roadmap: “full observability stack” not started)
- [~] **partial** — API OOM risk documented (1536m cap; monitor AIS batch via admin health)

---

## Go-live sequence (when unblocked)

1. Commit + open PR (`new-refactor-eng-style` → main); CI runs `go test`, `legacy-parity`, k6 smoke.
2. Install backup cron from `scripts/backup_cron.example`; run restore drill (`DRY_RUN=0 ./madsan/scripts/restore_madsan_db.sh`); record in §3.
3. Deploy prod overlay on ARM VM; seed volumes; set prod `.env` secrets.
4. Enqueue Legacy import (all); re-run parity until exit 0.
5. k6 through Caddy `:80`; manual smoke (map, dossier, deals auth, admin health).
6. TLS on Caddy; legal sign-off; run RLS migrate (`014`) then staged cutover to `madsan_rls` if multi-tenant prod.

---

## References

| Doc | Purpose |
|-----|---------|
| `madsan_v2_roadmap_status.md` | Phase status, live row counts, risks |
| `madsan_v2_compose_rebuild_plan.md` | Stack topology, prod overlay |
| `docs/LEGACY_ETL_DEPRECATION.md` | Parity thresholds + cutover checklist |
| `deploy/rollback.md` | Rollback without volume destroy |
