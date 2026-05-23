# Python → Go migration inventory (MAD-42)

Branch: `paperclip2`. Strangler pattern: Go read paths in `oil-live-intel`, Python ingest/orchestration in `backend/`.

## Map / API hot-path inventory

| Service | Path | Map-related endpoints / role | Callers | Migration note |
|---------|------|------------------------------|---------|----------------|
| **backend** (FastAPI) | `backend/main.py` | `GET /licenses` (bbox, zoom clusters, map markers) | `mining-viz` `useLicensesForMap`, `MapComponent` | **First port (this issue):** low-zoom clusters → Go |
| **backend** | `backend/services/license_map_perf.py` | Grid LOD helpers for `/licenses` | `main.py`, `petroleum_osm_store.py` | Ported to `oil-live-intel/internal/services/licensemap/` |
| **backend** | `backend/services/petroleum_osm_store.py` | Petroleum OSM bbox reads | Oil/Gas map layers | **Next candidate:** pipeline/infra bbox |
| **backend** | `backend/services/maritime_intel.py` | AIS snapshot, coastal demo merge | `maritime_worker`, map overlays | Keep Python worker; reads already partially in Go |
| **oil-live-intel** (Go) | `internal/api/router.go` | `/api/oil-live/map`, terminals, cargo, search | Live Data tab, Caddy `/api/oil-live/*` | Already Go — extend, do not rewrite |
| **Workers** (Python) | `*_worker.py`, `oil_live_graph_sync.py` | Ingest → Postgres | Cron / compose | **Stay Python** unless profiled CPU-bound |

## First port recommendation

**`GET /licenses` low-zoom cluster mode** (`zoom < 7`, `map=1`, valid bbox):

- Highest pan/zoom traffic on unified map (27k+ license rows).
- Pure SQL aggregation; no dossier provenance in cluster cells.
- Python remains authoritative for point mode (`zoom >= 7`), CRUD, annotations, import.

**Go endpoint (parallel, safe cutover):** `GET /api/oil-live/licenses/map` — same JSON shape as Python `{"mode":"clusters",...}`.

## Running Go alongside Python

Caddy already routes `/api/oil-live/*` → `oil-live-intel:8095` and `/licenses*` → `backend:8000` ([Caddyfile](../Caddyfile)).

```bash
# Local / compose
docker compose up -d db backend oil-live-intel

# Smoke — Go clusters (world zoom; adjust bbox to your data)
curl -sS 'http://127.0.0.1:8080/api/oil-live/licenses/map?min_lat=-35&max_lat=35&min_lng=-20&max_lng=55&zoom=4&limit=120' | jq '.mode,.grid_degrees,(.clusters|length)'

# Parity — Python (same bbox)
curl -sS 'http://127.0.0.1:8080/licenses?min_lat=-35&max_lat=35&min_lng=-20&max_lng=55&zoom=4&map=1&limit=120' | jq 'if type=="object" then .mode else "array" end'

# Map UI still uses Python until frontend flag:
# VITE_LICENSE_MAP_GO=1 → mining-viz calls /api/oil-live/licenses/map for zoom < 7
```

Env (optional, future cutover):

| Variable | Default | Purpose |
|----------|---------|---------|
| `VITE_LICENSE_MAP_GO` | `0` | Frontend: cluster fetches via Go |
| `LICENSE_MAP_GO_ENABLED` | — | Documented alias for ops runbooks |

## Cutover plan (no big-bang)

1. **Now:** Go endpoint live; Python unchanged; parity unit tests on grid helpers.
2. **Next PR:** Shadow-compare cluster counts Python vs Go on staging bbox set.
3. **Cutover:** `VITE_LICENSE_MAP_GO=1` for zoom `< 7` only; keep Python for points and admin.
4. **Later:** Port petroleum OSM bbox or `/api/oil-live/map` terminal merge if profiling warrants.
