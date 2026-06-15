package ingestion

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/madsan/intelligence/internal/config"
	"github.com/madsan/intelligence/internal/database"
)

const assetEnrichProgressEvery = 25

// terminalEnrichAssetTypes selects petroleum storage assets for enrichment.
// Individual OSM man_made=storage_tank features import as tank_farm (storage_terminals layer), not tank.
// Curated oil_terminals rows enrich directly after legacy import; until then proximity match uses mining_db.
var terminalEnrichAssetTypes = []string{"tank_farm", "tank", "storage", "terminal", "refinery"}

// AssetEnrichBatchOptions controls a one-off or scheduled tank/terminal enrichment run.
type AssetEnrichBatchOptions struct {
	Limit    int
	Force    bool
	DryRun   bool
	LegacyID string
	AssetID  string
	Quiet    bool
}

// AssetEnrichBatchResult summarizes a batch enrichment run.
type AssetEnrichBatchResult struct {
	Enriched      int
	Skipped       int
	Relationships int
	Evidence      int
	Errors        []string
}

// RunAssetEnrichmentBatch reconciles OSM tags and curated oil_terminals into asset_enrichment.
func RunAssetEnrichmentBatch(ctx context.Context, pool *pgxpool.Pool, cfg config.Config, log zerolog.Logger, opts AssetEnrichBatchOptions) (AssetEnrichBatchResult, error) {
	var out AssetEnrichBatchResult
	limit := opts.Limit
	if limit <= 0 {
		limit = terminalEnrichmentBatch
	}
	s := &Service{pool: pool, cfg: cfg}
	if cfg.LegacyDBURL != "" {
		if legacy, lerr := database.ConnectURL(ctx, cfg.LegacyDBURL); lerr == nil {
			s.legacyPool = legacy
			defer legacy.Close()
		} else if !opts.Quiet {
			log.Warn().Err(lerr).Msg("asset enrichment: legacy db unavailable for oil_terminals proximity")
		}
	}
	sourceID, _ := s.ensureSource(ctx, terminalEnrichmentSource)

	if opts.AssetID != "" {
		id, err := uuid.Parse(strings.TrimSpace(opts.AssetID))
		if err != nil {
			return out, fmt.Errorf("invalid asset id: %w", err)
		}
		row, err := loadTerminalEnrichmentRow(ctx, pool, id)
		if err != nil {
			return out, err
		}
		if err := enrichOneTerminalAsset(ctx, s, sourceID, log, opts, &out, row); err != nil && out.Enriched == 0 {
			return out, err
		}
		logAssetEnrichProgress(log, opts.Quiet, 1, &out)
		return out, nil
	}

	if !opts.Quiet {
		log.Info().
			Int("limit", limit).
			Bool("force", opts.Force).
			Bool("dry_run", opts.DryRun).
			Str("legacy_id", opts.LegacyID).
			Msg("asset enrichment batch starting")
	}

	query, args := selectTerminalEnrichmentAssetsSQL(opts, limit)
	rows, err := pool.Query(ctx, query, args...)
	if err != nil {
		return out, err
	}
	defer rows.Close()

	processed := 0
	for rows.Next() {
		var row terminalEnrichmentRow
		var raw []byte
		if err := rows.Scan(&row.AssetID, &row.Name, &row.AssetType, &row.Country, &row.Latitude, &row.Longitude, &row.LegacyTable, &raw, &row.Commodities); err != nil {
			out.Errors = append(out.Errors, err.Error())
			processed++
			logAssetEnrichProgress(log, opts.Quiet, processed, &out)
			continue
		}
		if len(raw) > 0 {
			_ = json.Unmarshal(raw, &row.RawPayload)
		}
		processed++
		if err := enrichOneTerminalAsset(ctx, s, sourceID, log, opts, &out, row); err != nil {
			out.Errors = append(out.Errors, fmt.Sprintf("%s: %v", row.AssetID, err))
		}
		logAssetEnrichProgress(log, opts.Quiet, processed, &out)
	}
	return out, rows.Err()
}

