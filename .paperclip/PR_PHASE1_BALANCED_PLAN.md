# PR draft — Phase 1 balanced plan (new-branch-develop → main)

## Summary

- **Crisis Desk v1:** `crisis_scenarios`, Hormuz digest API, Live Data **Crisis desk** lens, dev `seed_hormuz_crisis_demo.sh`
- **Data spine:** corridor delta API, AIS watch-zone metrics on sync-status, watch-zone-prioritized AIS ingest merge
- **Customs:** Brazil open-trade manifest adapter + graph-sync step (UK pattern)
- **Deal intelligence:** batch opportunity rescore worker, Deal pack MD + print/PDF
- **Phase 1 ops:** `phase1_signoff.sh`, `PHASE1_BROWSER_CHECKLIST.md`, extended platform smoke, staging ops docs

## Test plan

- [ ] `./scripts/phase1_signoff.sh` on Caddy `:8080`
- [ ] `./scripts/seed_hormuz_crisis_demo.sh` → digest `top_corridors | length` ≥ 1
- [ ] Manual: [docs/PHASE1_BROWSER_CHECKLIST.md](../docs/PHASE1_BROWSER_CHECKLIST.md)
- [ ] `docker compose build oil-live-intel && up -d oil-live-intel` (migrations `022_crisis_scenarios`)

## Non-goals

- No `VITE_LICENSE_MAP_GO_STRICT=1` in prod
- No production Hormuz SQL demo seed
