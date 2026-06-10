package api

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// getShipvaultCompany returns cached ShipVault company profile + fleet_list.
func (s *Server) getShipvaultCompany(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(chi.URLParam(r, "id"))
	if id == "" {
		http.Error(w, "missing company id", http.StatusBadRequest)
		return
	}
	var name, country, city, parentName, parentID string
	var fleetSize *int
	var totalDWT, totalGT, avgAge *float64
	var fleetListJSON, rawJSON []byte
	var madsanCompanyID *uuid.UUID
	var fetchedAt, staleAfter time.Time
	err := s.pool.QueryRow(r.Context(), `
		SELECT name, COALESCE(country,''), COALESCE(city,''),
		       COALESCE(parent_name,''), COALESCE(parent_company_id,''),
		       fleet_size, total_dwt, total_gt, avg_age_years,
		       fleet_list, madsan_company_id, fetched_at, stale_after, raw_payload
		FROM shipvault_companies
		WHERE shipvault_company_id = $1
	`, id).Scan(
		&name, &country, &city, &parentName, &parentID,
		&fleetSize, &totalDWT, &totalGT, &avgAge,
		&fleetListJSON, &madsanCompanyID, &fetchedAt, &staleAfter, &rawJSON,
	)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	var fleetList any
	_ = json.Unmarshal(fleetListJSON, &fleetList)
	out := map[string]any{
		"shipvault_company_id": id,
		"name":                 name,
		"tier":                 "observed",
		"source":               "shipvault",
		"fetched_at":           fetchedAt.UTC().Format(time.RFC3339),
		"stale_after":          staleAfter.UTC().Format(time.RFC3339),
		"fleet_list":           fleetList,
	}
	if country != "" {
		out["country"] = country
	}
	if city != "" {
		out["city"] = city
	}
	if parentName != "" {
		out["parent_name"] = parentName
	}
	if parentID != "" {
		out["parent_company_id"] = parentID
	}
	if fleetSize != nil {
		out["fleet_size"] = *fleetSize
	}
	if totalDWT != nil {
		out["total_dwt"] = *totalDWT
	}
	if totalGT != nil {
		out["total_gt"] = *totalGT
	}
	if avgAge != nil {
		out["avg_age_years"] = *avgAge
	}
	if madsanCompanyID != nil {
		out["madsan_company_id"] = madsanCompanyID.String()
	}
	writeJSON(w, out)
}

// getVesselTrack returns a 24h AIS track LineString from ais_positions.
func (s *Server) getVesselTrack(w http.ResponseWriter, r *http.Request) {
	mmsi := strings.TrimSpace(chi.URLParam(r, "mmsi"))
	if mmsi == "" {
		http.Error(w, "missing mmsi", http.StatusBadRequest)
		return
	}
	hours := queryInt(r, "hours", 24)
	if hours < 1 || hours > 168 {
		hours = 24
	}
	since := time.Now().UTC().Add(-time.Duration(hours) * time.Hour)

	rows, err := s.pool.Query(r.Context(), `
		SELECT lon, lat, ts, course, speed_knots
		FROM ais_positions
		WHERE mmsi = $1 AND ts >= $2
		ORDER BY ts ASC
		LIMIT 5000
	`, mmsi, since)
	if err != nil {
		writeJSON(w, map[string]any{
			"type":       "FeatureCollection",
			"features":   []any{},
			"mmsi":       mmsi,
			"hours":      hours,
			"tier":       "not_available",
			"disclaimer": "AIS position history unavailable — ais_positions table may not be populated yet.",
		})
		return
	}
	defer rows.Close()

	type pt struct {
		lon, lat float64
		ts       time.Time
		course   *float64
		speed    *float64
	}
	var points []pt
	for rows.Next() {
		var p pt
		if err := rows.Scan(&p.lon, &p.lat, &p.ts, &p.course, &p.speed); err != nil {
			continue
		}
		points = append(points, p)
	}

	coords := make([][]float64, 0, len(points))
	for _, p := range points {
		coords = append(coords, []float64{p.lon, p.lat})
	}

	features := []any{}
	if len(coords) >= 2 {
		features = append(features, map[string]any{
			"type": "Feature",
			"geometry": map[string]any{
				"type":        "LineString",
				"coordinates": coords,
			},
			"properties": map[string]any{
				"mmsi":        mmsi,
				"point_count": len(coords),
				"from":        points[0].ts.UTC().Format(time.RFC3339),
				"to":          points[len(points)-1].ts.UTC().Format(time.RFC3339),
			},
		})
	}

	tier := "observed"
	disclaimer := ""
	if len(coords) < 2 {
		tier = "partial"
		disclaimer = "Fewer than two AIS positions in the requested window — track not drawn."
	}

	out := map[string]any{
		"type":       "FeatureCollection",
		"features":   features,
		"mmsi":       mmsi,
		"hours":      hours,
		"tier":       tier,
		"disclaimer": disclaimer,
	}

	// Voyage leg linestrings from port-call pairing (Phase B).
	voyageRows, err := s.pool.Query(r.Context(), `
		SELECT ST_AsGeoJSON(geom::geometry)::jsonb, load_port_name, discharge_port_name,
		       started_at, ended_at, COALESCE(confidence_score,0)
		FROM voyages
		WHERE mmsi = $1 AND geom IS NOT NULL
		ORDER BY started_at DESC NULLS LAST
		LIMIT 5
	`, mmsi)
	if err == nil {
		defer voyageRows.Close()
		for voyageRows.Next() {
			var geom []byte
			var loadPort, dischargePort *string
			var started, ended *time.Time
			var conf float64
			if voyageRows.Scan(&geom, &loadPort, &dischargePort, &started, &ended, &conf) != nil {
				continue
			}
			var geometry any
			if json.Unmarshal(geom, &geometry) != nil {
				continue
			}
			props := map[string]any{
				"kind":                "voyage_leg",
				"confidence_score":    conf,
				"load_port_name":      loadPort,
				"discharge_port_name": dischargePort,
			}
			if started != nil {
				props["started_at"] = started.UTC().Format(time.RFC3339)
			}
			if ended != nil {
				props["ended_at"] = ended.UTC().Format(time.RFC3339)
			}
			out["features"] = append(out["features"].([]any), map[string]any{
				"type": "Feature", "geometry": geometry, "properties": props,
			})
		}
	}

	writeJSON(w, out)
}

