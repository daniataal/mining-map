# Satellite Intelligence — Deferred (Phase 12b)

**Status:** Deferred until core revenue is stable and ARM/23Gi capacity allows batch CV workloads.

**Scope when enabled:** Copernicus Sentinel-1 (SAR) and Sentinel-2 (optical) — floating-roof tank volume estimation, storage draw/build inference, dark-STS SAR cross-reference when AIS is sparse.

**Not in scope now:** YOLO/Segment-Anything pipelines, GPU inference, tile download cron, or any production claims labeled as satellite-derived.

## Copernicus tier policy

| Tier | Label | When used | UI requirement |
|------|-------|-----------|----------------|
| **observed** | Government / registry / AIS with timestamp | Primary dossier facts | Green badge; show source + freshness |
| **inferred** | AIS correlation, draught estimates, graph links | Derived intel without direct observation | Yellow badge; list contributing signals |
| **satellite-derived** | Sentinel-1/2 CV or InSAR inference | Only after Phase 12b ships | Purple badge; separate disclaimer; never merge into observed |
| **missing** | No coverage for claim | Gaps, stale AIS, no tiles | Gray badge; do not impute as zero |

### Sentinel source rules (future)

1. **Copernicus Data Space Ecosystem** — free tier; attribute ESA/Copernicus; cache tiles under `raw/copernicus/` with SHA256 skip.
2. **Commercial_use_ok gate** — satellite tiles used in paid deal packs only if license row marks `commercial_use_ok = true` (Copernicus open data: yes, with attribution).
3. **Latency honesty** — Sentinel-2 revisit ~5 days; SAR ~6–12 days depending on beam mode; never present as live inventory.
4. **Confidence floor** — satellite-derived tank fill estimates start at `confidence_score <= 65` until calibrated against port manifests or operator disclosures.
5. **Dark STS** — SAR-only STS confirmation requires `<2` AIS signatures in window **and** explicit `tier = satellite-derived`; AIS-proximity alone stays `inferred`.

### Interim substitutes (shipped / cheap)

- Tank/storage activity: AIS vessel loading correlation + port calls (inferred).
- Persian Gulf / Hormuz gaps: label **limited provider coverage**; do not backfill with satellite fiction.
- Deal verification: registry + sanctions + price context; no volume-from-satellite claims.

## Rollout criteria (re-open Phase 12b)

- [ ] Core Energy deal verification revenue path live
- [ ] Worker queue stable; targeted matview refresh without full-table churn
- [ ] Documented CPU/RAM budget for nightly tile fetch + CV batch (estimate ≥4Gi peak)
- [ ] Legal review of Copernicus attribution + satellite-derived disclaimers
- [ ] Calibration dataset: ≥50 terminals with known capacity or manifest ground truth

## Rollback

No schema dependency today. If experimental satellite jobs are added later, gate behind `feature_flags.satellite_intel` default **off**; disable flag and stop scheduler slug `copernicus_tank_volume` without data deletion.

## References

- Plan Phase 12b — satellite-derived intelligence
- `data_gaps_report.md` — Copernicus listed Tier 1 free, CV deferred
- Frontend legal copy: satellite-derived labeled separately (`/legal`)
