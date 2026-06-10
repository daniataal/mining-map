package ingestion

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/madsan/intelligence/internal/config"
	venrich "github.com/madsan/intelligence/internal/enrichment/vessel"
)

// VesselEnrichBatchOptions controls a one-off or scheduled vessel enrichment run.
type VesselEnrichBatchOptions struct {
	Limit   int
	Force   bool
	IMO     string
	DryRun  bool
	RateLim time.Duration
}

// VesselEnrichBatchResult summarizes a batch enrichment run.
type VesselEnrichBatchResult struct {
	Enriched  int
	Skipped   int
	Uncertain int
	Errors    []string
}

// RunVesselEnrichmentBatch enriches vessels from ShipVault into madsan_db.vessel_enrichment.
func RunVesselEnrichmentBatch(ctx context.Context, pool *pgxpool.Pool, cfg config.Config, log zerolog.Logger, opts VesselEnrichBatchOptions) (VesselEnrichBatchResult, error) {
	var out VesselEnrichBatchResult
	if !venrich.ShipVaultConfigured(cfg) {
		return out, fmt.Errorf("ShipVault not configured — set MADSAN_SHIPVAULT_ENABLED and SHIPVAULT_REFRESH_TOKEN or SHIPVAULT_BEARER_TOKEN")
	}
	svc, err := venrich.NewShipVaultService(cfg, log)
	if err != nil {
		return out, err
	}
	if svc == nil {
		return out, fmt.Errorf("ShipVault credentials missing")
	}

	limit := opts.Limit
	if limit <= 0 {
		limit = cfg.VesselEnrichmentBatch
	}
	if limit <= 0 {
		limit = defaultEnrichmentBatchSize
	}
	rate := opts.RateLim
	if rate <= 0 {
		rate = time.Duration(cfg.VesselEnrichmentRateMS) * time.Millisecond
	}
	if rate <= 0 {
		rate = defaultEnrichmentRateLimit
	}

	provider := venrich.DefaultChain(venrich.Options{
		ShipVaultService: svc,
		StaleDays:        cfg.VesselEnrichmentStaleDays,
	})

	var rows interface {
		Next() bool
		Scan(dest ...any) error
		Close()
		Err() error
	}
	if opts.IMO != "" {
		rows, err = pool.Query(ctx, venrich.SelectVesselByIMOSQL(), opts.IMO)
	} else {
		rows, err = pool.Query(ctx, venrich.SelectVesselsSQL(opts.Force), limit)
	}
	if err != nil {
		return out, err
	}
	defer rows.Close()

	s := &Service{pool: pool, cfg: cfg}
	sourceID, _ := s.ensureSource(ctx, vesselEnrichmentSourceSlug)

	for rows.Next() {
		var vesselID uuid.UUID
		var mmsi, imo, name string
		var lastSeen *time.Time
		var hasRow bool
		var staleAfter *time.Time
		if err := rows.Scan(&vesselID, &mmsi, &imo, &name, &lastSeen, &hasRow, &staleAfter); err != nil {
			out.Errors = append(out.Errors, err.Error())
			continue
		}
		if !opts.Force && !venrich.NeedsEnrichment(hasRow, staleAfter, time.Now()) {
			out.Skipped++
			continue
		}
		if imo == "" {
			out.Skipped++
			continue
		}

		res, err := provider.Enrich(ctx, mmsi, imo, name)
		if err != nil {
			out.Errors = append(out.Errors, fmt.Sprintf("imo=%s mmsi=%s: %v", imo, mmsi, err))
			continue
		}
		if res.StaleAfter.IsZero() {
			res.StaleAfter = venrich.StaleAfterFromTier(res.Tier, cfg.VesselEnrichmentStaleDays, 7)
		}
		if res.FetchedAt.IsZero() {
			res.FetchedAt = time.Now().UTC()
		}

		if opts.DryRun {
			log.Info().
				Str("imo", imo).Str("mmsi", mmsi).Str("name", name).
				Str("owner", res.OwnerName).Str("operator", res.OperatorName).
				Str("source", res.Source).Str("tier", res.Tier).
				Msg("dry-run vessel enrichment")
			out.Enriched++
			time.Sleep(rate)
			continue
		}

		ownerCompanyID, operatorCompanyID, err := s.linkVesselCompanies(ctx, vesselID, res, sourceID)
		if err != nil {
			out.Errors = append(out.Errors, fmt.Sprintf("imo=%s link companies: %v", imo, err))
		}
		if err := s.upsertVesselEnrichment(ctx, vesselID, mmsi, ownerCompanyID, operatorCompanyID, res); err != nil {
			out.Errors = append(out.Errors, fmt.Sprintf("imo=%s upsert: %v", imo, err))
			continue
		}
		if err := s.attachVesselEnrichmentEvidence(ctx, sourceID, vesselID, res); err != nil {
			out.Errors = append(out.Errors, fmt.Sprintf("imo=%s evidence: %v", imo, err))
		}
		if res.Implemented() && res.Confidence < 50 {
			if s.enqueueVesselEnrichmentReview(ctx, vesselID, mmsi, res) == nil {
				out.Uncertain++
			}
		}
		out.Enriched++
		time.Sleep(rate)
	}
	return out, rows.Err()
}
