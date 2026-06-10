package api

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

func (s *Server) refreshEntityEnrichment(w http.ResponseWriter, r *http.Request) {
	if _, ok := authClaims(r); !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	entityType := strings.TrimSpace(chi.URLParam(r, "entityType"))
	id := strings.TrimSpace(chi.URLParam(r, "id"))
	if id == "" {
		http.Error(w, "id required", http.StatusBadRequest)
		return
	}
	if _, err := uuid.Parse(id); err != nil {
		http.Error(w, "bad id", http.StatusBadRequest)
		return
	}

	ctx := r.Context()
	payload := map[string]any{}

	switch entityType {
	case "vessel":
		var imo string
		err := s.pool.QueryRow(ctx, `SELECT COALESCE(imo, '') FROM vessels WHERE id = $1`, id).Scan(&imo)
		if err != nil {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		imo = strings.TrimSpace(imo)
		if imo == "" {
			http.Error(w, "vessel has no IMO — cannot refresh registry enrichment", http.StatusUnprocessableEntity)
			return
		}
		payload["imo"] = imo
	case "asset":
		var exists bool
		err := s.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM assets WHERE id = $1)`, id).Scan(&exists)
		if err != nil || !exists {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
	default:
		http.Error(w, "unsupported entity type", http.StatusBadRequest)
		return
	}

	jobID, err := s.ingest.EnqueueEntityEnrichmentRefresh(ctx, entityType, id, payload)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"status":      "queued",
		"job_id":      jobID.String(),
		"entity_type": entityType,
		"entity_id":   id,
	})
}
