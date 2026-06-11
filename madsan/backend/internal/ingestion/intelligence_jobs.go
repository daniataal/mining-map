package ingestion

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog/log"

	"github.com/madsan/intelligence/internal/database"
	"github.com/madsan/intelligence/internal/maritime/geofence"
	"github.com/madsan/intelligence/internal/maritime/sts"
	"github.com/madsan/intelligence/internal/mcr"
	"github.com/madsan/intelligence/internal/predictive"
	"github.com/madsan/intelligence/internal/voyages"
)

const (
	stsDetectJobType       = "sts_detect"
	stsPairPredictJobType  = "sts_pair_predict"
	stsRescoreJobType      = "sts_rescore"
	maritimeContextJobType = "maritime_context_import"
	geoReferenceJobType    = "geo_reference_import"
	mcrRebuildJobType      = "mcr_rebuild"
	voyageRebuildJobType   = "voyage_rebuild"
)

func (s *Service) connectLegacy(ctx context.Context) (*pgxpool.Pool, func()) {
	if s.cfg.LegacyDBURL == "" {
		return nil, func() {}
	}
	pool, err := database.ConnectURL(ctx, s.cfg.LegacyDBURL)
	if err != nil {
		log.Warn().Err(err).Msg("legacy db unavailable for intelligence job")
		return nil, func() {}
	}
	return pool, func() { pool.Close() }
}

func (s *Service) processSTSDetect(ctx context.Context, jobID uuid.UUID) error {
	started := time.Now()
	retainHours := s.cfg.AISRetainDays * 24
	if retainHours <= 0 {
		retainHours = 72
	}
	radiusM := s.cfg.AISGeofenceRadiusM
	if radiusM <= 0 {
		radiusM = 1200
	}
	index, err := geofence.Load(ctx, s.pool, radiusM)
	if err != nil {
		return s.finishIntelJob(ctx, jobID, "failed", nil, err)
	}
	written, err := sts.RunCycle(ctx, s.pool, index, retainHours)
	if err != nil {
		return s.finishIntelJob(ctx, jobID, "failed", nil, err)
	}
	report, _ := json.Marshal(map[string]any{
		"events_written": written,
		"retain_hours":   retainHours,
		"duration_ms":    time.Since(started).Milliseconds(),
	})
	return s.finishIntelJob(ctx, jobID, "completed", report, nil)
}

func (s *Service) processSTSRescore(ctx context.Context, jobID uuid.UUID, payload []byte) error {
	started := time.Now()
	force := false
	if len(payload) > 0 {
		var opts struct {
			Force bool `json:"force"`
		}
		if json.Unmarshal(payload, &opts) == nil {
			force = opts.Force
		}
	}
	res, err := sts.RescoreStored(ctx, s.pool, 0, force)
	if err != nil {
		return s.finishIntelJob(ctx, jobID, "failed", nil, err)
	}
	report, _ := json.Marshal(map[string]any{
		"scanned":      res.Scanned,
		"updated":      res.Updated,
		"with_context": res.WithContext,
		"no_coords":    res.NoCoords,
		"force":        force,
		"duration_ms":  time.Since(started).Milliseconds(),
	})
	return s.finishIntelJob(ctx, jobID, "completed", report, nil)
}

func (s *Service) processSTSPairPredict(ctx context.Context, jobID uuid.UUID) error {
	started := time.Now()
	pairRes, err := predictive.RunSTSPairPredictions(ctx, s.pool)
	if err != nil {
		return s.finishIntelJob(ctx, jobID, "failed", nil, err)
	}
	report, _ := json.Marshal(map[string]any{
		"horizons":     pairRes.Horizons,
		"rows_scored":  pairRes.RowsScored,
		"rows_written": pairRes.RowsWritten,
		"duration_ms":  time.Since(started).Milliseconds(),
	})
	return s.finishIntelJob(ctx, jobID, "completed", report, nil)
}

func (s *Service) processMCRRebuild(ctx context.Context, jobID uuid.UUID) error {
	started := time.Now()
	legacy, closeLegacy := s.connectLegacy(ctx)
	defer closeLegacy()
	pools := mcr.Pools{Primary: s.pool, Legacy: legacy}
	res, err := mcr.RunRebuild(ctx, pools, log.Logger)
	if err != nil {
		return s.finishIntelJob(ctx, jobID, "failed", nil, err)
	}
	report, _ := json.Marshal(map[string]any{
		"upserted":    res.Upserted,
		"recipes":     res.Recipes,
		"errors":      res.Errors,
		"duration_ms": time.Since(started).Milliseconds(),
	})
	status := "completed"
	if len(res.Errors) > 0 && res.Upserted == 0 {
		status = "failed"
	}
	return s.finishIntelJob(ctx, jobID, status, report, nil)
}

func (s *Service) processVoyageRebuild(ctx context.Context, jobID uuid.UUID) error {
	started := time.Now()
	legacy, closeLegacy := s.connectLegacy(ctx)
	defer closeLegacy()
	res, err := voyages.Rebuild(ctx, s.pool, legacy)
	if err != nil {
		return s.finishIntelJob(ctx, jobID, "failed", nil, err)
	}
	report, _ := json.Marshal(map[string]any{
		"paired":            res.Paired,
		"tracks_built":      res.Tracks,
		"from_live_visits":  res.FromLive,
		"from_legacy_calls": res.FromLegacy,
		"duration_ms":       time.Since(started).Milliseconds(),
	})
	return s.finishIntelJob(ctx, jobID, "completed", report, nil)
}

func (s *Service) finishIntelJob(ctx context.Context, jobID uuid.UUID, status string, report []byte, err error) error {
	errMsg := ""
	if err != nil {
		errMsg = err.Error()
		status = "failed"
	}
	_, execErr := s.pool.Exec(ctx, `
		UPDATE ingestion_jobs SET status=$2, result_report=$3, error_message=NULLIF($4,''), finished_at=now()
		WHERE id=$1
	`, jobID, status, report, errMsg)
	if err != nil {
		return err
	}
	return execErr
}
