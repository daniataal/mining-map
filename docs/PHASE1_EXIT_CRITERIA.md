# Phase 1 exit criteria (trader-visible ledger)

**Paperclip:** Use this checklist to close the “Phase 1 — Trader-visible ledger” milestone (ADR-0001).  
**Branch discipline:** `paperclip2` or feature branch → PR with `platform_map_smoke.sh` green on Caddy `:8080`.

## Trader journey (must pass manually)

| # | Step | Pass when |
|---|------|-----------|
| 1 | Open app via **Caddy :8080** or Vite :5173 (not backend :8000 alone) | Live Data / Oil & Gas map loads without console errors |
| 2 | **Discover** — map shows terminals, MCR corridors (or honest empty + graph-sync CTA), vessels where AIS exists | Layer toggles work; bbox refetch &lt; 2s perceived; no world-wide dump |
| 3 | **Gulf honesty** — pan to Persian Gulf / Hormuz | Coverage / limitation banner visible when viewport overlaps Gulf; empty sea ≠ “no traffic” copy |
| 4 | **Verify** — open vessel or cargo row | Drawer shows `bol_tier`, evidence, sanctions/LEI where present; synthetic labeled |
| 5 | **Search** — company search (ES or PG degraded banner) | Results open drawer / fly map; search debounced |
| 6 | **Historic** — toggle EIA historic arcs (Raw lens) | `bol_tier=historic` disclaimer visible |
| 7 | **Customs open** — UK manifest rows in DB (`trade_manifest_rows`, `bol_tier=customs_open`) | Intel panel shows customs_open count + tier badge; not presented as paid BOL |
| 8 | **Deal pack** — export from opportunity/cargo | Deal Execution Pack or CSV export completes |
| 9 | **sync-status** | `GET /api/oil-live/sync-status` shows terminal/cargo counts, optional `graph_sync_steps` |

## Automated gates (CI / local)

```bash
cd oil-live-intel && go test ./internal/api/...
cd mining-viz && npm run build
BASE_URL=http://127.0.0.1:8080 ./scripts/platform_map_smoke.sh
BASE_URL=http://127.0.0.1:8080 ./scripts/license_bundle_parity.sh
BASE_URL=http://127.0.0.1:8080 ./scripts/license_map_parity.sh
```

Optional before removing Python license fallback:

- `VITE_LICENSE_MAP_SHADOW_METRICS=1` on staging for 7–14 days
- `getLicenseMapShadowMetrics()` shows **zero** `usedFallback: true`
- Then set `VITE_LICENSE_MAP_GO_STRICT=1` (Go-only reads)

## Explicit non-goals for Phase 1

- Paid ImportYeti / CBP manifest scraping
- Production route planner / marketplace execute / KYC payments
- Full global mining cadastre completeness
- Persian Gulf AIS density matching commercial trackers

## Sign-off

- [ ] Product: trader journey table above (manual browser pass on :8080)
- [x] Engineering: automated gates (`go test`, `npm run build`, `platform_map_smoke.sh`, license parity) — re-run on PR branch before merge
- [ ] Ops: `oil-live-intel-worker` + graph-sync healthy; demo seed off in prod — see [STAGING_OPS.md](./STAGING_OPS.md)

**Automated engineering sign-off:** `./scripts/phase1_signoff.sh`

**Crisis desk dev corridors (optional):** `./scripts/seed_hormuz_crisis_demo.sh` then re-check digest `top_corridors` length ≥ 1.

**Browser checklist:** [PHASE1_BROWSER_CHECKLIST.md](./PHASE1_BROWSER_CHECKLIST.md)

**License strict cutover:** staging `VITE_LICENSE_MAP_SHADOW_METRICS=1` → [LICENSE_MAP_CUTOVER_GATE.md](./LICENSE_MAP_CUTOVER_GATE.md). Do not set `VITE_LICENSE_MAP_GO_STRICT=1` in prod until shadow shows zero `usedFallback`.
