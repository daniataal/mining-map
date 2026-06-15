package api

import (
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"

	"github.com/go-chi/chi/v5"

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
	result, err := dedup.EnqueueCompanyDuplicates(r.Context(), s.pool, limit)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]any{
		"enqueued":              result.Total(),
		"exact_name_enqueued":   result.ExactNameEnqueued,
		"cross_name_enqueued":   result.CrossNameEnqueued,
		"status":                "ok",
	})
}

func (s *Server) exportCompanyPairsCSV(w http.ResponseWriter, r *http.Request) {
	limit := 200
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			limit = n
		}
	}
	enqueued, err := dedup.EnqueueCrossNameDuplicatePairs(r.Context(), s.pool, dedup.DefaultCrossNameEnqueueCap)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	filename := dedup.PairExportFilename()
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
	w.Header().Set("X-Madsan-Cross-Name-Enqueued", strconv.Itoa(enqueued))
	pairCount, err := dedup.ExportCompanyPairsCSV(r.Context(), s.pool, limit, w)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("X-Madsan-Pair-Count", strconv.Itoa(pairCount))
}

func (s *Server) enqueueClusterMergeReview(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	clusterID, err := url.PathUnescape(chi.URLParam(r, "id"))
	if err != nil || clusterID == "" {
		http.Error(w, "cluster id required", http.StatusBadRequest)
		return
	}
	result, err := dedup.EnqueueCompanyClusterMergeReview(r.Context(), s.pool, clusterID)
	if err != nil {
		switch {
		case errors.Is(err, dedup.ErrClusterNotFound):
			http.Error(w, err.Error(), http.StatusNotFound)
		case errors.Is(err, dedup.ErrTierNotEligible):
			w.WriteHeader(http.StatusBadRequest)
			writeJSON(w, map[string]any{
				"status":      "rejected",
				"review_tier": result.ReviewTier,
				"error":       err.Error(),
			})
		default:
			http.Error(w, err.Error(), http.StatusInternalServerError)
		}
		return
	}
	status := "enqueued"
	if !result.Enqueued {
		status = "deduped"
	}
	writeJSON(w, map[string]any{
		"status":      status,
		"enqueued":    result.Enqueued,
		"queue_id":    result.QueueID,
		"review_tier": result.ReviewTier,
		"message":     result.Message,
	})
}