// getVesselPortCalls lists port-call signals and live visits for a vessel.
func (s *Server) getVesselPortCalls(w http.ResponseWriter, r *http.Request) {
	mmsi := strings.TrimSpace(chi.URLParam(r, "mmsi"))
	limit := queryInt(r, "limit", 25)
	if mmsi == "" {
		http.Error(w, "missing mmsi", http.StatusBadRequest)
		return
	}

	var vesselID uuid.UUID
	if err := s.pool.QueryRow(r.Context(), `SELECT id FROM vessels WHERE mmsi = $1`, mmsi).Scan(&vesselID); err != nil {
		http.Error(w, "vessel not found", http.StatusNotFound)
		return
	}

	type portCallRow struct {
		TerminalName string  `json:"terminal_name,omitempty"`
		Country      string  `json:"country,omitempty"`
		EventType    string  `json:"event_type,omitempty"`
		Commodity    string  `json:"commodity_family,omitempty"`
		Arrival      string  `json:"arrival_ts,omitempty"`
		Departure    string  `json:"departure_ts,omitempty"`
		Confidence   float64 `json:"confidence_score,omitempty"`
		Tier         string  `json:"tier"`
		Source       string  `json:"source"`
		Status       string  `json:"status,omitempty"`
		Disclaimer   string  `json:"disclaimer,omitempty"`
	}
	var out []portCallRow

	// Live port_call_visits (Phase E).
	visitRows, err := s.pool.Query(r.Context(), `
		SELECT COALESCE(a.name,''), COALESCE(a.country_code,''),
		       pc.event_type, COALESCE(pc.commodity_family,''),
		       pc.arrival_ts, pc.departure_ts, pc.status,
		       COALESCE(pc.confidence_score,0)
		FROM port_call_visits pc
		JOIN assets a ON a.id = pc.asset_id
		WHERE pc.mmsi = $1
		ORDER BY pc.arrival_ts DESC
		LIMIT $2
	`, mmsi, limit)
	if err == nil {
		defer visitRows.Close()
		for visitRows.Next() {
			var name, country, eventType, commodity, status string
			var arrival time.Time
			var departure *time.Time
			var conf float64
			if err := visitRows.Scan(&name, &country, &eventType, &commodity, &arrival, &departure, &status, &conf); err != nil {
				continue
			}
			row := portCallRow{
				TerminalName: name,
				Country:      country,
				EventType:    eventType,
				Commodity:    commodity,
				Arrival:      arrival.UTC().Format(time.RFC3339),
				Tier:         "observed",
				Source:       "ais_geofence",
				Status:       status,
				Confidence:   conf,
			}
			if departure != nil {
				row.Departure = departure.UTC().Format(time.RFC3339)
			}
			out = append(out, row)
		}
	}

	// Migrated / signal port calls from core_signals.
	sigRows, err := s.pool.Query(r.Context(), `
		SELECT payload, observed_at, tier, COALESCE(confidence_score,0)
		FROM core_signals
		WHERE entity_type = 'vessel' AND entity_id = $1 AND signal_type = 'port_call'
		ORDER BY observed_at DESC
		LIMIT $2
	`, vesselID, limit)
	if err == nil {
		defer sigRows.Close()
		for sigRows.Next() {
			var payload []byte
			var observed time.Time
			var tier string
			var conf float64
			if err := sigRows.Scan(&payload, &observed, &tier, &conf); err != nil {
				continue
			}
			var m map[string]any
			_ = json.Unmarshal(payload, &m)
			row := portCallRow{
				Tier:       tier,
				Source:     "core_signals",
				Arrival:    observed.UTC().Format(time.RFC3339),
				Confidence: conf,
			}
			if v, ok := m["terminal_name"].(string); ok {
				row.TerminalName = v
			}
			if v, ok := m["terminal_country"].(string); ok {
				row.Country = v
			}
			if v, ok := m["event_type"].(string); ok {
				row.EventType = v
			}
			if v, ok := m["commodity_family"].(string); ok {
				row.Commodity = v
			}
			if v, ok := m["source"].(string); ok && v != "" {
				row.Source = v
			}
			out = append(out, row)
		}
	}

	writeJSON(w, map[string]any{
		"mmsi":       mmsi,
		"count":      len(out),
		"port_calls": out,
	})
}

