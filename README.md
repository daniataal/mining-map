# MadSan Global Intelligence

A full-stack intelligence platform for visualizing mining licenses on an interactive map.

## ✨ New Features
*   **Secure Authentication**: Map interactions are locked until login.
*   **Admin Panel**: Create new users and monitor system activity.
*   **Activity Logs**: Tracks every user click and action (viewing licenses, updating status, etc.).
*   **Mobile Optimized**: Responsive design with specialized mobile navigation and layouts.

## 🔐 Default Credentials
*   **Username**: `admin`
*   **Password**: `admin123`

> **Note**: You should change these credentials or create a new admin user immediately after deployment.

## 🚀 Quick Start (Docker)

The easiest way to run the application is using Docker.

### 1. Run the Container
Run the following command to start the application with a persistent database.
Replace `YOUR_SERVER_IP` with your actual IP address (e.g. `129.159.148.51`).

```bash
sudo docker run -d \
  -e VITE_API_BASE=http://YOUR_SERVER_IP:8000 \
  -p 8000:8000 \
  -p 5173:5173 \
  -v /opt/mining-map:/data \
  -e MINING_DB_PATH=/data/mining.db \
  --name mining-map-v2 \
  dannyatalla/mining-map:v2
```

### 2. Access the Application
*   **Frontend**: `http://YOUR_SERVER_IP:5173`
*   **Backend API**: `http://YOUR_SERVER_IP:8000/licenses`

### 3. Troubleshooting
If you see **"Database error"** or permissions issues:
1.  Stop the container: `sudo docker rm -f mining-map-v2`
2.  Clear the bad volume path on the server: `sudo rm -rf /opt/mining-map/mining.db`
3.  Pre-create the folder: `sudo mkdir -p /opt/mining-map`
4.  Run the container command again.

## 🛠️ Local Development

If you want the live maritime vessel layer, set `AISSTREAM_API_KEY` in the repo-root `.env` before running `docker compose up` or starting the backend locally. GitHub Actions deployments expect the same value in the repository secret named `AISSTREAM_API_KEY` and write it to the server as `/opt/mining-map/backend.env` during deploy.

### Performance on small VMs

Swap space helps the kernel avoid **OOM kills** when memory spikes, but it does **not** replace RAM for interactive latency. When Postgres, Node, or Python processes routinely page to disk, the whole stack feels frozen and request latencies explode. Treat swap as an emergency buffer, not extra capacity.

**What this repo already does (honest inventory):**

- **Maritime worker** is configurable via env (`MARITIME_WORKER_INTERVAL_SECONDS`, `MARITIME_WORKER_BACKOFF_SECONDS`, `MARITIME_WORKER_MAX_VESSELS`, capture window, scope, snapshot TTL). Compose passes these through with defaults; `backend/maritime_worker.py` enforces minimum intervals (15s loop / 5s backoff).
- **API and UI caps** reduce worst-case work: maritime vessel responses expose `cap_applied`; the map limits port markers (`PORTS_MAP_RENDER_LIMIT` ≈ 3000 in `MapComponent.tsx`) and soft-caps maritime markers (`MARITIME_RENDER_SOFT_CAP` ≈ 1200); `port_logistics` documents a similar map render limit for terminal nodes.
- **Backend process model**: `python main.py` runs Uvicorn; `UVICORN_WORKERS` defaults to **1** (set explicitly in compose). Values greater than 1 fork multiple workers and **increase** RAM use—only raise this on larger hosts.
- **Gaps / trade-offs**: root `docker-compose.yml` does **not** set CPU/memory limits, custom `postgresql.conf`, or `shm_size` for Postgres. The `mining-viz` container image runs **`vite` dev** (`npm run dev`), which is convenient for development but heavier than serving a production `npm run build` static bundle behind Caddy.

**Practical tips on a ~1 vCPU / ~1 GB RAM host:**

1. Prefer **conservative concurrency**: keep `UVICORN_WORKERS=1`; avoid running extra heavy jobs on the same VM during ingest or LLM traffic.
2. **Do not rely on swap for steady-state performance**—if `maritime-worker` + Postgres + backend + Node regularly swap, raise `MARITIME_WORKER_INTERVAL_SECONDS`, lower `MARITIME_WORKER_MAX_VESSELS`, or stop the worker temporarily while debugging.
3. **Split roles when possible**: avoid running dev `vite` on the same machine as production traffic; for production-like hosting, build static assets and point Caddy at `dist/` instead of the dev server (requires a Dockerfile or deploy step change not included in the default compose path).
4. **Optional compose merge**: `docker-compose.small-vm.yml` supplies gentler maritime defaults (longer interval, fewer vessels). Use: `docker compose -f docker-compose.yml -f docker-compose.small-vm.yml up -d`. Default `docker compose up` is unchanged.
5. **Linux `vm.swappiness`** (host only, not in compose): lowering it (e.g. toward 10) makes the kernel prefer keeping app pages in RAM before swapping; raising it favors swap. Changes are global and easy to get wrong—only tune with monitoring (`vmstat`, `free -h`) and revert if latency worsens.

