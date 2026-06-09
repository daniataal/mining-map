# Map Refactor Plan

## From → To

- Leaflet + DOM markers (800 cap) → **MapLibre GL JS** WebGL layers
- Large GeoJSON → **ST_AsMVT** vector tiles from Go
- Per-pan bbox API storms → debounced viewport + tile cache

## Live layer (GPS model)

- WebSocket viewport subscription
- Snapshot + deltas (5–15s), binary frames
- Client dead-reckoning for vessel smoothness

## Layer registry

Typed registry: energy/metals/shared, minZoom, filters, clickBehavior, tier, limitations.
