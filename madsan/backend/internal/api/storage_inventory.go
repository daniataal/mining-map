package api

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// listStorageSites serves clustered tank-site inventory estimates as GeoJSON
// for the map layer. Estimates are ranges from open data (OSM tank counts x
// typical tank sizes x EIA utilization band) — never measurements.
func (s *Server) listStorageSites(w http.ResponseWriter, r *http.Request) {
	limit := 1000
	if v := strings.TrimSpace(r.URL.Query().Get("limit")); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 5000 {
			limit = n
		}
	}
	minTanks := 3
	if v := strings.TrimSpace(r.URL.Query().Get("min_tanks")); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 1 {
			minTanks = n
		}
	}
	minLng, minLat, maxLng, maxLat := -180.0, -90.0, 180.0, 90.0
	if bbox := strings.TrimSpace(r.URL.Query().Get("bbox")); bbox != "" {
		parts := strings.Split(bbox, ",")
		if len(parts) == 4 {
			if a, err := strconv.ParseFloat(strings.TrimSpace(parts[0]), 64); err == nil {
				minLng = a
			}
			if a, err := strconv.ParseFloat(strings.TrimSpace(parts[1]), 64); err == nil {
				minLat = a
			}
			if a, err := strconv.ParseFloat(strings.TrimSpace(parts[2]), 64); err == nil {
				maxLng = a
			}
			if a, err := strconv.ParseFloat(strings.TrimSpace(parts[3]), 64); err == nil {
				maxLat = a
			}
		}
	}

	rows, err := s.pool.Query(r.Context(), `
		SELECT id, name, country_code, tank_count, centroid_lat, centroid_lon,
			capacity_bbl_low, capacity_bbl_high, fill_rate_low, fill_rate_high,
			inventory_bbl_low, inventory_bbl_high, method, confidence, computed_at
		FROM storage_site_estimates
		WHERE tank_count >= $2
		  AND centroid_lon BETWEEN $3 AND $5 AND centroid_lat BETWEEN $4 AND $6
		ORDER BY tank_count DESC
		LIMIT $1
	`, limit, minTanks, minLng, minLat, maxLng, maxLat)
	if err != nil {
		writeJSON(w, map[string]any{"type": "FeatureCollection", "features": []any{}, "tier": "not_available"})
		return
	}
	defer rows.Close()

	features := make([]any, 0)
	for rows.Next() {
		var id, name, country, method, confidence string
		var tankCount int
		var lat, lon float64
		var capLow, capHigh, fillLow, fillHigh, invLow, invHigh *float64
		var computedAt time.Time
		if rows.Scan(&id, &name, &country, &tankCount, &lat, &lon,
			&capLow, &capHigh, &fillLow, &fillHigh, &invLow, &invHigh,
			&method, &confidence, &computedAt) != nil {
			continue
		}
		features = append(features, map[string]any{
			"type": "Feature",
			"id":   id,
			"geometry": map[string]any{
				"type":        "Point",
				"coordinates": []float64{lon, lat},
			},
			"properties": map[string]any{
				"site_id":            id,
				"name":               name,
				"country_code":       country,
				"tank_count":         tankCount,
				"capacity_bbl_low":   f64(capLow),
				"capacity_bbl_high":  f64(capHigh),
				"fill_rate_low":      f64(fillLow),
				"fill_rate_high":     f64(fillHigh),
				"inventory_bbl_low":  f64(invLow),
				"inventory_bbl_high": f64(invHigh),
				"method":             method,
				"confidence":         confidence,
				"computed_at":        computedAt.UTC().Format(time.RFC3339),
				"entity_kind":        "storage_site",
			},
		})
	}

	writeJSON(w, map[string]any{
		"type":       "FeatureCollection",
		"features":   features,
		"count":      len(features),
		"tier":       "inferred",
		"disclaimer": "Inventory is a bounded estimate from OSM tank counts, typical tank sizes and EIA utilization bands — not a measurement.",
	})
}

// getStorageSummary serves totals plus the latest US crude stock trend (from
// the most recent storage_inventory_estimate job report).
func (s *Server) getStorageSummary(w http.ResponseWriter, r *http.Request) {
	var sites, tanks int
	var invLow, invHigh *float64
	_ = s.pool.QueryRow(r.Context(), `
		SELECT COUNT(*)::int, COALESCE(SUM(tank_count),0)::int,
			SUM(inventory_bbl_low), SUM(inventory_bbl_high)
		FROM storage_site_estimates
	`).Scan(&sites, &tanks, &invLow, &invHigh)

	out := map[string]any{
		"sites":              sites,
		"tanks":              tanks,
		"inventory_bbl_low":  f64(invLow),
		"inventory_bbl_high": f64(invHigh),
		"tier":               "inferred",
		"disclaimer":         "Global bounded estimate from open data (OSM + EIA reference bands).",
	}

	var report []byte
	if err := s.pool.QueryRow(r.Context(), `
		SELECT result_report FROM ingestion_jobs
		WHERE job_type = 'storage_inventory_estimate' AND status = 'completed' AND result_report IS NOT NULL
		ORDER BY finished_at DESC LIMIT 1
	`).Scan(&report); err == nil && len(report) > 0 {
		var parsed map[string]any
		if json.Unmarshal(report, &parsed) == nil {
			if trend, ok := parsed["us_crude_stock_trend"]; ok {
				out["us_crude_stock_trend"] = trend
			}
		}
	}
	writeJSON(w, out)
}

func f64(v *float64) any {
	if v == nil {
		return nil
	}
	return *v
}
