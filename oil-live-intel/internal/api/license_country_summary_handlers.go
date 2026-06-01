package api

import (
	"net/http"
	"strings"

	"github.com/mining-map/oil-live-intel/internal/services/licensemap"
)

// LicenseCountrySummary returns one marker per country with licenses in the viewport bbox.
// Query: min_lat, max_lat, min_lng, max_lng, optional sector, prefer_open_data, limit.
func (s *Server) LicenseCountrySummary(w http.ResponseWriter, r *http.Request) {
	minLat := queryFloat(r, "min_lat", 0)
	maxLat := queryFloat(r, "max_lat", 0)
	minLng := queryFloat(r, "min_lng", 0)
	maxLng := queryFloat(r, "max_lng", 0)
	if !licensemap.ValidBBox(minLat, maxLat, minLng, maxLng) {
		writeJSON(w, http.StatusBadRequest, map[string]string{
			"error": "invalid_bbox",
			"hint":  "pass min_lat, max_lat, min_lng, max_lng as a non-degenerate box",
		})
		return
	}

	if s.Pool == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{
			"error": "database_unavailable",
		})
		return
	}

	var countries []string
	if raw := strings.TrimSpace(r.URL.Query().Get("countries")); raw != "" {
		for _, part := range strings.Split(raw, ",") {
			if c := strings.TrimSpace(part); c != "" {
				countries = append(countries, c)
			}
		}
	}
	preferOpen := true
	if v := strings.TrimSpace(r.URL.Query().Get("prefer_open_data")); v == "0" || strings.EqualFold(v, "false") {
		preferOpen = false
	}

	rows, err := licensemap.QueryCountrySummary(r.Context(), s.Pool, licensemap.CountrySummaryQuery{
		MinLat:         minLat,
		MaxLat:         maxLat,
		MinLng:         minLng,
		MaxLng:         maxLng,
		Limit:          queryInt(r, "limit", 120),
		Sector:         r.URL.Query().Get("sector"),
		Countries:      countries,
		PreferOpenData: preferOpen,
	})
	if err != nil {
		s.Log.Error().Err(err).Msg("license country summary")
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "query_failed"})
		return
	}

	writeJSONCached(w, http.StatusOK, map[string]any{
		"mode":      "country_summary",
		"countries": rows,
		"runtime":   "go",
	}, 180)
}
