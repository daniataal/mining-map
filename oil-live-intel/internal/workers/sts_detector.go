package workers

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/mining-map/oil-live-intel/internal/services/geofence"
	"github.com/mining-map/oil-live-intel/internal/services/sts"
)

const stsDetectorInterval = 30 * time.Minute

// RunSTSDetector periodically scans live AIS and GFW archive for co-proximity STS candidates.
func RunSTSDetector(ctx context.Context, pool *pgxpool.Pool, retainHours, archiveBackfillDays int, log zerolog.Logger) {
	ticker := time.NewTicker(stsDetectorInterval)
	defer ticker.Stop()

	runOnce := func() {
		index, err := geofence.Load(ctx, pool, geofenceRadiusM)
		if err != nil {
			log.Warn().Err(err).Msg("sts detector: terminal index load failed")
			return
		}
		n, err := sts.RunCycle(ctx, pool, index, retainHours, archiveBackfillDays)
		if err != nil {
			log.Warn().Err(err).Msg("sts detector cycle failed")
			return
		}
		log.Info().Int("events_upserted", n).Msg("sts detector cycle complete")
	}

	runOnce()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			runOnce()
		}
	}
}
