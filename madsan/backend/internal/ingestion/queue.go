package ingestion

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/google/uuid"
)

var ErrJobAlreadyQueued = errors.New("job already pending or running")

// EnqueueDeduped inserts a job unless an identical pending/running job exists.
func (s *Service) EnqueueDeduped(ctx context.Context, jobType, sourceSlug string, payload map[string]any) (uuid.UUID, error) {
	var existing uuid.UUID
	err := s.pool.QueryRow(ctx, `
		SELECT id FROM ingestion_jobs
		WHERE job_type = $1 AND COALESCE(source_slug, '') = $2
		  AND status IN ('pending', 'running')
		ORDER BY created_at DESC LIMIT 1
	`, jobType, sourceSlug).Scan(&existing)
	if err == nil {
		return existing, ErrJobAlreadyQueued
	}
	return s.Enqueue(ctx, jobType, sourceSlug, payload)
}

// JobStats summarizes ingestion queue health.
type JobStats struct {
	Pending   int `json:"pending"`
	Running   int `json:"running"`
	Completed int `json:"completed"`
	Failed    int `json:"failed"`
}

func (s *Service) JobStats(ctx context.Context) (JobStats, error) {
	var st JobStats
	rows, err := s.pool.Query(ctx, `
		SELECT status, COUNT(*)::int FROM ingestion_jobs GROUP BY status
	`)
	if err != nil {
		return st, err
	}
	defer rows.Close()
	for rows.Next() {
		var status string
		var n int
		if err := rows.Scan(&status, &n); err != nil {
			return st, err
		}
		switch status {
		case "pending":
			st.Pending = n
		case "running":
			st.Running = n
		case "completed":
			st.Completed = n
		case "failed":
			st.Failed = n
		}
	}
	return st, rows.Err()
}

// ListRecentJobs returns recent ingestion jobs for admin UI.
func (s *Service) ListRecentJobs(ctx context.Context, limit int) ([]map[string]any, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := s.pool.Query(ctx, `
		SELECT id, job_type, COALESCE(source_slug,''), status, attempts,
		       scheduled_at, started_at, finished_at, error_message, result_report
		FROM ingestion_jobs ORDER BY created_at DESC LIMIT $1
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id uuid.UUID
		var jobType, sourceSlug, status string
		var attempts int
		var errMsg *string
		var sched, started, fin any
		var report []byte
		if err := rows.Scan(&id, &jobType, &sourceSlug, &status, &attempts, &sched, &started, &fin, &errMsg, &report); err != nil {
			return nil, err
		}
		item := map[string]any{
			"id": id.String(), "job_type": jobType, "source_slug": sourceSlug,
			"status": status, "attempts": attempts,
			"scheduled_at": sched, "started_at": started, "finished_at": fin,
			"error_message": errMsg,
		}
		if len(report) > 0 {
			var m map[string]any
			if json.Unmarshal(report, &m) == nil {
				item["result_report"] = m
			}
		}
		out = append(out, item)
	}
	return out, rows.Err()
}
