# 09 Go Country Borders Cutover Validation

## Objective

The goal of this phase was to execute Phase 1 of the Go Migration Roadmap: "Consolidate Map & Geospatial (Immediate)". This involved migrating the `/api/map/country-borders` endpoint from the transitional Python/FastAPI backend into the `oil-live-intel` Go service to guarantee high UI performance and consolidate geospatial delivery.

## Work Completed

### 1. Data Dependency Portability (`//go:embed`)
- Moved the 45MB `country_borders.geojson` file from `backend/data/` to `oil-live-intel/internal/data/` via `git mv` to preserve git history.
- Created `oil-live-intel/internal/data/data.go` and used the `//go:embed` compiler directive to compile the JSON directly into the binary. This eliminates container volume mounting constraints and allows the Go binary to load the payload instantly from memory.
- Created a symlink in `backend/data/country_borders.geojson` pointing to the new location to ensure the legacy Python route still functions as an instantaneous rollback path.

### 2. High-Performance Go Handler
- Created `oil-live-intel/internal/api/country_borders_handlers.go`.
- Implemented `CountryBorders` utilizing standard Go structs for parsing the `FeatureCollection`.
- Handled country string normalization replicating `backend/country_borders.py` precisely (ignoring case, spaces, and diacritics using `golang.org/x/text/transform` and handling predefined country aliases like "USA" -> "united states of america").
- Pre-computed the JSON tree in memory via `sync.Once` upon the first request to eliminate disk I/O and repeating unmarshal overhead.
- Ported the ETag and `If-None-Match` logic correctly to return 304 Not Modified headers, saving significant bandwidth for repeating geographic requests.

### 3. Caddy Reverse Proxy & Strangler Fig Cutover
- Modified `Caddyfile` to transparently rewrite `/api/map/country-borders` to `/api/oil-live/map/country-borders` before hitting the global Go reverse proxy.
- Rebuilt Docker containers for `caddy` and `oil-live-intel`.

## Verification & Tests Passed

1. **Unit Parity**: Created `country_borders_handlers_test.go` checking string normalizations and status responses. Passed `go test ./...`
2. **Runtime Verification**: 
   - `curl -v "http://localhost:8080/api/map/country-borders?countries=russia,uae"` yielded HTTP 200 OK with `application/geo+json` header and effectively returned 2 features accurately filtered from the giant dataset.
   - `curl -v -H "If-None-Match: [ETag]" "..."` successfully halted parsing and returned a 304 Not Modified with empty body.
3. **Rollback Availability**: The Python `/api/map/country-borders` endpoint logic is left perfectly intact as a safeguard until long-term stability is confirmed, but no traffic routes to it.

## Conclusion

Phase 1 of the Go Migration Roadmap is fully implemented. The frontend map continues to be served transparently, but is now receiving its borders dataset via an ultra-fast compiled `oil-live-intel` binary.
