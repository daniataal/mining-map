package api

import (
	"context"
	"net/http"
	"sync"
	"time"

	"github.com/madsan/intelligence/internal/database"
	"github.com/madsan/intelligence/internal/ingestion"
)

const parityCacheTTL = 5 * time.Minute

type parityCache struct {
	mu     sync.Mutex
	at     time.Time
	report ingestion.ParityReport
	err    error
}

func (s *Server) adminHealthRuntime(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var vesselsTotal, vessels24h, vessels72h int
	_ = s.pool.QueryRow(ctx, `SELECT COUNT(*)::int FROM vessels`).Scan(&vesselsTotal)
	_ = s.pool.QueryRow(ctx, `
		SELECT COUNT(*)::int FROM vessels WHERE last_seen_at > now() - interval '24 hours'
	`).Scan(&vessels24h)
	_ = s.pool.QueryRow(ctx, `
		SELECT COUNT(*)::int FROM vessels WHERE last_seen_at > now() - interval '72 hours'
	`).Scan(&vessels72h)

	ais := map[string]any{}
	if s.aisStats != nil {
		ais = s.aisStats.Snapshot()
	} else {
		ais["enabled"] = s.cfg.EnableAISSync
		ais["legacy_configured"] = s.cfg.LegacyDBURL != ""
		ais["interval_sec"] = int(s.cfg.AISSyncInterval / time.Second)
	}
	ais["vessels_total"] = vesselsTotal
	ais["vessels_fresh_24h"] = vessels24h
	ais["vessels_fresh_72h"] = vessels72h
	ais["coverage_note"] = "AIS reflects legacy provider coverage; Persian Gulf may be sparse"

	parityBlock := map[string]any{
		"threshold_pct": 5.0,
		"cache_ttl_sec": int(parityCacheTTL / time.Second),
	}
	if s.cfg.LegacyDBURL == "" {
		parityBlock["available"] = false
		parityBlock["error"] = "LEGACY_DATABASE_URL not configured"
	} else {
		parity, parityErr := s.cachedLegacyParity(ctx)
		if parityErr != nil {
			parityBlock["error"] = parityErr.Error()
			parityBlock["available"] = false
		} else {
			parityBlock["available"] = true
			parityBlock["checked_at"] = parity.CheckedAt
			parityBlock["passed"] = parity.Passed
			parityBlock["failed_critical"] = parity.FailedCritical
			parityBlock["tables"] = parity.Tables
		}
	}

	writeJSON(w, map[string]any{
		"ais_sync":       ais,
		"legacy_parity":  parityBlock,
		"legacy_python":  s.cfg.LegacyImportPython,
	})
}

func (s *Server) cachedLegacyParity(ctx context.Context) (ingestion.ParityReport, error) {
	s.parity.mu.Lock()
	if !s.parity.at.IsZero() && time.Since(s.parity.at) < parityCacheTTL {
		report, err := s.parity.report, s.parity.err
		s.parity.mu.Unlock()
		return report, err
	}
	s.parity.mu.Unlock()

	report, err := s.refreshLegacyParity(ctx)

	s.parity.mu.Lock()
	s.parity.at = time.Now().UTC()
	s.parity.report = report
	s.parity.err = err
	s.parity.mu.Unlock()

	return report, err
}

func (s *Server) refreshLegacyParity(ctx context.Context) (ingestion.ParityReport, error) {
	if s.cfg.LegacyDBURL == "" {
		return ingestion.ParityReport{}, nil
	}
	legacy, err := database.ConnectURL(ctx, s.cfg.LegacyDBURL)
	if err != nil {
		return ingestion.ParityReport{}, err
	}
	defer legacy.Close()
	return ingestion.RunLegacyParity(ctx, legacy, s.pool, 5.0)
}