func selectTerminalEnrichmentAssetsSQL(opts AssetEnrichBatchOptions, limit int) (string, []any) {
	types := "'" + strings.Join(terminalEnrichAssetTypes, "','") + "'"
	q := fmt.Sprintf(`
		SELECT a.id, a.name, a.asset_type, COALESCE(a.country_code,''),
		       a.latitude, a.longitude, COALESCE(a.legacy_table,''), a.raw_source_payload, a.commodities_supported
		FROM assets a
		LEFT JOIN asset_enrichment ae ON ae.asset_id = a.id
		WHERE a.asset_type IN (%s)
		  AND a.latitude IS NOT NULL AND a.longitude IS NOT NULL
	`, types)
	args := []any{}
	argN := 1
	if !opts.Force {
		q += ` AND (ae.asset_id IS NULL OR ae.stale_after IS NULL OR ae.stale_after < now())`
	}
	if opts.LegacyID != "" {
		q += fmt.Sprintf(` AND a.legacy_id = $%d`, argN)
		args = append(args, strings.TrimSpace(opts.LegacyID))
		argN++
	}
	q += fmt.Sprintf(` ORDER BY ae.fetched_at NULLS FIRST, a.updated_at DESC LIMIT $%d`, argN)
	args = append(args, limit)
	return q, args
}

func loadTerminalEnrichmentRow(ctx context.Context, pool *pgxpool.Pool, assetID uuid.UUID) (terminalEnrichmentRow, error) {
	var row terminalEnrichmentRow
	var raw []byte
	err := pool.QueryRow(ctx, `
		SELECT a.id, a.name, a.asset_type, COALESCE(a.country_code,''),
		       a.latitude, a.longitude, COALESCE(a.legacy_table,''), a.raw_source_payload, a.commodities_supported
		FROM assets a
		WHERE a.id = $1
	`, assetID).Scan(&row.AssetID, &row.Name, &row.AssetType, &row.Country, &row.Latitude, &row.Longitude, &row.LegacyTable, &raw, &row.Commodities)
	if err != nil {
		return row, err
	}
	if len(raw) > 0 {
		_ = json.Unmarshal(raw, &row.RawPayload)
	}
	return row, nil
}

func enrichOneTerminalAsset(ctx context.Context, s *Service, sourceID uuid.UUID, log zerolog.Logger, opts AssetEnrichBatchOptions, out *AssetEnrichBatchResult, row terminalEnrichmentRow) error {
	if !opts.Quiet {
		log.Info().
			Str("asset_id", row.AssetID.String()).
			Str("name", row.Name).
			Str("type", row.AssetType).
			Msg("asset enrich")
	}
	result, err := s.reconcileTerminalEnrichment(ctx, row)
	if err != nil {
		return err
	}
	if result == nil {
		out.Skipped++
		return nil
	}
	if result.OperatorName == "" && result.CapacityVal == nil && result.OilTerminalID == "" {
		out.Skipped++
		if !opts.Quiet {
			log.Info().Str("asset_id", row.AssetID.String()).Msg("asset enrich skipped_no_data")
		}
		return nil
	}
	if opts.DryRun {
		out.Enriched++
		if !opts.Quiet {
			log.Info().
				Str("asset_id", row.AssetID.String()).
				Str("operator", result.OperatorName).
				Str("tier", result.Tier).
				Msg("asset enrich dry_run")
		}
		return nil
	}
	_, rels, ev, err := s.persistTerminalEnrichment(ctx, sourceID, row, result)
	if err != nil {
		return err
	}
	out.Enriched++
	out.Relationships += rels
	out.Evidence += ev
	return nil
}

func logAssetEnrichProgress(log zerolog.Logger, quiet bool, processed int, out *AssetEnrichBatchResult) {
	if quiet || processed%assetEnrichProgressEvery != 0 {
		return
	}
	log.Info().
		Int("processed", processed).
		Int("enriched", out.Enriched).
		Int("skipped", out.Skipped).
		Int("relationships", out.Relationships).
		Msg("asset enrichment progress")
}
