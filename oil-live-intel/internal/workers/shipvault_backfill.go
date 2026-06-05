package workers

import (
	"context"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/mining-map/oil-live-intel/internal/config"
	"github.com/mining-map/oil-live-intel/internal/services/shipvault"
	"github.com/rs/zerolog"
)

type shipVaultBackfillCandidate struct {
	MMSI int64
	IMO  string
}

// StartShipVaultBackfillLoop incrementally fills the Postgres registry cache for known vessels.
func StartShipVaultBackfillLoop(ctx context.Context, pool *pgxpool.Pool, cfg config.Config, log zerolog.Logger) {
	if !cfg.ShipVaultBackfillEnabled {
		log.Info().Msg("[shipvault-backfill] disabled")
		return
	}

	interval := time.Duration(cfg.ShipVaultBackfillIntervalHours) * time.Hour
	if interval < time.Hour {
		interval = time.Hour
	}
	limit := cfg.ShipVaultBackfillLimit
	if limit <= 0 {
		limit = 25
	}
	if limit > 200 {
		limit = 200
	}

	for {
		if err := runShipVaultBackfillOnce(ctx, pool, cfg, limit, log); err != nil {
			log.Warn().Err(err).Msg("[shipvault-backfill] pass failed")
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(interval):
		}
	}
}

func runShipVaultBackfillOnce(ctx context.Context, pool *pgxpool.Pool, cfg config.Config, limit int, log zerolog.Logger) error {
	dbRefresh, err := shipvault.LoadRefreshToken(ctx, pool)
	if err != nil {
		return err
	}
	if !cfg.ShipVaultConfigured(dbRefresh != "") {
		log.Info().Msg("[shipvault-backfill] idle: ShipVault token not configured")
		return nil
	}

	refreshToken := strings.TrimSpace(cfg.ShipVaultRefreshToken)
	if refreshToken == "" {
		refreshToken = dbRefresh
	}
	svc, mode, err := shipvault.NewService(shipvault.ServiceOptions{
		BaseURL:        cfg.ShipVaultBaseURL,
		CacheTTLDays:   cfg.ShipVaultCacheTTLDays,
		BearerToken:    cfg.ShipVaultBearerToken,
		RefreshToken:   refreshToken,
		SessionJSON:    cfg.ShipVaultSessionJSON,
		Email:          cfg.ShipVaultEmail,
		Password:       cfg.ShipVaultPassword,
		FirebaseAPIKey: cfg.ShipVaultFirebaseAPIKey,
		AppOriginURL:   cfg.ShipVaultAppOriginURL,
		PersistRefreshToken: func(pctx context.Context, rt string) error {
			return shipvault.SaveRefreshToken(pctx, pool, rt)
		},
	}, log)
	if err != nil {
		return err
	}

	candidates, err := shipVaultBackfillCandidates(ctx, pool, limit)
	if err != nil {
		return err
	}
	if len(candidates) == 0 {
		log.Info().Str("auth", mode.String()).Msg("[shipvault-backfill] no missing IMO cache rows")
		return nil
	}

	var enriched, failed int
	for _, c := range candidates {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		if _, err := svc.EnrichVessel(ctx, pool, c.MMSI, c.IMO, false); err != nil {
			failed++
			log.Debug().Err(err).Int64("mmsi", c.MMSI).Str("imo", c.IMO).Msg("[shipvault-backfill] enrichment failed")
		} else {
			enriched++
		}
		time.Sleep(500 * time.Millisecond)
	}
	log.Info().
		Str("auth", mode.String()).
		Int("candidates", len(candidates)).
		Int("enriched", enriched).
		Int("failed", failed).
		Msg("[shipvault-backfill] pass complete")
	return nil
}

func shipVaultBackfillCandidates(ctx context.Context, pool *pgxpool.Pool, limit int) ([]shipVaultBackfillCandidate, error) {
	rows, err := pool.Query(ctx, `
		SELECT v.mmsi, TRIM(v.imo) AS imo
		FROM oil_vessels v
		LEFT JOIN vessel_enrichment_cache c ON c.imo = TRIM(v.imo)
		WHERE v.imo IS NOT NULL
		  AND TRIM(v.imo) <> ''
		  AND c.imo IS NULL
		ORDER BY
		  CASE
		    WHEN COALESCE(v.crude_capable, false) OR COALESCE(v.product_tanker, false) THEN 0
		    WHEN LOWER(COALESCE(v.tanker_class, '')) <> '' THEN 1
		    WHEN LOWER(COALESCE(v.vessel_type, '')) LIKE '%tanker%' THEN 2
		    ELSE 3
		  END,
		  v.updated_at DESC NULLS LAST,
		  v.mmsi ASC
		LIMIT $1
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []shipVaultBackfillCandidate
	for rows.Next() {
		var c shipVaultBackfillCandidate
		if err := rows.Scan(&c.MMSI, &c.IMO); err != nil {
			return out, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}
