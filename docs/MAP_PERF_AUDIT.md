# Map performance audit checklist

Use this when validating map speed after ingest or layer changes. Target: **bulk in Postgres, sparse on the wire, minimal in the DOM** (see [AGENTS.md](../AGENTS.md)).

## 1. Measure (browser DevTools)

### Mining map (licenses)

1. Open **Mining** or **Global** view, zoom to a country with dense licenses.
2. **Network** tab: filter `licenses`.
3. Pan once; note:
   - **Time to first marker** (request start → response end → paint).
   - **Response size (KB)** for `GET /licenses?...&map=1&zoom=...`.
   - **Row count** in JSON (`clusters` length or array length).
4. **Performance** → record; pan again; check **DOM nodes** (marker count should stay bounded; server clusters at zoom &lt; 8).

### Live Data map

1. Open **Oil & Gas** → **Live** sidebar.
2. Toggle layers off one at a time; confirm **no** requests for disabled layers:
   - Terminals/Vessels off → no `oil-live/map`
   - Corridors off → no `cargo-records/map`
   - Trade flows off → no `trade-flows`
   - Opportunities off → no `opportunities`
3. At **world zoom** (&lt; 8), `trade-flows` should use `group=country_pair` (check query string).
4. Pan; note `oil-live/map` KB and marker count in DOM.

## 2. API expectations

| Endpoint | Low zoom (&lt; 8) | Cache |
|----------|-------------------|--------|
| `GET /licenses?bbox&map=1&zoom` | `{ mode: "clusters", clusters: [...] }` | `Cache-Control: public, max-age=120–180` |
| `GET /api/oil-live/map?bbox&zoom` | Lower `limit` (250) | `max-age=45` |
| `GET /api/oil-live/trade-flows?zoom` | Default `country_pair` | `max-age=120` |
| `GET /api/petroleum/osm-layers/{id}?bbox&zoom` | `ST_SimplifyPreserveTopology` | `max-age=600` |

## 3. Quick curl (local stack)

```bash
# License clusters (world zoom)
curl -s "http://127.0.0.1:8000/licenses?min_lat=-10&max_lat=10&min_lng=-20&max_lng=20&map=1&zoom=5&sector=mining" | jq '.mode, (.clusters | length)'

# Slim map points (detail zoom)
curl -s "http://127.0.0.1:8000/licenses?min_lat=-10&max_lat=10&min_lng=-20&max_lng=20&map=1&zoom=10&sector=mining" | jq 'length'

# Oil-live map cache header
curl -sI "http://127.0.0.1:8080/api/oil-live/map?bbox=-10,-20,10,20&zoom=5&limit=250" | grep -i cache-control
```

## 4. Regression signals

- Off layer still fetches → fix `enabled` on React Query.
- World zoom returns thousands of license points → check `zoom` param reaches backend.
- Trade flows at world zoom use `company_pair` → should be `country_pair` unless zoom ≥ 8.
- Pipelines lag at world zoom → confirm `zoom` on OSM layer requests.

## 5. Targets (engineering bar)

- Initial map paint: &lt; 2s for default hub bbox (one overlay + terminals).
- Pan refetch: debounced once at **450ms** (`MAP_VIEWPORT_DEBOUNCE_MS` in `mining-viz/src/lib/mapViewportDebounce.ts`); stale layer until new data (`keepPreviousData`).
- License DOM markers capped at **800** when not server-clustered (`LICENSE_MAP_DOM_MARKER_CAP`).
- Per-bbox marker cap: server `limit` 500–2000; clusters at zoom &lt; 8.
