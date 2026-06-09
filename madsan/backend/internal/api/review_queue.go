package api

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/madsan/intelligence/internal/dedup"
)

func (s *Server) resolveReviewQueueItem(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	idStr := chi.URLParam(r, "id")
	queueID, err := uuid.Parse(idStr)
	if err != nil {
		http.Error(w, "bad id", http.StatusBadRequest)
		return
	}
	var body struct {
		Action             string `json:"action"`
		CanonicalCompanyID string `json:"canonical_company_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}

	out, err := dedup.ResolveReviewQueue(r.Context(), s.pool, queueID, dedup.ResolveInput{
		Action:             body.Action,
		CanonicalCompanyID: body.CanonicalCompanyID,
	})
	if err != nil {
		switch {
		case errors.Is(err, dedup.ErrQueueNotFound):
			http.Error(w, err.Error(), http.StatusNotFound)
		case errors.Is(err, dedup.ErrQueueNotPending),
			errors.Is(err, dedup.ErrInvalidAction),
			errors.Is(err, dedup.ErrMissingCanonical),
			errors.Is(err, dedup.ErrInvalidCanonical),
			errors.Is(err, dedup.ErrUnsupportedReason):
			http.Error(w, err.Error(), http.StatusBadRequest)
		default:
			http.Error(w, err.Error(), http.StatusInternalServerError)
		}
		return
	}
	writeJSON(w, out)
}
