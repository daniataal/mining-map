package ingestion

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/madsan/intelligence/internal/config"
	venrich "github.com/madsan/intelligence/internal/enrichment/vessel"
	sv "github.com/madsan/intelligence/internal/enrichment/vessel/shipvault"
)

const vesselEnrichProgressEvery = 10

// VesselEnrichBatchOptions controls a one-off or scheduled vessel enrichment run.
type VesselEnrichBatchOptions struct {
	Limit         int
	Force         bool
	IMO           string
	DryRun        bool
	SkipCompanies bool
	SkipYards     bool
	RateLim       time.Duration
	Quiet         bool // suppress per-vessel and periodic progress logs (CLI default is verbose)
}

// VesselEnrichBatchResult summarizes a batch enrichment run.
type VesselEnrichBatchResult struct {
	Enriched  int
	Skipped   int
	Uncertain int
	Companies int
	Yards     int
	Errors    []string
}

// RunVesselEnrichmentBatch enriches vessels from ShipVault into madsan_db registry tables.
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
	s := &Service{pool: pool, cfg: cfg}
	sourceID, _ := s.ensureSource(ctx, vesselEnrichmentSourceSlug)
	companySeen := make(map[string]struct{})
	yardSeen := make(map[string]struct{})

	if opts.IMO != "" {
		if err := runSingleIMOEnrichment(ctx, s, svc, cfg, log, opts, &out, sourceID, companySeen, yardSeen); err != nil {
			return out, err
		}
		logVesselEnrichProgress(log, opts.Quiet, 1, &out)
		return out, nil
	}

	if !opts.Quiet {
		log.Info().Int("limit", limit).Bool("force", opts.Force).Bool("dry_run", opts.DryRun).Msg("vessel enrichment batch starting")
	}

	rows, err := pool.Query(ctx, venrich.SelectVesselsSQL(opts.Force), limit)
	if err != nil {
		return out, err
	}
	defer rows.Close()

	processed := 0
	for rows.Next() {
		var vesselID uuid.UUID
		var mmsi, imo, name string
		var lastSeen *time.Time
		var hasRow bool
		var staleAfter *time.Time
		if err := rows.Scan(&vesselID, &mmsi, &imo, &name, &lastSeen, &hasRow, &staleAfter); err != nil {
			out.Errors = append(out.Errors, err.Error())
			processed++
			logVesselEnrichProgress(log, opts.Quiet, processed, &out)
			continue
		}
		if !opts.Force && !venrich.NeedsEnrichment(hasRow, staleAfter, time.Now()) {
			out.Skipped++
			processed++
			logVesselStart(log, opts.Quiet, imo, mmsi, name, "skipped_fresh")
			logVesselEnrichProgress(log, opts.Quiet, processed, &out)
			continue
		}
		if imo == "" {
			out.Skipped++
			processed++
			logVesselStart(log, opts.Quiet, imo, mmsi, name, "skipped_no_imo")
			logVesselEnrichProgress(log, opts.Quiet, processed, &out)
			continue
		}
		processed++
		logVesselStart(log, opts.Quiet, imo, mmsi, name, "starting")
		_ = processVesselEnrichment(ctx, s, svc, cfg, log, opts, &out, sourceID, companySeen, yardSeen, vesselID, mmsi, imo, name)
		logVesselEnrichProgress(log, opts.Quiet, processed, &out)
	}
	return out, rows.Err()
}

func runSingleIMOEnrichment(
	ctx context.Context,
	s *Service,
	svc *sv.Service,
	cfg config.Config,
	log zerolog.Logger,
	opts VesselEnrichBatchOptions,
	out *VesselEnrichBatchResult,
	sourceID uuid.UUID,
	companySeen, yardSeen map[string]struct{},
) error {
	var vesselID uuid.UUID
	var mmsi, imo, name string
	var lastSeen *time.Time
	var hasRow bool
	var staleAfter *time.Time
	err := s.pool.QueryRow(ctx, venrich.SelectVesselByIMOSQL(), opts.IMO).Scan(
		&vesselID, &mmsi, &imo, &name, &lastSeen, &hasRow, &staleAfter,
	)
	if err != nil {
		imo = strings.TrimSpace(opts.IMO)
		if imo == "" {
			return fmt.Errorf("imo lookup: %w", err)
		}
		// Smoke-test path: fetch ShipVault even when vessel row is absent (dry-run or --force insert later).
		if !opts.DryRun && !opts.Force {
			return fmt.Errorf("imo %s not in madsan_db.vessels — use --dry-run to smoke-test or ingest vessel first", imo)
		}
	}
	if imo != "" && !opts.Force && hasRow && !venrich.NeedsEnrichment(hasRow, staleAfter, time.Now()) {
		out.Skipped++
		logVesselStart(log, opts.Quiet, imo, mmsi, name, "skipped_fresh")
		return nil
	}
	if imo == "" {
		out.Skipped++
		logVesselStart(log, opts.Quiet, imo, mmsi, name, "skipped_no_imo")
		return nil
	}
	logVesselStart(log, opts.Quiet, imo, mmsi, name, "starting")
	return processVesselEnrichment(ctx, s, svc, cfg, log, opts, out, sourceID, companySeen, yardSeen, vesselID, mmsi, imo, name)
}

