package main

import (
	"context"
	"flag"
	"fmt"

	"github.com/rs/zerolog/log"

	"github.com/madsan/intelligence/internal/config"
	"github.com/madsan/intelligence/internal/database"
	"github.com/madsan/intelligence/internal/ingestion"
)

func main() {
	dryRun := flag.Bool("dry-run", false, "print planned updates without writing")
	limit := flag.Int("limit", 0, "max rows to scan (0 = all)")
	flag.Parse()

	cfg := config.Load()
	ctx := context.Background()
	pool, err := database.ConnectURL(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatal().Err(err).Msg("db connect")
	}
	defer pool.Close()

	query := `
		SELECT id, asset_type, raw_source_payload
		FROM assets
		WHERE ` + ingestion.PetroleumProvenanceWhereSQL + `
		  AND raw_source_payload IS NOT NULL
		ORDER BY id`
	if *limit > 0 {
		query += fmt.Sprintf(" LIMIT %d", *limit)
	}

	rows, err := pool.Query(ctx, query)
	if err != nil {
		log.Fatal().Err(err).Msg("query assets")
	}
	defer rows.Close()

	var scanned, changed, skipped int
	type change struct {
		id      string
		from    string
		to      string
	}
	var pending []change

	for rows.Next() {
		var id string
		var currentType string
		var raw []byte
		if err := rows.Scan(&id, &currentType, &raw); err != nil {
			log.Warn().Err(err).Msg("scan row")
			continue
		}
		scanned++
		mapped, err := ingestion.ResolvePetroleumAssetType(raw)
		if err != nil {
			skipped++
			continue
		}
		if mapped == currentType {
			continue
		}
		changed++
		pending = append(pending, change{id: id, from: currentType, to: mapped})
	}
	if err := rows.Err(); err != nil {
		log.Fatal().Err(err).Msg("iterate rows")
	}

	if *dryRun {
		for _, c := range pending {
			fmt.Printf("dry-run: asset %s %s -> %s\n", c.id, c.from, c.to)
		}
		log.Info().
			Int("scanned", scanned).
			Int("would_update", changed).
			Int("skipped", skipped).
			Bool("dry_run", true).
			Msg("petroleum asset type backfill complete")
		return
	}

	updated := 0
	for _, c := range pending {
		tag, err := pool.Exec(ctx, `
			UPDATE assets SET asset_type = $2, updated_at = now()
			WHERE id = $1::uuid AND (`+ingestion.PetroleumProvenanceWhereSQL+`)
		`, c.id, c.to)
		if err != nil {
			log.Warn().Err(err).Str("id", c.id).Msg("update failed")
			continue
		}
		if tag.RowsAffected() > 0 {
			updated++
		}
	}

	_, _ = pool.Exec(ctx, `REFRESH MATERIALIZED VIEW CONCURRENTLY map_energy_assets`)
	_, err = pool.Exec(ctx, `REFRESH MATERIALIZED VIEW map_energy_assets`)
	if err != nil {
		log.Warn().Err(err).Msg("refresh map_energy_assets")
	}
	_, _ = pool.Exec(ctx, `REFRESH MATERIALIZED VIEW map_metals_assets`)

	log.Info().
		Int("scanned", scanned).
		Int("updated", updated).
		Int("skipped", skipped).
		Msg("petroleum asset type backfill complete")
}
