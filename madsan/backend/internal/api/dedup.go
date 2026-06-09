package api

import (
	"net/http"
	"strconv"

	"github.com/madsan/intelligence/internal/dedup"
)

func (s *Server) listCompanyDuplicates(w http.ResponseWriter, r *http.Request) {
	limit := 50
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			limit = n
		}
	}
	clusters, err := dedup.ListCompanyDuplicateClusters(r.Context(), s.pool, limit)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	names, extra, _ := dedup.ClusterSummary(r.Context(), s.pool)
	writeJSON(w, map[string]any{
		"duplicate_names": names,
		"duplicate_rows":  extra,
		"clusters":        clusters,
	})
}

func (s *Server) scanCompanyDuplicates(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	limit := 100
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			limit = n
		}
	}
	n, err := dedup.EnqueueCompanyDuplicates(r.Context(), s.pool, limit)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]any{"enqueued": n, "status": "ok"})
}