func processVesselEnrichment(
	ctx context.Context,
	s *Service,
	svc *sv.Service,
	cfg config.Config,
	log zerolog.Logger,
	opts VesselEnrichBatchOptions,
	out *VesselEnrichBatchResult,
	sourceID uuid.UUID,
	companySeen, yardSeen map[string]struct{},
	vesselID uuid.UUID,
	mmsi, imo, name string,
) error {
	rate := opts.RateLim
	if rate <= 0 {
		rate = time.Duration(cfg.VesselEnrichmentRateMS) * time.Millisecond
	}
	if rate <= 0 {
		rate = defaultEnrichmentRateLimit
	}

	if !opts.Quiet {
		log.Info().Str("imo", imo).Str("mmsi", mmsi).Str("name", name).Msg("fetching ShipVault")
	}
	svResult, err := svc.FetchLive(ctx, imo, mmsi, name)
	if err != nil {
		if !opts.Quiet {
			log.Warn().Str("imo", imo).Str("mmsi", mmsi).Str("name", name).Err(err).Msg("shipvault fetch failed")
		}
		out.Errors = append(out.Errors, fmt.Sprintf("imo=%s mmsi=%s: %v", imo, mmsi, err))
		return nil
	}
	res := venrich.FromShipVaultResult(mmsi, imo, svResult, cfg.VesselEnrichmentStaleDays)
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
			Int("name_history", len(safeNameHistory(svResult))).
			Str("yard_id", safeYardID(svResult)).
			Str("source", res.Source).Str("tier", res.Tier).
			Msg("dry-run vessel enrichment")
		out.Enriched++
		return nil
	}
	if mmsi == "" {
		out.Errors = append(out.Errors, fmt.Sprintf("imo=%s: no mmsi in madsan_db — cannot upsert vessel_enrichment", imo))
		return nil
	}

	ownerCompanyID, operatorCompanyID, err := s.linkVesselCompanies(ctx, vesselID, res, sourceID)
	if err != nil {
		out.Errors = append(out.Errors, fmt.Sprintf("imo=%s link companies: %v", imo, err))
	}
	if err := s.upsertVesselEnrichment(ctx, vesselID, mmsi, ownerCompanyID, operatorCompanyID, res); err != nil {
		out.Errors = append(out.Errors, fmt.Sprintf("imo=%s upsert: %v", imo, err))
		return nil
	}
	if svResult != nil && svResult.Vessel != nil {
		if err := s.upsertVesselNameHistory(ctx, vesselID, mmsi, imo, svResult.Vessel.NameHistory, res.FetchedAt); err != nil {
			out.Errors = append(out.Errors, fmt.Sprintf("imo=%s name history: %v", imo, err))
		}
	}
	if !opts.SkipCompanies && svResult != nil && svResult.Vessel != nil && svResult.Vessel.OwnerCompanyID != "" {
		cid := svResult.Vessel.OwnerCompanyID
		if _, ok := companySeen[cid]; !ok && !s.shipVaultCompanyFresh(ctx, cid, opts.Force) {
			if cd, cerr := svc.LoadCompanyDetail(ctx, cid); cerr == nil && cd != nil {
				if err := s.upsertShipVaultCompany(ctx, cd, ownerCompanyID, cfg.VesselEnrichmentStaleDays); err != nil {
					out.Errors = append(out.Errors, fmt.Sprintf("company=%s: %v", cid, err))
				} else {
					out.Companies++
				}
			}
		}
		companySeen[cid] = struct{}{}
	}
	if !opts.SkipYards && svResult != nil && svResult.VesselDetail != nil {
		yd := svResult.VesselDetail
		if yd.YardID != "" {
			if _, ok := yardSeen[yd.YardID]; !ok && !s.shipVaultYardFresh(ctx, yd.YardID, opts.Force) {
				if ydetail, yerr := svc.LoadYardDetail(ctx, yd.YardID, yd.YardName); yerr == nil && ydetail != nil {
					if err := s.upsertShipVaultYard(ctx, ydetail, cfg.VesselEnrichmentStaleDays); err != nil {
						out.Errors = append(out.Errors, fmt.Sprintf("yard=%s: %v", yd.YardID, err))
					} else {
						out.Yards++
					}
				}
			}
			yardSeen[yd.YardID] = struct{}{}
			if err := s.upsertVesselYardLink(ctx, vesselID, mmsi, imo, yd, res.FetchedAt); err != nil {
				out.Errors = append(out.Errors, fmt.Sprintf("imo=%s yard link: %v", imo, err))
			}
		}
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
	if !opts.Quiet {
		log.Info().
			Str("imo", imo).Str("mmsi", mmsi).Str("name", name).
			Str("tier", res.Tier).Float64("confidence", res.Confidence).
			Msg("vessel enriched")
	}
	time.Sleep(rate)
	return nil
}

func logVesselStart(log zerolog.Logger, quiet bool, imo, mmsi, name, status string) {
	if quiet {
		return
	}
	log.Info().
		Str("imo", imo).Str("mmsi", mmsi).Str("name", name).Str("status", status).
		Msg("vessel")
}

func logVesselEnrichProgress(log zerolog.Logger, quiet bool, processed int, out *VesselEnrichBatchResult) {
	if quiet || processed%vesselEnrichProgressEvery != 0 {
		return
	}
	log.Info().
		Int("processed", processed).
		Int("enriched", out.Enriched).
		Int("skipped", out.Skipped).
		Int("errors", len(out.Errors)).
		Msg("vessel enrichment progress")
}

func safeNameHistory(r *sv.EnrichmentResult) []sv.NameHistoryEntry {
	if r == nil || r.Vessel == nil {
		return nil
	}
	return r.Vessel.NameHistory
}

func safeYardID(r *sv.EnrichmentResult) string {
	if r == nil || r.VesselDetail == nil {
		return ""
	}
	return r.VesselDetail.YardID
}
