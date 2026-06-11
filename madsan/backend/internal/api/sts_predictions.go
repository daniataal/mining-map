package api

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgconn"

	"github.com/madsan/intelligence/internal/predictive"
)

func (s *Server) listSTSPredictions(w http.ResponseWriter, r *http.Request) {
	limit := 200
	if v := strings.TrimSpace(r.URL.Query().Get("limit")); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 500 {
			limit = n
		}
	}
	minProbability := 65.0
	if v := strings.TrimSpace(r.URL.Query().Get("min_probability")); v != "" {
		if n, err := strconv.ParseFloat(v, 64); err == nil && n >= 0 && n <= 100 {
			minProbability = n
		}
	}
	useBBox, minLng, minLat, maxLng, maxLat := parseBBOX(r.URL.Query().Get("bbox"))

	rows, err := s.pool.Query(r.Context(), `
		SELECT id::text, COALESCE(payload, '{}'::jsonb), COALESCE(confidence_score, 0)::double precision,
		       COALESCE(horizon_hours, 24), COALESCE(predicted_at, created_at), expires_at,
		       ST_Y(geom::geometry), ST_X(geom::geometry)
		FROM predictive_signals
		WHERE signal_type = $1
		  AND COALESCE(confidence_score, 0) >= $2
		  AND geom IS NOT NULL
		  AND (expires_at IS NULL OR expires_at > now())
		  AND (NOT $3::boolean OR ST_Intersects(geom::geometry, ST_MakeEnvelope($4, $5, $6, $7, 4326)))
		ORDER BY confidence_score DESC, predicted_at DESC NULLS LAST
		LIMIT $8
	`, predictive.STSPairPredictionSignalType, minProbability, useBBox, minLng, minLat, maxLng, maxLat, limit)
	if err != nil {
		if isPredictionSchemaMissing(err) {
			writeJSON(w, map[string]any{
				"type":       "FeatureCollection",
				"features":   []any{},
				"count":      0,
				"tier":       "not_available",
				"disclaimer": "STS pair prediction layer not available until predictive_signals schema and prediction job are initialized.",
			})
			return
		}
		http.Error(w, "query failed", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	features := make([]any, 0)
	for rows.Next() {
		var id string
		var payload []byte
		var probability float64
		var rowHorizon int
		var predictedAt time.Time
		var expiresAt sql.NullTime
		var lat, lon float64
		if rows.Scan(&id, &payload, &probability, &rowHorizon, &predictedAt, &expiresAt, &lat, &lon) != nil {
			continue
		}
		props := map[string]any{}
		_ = json.Unmarshal(payload, &props)
		if props["name"] == nil || strings.TrimSpace(fmtStr(props["name"])) == "" {
			props["name"] = "Probable STS pair"
		}
		props["signal_id"] = id
		props["event_kind"] = "prediction"
		props["prediction_kind"] = "vessel_pair"
		props["future_pair_probability"] = probability
		props["confidence_score"] = probability
		props["horizon_hours"] = rowHorizon
		props["tier"] = "prediction"
		props["predicted_at"] = predictedAt.UTC().Format(time.RFC3339)
		props["observed_at"] = predictedAt.UTC().Format(time.RFC3339)
		if expiresAt.Valid {
			props["expires_at"] = expiresAt.Time.UTC().Format(time.RFC3339)
		}
		if props["disclaimer"] == nil {
			props["disclaimer"] = "STS pair prediction is based on recent AIS vessel proximity and context; it is not a confirmed transfer."
		}
		features = append(features, map[string]any{
			"type": "Feature",
			"id":   id,
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
		"tier":            "prediction",
		"min_probability": minProbability,
		"disclaimer":      "STS predictions show likely vessel pairs at their recent AIS midpoint, not grid centroids.",
	})
}

func parseBBOX(raw string) (bool, float64, float64, float64, float64) {
	parts := strings.Split(strings.TrimSpace(raw), ",")
	if len(parts) != 4 {
		return false, 0, 0, 0, 0
	}
	vals := make([]float64, 4)
	for i, p := range parts {
		v, err := strconv.ParseFloat(strings.TrimSpace(p), 64)
		if err != nil {
			return false, 0, 0, 0, 0
		}
		vals[i] = v
	}
	return true, vals[0], vals[1], vals[2], vals[3]
}

func isPredictionSchemaMissing(err error) bool {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code == "42P01" || pgErr.Code == "42703"
	}
	return false
}
