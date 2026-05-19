# Routing engines (honest capability matrix)

The route planner is a **screening** tool for supplier→buyer corridors. It uses free/open data where possible and degrades gracefully when external services are slow or unavailable.

## What is “real” vs approximate

| Mode | When it is real | What is still approximate |
|------|-----------------|---------------------------|
| **Road** | OSRM driving network (`OSRM_BASE_URL`, public or self-hosted) | Permits, border posts, hazmat restrictions, tolls, and contracted lanes are not modeled. |
| **Sea** | [searoute](https://github.com/genthalili/searoute-py) marine network when `SEAROUTE_ENABLED=1` and the package is installed | Port berthing, canal bookings, weather, and security corridors are not included. Port coordinates are on land — trunks are anchored via offshore corridor waypoints before searoute runs. |
| **Sea (fallback)** | Static offshore corridor anchors (region-aware) | Not a sailing chart; distances are screening-only. |
| **Rail** | OpenStreetMap `railway=rail|light_rail` ways between export/import hubs (Overpass, ODbL) | Gauge, electrification, slot availability, and border clearance are not verified. Short connectors may still use OSRM or geodesic segments. |
| **Rail (fallback)** | OSRM driving between hubs when OSM has no track geometry | This is **not** a track database — label: `rail_approximation_road`. |
| **Air** | Great-circle trunk between airports | Not published airways, ETOPS, slots, or fuel stops. First/last mile uses OSRM road access when time budget allows. |

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `OSRM_BASE_URL` | `https://router.project-osrm.org` | Road (and rail fallback) geometry |
| `OSRM_TIMEOUT_SEC` | `8` | Per-request OSRM timeout |
| `OSRM_GEOMETRY_CACHE_MAX` | `256` (8192 in route-service) | In-memory OSRM cache entries |
| `SEAROUTE_ENABLED` | `1` | Use searoute for sea trunks |
| `SEAROUTE_TIMEOUT_SEC` | `15` | Searoute time budget |
| `ROUTE_PLAN_DEADLINE_SEC` | `75` (120 in docker route-service) | Whole-plan deadline; OSRM/searoute skipped when nearly exceeded |
| `RAIL_OVERPASS_URL` | `https://overpass-api.de/api/interpreter` | OSM railway Overpass endpoint |
| `RAIL_OSM_CACHE_TTL_SEC` | `43200` | In-memory rail corridor cache TTL |

## Self-hosted OSRM (optional)

For production traffic or regions poorly covered by the public demo router, run a local OSRM instance and point `OSRM_BASE_URL` at it. In `docker-compose.yml`, the `route-service` container reads `OSRM_BASE_URL`; an optional `osrm` profile can be added when you build regional `.osrm` files.

## API leg fields

Each leg in `/api/logistics/route-plan` (and the route microservice) includes:

- `geometry_source` — machine id (`osrm`, `searoute`, `rail_osm`, `air_great_circle_trunk`, …)
- `routing_engine` — one-line UI label (e.g. “Real road (OSRM)”)
- `limitations[]` — short bullets explaining what was not modeled

The Route Intelligence agent uses `geometry_source` in deterministic checks (degraded sea, non-track rail, legacy air sources).
