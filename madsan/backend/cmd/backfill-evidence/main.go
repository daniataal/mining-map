package main

import (
	"context"
	"encoding/json"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog/log"

	"github.com/madsan/intelligence/internal/config"
	"github.com/madsan/intelligence/internal/confidence"
	"github.com/madsan/intelligence/internal/database"
	"github.com/madsan/intelligence/internal/ingestion"
)

func main() {
	cfg := config.Load()
	ctx := context.Background()
	pool, err := database.ConnectURL(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatal().Err(err).Msg("db connect")
	}
	defer pool.Close()
	ing := ingestion.New(pool, cfg)

	total := 0
	backfillCompanies(ctx, pool, ing, &total)
	backfillAssets(ctx, pool, ing, &total)
	backfillVessels(ctx, pool, ing, &total)
	log.Info().Int("entities", total).Msg("evidence backfill complete")
}

func backfillCompanies(ctx context.Context, pool *pgxpool.Pool, ing *ingestion.Service, total *int) {
	sourceID, err := ing.EnsureSource(ctx, "bunker_seed")
	if err != nil {
		return
	}
	rows, err := pool.Query(ctx, `
		SELECT id, name, country_code, raw_source_payload
		FROM companies WHERE raw_source_payload IS NOT NULL
	`)
	if err != nil {
		return
	}
	defer rows.Close()
	for rows.Next() {
		var id uuid.UUID
		var name string
		var country *string
		var raw []byte
		if err := rows.Scan(&id, &name, &country, &raw); err != nil {
			continue
		}
		rec := companyRecord(name, country, raw, "bunker_seed")
		score := confidence.Score(50, map[string]bool{"has_coordinates": rec.Latitude != nil})
		if err := ing.AttachEvidence(ctx, sourceID, "company", id, rec, score); err == nil {
			*total++
		}
	}
}

func backfillAssets(ctx context.Context, pool *pgxpool.Pool, ing *ingestion.Service, total *int) {
	sourceID, err := ing.EnsureSource(ctx, "legacy_petroleum_osm_features")
	if err != nil {
		return
	}
	rows, err := pool.Query(ctx, `
		SELECT id, name, country_code, latitude, longitude, raw_source_payload, legacy_table
		FROM assets WHERE raw_source_payload IS NOT NULL
	`)
	if err != nil {
		return
	}
	defer rows.Close()
	for rows.Next() {
		var id uuid.UUID
		var name string
		var country *string
		var lat, lng *float64
		var raw []byte
		var legacyTable *string
		if err := rows.Scan(&id, &name, &country, &lat, &lng, &raw, &legacyTable); err != nil {
			continue
		}
		slug := "legacy_petroleum_osm_features"
		if legacyTable != nil && *legacyTable != "" {
			slug = *legacyTable
		}
		rec := ingestion.NormalizedRecord{EntityType: "asset", Name: name, SourceSlug: slug, Latitude: lat, Longitude: lng, RawPayload: map[string]any{}}
		if country != nil {
			rec.CountryCode = *country
		}
		if len(raw) > 0 {
			_ = json.Unmarshal(raw, &rec.RawPayload)
		}
		score := confidence.Score(45, map[string]bool{"has_coordinates": lat != nil})
		if err := ing.AttachEvidence(ctx, sourceID, "asset", id, rec, score); err == nil {
			*total++
		}
	}
}

func backfillVessels(ctx context.Context, pool *pgxpool.Pool, ing *ingestion.Service, total *int) {
	sourceID, err := ing.EnsureSource(ctx, "legacy_oil_vessels")
	if err != nil {
		return
	}
	rows, err := pool.Query(ctx, `SELECT id, name, mmsi, imo, vessel_type, latitude, longitude FROM vessels`)
	if err != nil {
		return
	}
	defer rows.Close()
	for rows.Next() {
		var id uuid.UUID
		var name, mmsi, imo, vtype *string
		var lat, lng *float64
		if err := rows.Scan(&id, &name, &mmsi, &imo, &vtype, &lat, &lng); err != nil {
			continue
		}
		rec := ingestion.NormalizedRecord{
			EntityType: "vessel",
			Name:       deref(name),
			SourceSlug: "legacy_oil_vessels",
			Latitude:   lat,
			Longitude:  lng,
			RawPayload: map[string]any{"mmsi": deref(mmsi), "imo": deref(imo), "vessel_type": deref(vtype)},
		}
		score := confidence.Score(55, map[string]bool{"has_coordinates": lat != nil})
		if err := ing.AttachEvidence(ctx, sourceID, "vessel", id, rec, score); err == nil {
			*total++
		}
	}
}

func companyRecord(name string, country *string, raw []byte, slug string) ingestion.NormalizedRecord {
	rec := ingestion.NormalizedRecord{EntityType: "company", Name: name, SourceSlug: slug, RawPayload: map[string]any{}}
	if country != nil {
		rec.CountryCode = *country
	}
	if len(raw) > 0 {
		_ = json.Unmarshal(raw, &rec.RawPayload)
		if lat, ok := toFloat(rec.RawPayload["lat"]); ok {
			rec.Latitude = &lat
		}
		if lng, ok := toFloat(rec.RawPayload["lng"]); ok {
			rec.Longitude = &lng
		}
	}
	return rec
}

func toFloat(v any) (float64, bool) {
	switch t := v.(type) {
	case float64:
		return t, true
	case int:
		return float64(t), true
	default:
		return 0, false
	}
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