**Compose-related env vars** (defaults in `docker-compose.yml` unless overridden):

| Variable | Typical default | Notes |
| --- | --- | --- |
| `UVICORN_WORKERS` | `1` | Passed to backend; values greater than 1 multiply RAM. |
| `MARITIME_WORKER_INTERVAL_SECONDS` | `60` | Min **15** in `maritime_worker.py`. |
| `MARITIME_WORKER_BACKOFF_SECONDS` | `15` | Min **5** after a failed collection. |
| `MARITIME_WORKER_MAX_VESSELS` | `120` | Fewer reduces AIS/DB write load. |
| `MARITIME_SNAPSHOT_TTL_SECONDS` | `300` | Staleness window for cached vessel snapshots. |

### Remote PostGIS Recovery

Remote deployments use `postgis/postgis:15-3.3-alpine` for the `db` service. After the workflow deploys this image, recreate the stack with `sudo docker compose pull && sudo docker compose up -d --remove-orphans`; only delete the `postgres_data` volume if the existing remote database is disposable, because that reset permanently removes DB data.

### Postgres Exposure Hardening

Production compose now keeps Postgres on the internal Docker network only (no host `5432` publish). Backend and worker still connect through `DB_HOST=db` / `DB_PORT=5432`, so app behavior is unchanged. If your VM previously exposed `5432`, immediately block it at firewall/security-group level and rotate the DB password.

### Open data: regions, sources, verification

Live licence/tenure rows are ingested from configured ArcGIS/FeatureServer endpoints on backend startup and via `POST /api/admin/open-data/sync` (admin token). **Official** layers use `record_origin=open_data` and `sourceKind=official_registry` in `GET /licenses`. **Fallback** site/field visibility (not concession registries) uses `record_origin=global_open_fallback`.

- **Coverage dashboard**: `GET /api/open-data/coverage/world` — optional `region` query (`middle_east`, `europe`, `asia` / `asia_pacific`, `africa`, `americas`, `other`, or `all`). Response includes `regional_summary` (full world) and per-country `macro_region`.
- **Re-sync selected sources** (requires DB + `psycopg2`; example inside the `backend` container or venv with deps):

```bash
python3 -c "from backend.services.ingest.open_data_sync import sync_open_data_sources; print(sync_open_data_sources(source_ids=['norway_npd_production_licences_current','finland_tukes_active_mining_areas','australia_queensland_mineral_tenement','usgs_mrds_global']))"
```

- **Endpoint smoke checks** (no DB): confirm ArcGIS layers return counts, e.g. Norway NPD layer ~1809 features, Finland Tukes active mining areas ~30, Queensland mineral tenement ~5309.

### Deploy-time fallback CSV auto-import

The GitHub Actions deploy workflow now supports automatic fallback CSV import for
South Africa + Ghana after services are up.

Required repository secrets:

*   `ADMIN_TOKEN`: used both by the backend (`backend.env`) and by the workflow
    when calling `POST /api/admin/import/extracted-csv`.
*   `AISSTREAM_API_KEY`: unchanged existing secret.

Optional repository variable:

*   `AUTO_IMPORT_LICENSES_CSV` (default: `true`): set to `false` to skip the
    auto-import step without changing the workflow file.

Behavior:

*   If `licenses_export.csv` exists in the repo root (or
    `mining-viz/licenses_export.csv`), the workflow uploads it to the VM and
    stores it at `/opt/mining-map/data/licenses_export.csv`.
*   After deploy, the workflow waits for backend readiness and calls the local
    import endpoint with `countries=South Africa,Ghana` and `sector=mining`.
*   If CSV is missing, backend is not ready, token is missing, or import fails,
    the workflow logs and continues deployment (no hard fail by default).

### Backend (Python/FastAPI)
```bash
cd backend
python -m venv venv
source venv/bin/activate  # or venv\Scripts\activate on Windows
pip install fastapi uvicorn python-multipart psycopg2-binary passlib bcrypt pyjwt
python main.py
```

### Frontend (React/Vite)
```bash
cd mining-viz
npm install
npm run dev
```

## 📂 Project Structure
*   `/backend` - FastAPI server, Postgres/SQLite logic, and Auth handling.
*   `/mining-viz` - React frontend for MadSan Global Intelligence, with Leaflet maps and Admin Panel.
*   `/meridian-android` - **Meridian Trade OS** — native Kotlin/Compose Android app ([README](meridian-android/README.md)).
*   `Dockerfile` - Container definition.
*   `start.sh` - Startup script that handles DB persistence and permissions.

