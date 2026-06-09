# Map UX gating rule

Do **not** add until Phase 4 layer-authority verification passes:

- New intelligence map layers (ESG, dredging, additional GEM imports)
- New bunker hub seed expansion
- New floating map-center overlays or data lists

## Verification checklist

```bash
cd mining-viz && npm test -- --run assetLayerCockpit layerVisibilityAuthority storageTankFarmsLayer infrastructureCoverage
```

Manual:

- Toggle all asset layers off, zoom out — layers stay off
- Cluster click parses (fly-in) without list popup or snap-back
- Pipeline drawer dismisses on map click, Escape, and X
- BUNKER on shows markers only; registry opens via Bunker register button
- License refetch shows corner pill, not full-screen blocker
