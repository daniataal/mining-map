package api

import (
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
)

// GetVesselTrack returns recent AIS positions for one MMSI from oil_ais_positions.
func (s *Server) GetVesselTrack(w http.ResponseWriter, r *http.Request) {
	mmsi, err := strconv.ParseInt(chi.URLParam(r, "mmsi"), 10, 64)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid mmsi")
		return
	}
	hours := queryInt(r, "hours", 24)
	if hours < 1 {
		hours = 1
	}
	if hours > 168 {
		hours = 168
	}

	rows, err := s.Pool.Query(r.Context(), `
		SELECT ts, lat, lon, speed, course
		FROM oil_ais_positions
		WHERE mmsi = $1 AND ts > now() - make_interval(hours => $2)
		ORDER BY ts ASC
	`, mmsi, hours)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()

	points := make([]map[string]any, 0)
	for rows.Next() {
		var ts time.Time
		var lat, lon float64
		var speed, course *float64
		if err := rows.Scan(&ts, &lat, &lon, &speed, &course); err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		pt := map[string]any{
			"received_at": ts.UTC().Format(time.RFC3339),
			"latitude":    lat,
			"longitude":   lon,
		}
		if speed != nil {
			pt["speed_over_ground"] = *speed
		}
		if course != nil {
			pt["course_over_ground"] = *course
		}
		points = append(points, pt)
	}
	if err := rows.Err(); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSONCached(w, http.StatusOK, map[string]any{
		"mmsi":   mmsi,
		"hours":  hours,
		"points": points,
	}, 30)
}
