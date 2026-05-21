---
name: Live Data Unification
overview: Scale oil-live map, labeling, contact enrichment, and AIS pipeline for production UX.
todos:
  - id: map-bbox-performance
    content: Viewport bbox map API + terminal clustering (≤500 markers)
    status: completed
  - id: provenance-badges
    content: seed_port_calls / synthetic / live_ais badges on cargo and port calls
    status: completed
  - id: contact-enrichment-batch
    content: POST /api/admin/oil-live/enrich-contacts?limit=50
    status: completed
  - id: live-ais-verification
    content: Document dual AIS path; metadata on live port calls
    status: completed
  - id: docker-smoke
    content: sync-status, bbox map, cargo-records smoke checks
    status: completed
  - id: graph-scale
    content: 5k+ terminals, 126 MCRs, 2k companies via graph-sync
    status: completed
---

# Live Data Unification Plan

## Completed

- **Map performance**: `GET /api/oil-live/map?bbox=` filters terminals/vessels server-side; frontend requires viewport before fetch; terminal `MarkerClusterGroup` caps DOM nodes.
- **Provenance**: `data_provenance` on cargo + port calls; UI badges in panel and entity drawer.
- **Contacts**: Admin batch endpoint enriches top companies with `supplier_id` via license contact agent.
- **AIS**: `maritime-worker` → Redis (canvas); `oil-live-intel-worker` → `oil_ais_positions` + port calls (no duplicate cross-write).
- **Scale**: graph-sync + bulk OSM seed supports 5k+ terminals.

## Manual / ops

```bash
# Graph sync
curl -X POST http://localhost:8000/api/admin/oil-live/graph-sync -H "X-Admin-Token: $ADMIN_API_TOKEN"

# Contact batch (companies saved to suppliers first)
curl -X POST "http://localhost:8000/api/admin/oil-live/enrich-contacts?limit=50" -H "X-Admin-Token: $ADMIN_API_TOKEN"

# Map bbox smoke (Persian Gulf sample)
curl "http://localhost:8095/api/oil-live/map?bbox=48,24,52,28&limit=500"
```
