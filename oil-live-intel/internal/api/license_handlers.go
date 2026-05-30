package api

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/mining-map/oil-live-intel/internal/services/licensemap"
)

// ListLicenses handles GET /licenses for point mode and grid cluster mode
func (s *Server) ListLicenses(w http.ResponseWriter, r *http.Request) {
	minLat := queryFloat(r, "min_lat", 0)
	maxLat := queryFloat(r, "max_lat", 0)
	minLng := queryFloat(r, "min_lng", 0)
	maxLng := queryFloat(r, "max_lng", 0)
	hasBBox := false
	if r.URL.Query().Get("min_lat") != "" && r.URL.Query().Get("max_lat") != "" &&
		r.URL.Query().Get("min_lng") != "" && r.URL.Query().Get("max_lng") != "" {
		if licensemap.ValidBBox(minLat, maxLat, minLng, maxLng) {
			hasBBox = true
		}
	}

	var zoomPtr *float64
	if z := strings.TrimSpace(r.URL.Query().Get("zoom")); z != "" {
		if v, err := strconv.ParseFloat(z, 64); err == nil {
			zoomPtr = &v
		}
	}
	mapMode := false
	if v := strings.TrimSpace(r.URL.Query().Get("map")); v == "1" || strings.EqualFold(v, "true") {
		mapMode = true
	}
	if zoomPtr != nil {
		mapMode = true
	}

	grid := licensemap.GridDegrees(zoomPtr)
	if mapMode && grid != nil && hasBBox {
		// Delegate to cluster mode
		s.LicenseMapClusters(w, r)
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

	points, err := licensemap.QueryPoints(r.Context(), s.Pool, licensemap.PointQuery{
		MinLat:         minLat,
		MaxLat:         maxLat,
		MinLng:         minLng,
		MaxLng:         maxLng,
		HasBBox:        hasBBox,
		Limit:          queryInt(r, "limit", 5000),
		Sector:         r.URL.Query().Get("sector"),
		Countries:      countries,
		PreferOpenData: preferOpen,
	})
	if err != nil {
		s.Log.Error().Err(err).Msg("license map points")
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "query_failed"})
		return
	}

	writeJSONCached(w, http.StatusOK, points, 120)
}
