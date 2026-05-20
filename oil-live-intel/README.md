# oil-live-intel

Free, explainable oil **live intelligence** service for the mining-map platform.

## What it does

- Oil terminals, tank farms, and hubs (curated seed + GeoJSON import)
- Inferred possible loading/unloading from AIS + geofence (when enabled)
- Company discovery and **Save to Suppliers** (creates license + Deal annotation)
- Intelligence cards with confidence, evidence, and disclaimers

**Not confirmed transactions.** All cargo activity is labeled possible/likely/inferred.

## Live AIS pipeline (Phases 6–8)

When `AISSTREAM_API_KEY` is set and `ENABLE_AIS=true`:

1. Worker subscribes to AISStream bounding boxes around seeded terminals
2. Filters oil/product tankers (AIS types 80–89 + name heuristics; bulk near sulfur terminals)
3. Geofence match (~1.2 km) opens `oil_port_calls`
4. After 2+ hours outside terminal, closes visit, classifies load/discharge from draft delta
5. Generates `oil_intelligence_cards` with confidence + evidence
6. Worker POSTs events to API `/api/oil-live/internal/broadcast` → WebSocket clients

## Run with Docker Compose

From repo root:

```bash
docker compose up -d --build oil-live-intel
curl -s http://localhost:8095/api/oil-live/health
```

## Environment

| Variable | Required | Default |
|----------|----------|---------|
| `DATABASE_URL` | yes | `postgresql://postgres:password@db:5432/mining_db?sslmode=disable` |
| `OIL_INTEL_PORT` | no | `8095` |
| `AISSTREAM_API_KEY` | for live AIS | — |
| `ENABLE_AIS` | no | `true` (needs API key) |
| `EIA_API_KEY` | optional | — |
| `COMTRADE_API_KEY` | optional | Higher-quota Comtrade; public preview works without key |
| `ENABLE_COMTRADE` | no | `true` — sync HS 2709/2710/2711 daily |
| `ENABLE_EIA` | no | `true` — EIA volume supplement when key set |
| `EXISTING_BACKEND_URL` | no | `http://backend:8000` |
| `SUPPLIER_CREATE_ENDPOINT` | no | `/licenses` |

## API

All routes under `/api/oil-live/` — see plan doc for full list.

## Product families

Terminals tag products: `crude_oil`, `diesel`, `gasoline`, `lng`, `lpg`, `sulfur`, `refined_products`, etc.

Heavy/light crude grades are **terminal tags only** in v1 — not inferred from AIS.

## Confidence

Deterministic score from terminal proximity, dwell time, draft change, tanker class, and product match.

## Supplier integration

`POST /api/oil-live/companies/{id}/save-to-suppliers` forwards auth to:

1. `POST /licenses` on the Python backend
2. `PUT /api/licenses/{id}/annotations` with `status: "good"`

On failure, returns payload for manual supplier creation and logs `oil_supplier_exports`.
