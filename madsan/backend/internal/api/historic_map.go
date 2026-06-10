package api

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
)

// listSTSEvents returns STS event points for the map layer (stub until Phase A migration completes).
func (s *Server) listSTSEvents(w http.ResponseWriter, r *http.Request) {
	_ = r.URL.Query().Get("bbox")
	writeJSON(w, map[string]any{
		"type":     "FeatureCollection",
		"features": []any{},
		"tier":     "stub",
		"disclaimer": "STS map layer stub — events appear after oil_sts_events migration to core_signals.",
	})
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
