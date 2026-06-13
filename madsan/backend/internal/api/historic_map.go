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
	minProbability := 45.0
	if v := strings.TrimSpace(r.URL.Query().Get("min_probability")); v != "" {
		if n, err := strconv.ParseFloat(v, 64); err == nil && n >= 0 && n <= 100 {
			minProbability = n
		}
	}
	// Lookback window: default 7 days, capped at 90.
	sinceHours := 168
	if v := strings.TrimSpace(r.URL.Query().Get("since_hours")); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 2160 {
			sinceHours = n
		}
	}
	bbox := strings.TrimSpace(r.URL.Query().Get("bbox"))
	minLng, minLat, maxLng, maxLat := -180.0, -90.0, 180.0, 90.0
	if bbox != "" {
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

	// Probability is served from stored payloads only — sts_rescore backfills
	// transfer_probability so no spatial scoring runs per map request.
	rows, err := s.pool.Query(r.Context(), `
		SELECT cs.id, cs.payload, COALESCE(cs.confidence_score,0), cs.observed_at, COALESCE(cs.tier,''),
			COALESCE(NULLIF(cs.payload->>'name_a',''), NULLIF(cs.payload->>'vessel_a_name',''), va.name, '') AS name_a,
			COALESCE(NULLIF(cs.payload->>'name_b',''), NULLIF(cs.payload->>'vessel_b_name',''), vb.name, '') AS name_b,
			COALESCE(NULLIF(cs.payload->>'vessel_a_class',''), va.vessel_type, '') AS class_a,
			COALESCE(NULLIF(cs.payload->>'vessel_b_class',''), vb.vessel_type, '') AS class_b
		FROM core_signals cs
		LEFT JOIN vessels va ON va.mmsi = NULLIF(cs.payload->>'mmsi_a','')
		LEFT JOIN vessels vb ON vb.mmsi = NULLIF(cs.payload->>'mmsi_b','')
		CROSS JOIN LATERAL (
			SELECT
				COALESCE(NULLIF(NULLIF(cs.payload->>'event_lat',''),'0')::float8,
					NULLIF(NULLIF(cs.payload->>'closest_approach_lat',''),'0')::float8,
					NULLIF(NULLIF(cs.payload->>'centroid_lat',''),'0')::float8) AS lat,
				COALESCE(NULLIF(NULLIF(cs.payload->>'event_lon',''),'0')::float8,
					NULLIF(NULLIF(cs.payload->>'closest_approach_lon',''),'0')::float8,
					NULLIF(NULLIF(cs.payload->>'centroid_lon',''),'0')::float8) AS lon
		) pt
		WHERE cs.signal_type = 'sts'
		  AND cs.observed_at >= now() - make_interval(hours => $2)
		  AND COALESCE((cs.payload->>'transfer_probability')::numeric, cs.confidence_score, 0) >= $3
		  AND pt.lat IS NOT NULL AND pt.lon IS NOT NULL
		  AND pt.lon BETWEEN $4 AND $6 AND pt.lat BETWEEN $5 AND $7
		ORDER BY cs.observed_at DESC
		LIMIT $1
	`, limit, sinceHours, minProbability, minLng, minLat, maxLng, maxLat)
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
		lat, okLat := eventPointFromPayload(m, "lat")
		lon, okLon := eventPointFromPayload(m, "lon")
		if !okLat || !okLon {
			continue
		}
		// Payload-only normalization for any stragglers; no spatial queries here.
		ensureSTSProbability(r.Context(), nil, m, score)
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
		"type":            "FeatureCollection",
		"features":        features,
		"count":           len(features),
		"tier":            "observed",
		"min_probability": minProbability,
		"since_hours":     sinceHours,
		"disclaimer":      "STS events are AIS proximity candidates re-scored with port/anchorage, terminal, crowding, and port-call context; low-probability port co-proximity is hidden by default.",
	})
}

// getSTSSummary returns true counts for the STS layers (sidebar/drawer), so the
// UI never derives totals from a capped feature list.
func (s *Server) getSTSSummary(w http.ResponseWriter, r *http.Request) {
	minProbability := 45.0
	if v := strings.TrimSpace(r.URL.Query().Get("min_probability")); v != "" {
		if n, err := strconv.ParseFloat(v, 64); err == nil && n >= 0 && n <= 100 {
			minProbability = n
		}
	}
	var events24h, events7d, eventsTotal, unscored int
	var lastObserved *time.Time
	err := s.pool.QueryRow(r.Context(), `
		SELECT
			COUNT(*) FILTER (WHERE q.observed_at >= now() - interval '24 hours')::int,
			COUNT(*) FILTER (WHERE q.observed_at >= now() - interval '7 days')::int,
			COUNT(*)::int,
			COUNT(*) FILTER (WHERE q.prob IS NULL)::int,
			MAX(q.observed_at)
		FROM (
			SELECT cs.observed_at, (cs.payload->>'transfer_probability')::numeric AS prob
			FROM core_signals cs
			WHERE cs.signal_type = 'sts'
			  AND COALESCE((cs.payload->>'transfer_probability')::numeric, cs.confidence_score, 0) >= $1
			  AND COALESCE(NULLIF(NULLIF(cs.payload->>'event_lat',''),'0'),
					NULLIF(NULLIF(cs.payload->>'closest_approach_lat',''),'0'),
					NULLIF(NULLIF(cs.payload->>'centroid_lat',''),'0')) IS NOT NULL
		) q
	`, minProbability).Scan(&events24h, &events7d, &eventsTotal, &unscored, &lastObserved)
	if err != nil {
		writeJSON(w, map[string]any{"tier": "not_available", "disclaimer": "STS summary unavailable"})
		return
	}
	var predictionsActive int
	_ = s.pool.QueryRow(r.Context(), `
		SELECT COUNT(*)::int FROM predictive_signals
		WHERE signal_type = 'commercial_sts_v1'
		  AND (expires_at IS NULL OR expires_at > now())
	`).Scan(&predictionsActive)
	writeJSON(w, map[string]any{
		"events_24h":         events24h,
		"events_7d":          events7d,
		"events_total":       eventsTotal,
		"events_unscored":    unscored,
		"predictions_active": predictionsActive,
		"min_probability":    minProbability,
		"last_observed_at":   lastObserved,
		"tier":               "observed",
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
