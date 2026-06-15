package main

import (
	"context"
	"os"
	"strconv"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog/log"

	"github.com/madsan/intelligence/internal/config"
	"github.com/madsan/intelligence/internal/database"
	"github.com/madsan/intelligence/internal/intelligence"
)

func main() {
	cfg := config.Load()
	ctx := context.Background()
	pool, err := database.ConnectURL(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatal().Err(err).Msg("db connect")
	}
	defer pool.Close()

	limit := 8000
	if v := os.Getenv("MADSAN_SIGNAL_BACKFILL_LIMIT"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			limit = n
		}
	}
	written := backfillCompanies(ctx, pool, limit)
	written += backfillAssets(ctx, pool, limit)
	log.Info().Int("signals_written", written).Msg("import signal backfill complete")
}

func backfillCompanies(ctx context.Context, pool *pgxpool.Pool, limit int) int {
	rows, err := pool.Query(ctx, `
		SELECT c.id, c.confidence_score, c.commodities, count(e.id)::int
		FROM companies c
		LEFT JOIN evidence e ON e.entity_type = 'company' AND e.entity_id = c.id
		GROUP BY c.id
		ORDER BY count(e.id) DESC
		LIMIT $1
	`, limit)
	if err != nil {
		return 0
	}
	defer rows.Close()
	n := 0
	for rows.Next() {
		var id uuid.UUID
		var conf float64
		var commodities []string
		var evCount int
		if rows.Scan(&id, &conf, &commodities, &evCount) != nil {
			continue
		}
		if err := intelligence.PersistImportSnapshot(ctx, pool, id, intelligence.ImportSnapshot{
			EntityType: "company", Commodities: commodities, EvidenceCount: evCount, Confidence: conf,
		}); err == nil {
			n++
		}
	}
	return n
}

func backfillAssets(ctx context.Context, pool *pgxpool.Pool, limit int) int {
	rows, err := pool.Query(ctx, `
		SELECT a.id, a.asset_type, a.confidence_score, a.commodities_supported, count(e.id)::int
		FROM assets a
		LEFT JOIN evidence e ON e.entity_type = 'asset' AND e.entity_id = a.id
		GROUP BY a.id
		ORDER BY count(e.id) DESC
		LIMIT $1
	`, limit)
	if err != nil {
		return 0
	}
	defer rows.Close()
	n := 0
	for rows.Next() {
		var id uuid.UUID
		var assetType string
		var conf float64
		var commodities []string
		var evCount int
		if rows.Scan(&id, &assetType, &conf, &commodities, &evCount) != nil {
			continue
		}
		if err := intelligence.PersistImportSnapshot(ctx, pool, id, intelligence.ImportSnapshot{
			EntityType: "asset", AssetType: assetType, Commodities: commodities,
			EvidenceCount: evCount, Confidence: conf,
		}); err == nil {
			n++
		}
	}
	return n
}
