package api

import (
	"net/http"
	"strings"
)

// LookupVesselByIMO resolves MMSI + latest position for map selection from fleet tables.
// GET /api/oil-live/vessels/lookup?imo=
func (s *Server) LookupVesselByIMO(w http.ResponseWriter, r *http.Request) {
	imo := strings.TrimSpace(r.URL.Query().Get("imo"))
	if imo == "" {
		writeErr(w, http.StatusBadRequest, "imo query required")
		return
	}
	ctx := r.Context()
	var mmsi int64
	var name *string
	err := s.Pool.QueryRow(ctx, `
		SELECT mmsi, name FROM oil_vessels WHERE imo = $1 LIMIT 1
	`, imo).Scan(&mmsi, &name)
	if err != nil {
		writeErr(w, http.StatusNotFound, "vessel not found for imo")
		return
	}
	var lat, lng *float64
	var posTime *string
	_ = s.Pool.QueryRow(ctx, `
		SELECT ST_Y(geom::geometry), ST_X(geom::geometry), received_at::text
		FROM oil_ais_positions
		WHERE mmsi = $1
		ORDER BY received_at DESC NULLS LAST
		LIMIT 1
	`, mmsi).Scan(&lat, &lng, &posTime)

	out := map[string]any{
		"mmsi": mmsi,
		"imo":  imo,
	}
	if name != nil {
		out["name"] = *name
	}
	if lat != nil && lng != nil {
		out["lat"] = *lat
		out["lng"] = *lng
	}
	if posTime != nil {
		out["position_time"] = *posTime
	}
	writeJSON(w, http.StatusOK, out)
}
