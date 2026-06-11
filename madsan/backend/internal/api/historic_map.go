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

// listSTSEvents returns STS proximity signals from core_signals for the map layer.
func (s *Server) listSTSEvents(w http.ResponseWriter, r *http.Request) {
	limit := 500
	if v := strings.TrimSpace(r.URL.Query().Get("limit")); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 2000 {
			limit = n
		}
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
		SELECT cs.id, cs.payload, COALESCE(cs.confidence_score,0), cs.observed_at, COALESCE(cs.tier,''),
			COALESCE(NULLIF(cs.payload->>'name_a',''), NULLIF(cs.payload->>'vessel_a_name',''), va.name, '') AS name_a,
			COALESCE(NULLIF(cs.payload->>'name_b',''), NULLIF(cs.payload->>'vessel_b_name',''), vb.name, '') AS name_b,
			COALESCE(NULLIF(cs.payload->>'vessel_a_class',''), va.vessel_type, '') AS class_a,
			COALESCE(NULLIF(cs.payload->>'vessel_b_class',''), vb.vessel_type, '') AS class_b
		FROM core_signals cs
		LEFT JOIN vessels va ON va.mmsi = NULLIF(cs.payload->>'mmsi_a','')
		LEFT JOIN vessels vb ON vb.mmsi = NULLIF(cs.payload->>'mmsi_b','')
		WHERE cs.signal_type = 'sts'
		ORDER BY cs.observed_at DESC
		LIMIT $1
	`, limit)
	if err != nil {
		writeJSON(w, map[string]any{
			"type":       "FeatureCollection",
			"features":   []any{},
			"tier":       "not_available",
			"disclaimer": "STS layer unavailable",
		})
		return
	}
	defer rows.Close()

	features := make([]any, 0)
	for rows.Next() {
		var signalID string
		var payload []byte
		var score float64
		var observed time.Time
		var rowTier, nameA, nameB, classA, classB string
		if rows.Scan(&signalID, &payload, &score, &observed, &rowTier, &nameA, &nameB, &classA, &classB) != nil {
			continue
		}
		var m map[string]any
		if json.Unmarshal(payload, &m) != nil {
			continue
		}
		lat, okLat := toFloat64(m["centroid_lat"])
		lon, okLon := toFloat64(m["centroid_lon"])
		if !okLat || !okLon {
			continue
		}
		if minLng != nil && (lon < *minLng || lon > *maxLng || lat < *minLat || lat > *maxLat) {
			continue
		}
		sid, err := uuid.Parse(signalID)
		if err != nil {
			continue
		}
		props := stsFeatureProperties(sid, m, score, observed, rowTier, nameA, nameB, classA, classB)
		features = append(features, map[string]any{
			"type": "Feature",
			"id":   stsFeatureID(sid, m),
			"geometry": map[string]any{
				"type":        "Point",
				"coordinates": []float64{lon, lat},
			},
			"properties": props,
		})
	}

	writeJSON(w, map[string]any{
		"type":       "FeatureCollection",
		"features":   features,
		"count":      len(features),
		"tier":       "observed",
		"disclaimer": "STS events from ais_positions proximity detector (6-factor scored core_signals)",
	})
}

func toFloat64(v any) (float64, bool) {
	switch t := v.(type) {
	case float64:
		return t, true
	case json.Number:
		f, err := t.Float64()
		return f, err == nil
	default:
		return 0, false
	}
}

// getHistoricAggregates returns pre-bucketed series for charts (stub; no raw history rows).
func (s *Server) getHistoricAggregates(w http.ResponseWriter, r *http.Request) {
	entityType := chi.URLParam(r, "entityType")
	entityID := chi.URLParam(r, "entityID")
	metric := r.URL.Query().Get("metric")
	if metric == "" {
		metric = "signals"
	}
	bucket := r.URL.Query().Get("bucket")
	if bucket == "" {
		bucket = "day"
	}
	from := r.URL.Query().Get("from")
	to := r.URL.Query().Get("to")
	if from == "" {
		from = time.Now().Add(-30 * 24 * time.Hour).UTC().Format(time.RFC3339)
	}
	if to == "" {
		to = time.Now().UTC().Format(time.RFC3339)
	}

	writeJSON(w, map[string]any{
		"entity_type": entityType,
		"entity_id":   entityID,
		"metric":      metric,
		"bucket":      bucket,
		"from":        from,
		"to":          to,
		"buckets":     []any{},
		"tier":        "stub",
		"disclaimer":  "Historic aggregates stub — wire to core_signals/prices rollups after Phase A migration.",
	})
}
