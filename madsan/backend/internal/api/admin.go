package api

import (
	"encoding/json"
	"net/http"
)

func (s *Server) listSources(w http.ResponseWriter, r *http.Request) {
	rows, err := s.pool.Query(r.Context(), `
		SELECT s.slug, s.source_name, s.source_type, s.source_category,
		       s.reliability_score, s.imported_at, s.last_success_at, s.enabled,
		       (SELECT COUNT(*)::int FROM evidence e WHERE e.source_id = s.id) AS evidence_rows,
		       (SELECT COUNT(*)::int FROM staging_generic_records st WHERE st.source_id = s.id) AS staging_rows
		FROM sources s
		ORDER BY s.imported_at DESC NULLS LAST
		LIMIT 50
	`)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var slug, name, typ *string
		var category *string
		var reliability *float64
		var imported, lastSuccess any
		var enabled bool
		var evidence, staging int
		if err := rows.Scan(&slug, &name, &typ, &category, &reliability, &imported, &lastSuccess, &enabled, &evidence, &staging); err != nil {
			continue
		}
		out = append(out, map[string]any{
			"slug": slug, "source_name": name, "source_type": typ, "source_category": category,
			"reliability_score": reliability, "imported_at": imported, "last_success_at": lastSuccess,
			"enabled": enabled, "evidence_rows": evidence, "staging_rows": staging,
		})
	}
	writeJSON(w, out)
}

func (s *Server) enqueueIngestionJob(w http.ResponseWriter, r *http.Request) {
	var body struct {
		JobType    string         `json:"job_type"`
		SourceSlug string         `json:"source_slug"`
		Payload    map[string]any `json:"payload"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	if body.JobType == "" {
		http.Error(w, "job_type required", http.StatusBadRequest)
		return
	}
	if body.SourceSlug == "" {
		body.SourceSlug = body.JobType
	}
	if body.Payload == nil {
		body.Payload = map[string]any{"trigger": "admin"}
	}
	id, err := s.ingest.EnqueueDeduped(r.Context(), body.JobType, body.SourceSlug, body.Payload)
	if err != nil {
		writeJSON(w, map[string]any{
			"status":  "deduped",
			"job_id":  id.String(),
			"message": "Job already pending or running",
		})
		return
	}
	writeJSON(w, map[string]any{"status": "enqueued", "job_id": id.String()})
}

func (s *Server) adminInsightsV2(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var assets, companies, vessels, evidence, sources, staging int
	var vesselsFresh int
	_ = s.pool.QueryRow(ctx, `SELECT COUNT(*)::int FROM assets`).Scan(&assets)
	_ = s.pool.QueryRow(ctx, `SELECT COUNT(*)::int FROM companies`).Scan(&companies)
	_ = s.pool.QueryRow(ctx, `SELECT COUNT(*)::int FROM vessels`).Scan(&vessels)
	_ = s.pool.QueryRow(ctx, `SELECT COUNT(*)::int FROM evidence`).Scan(&evidence)
	_ = s.pool.QueryRow(ctx, `SELECT COUNT(*)::int FROM sources`).Scan(&sources)
	_ = s.pool.QueryRow(ctx, `SELECT COUNT(*)::int FROM staging_generic_records`).Scan(&staging)
	_ = s.pool.QueryRow(ctx, `
		SELECT COUNT(*)::int FROM vessels WHERE last_seen_at > now() - interval '24 hours'
	`).Scan(&vesselsFresh)

	jobStats, _ := s.ingest.JobStats(ctx)
	var reviewPending int
	_ = s.pool.QueryRow(ctx, `SELECT COUNT(*)::int FROM manual_review_queue WHERE status='pending'`).Scan(&reviewPending)
	var dupClusters, dupExtra int
	_ = s.pool.QueryRow(ctx, `
		SELECT COUNT(*)::int, COALESCE(SUM(cnt - 1), 0)::int FROM (
			SELECT COUNT(*)::int AS cnt FROM companies GROUP BY normalized_name HAVING COUNT(*) > 1
		) s
	`).Scan(&dupClusters, &dupExtra)

	writeJSON(w, map[string]any{
		"entities": map[string]any{
			"assets": assets, "companies": companies, "vessels": vessels,
			"vessels_ais_24h": vesselsFresh,
		},
		"provenance": map[string]any{
			"sources": sources, "evidence_rows": evidence, "staging_rows": staging,
		},
		"ingestion": jobStats,
		"review_queue_pending": reviewPending,
		"dedup": map[string]any{
			"company_clusters": dupClusters,
			"extra_rows":       dupExtra,
		},
		"config": map[string]any{
			"legacy_python_enabled": s.cfg.LegacyImportPython,
		},
	})
}
