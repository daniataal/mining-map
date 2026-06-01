# License map Go strict cutover gate

Do **not** enable `VITE_LICENSE_MAP_GO_STRICT=1` in production until all gates below pass.

## Preconditions

1. **Parity scripts green** on the target environment (Caddy `:8080`):

```bash
BASE_URL=http://127.0.0.1:8080 ./scripts/license_map_parity.sh
BASE_URL=http://127.0.0.1:8080 ./scripts/license_bundle_parity.sh
BASE_URL=http://127.0.0.1:8080 ./scripts/platform_map_smoke.sh
```

2. **Shadow period (staging):** set `VITE_LICENSE_MAP_SHADOW_METRICS=1` on the frontend build (see root `.env.example`). Monitor for **7–14 days** of production-like map pan/zoom traffic.

3. **Zero Python fallback:** in browser devtools, `getLicenseMapShadowMetrics()` (or `[license-map-shadow]` console logs) must show **no** entries with `usedFallback: true`.

## Cutover

1. Set `VITE_LICENSE_MAP_GO_STRICT=1` on staging; rebuild `mining-viz`.
2. Re-run parity + manual map check (world z&lt;8 country-summary, z≥8 clusters).
3. Promote to production only after staging soak with zero fallbacks.

## Rollback

Set `VITE_LICENSE_MAP_GO_STRICT=0` (or unset) and redeploy frontend. Go and Python license APIs remain available; no DB migration required.

See also [PHASE1_EXIT_CRITERIA.md](./PHASE1_EXIT_CRITERIA.md) and [LIVE_DATA.md](./LIVE_DATA.md).