// listMCRCorridors returns voyage corridor arcs for the map (GeoJSON).
func (s *Server) listMCRCorridors(w http.ResponseWriter, r *http.Request) {
	limit := queryInt(r, "limit", 300)
	minConf := queryFloat(r, "min_confidence")
	if minConf == nil {
		v := 0.0
		minConf = &v
	}

	bbox := strings.TrimSpace(r.URL.Query().Get("bbox"))
	var minLng, minLat, maxLng, maxLat *float64
	if bbox != "" {
		parts := strings.Split(bbox, ",")
		if len(parts) == 4 {
			if a, err := strconv.ParseFloat(strings.TrimSpace(parts[0]), 64); err == nil {
				minLng = &a
			}
			if a, err := strconv.ParseFloat(strings.TrimSpace(parts[1]), 64); err == nil {
				minLat = &a
			}
			if a, err := strconv.ParseFloat(strings.TrimSpace(parts[2]), 64); err == nil {
				maxLng = &a
			}
			if a, err := strconv.ParseFloat(strings.TrimSpace(parts[3]), 64); err == nil {
				maxLat = &a
			}
		}
	}

	rows, err := s.pool.Query(r.Context(), `
		SELECT id::text, COALESCE(load_port_name,''), COALESCE(load_country,''),
		       COALESCE(discharge_port_name,''), COALESCE(discharge_country,''),
		       COALESCE(commodity_family,''), COALESCE(confidence_score,0), COALESCE(tier,'inferred'),
		       ST_AsGeoJSON(geom::geometry) AS geojson
		FROM voyages
		WHERE geom IS NOT NULL
		  AND confidence_score >= $1
		  AND ($2::float8 IS NULL OR ST_Intersects(
		        geom::geometry,
		        ST_MakeEnvelope($2, $3, $4, $5, 4326)
		      ))
		ORDER BY started_at DESC NULLS LAST
		LIMIT $6
	`, *minConf, minLng, minLat, maxLng, maxLat, limit)
	if err != nil {
		writeJSON(w, map[string]any{
			"type":       "FeatureCollection",
			"features":   []any{},
			"tier":       "not_available",
			"disclaimer": "Voyage corridors unavailable — voyages.geom empty until Phase A/B migration.",
		})
		return
	}
	defer rows.Close()

	features := []any{}
	for rows.Next() {
		var id, loadPort, loadCountry, dischargePort, dischargeCountry, commodity, tier string
		var conf float64
		var geoJSON []byte
		if err := rows.Scan(&id, &loadPort, &loadCountry, &dischargePort, &dischargeCountry, &commodity, &conf, &tier, &geoJSON); err != nil {
			continue
		}
		var geom any
		if json.Unmarshal(geoJSON, &geom) != nil {
			continue
		}
		features = append(features, map[string]any{
			"type":     "Feature",
			"geometry": geom,
			"properties": map[string]any{
				"id":                  id,
				"load_port_name":      loadPort,
				"load_country":        loadCountry,
				"discharge_port_name": dischargePort,
				"discharge_country":   dischargeCountry,
				"commodity_family":    commodity,
				"confidence_score":    conf,
				"tier":                tier,
			},
		})
	}

	tier := "inferred"
	disclaimer := "Corridor arcs from migrated voyage legs — indicative routing, not confirmed cargo."
	if len(features) == 0 {
		tier = "partial"
		disclaimer = "No voyage geometries in viewport — corridors appear after port-call migration (Phase A)."
	}

	writeJSON(w, map[string]any{
		"type":       "FeatureCollection",
		"features":   features,
		"tier":       tier,
		"disclaimer": disclaimer,
	})
}
