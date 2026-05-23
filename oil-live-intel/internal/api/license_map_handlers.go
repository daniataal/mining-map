package api

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/mining-map/oil-live-intel/internal/services/licensemap"
)

// LicenseMapClusters is the first Go strangler for Python GET /licenses (low-zoom grid clusters).
// Query: min_lat, max_lat, min_lng, max_lng, zoom, limit, sector, countries, prefer_open_data.
// Response matches Python cluster mode: {"mode":"clusters","clusters":[...],"zoom":...,"grid_degrees":...}
func (s *Server) LicenseMapClusters(w http.ResponseWriter, r *http.Request) {
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

	var zoomPtr *float64
	if z := strings.TrimSpace(r.URL.Query().Get("zoom")); z != "" {
		if v, err := strconv.ParseFloat(z, 64); err == nil {
			zoomPtr = &v
		}
	}
	grid := licensemap.GridDegrees(zoomPtr)
	if grid == nil {
		writeJSON(w, http.StatusNotImplemented, map[string]any{
			"mode":     "points",
			"fallback": "python",
			"endpoint": "/licenses",
			"hint":     "Go scaffold covers low-zoom clusters (zoom < 7); point mode remains on Python until cutover.",
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

	clusters, err := licensemap.QueryClusters(r.Context(), s.Pool, licensemap.ClusterQuery{
		MinLat:         minLat,
		MaxLat:         maxLat,
		MinLng:         minLng,
		MaxLng:         maxLng,
		GridDeg:        *grid,
		Zoom:           zoomPtr,
		Limit:          queryInt(r, "limit", 800),
		Sector:         r.URL.Query().Get("sector"),
		Countries:      countries,
		PreferOpenData: preferOpen,
	})
	if err != nil {
		s.Log.Error().Err(err).Msg("license map clusters")
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "query_failed"})
		return
	}

	writeJSONCached(w, http.StatusOK, map[string]any{
		"mode":         "clusters",
		"clusters":     clusters,
		"zoom":         zoomPtr,
		"grid_degrees": *grid,
		"runtime":      "go",
	}, 180)
}
