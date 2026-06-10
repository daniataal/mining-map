package ingestion

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"

	"github.com/madsan/intelligence/internal/maritime/ais"
)

const portCallSweepJobType = "port_call_sweep"

func (s *Service) processPortCallSweep(ctx context.Context, jobID uuid.UUID) error {
	hours := 6
	var payload map[string]any
	_ = s.pool.QueryRow(ctx, `SELECT COALESCE(payload,'{}'::jsonb) FROM ingestion_jobs WHERE id=$1`, jobID).Scan(&payload)
	if v, ok := payload["lookback_hours"].(float64); ok && v > 0 {
		hours = int(v)
	}
	started := time.Now()
	n, err := ais.SweepRecentPositions(ctx, s.pool, s.cfg, hours)
	status := "completed"
	var errMsg string
	if err != nil {
		status = "failed"
		errMsg = err.Error()
	}
	report, _ := json.Marshal(map[string]any{
		"positions_swept": n,
		"lookback_hours":  hours,
		"duration_ms":     time.Since(started).Milliseconds(),
	})
	_, _ = s.pool.Exec(ctx, `
		UPDATE ingestion_jobs SET status=$2, result_report=$3, error_message=NULLIF($4,''), finished_at=now()
		WHERE id=$1
	`, jobID, status, report, errMsg)
	return err
}
