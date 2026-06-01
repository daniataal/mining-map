# Staging operations (Phase 1 / license cutover)

## License shadow metrics

On **staging** frontend build set:

```bash
VITE_LICENSE_MAP_SHADOW_METRICS=1
```

Monitor browser console `[license-map-shadow]` for 14 days. Gate: zero `usedFallback: true` before `VITE_LICENSE_MAP_GO_STRICT=1`.

See [LICENSE_MAP_CUTOVER_GATE.md](./LICENSE_MAP_CUTOVER_GATE.md).

## Production demo seed

Compose prod should set `OIL_LIVE_DISABLE_DEMO_SEED=1`. Verify:

```bash
curl -s "$BASE_URL/api/oil-live/sync-status" | jq '.demo_cargo_record_count, .production_cargo_record_count'
```

## Automated Phase 1 gates

```bash
./scripts/phase1_signoff.sh
```

Product still runs manual rows in [PHASE1_EXIT_CRITERIA.md](./PHASE1_EXIT_CRITERIA.md).