## 🗺️ License Geocoding Backfill

About **3000 of ~4000** licenses ship without precise coordinates and the rest
often share a regional centroid (the CSV importer used a static lookup table
in `convert_data.py`). The backend exposes an **additive, reversible**
backfill that approximates coordinates from each row's `region` + `country`
text via Nominatim (free) or Mapbox (optional, faster).

### How to run safely

Always **dry-run first** (default) and inspect the sample before committing:

```bash
# Preview 100 candidates, no writes:
curl -X POST http://localhost:8000/api/admin/geocode-licenses \
  -H 'Content-Type: application/json' \
  -H "X-Admin-Token: $ADMIN_TOKEN" \
  -d '{"dry_run": true, "limit": 100}'

# Looks good? Commit a small batch (writes lat/lng, snapshots originals):
curl -X POST http://localhost:8000/api/admin/geocode-licenses \
  -H 'Content-Type: application/json' \
  -H "X-Admin-Token: $ADMIN_TOKEN" \
  -d '{"dry_run": false, "limit": 100}'

# Restrict to one country:
curl -X POST http://localhost:8000/api/admin/geocode-licenses \
  -H 'Content-Type: application/json' \
  -H "X-Admin-Token: $ADMIN_TOKEN" \
  -d '{"dry_run": false, "limit": 500, "country": "Ghana"}'

# Undo every backfilled row (keeps user-verified rows untouched):
curl -X POST http://localhost:8000/api/admin/geocode-licenses/revert \
  -H "X-Admin-Token: $ADMIN_TOKEN"
```

There is an equivalent CLI:

```bash
docker compose exec backend python /app/geocode_licenses.py --dry-run --limit 100
docker compose exec backend python /app/geocode_licenses.py --limit 500 --country Ghana
docker compose exec backend python /app/geocode_licenses.py --revert --limit 10000
```

### Safety properties

*   **Reversible.** Every write snapshots the prior `lat` / `lng` into
    `original_lat` / `original_lng` (only the *first* time, so re-runs don't
    lose the canonical pre-backfill value). `/revert` restores them.
*   **Never overwrites user-verified rows.** Rows with `geo_source = 'user'`
    are skipped unless the request explicitly passes
    `allow_overwrite_user: true`.
*   **Idempotent.** A persistent `geo_cache` table memoises every
    `(region, country)` lookup (positive *and* negative results), so a
    repeated run on the same set is a no-op.
*   **Polite to Nominatim.** Hard ≥1.1 s delay between requests, custom
    `User-Agent` required by their usage policy.
*   **Approximate flag surfaces in the UI.** The frontend reads
    `geoApproximated` from `GET /licenses` and renders an `≈ APPROX
    LOCATION` badge on the marker popup so analysts immediately see which
    rows are surveyed and which are district-centroid backfills.

### Env vars

| Var | Default | Purpose |
| --- | --- | --- |
| `ADMIN_TOKEN` | *(unset → endpoint logs warning, allows access)* | Required value for the `X-Admin-Token` header in production. |
| `GEOCODER_USER_AGENT` | `mining-map-backfill/1.0 (contact admin)` | Per Nominatim policy. Replace with a real contact email in prod. |
| `NOMINATIM_BASE_URL` | `https://nominatim.openstreetmap.org` | Point at a self-hosted Nominatim for higher throughput. |
| `NOMINATIM_RPS_DELAY` | `1.1` | Seconds between Nominatim requests. |
| `MAPBOX_GEOCODING_TOKEN` | *(unset)* | Optional. When set, Mapbox is preferred over Nominatim. |

### Manual test plan

1. Start the stack: `docker compose up -d`. The migration adds the
   `geo_source`, `geo_approximated`, `original_lat`, `original_lng`,
   `geo_confidence`, `geocoded_at` columns to `licenses` (idempotent).
2. Open the map at `http://localhost:5173` and zoom into a known cluster
   that previously refused to open popups (e.g. an Accra-centroid stack).
   Click the cluster → spiderfy → click any leg. The popup must open
   anchored on the spider leg.
3. Hover the spider legs — collocated rows show an inline `≈ approx (N)`
   tag in the tooltip indicating how many rows shared coordinates.
4. Run the backfill in dry-run mode (above). Inspect the `sample` array.
5. Run with `dry_run=false`. Reload the map: rows that were nudged
   into a real location now show the `≈ APPROX LOCATION` badge in the
   popup.
6. Run `/revert`. The `≈` badges disappear and rows return to their
   original lat/lng (user-verified rows are unaffected).
