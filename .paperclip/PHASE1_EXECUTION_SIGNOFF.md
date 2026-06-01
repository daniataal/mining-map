# Meridian balanced roadmap — implementation sign-off

**Branch:** `new-branch-develop` (re-run gates before merge)  
**Date:** 2026-06-01

## Shipped (master plan todos)

| Track | Deliverable |
|-------|-------------|
| P1 | `scripts/phase1_signoff.sh`, [STAGING_OPS.md](../docs/STAGING_OPS.md), smoke extended |
| AIS | [AIS_GULF_PROVIDER_EVALUATION.md](../docs/AIS_GULF_PROVIDER_EVALUATION.md), `sync-status.watch_zone_observations_24h` |
| Aggregates | `GET /api/oil-live/corridors/delta`, crisis lens uses country_pair trade flows |
| Scorer | `BatchRescoreOpenOpportunities` in oil-live-intel worker |
| Crisis | `022_crisis_scenarios.sql`, digest API, **Crisis desk** lens + panel |
| Brazil | `sync_brazil_open_trade_rows`, graph-sync step, sample CSV |
| Deal pack | MD export + **Print / PDF** (browser print) on Deal Execution Pack |
| Go | Parity in phase1_signoff; cutover doc unchanged |
| Execute | [EXECUTE_RFQ_COMPLIANCE_SPIKE.md](../docs/EXECUTE_RFQ_COMPLIANCE_SPIKE.md) |
| Ops glue | `BRAZIL_MANIFEST_CSV_DIR` on graph-sync worker; `ingest_brazil_manifests_dev.sh` |
| UI | Intel panel AIS-by-zone strip; crisis digest `top_corridors` |
| Dev seed | `seed_hormuz_crisis_demo.sh` + Go `EnsureHormuzCrisisDemoMCR` |
| CI | platform-health runs opportunity + ais Go tests |

## Verification (2026-06-01, branch `new-branch-develop`)

| Gate | Result | Notes |
|------|--------|-------|
| `docker compose build oil-live-intel && up -d` | **PASS** | Service healthy on `:8095`; Caddy proxy `:8080` |
| Hormuz digest `top_corridors` | **3** (after `./scripts/seed_hormuz_crisis_demo.sh`) | Demo MCR seed; prod stays empty unless real data in bbox |
| `watch_zone_observations_24h` | **3** | Persian Gulf, Gulf of Oman, Oman approaches — all `has_gap: true` (expected sparse AIS) |
| `./scripts/phase1_signoff.sh` | **PASS** | Go api/licensemap/opportunity/ais, vite build, platform smoke, license parity |
| `platform_map_smoke.sh` | **PASS** | Asserts `top_corridors` key on digest |
| `go test ./internal/services/ais/...` | **PASS** | Watch-zone box merge covered |
| `backend/.venv` pytest trade manifest | **PASS** | 5 passed (`python3 -m pytest` needs venv on host) |

```bash
./scripts/phase1_signoff.sh
curl -s http://127.0.0.1:8080/api/oil-live/scenarios/hormuz_disruption_v1/digest | jq '.scenario.slug, (.top_corridors|length), (.watch_zone_observations_24h|length)'
curl -s 'http://127.0.0.1:8080/api/oil-live/corridors/delta?limit=5' | jq '.count'
backend/.venv/bin/python -m pytest backend/tests/test_trade_manifest_ingest.py -q
```

## Manual (product)

- [ ] [PHASE1_BROWSER_CHECKLIST.md](../docs/PHASE1_BROWSER_CHECKLIST.md) (rows 1–9 + Crisis desk)
- [ ] [PHASE1_EXIT_CRITERIA.md](../docs/PHASE1_EXIT_CRITERIA.md) rows 1–9 in browser
- [ ] Live Data → **Crisis desk** lens → Hormuz digest + top plays
- [ ] Staging: `VITE_LICENSE_MAP_SHADOW_METRICS=1`

**Dev:** populate crisis `top_corridors` with `./scripts/seed_hormuz_crisis_demo.sh` (or `OIL_LIVE_DISABLE_DEMO_SEED=0` + restart `oil-live-intel`).

## Paperclip epics

See [.paperclip/MERIDIAN_ROADMAP_EPICS.md](./MERIDIAN_ROADMAP_EPICS.md).
