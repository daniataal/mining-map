package ingestion

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/madsan/intelligence/internal/markets"
	"github.com/madsan/intelligence/internal/sources"
)

const worldBankPricesJobType = "world_bank_prices"

type worldBankPricesPayload struct {
	URL string `json:"url,omitempty"`
}

func (s *Service) processWorldBankPrices(ctx context.Context, jobID uuid.UUID, payload []byte) error {
	started := time.Now()
	opts := worldBankPricesPayload{}
	if len(payload) > 0 {
		_ = json.Unmarshal(payload, &opts)
	}
	url := strings.TrimSpace(opts.URL)
	if url == "" {
		url = markets.WorldBankPinkSheetDefaultURL
	}
	n, err := markets.PersistWorldBankMonthlyPrices(ctx, s.pool, url, sources.HTTPClient())
	report := buildLegacyImportReport(map[string]any{
		"prices_upserted": n,
		"source_url":      url,
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
