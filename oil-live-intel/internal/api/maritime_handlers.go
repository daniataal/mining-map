package api

import (
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/mining-map/oil-live-intel/internal/services/maritimecontext"
)

const (
	regionCoverageFreshnessHours = 3
	statsFreshnessHours          = 24
)

// MaritimeContext serves open-data vessel/company screening context for Oil & Gas workflows.
func (s *Server) MaritimeContext(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	var lat, lng *float64
	if v := q.Get("lat"); v != "" {
		if f, err := strconv.ParseFloat(v, 64); err == nil {
			lat = &f
		}
	}
	if v := q.Get("lng"); v != "" {
		if f, err := strconv.ParseFloat(v, 64); err == nil {
			lng = &f
		}
	}
	out := maritimecontext.BuildContext(maritimecontext.ContextInput{
		Company:     q.Get("company"),
		Country:     q.Get("country"),
		CountryISO2: q.Get("country_iso2"),
		Commodity:   q.Get("commodity"),
		Lat:         lat,
		Lng:         lng,
		VesselName:  q.Get("vessel_name"),
		MMSI:        q.Get("mmsi"),
		IMO:         q.Get("imo"),
		Destination: q.Get("destination"),
	})
	writeJSONCached(w, http.StatusOK, out, 120)
}

// MaritimeStats exposes AIS ingest diagnostics from Go-owned Postgres tables.
func (s *Server) MaritimeStats(w http.ResponseWriter, r *http.Request) {
	minLon, minLat, maxLon, maxLat, bboxOK := parseBBox(r.URL.Query().Get("bbox"))

	var workerStatus, displayName string
	var lastObs, updatedAt *time.Time
	var obsCount int
	var limitations []string
	_ = s.Pool.QueryRow(r.Context(), `
		SELECT status, display_name, last_observation_at, observation_count, limitations, updated_at
		FROM maritime_source_health WHERE source = 'aisstream'
	`).Scan(&workerStatus, &displayName, &lastObs, &obsCount, &limitations, &updatedAt)

	var lastErr any
	if workerStatus == "error" && len(limitations) > 0 {
		lastErr = limitations[0]
	}
	if displayName == "" {
		displayName = "AISStream"
	}
	worker := map[string]any{
		"status":              workerStatus,
		"source":              displayName,
		"last_attempt_at":     formatTimePtr(updatedAt),
		"last_success_at":     formatTimePtr(lastObs),
		"last_error":          lastErr,
		"last_cycle_upserted": obsCount,
	}

	var storedCount int
	var latestAge *float64
	_ = s.Pool.QueryRow(r.Context(), `
		SELECT COUNT(DISTINCT mmsi)::int, EXTRACT(EPOCH FROM (now() - MAX(ts)))::float8
		FROM oil_ais_positions WHERE ts > now() - make_interval(hours => $1)
	`, statsFreshnessHours).Scan(&storedCount, &latestAge)

	gulfCount := s.countAISInBBox(r, 48.0, 24.0, 57.0, 30.0, statsFreshnessHours)
	northCount := s.countAISInBBox(r, -5.0, 50.0, 12.0, 62.0, statsFreshnessHours)
	bboxCount := 0
	if bboxOK {
		bboxCount = s.countAISInBBox(r, minLon, minLat, maxLon, maxLat, statsFreshnessHours)
	}

	aisFresh := latestAge != nil && *latestAge <= float64(regionCoverageFreshnessHours*3600)
	gap := gulfCount == 0 && northCount >= 25 && (workerStatus == "ok" || workerStatus == "connecting")

	writeJSONCached(w, http.StatusOK, map[string]any{
		"stored_vessel_count":                 storedCount,
		"snapshot_vessel_count":               storedCount,
		"persian_gulf_vessel_count":           gulfCount,
		"north_sea_vessel_count":              northCount,
		"aisstream_persian_gulf_coverage_gap": gap,
		"ais_positions_fresh":                 aisFresh,
		"ais_latest_age_seconds":              latestAge,
		"bbox_vessel_count":                   bboxCount,
		"requested_bbox":                      bboxOrNil(bboxOK, minLon, minLat, maxLon, maxLat),
		"aisstream_configured":                os.Getenv("AISSTREAM_API_KEY") != "",
		"stale":                               !aisFresh,
		"worker":                              worker,
		"redis_snapshot": map[string]any{
			"available": false,
			"writer":    "retired",
			"note":      "Live AIS is ingested by oil-live-intel-worker into oil_ais_positions.",
		},
		"limitations": []string{
			"Counts are distinct MMSI in Postgres from the Go AIS ingest path.",
			"Persian Gulf gap heuristic compares Gulf vs North Sea reference boxes — upstream AISStream coverage is partial.",
		},
	}, 30)
}

func (s *Server) countAISInBBox(r *http.Request, minLon, minLat, maxLon, maxLat float64, hours int) int {
	var n int
	_ = s.Pool.QueryRow(r.Context(), `
		SELECT COUNT(DISTINCT mmsi)::int FROM oil_ais_positions
		WHERE ts > now() - make_interval(hours => $1)
		  AND lat >= $2 AND lat <= $3 AND lon >= $4 AND lon <= $5
	`, hours, minLat, maxLat, minLon, maxLon).Scan(&n)
	return n
}

func bboxOrNil(ok bool, minLon, minLat, maxLon, maxLat float64) any {
	if !ok {
		return nil
	}
	return []float64{minLat, minLon, maxLat, maxLon}
}
