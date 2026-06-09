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

// One-shot backfill: copy LineString geometry from legacy petroleum_osm_features into pipeline_graph_edges.
func main() {
	limit := flag.Int("limit", 0, "max pipeline rows (0 = all)")
	batch := flag.Int("batch", 500, "batch size")
	flag.Parse()

	cfg := config.Load()
	ctx := context.Background()
	madsan, err := database.ConnectURL(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatal().Err(err).Msg("madsan db connect")
	}
	defer madsan.Close()
	if cfg.LegacyDBURL == "" {
		log.Fatal().Msg("LEGACY_DATABASE_URL not configured")
	}
	legacy, err := database.ConnectURL(ctx, cfg.LegacyDBURL)
	if err != nil {
		log.Fatal().Err(err).Msg("legacy db connect")
	}
	defer legacy.Close()

	svc := ingestion.New(madsan, cfg)
	offset := 0
	written := 0
	for {
		if *limit > 0 && written >= *limit {
			break
		}
		lim := *batch
		if *limit > 0 && written+lim > *limit {
			lim = *limit - written
		}
		rows, err := legacy.Query(ctx, `
			SELECT id, layer_id, tags,
			       ST_Y(ST_PointOnSurface(geom)) AS latitude,
			       ST_X(ST_PointOnSurface(geom)) AS longitude,
			       ST_AsEWKB(geom) AS geom_wkb
			FROM petroleum_osm_features
			WHERE geom IS NOT NULL AND layer_id = 'pipelines'
			ORDER BY id OFFSET $1 LIMIT $2`, offset, lim)
		if err != nil {
			log.Fatal().Err(err).Msg("legacy query")
		}
		n := 0
		for rows.Next() {
			var id int64
			var layerID string
			var tags any
			var lat, lon float64
			var wkb []byte
			if err := rows.Scan(&id, &layerID, &tags, &lat, &lon, &wkb); err != nil {
				rows.Close()
				log.Fatal().Err(err).Msg("scan")
			}
			rec := ingestion.BackfillPipelineRecord(id, layerID, tags, lat, lon, wkb)
			if err := svc.UpsertPipelineEdge(ctx, rec); err != nil {
				log.Warn().Err(err).Int64("id", id).Msg("skip row")
				continue
			}
			written++
			n++
		}
		rows.Close()
		if n == 0 {
			break
		}
		offset += n
		if n < lim {
			break
		}
	}
	fmt.Printf("pipeline_graph_edges backfill written: %d\n", written)
}
