package api

import (
	"net/http"
	"time"
)

func (s *Server) CoverageStatus(w http.ResponseWriter, r *http.Request) {
	region := r.URL.Query().Get("region")
	if region == "" {
		region = "worldwide_available_observations"
	}

	var minLon, minLat, maxLon, maxLat float64
	hasBbox := false
	switch region {
	case "middle_east":
		minLon, minLat, maxLon, maxLat = 32.0, 12.0, 62.0, 32.0
		hasBbox = true
	case "persian_gulf":
		minLon, minLat, maxLon, maxLat = 48.0, 24.0, 57.0, 30.0
		hasBbox = true
	case "strait_of_hormuz":
		minLon, minLat, maxLon, maxLat = 54.0, 25.5, 57.0, 27.0
		hasBbox = true
	case "gulf_of_oman":
		minLon, minLat, maxLon, maxLat = 56.0, 22.0, 60.0, 26.0
		hasBbox = true
	case "fujairah":
		minLon, minLat, maxLon, maxLat = 56.2, 25.0, 56.6, 25.4
		hasBbox = true
	case "dubai_jebel_ali":
		minLon, minLat, maxLon, maxLat = 54.8, 24.9, 55.4, 25.3
		hasBbox = true
	case "ras_tanura":
		minLon, minLat, maxLon, maxLat = 49.9, 26.5, 50.3, 27.0
		hasBbox = true
	}

	var vesselCount, tankerCount int
	var latestOverall, latestRegion *time.Time

	// Count worldwide latest
	_ = s.Pool.QueryRow(r.Context(), "SELECT MAX(received_at) FROM oil_ais_positions").Scan(&latestOverall)

	query := `
		SELECT count(distinct p.mmsi), 
		       count(distinct case when v.tanker_class IS NOT NULL OR v.product_tanker = true OR v.crude_capable = true then p.mmsi else null end), 
		       max(p.received_at)
		FROM oil_ais_positions p
		LEFT JOIN oil_vessels v ON p.mmsi = v.mmsi
		WHERE p.received_at > now() - interval '24 hours'
	`
	var err error
	if hasBbox {
		query += " AND ST_Intersects(p.geom, ST_MakeEnvelope($1, $2, $3, $4, 4326))"
		err = s.Pool.QueryRow(r.Context(), query, minLon, minLat, maxLon, maxLat).Scan(&vesselCount, &tankerCount, &latestRegion)
	} else {
		err = s.Pool.QueryRow(r.Context(), query).Scan(&vesselCount, &tankerCount, &latestRegion)
	}

	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	res := map[string]any{
		"provider":                      "aisstream",
		"region":                        region,
		"vessels_observed_last_hour":    vesselCount,
		"tankers_observed_last_hour":    tankerCount,
		"latest_overall_observation_at": latestOverall,
		"latest_region_observation_at":  latestRegion,
	}

	if tankerCount == 0 && region != "worldwide_available_observations" {
		res["coverage_status"] = "absent_or_unavailable"
		res["coverage_warning"] = true
		res["warning_text"] = "Limited AIS coverage: no recent vessel positions are available from the connected source for this region. This does not mean that no tanker traffic exists here."
		res["message"] = res["warning_text"]
	} else {
		res["coverage_status"] = "available"
		res["coverage_warning"] = false
		res["warning_text"] = nil
	}

	writeJSON(w, http.StatusOK, res)
}
