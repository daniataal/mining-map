package api

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/madsan/intelligence/internal/graph"
)

func (s *Server) getPipelineConnectivity(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		http.Error(w, "pipeline id required", http.StatusBadRequest)
		return
	}
	result, err := graph.LoadPipelineConnectivity(r.Context(), s.pool, id)
	if errors.Is(err, graph.ErrPipelineNotFound) {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, result)
}
