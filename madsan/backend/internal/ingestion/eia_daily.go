package ingestion

import (
	"context"
	"net/http"
	"time"

	"github.com/google/uuid"

	"github.com/madsan/intelligence/internal/markets"
)

func (s *Service) processEIADaily(ctx context.Context, jobID uuid.UUID) error {
	started := time.Now()
	client := &http.Client{Timeout: 12 * time.Second}
	n, err := markets.PersistDailySpots(ctx, s.pool, s.cfg.EIAAPIKey, client)
	report := buildLegacyImportReport(map[string]any{
		"prices_upserted": n,
		"eia_key_set":     s.cfg.EIAAPIKey != "",
	}, started)
	status := "completed"
	errMsg := ""
	if err != nil {
		status = "failed"
		errMsg = err.Error()
	}
	_, _ = s.pool.Exec(ctx, `
		UPDATE ingestion_jobs SET status=$2, result_report=$3, error_message=NULLIF($4,''), finished_at=now()
		WHERE id=$1
	`, jobID, status, report, errMsg)
	return err
}

