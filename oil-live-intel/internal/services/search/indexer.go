package search

import (
	"context"
	"fmt"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// IndexerStats holds per-index counts for one sync pass (full or incremental).
type IndexerStats struct {
	Index   string
	Fetched int
	Indexed int
	Failed  int
	Errors  []BulkItemError
}

// Cursors tracks the high-water mark for incremental sync per index.
// Cargo/companies/terminals use updated_at; oil_vessels does not have an
// updated_at column with a meaningful default, so it uses updated_at too
// (column exists per migration 001).
type Cursors struct {
	Cargo     time.Time
	Companies time.Time
	Terminals time.Time
	Vessels   time.Time
}

// SyncAll runs one indexing pass over all four indices. When incremental is
// false (the cold-start path), every row is sent; when true, only rows whose
// updated_at >= the corresponding cursor entry are sent. Cursors are advanced
// in place to the most-recent updated_at seen.
//
// The function is intentionally bounded — it does NOT retry on partial
// failures; the caller (the worker ticker) will run it again.
func SyncAll(ctx context.Context, pool *pgxpool.Pool, c Client, batchSize int, cursors *Cursors, incremental bool) ([]IndexerStats, error) {
	if batchSize <= 0 {
		batchSize = 500
	}
	if cursors == nil {
		cursors = &Cursors{}
	}
	stats := make([]IndexerStats, 0, 4)
	cargoStats, err := syncCargo(ctx, pool, c, batchSize, &cursors.Cargo, incremental)
	if err != nil {
		return stats, fmt.Errorf("sync cargo: %w", err)
	}
	stats = append(stats, cargoStats)
	coStats, err := syncCompanies(ctx, pool, c, batchSize, &cursors.Companies, incremental)
	if err != nil {
		return stats, fmt.Errorf("sync companies: %w", err)
	}
	stats = append(stats, coStats)
	termStats, err := syncTerminals(ctx, pool, c, batchSize, &cursors.Terminals, incremental)
	if err != nil {
		return stats, fmt.Errorf("sync terminals: %w", err)
	}
	stats = append(stats, termStats)
	vesStats, err := syncVessels(ctx, pool, c, batchSize, &cursors.Vessels, incremental)
	if err != nil {
		return stats, fmt.Errorf("sync vessels: %w", err)
	}
	stats = append(stats, vesStats)
	return stats, nil
}

func flushIfFull(ctx context.Context, c Client, index string, batch []BulkDoc, batchSize int, stats *IndexerStats) ([]BulkDoc, error) {
	if len(batch) < batchSize {
		return batch, nil
	}
	return flush(ctx, c, index, batch, stats)
}

func flush(ctx context.Context, c Client, index string, batch []BulkDoc, stats *IndexerStats) ([]BulkDoc, error) {
	if len(batch) == 0 {
		return batch, nil
	}
	res, err := IndexBatch(ctx, c, index, batch)
	if err != nil {
		return nil, err
	}
	stats.Indexed += res.Indexed
	stats.Failed += res.Failed
	if len(res.Errors) > 0 {
		stats.Errors = append(stats.Errors, res.Errors...)
	}
	return batch[:0], nil
}

func syncCargo(ctx context.Context, pool *pgxpool.Pool, c Client, batchSize int, cursor *time.Time, incremental bool) (IndexerStats, error) {
	stats := IndexerStats{Index: IndexCargo}
	const query = `
	SELECT id::text,
	       synthetic_bol_id,
	       recipe,
	       bol_tier,
	       commodity_family,
	       commodity_description,
	       discharge_hint,
	       load_country,
	       discharge_country,
	       shipper_name,
	       consignee_name,
	       vessel_name,
	       shipper_lei,
	       consignee_lei,
	       shipper_sanctions_status,
	       consignee_sanctions_status,
	       event_date,
	       confidence,
	       triangulation_score,
	       volume_best_estimate,
	       corridor_load_lat,
	       corridor_load_lng,
	       corridor_discharge_lat,
	       corridor_discharge_lng,
	       updated_at
	FROM meridian_cargo_records
	WHERE ($1::timestamptz IS NULL OR updated_at >= $1)
	ORDER BY updated_at ASC
	`
	var sinceArg any
	if incremental && !cursor.IsZero() {
		sinceArg = *cursor
	}
	rows, err := pool.Query(ctx, query, sinceArg)
	if err != nil {
		return stats, err
	}
	defer rows.Close()

	batch := make([]BulkDoc, 0, batchSize)
	for rows.Next() {
		var (
			id, syntheticID, recipe, bolTier                                                                              *string
			commodityFamily, commodityDescription, dischargeHint                                                          *string
			loadCountry, dischargeCountry                                                                                 *string
			shipperName, consigneeName, vesselName                                                                        *string
			shipperLEI, consigneeLEI                                                                                      *string
			shipperSanctions, consigneeSanctions                                                                          *string
			eventDate                                                                                                     *time.Time
			confidence, triangulation, volumeBest                                                                         *float64
			corridorLoadLat, corridorLoadLng, corridorDischargeLat, corridorDischargeLng                                  *float64
			updatedAt                                                                                                     time.Time
		)
		if err := rows.Scan(
			&id, &syntheticID, &recipe, &bolTier,
			&commodityFamily, &commodityDescription, &dischargeHint,
			&loadCountry, &dischargeCountry,
			&shipperName, &consigneeName, &vesselName,
			&shipperLEI, &consigneeLEI,
			&shipperSanctions, &consigneeSanctions,
			&eventDate,
			&confidence, &triangulation, &volumeBest,
			&corridorLoadLat, &corridorLoadLng, &corridorDischargeLat, &corridorDischargeLng,
			&updatedAt,
		); err != nil {
			return stats, err
		}
		stats.Fetched++
		if updatedAt.After(*cursor) {
			*cursor = updatedAt
		}
		doc := map[string]any{
			"id":                         strDeref(id),
			"synthetic_bol_id":           strDeref(syntheticID),
			"recipe":                     strDeref(recipe),
			"bol_tier":                   strDeref(bolTier),
			"commodity_family":           strDeref(commodityFamily),
			"commodity_description":      strDeref(commodityDescription),
			"discharge_hint":             strDeref(dischargeHint),
			"load_country":               strDeref(loadCountry),
			"discharge_country":          strDeref(dischargeCountry),
			"shipper_name":               strDeref(shipperName),
			"consignee_name":             strDeref(consigneeName),
			"vessel_name":                strDeref(vesselName),
			"shipper_lei":                strDeref(shipperLEI),
			"consignee_lei":              strDeref(consigneeLEI),
			"shipper_sanctions_status":   strDeref(shipperSanctions),
			"consignee_sanctions_status": strDeref(consigneeSanctions),
			"confidence":                 floatDerefOrZero(confidence),
			"triangulation_score":        floatDerefOrZero(triangulation),
			"volume_best_estimate":       floatDerefOrZero(volumeBest),
		}
		if eventDate != nil {
			doc["event_date"] = eventDate.UTC().Format(time.RFC3339)
		}
		if corridorLoadLat != nil && corridorLoadLng != nil {
			doc["corridor_load"] = map[string]any{"lat": *corridorLoadLat, "lon": *corridorLoadLng}
		}
		if corridorDischargeLat != nil && corridorDischargeLng != nil {
			doc["corridor_discharge"] = map[string]any{"lat": *corridorDischargeLat, "lon": *corridorDischargeLng}
		}
		batch = append(batch, BulkDoc{ID: strDeref(id), Body: doc})
		next, err := flushIfFull(ctx, c, IndexCargo, batch, batchSize, &stats)
		if err != nil {
			return stats, err
		}
		batch = next
	}
	if err := rows.Err(); err != nil {
		return stats, err
	}
	if _, err := flush(ctx, c, IndexCargo, batch, &stats); err != nil {
		return stats, err
	}
	return stats, nil
}

func syncCompanies(ctx context.Context, pool *pgxpool.Pool, c Client, batchSize int, cursor *time.Time, incremental bool) (IndexerStats, error) {
	stats := IndexerStats{Index: IndexCompanies}
	const query = `
	SELECT id::text, name, normalized_name, country, sanctions_status, lei, wikidata_qid, confidence, updated_at
	FROM oil_companies
	WHERE ($1::timestamptz IS NULL OR updated_at >= $1)
	ORDER BY updated_at ASC
	`
	var sinceArg any
	if incremental && !cursor.IsZero() {
		sinceArg = *cursor
	}
	rows, err := pool.Query(ctx, query, sinceArg)
	if err != nil {
		return stats, err
	}
	defer rows.Close()
	batch := make([]BulkDoc, 0, batchSize)
	for rows.Next() {
		var (
			id, name, normalized, country, sanctions, lei, wikidata *string
			confidence                                              *float64
			updatedAt                                               time.Time
		)
		if err := rows.Scan(&id, &name, &normalized, &country, &sanctions, &lei, &wikidata, &confidence, &updatedAt); err != nil {
			return stats, err
		}
		stats.Fetched++
		if updatedAt.After(*cursor) {
			*cursor = updatedAt
		}
		batch = append(batch, BulkDoc{
			ID: strDeref(id),
			Body: map[string]any{
				"id":               strDeref(id),
				"name":             strDeref(name),
				"normalized_name":  strDeref(normalized),
				"country":          strDeref(country),
				"sanctions_status": strDeref(sanctions),
				"lei":              strDeref(lei),
				"wikidata_qid":     strDeref(wikidata),
				"confidence":       floatDerefOrZero(confidence),
			},
		})
		next, err := flushIfFull(ctx, c, IndexCompanies, batch, batchSize, &stats)
		if err != nil {
			return stats, err
		}
		batch = next
	}
	if err := rows.Err(); err != nil {
		return stats, err
	}
	if _, err := flush(ctx, c, IndexCompanies, batch, &stats); err != nil {
		return stats, err
	}
	return stats, nil
}

func syncTerminals(ctx context.Context, pool *pgxpool.Pool, c Client, batchSize int, cursor *time.Time, incremental bool) (IndexerStats, error) {
	stats := IndexerStats{Index: IndexTerminals}
	const query = `
	SELECT id::text, name, operator_name, country, products,
	       CASE WHEN geom IS NOT NULL THEN ST_Y(ST_Centroid(geom)) END AS lat,
	       CASE WHEN geom IS NOT NULL THEN ST_X(ST_Centroid(geom)) END AS lng,
	       updated_at
	FROM oil_terminals
	WHERE ($1::timestamptz IS NULL OR updated_at >= $1)
	ORDER BY updated_at ASC
	`
	var sinceArg any
	if incremental && !cursor.IsZero() {
		sinceArg = *cursor
	}
	rows, err := pool.Query(ctx, query, sinceArg)
	if err != nil {
		return stats, err
	}
	defer rows.Close()
	batch := make([]BulkDoc, 0, batchSize)
	for rows.Next() {
		var (
			id, name, operator, country *string
			products                    []string
			lat, lng                    *float64
			updatedAt                   time.Time
		)
		if err := rows.Scan(&id, &name, &operator, &country, &products, &lat, &lng, &updatedAt); err != nil {
			return stats, err
		}
		stats.Fetched++
		if updatedAt.After(*cursor) {
			*cursor = updatedAt
		}
		doc := map[string]any{
			"id":            strDeref(id),
			"name":          strDeref(name),
			"operator_name": strDeref(operator),
			"country":       strDeref(country),
			"products":      products,
		}
		if lat != nil && lng != nil {
			doc["location"] = map[string]any{"lat": *lat, "lon": *lng}
		}
		batch = append(batch, BulkDoc{ID: strDeref(id), Body: doc})
		next, err := flushIfFull(ctx, c, IndexTerminals, batch, batchSize, &stats)
		if err != nil {
			return stats, err
		}
		batch = next
	}
	if err := rows.Err(); err != nil {
		return stats, err
	}
	if _, err := flush(ctx, c, IndexTerminals, batch, &stats); err != nil {
		return stats, err
	}
	return stats, nil
}

func syncVessels(ctx context.Context, pool *pgxpool.Pool, c Client, batchSize int, cursor *time.Time, incremental bool) (IndexerStats, error) {
	stats := IndexerStats{Index: IndexVessels}
	// oil_vessels has updated_at but no flag column; we use the metadata->>'flag'
	// when available, else NULL.
	const query = `
	SELECT mmsi, imo, name, tanker_class,
	       (metadata->>'flag') AS flag,
	       updated_at
	FROM oil_vessels
	WHERE ($1::timestamptz IS NULL OR updated_at >= $1)
	ORDER BY updated_at ASC
	`
	var sinceArg any
	if incremental && !cursor.IsZero() {
		sinceArg = *cursor
	}
	rows, err := pool.Query(ctx, query, sinceArg)
	if err != nil {
		return stats, err
	}
	defer rows.Close()
	batch := make([]BulkDoc, 0, batchSize)
	for rows.Next() {
		var (
			mmsi                    int64
			imo, name, klass, flag  *string
			updatedAt               time.Time
		)
		if err := rows.Scan(&mmsi, &imo, &name, &klass, &flag, &updatedAt); err != nil {
			return stats, err
		}
		stats.Fetched++
		if updatedAt.After(*cursor) {
			*cursor = updatedAt
		}
		doc := map[string]any{
			"mmsi":         strconv.FormatInt(mmsi, 10),
			"imo":          strDeref(imo),
			"name":         strDeref(name),
			"tanker_class": strDeref(klass),
			"flag":         strDeref(flag),
		}
		batch = append(batch, BulkDoc{ID: strconv.FormatInt(mmsi, 10), Body: doc})
		next, err := flushIfFull(ctx, c, IndexVessels, batch, batchSize, &stats)
		if err != nil {
			return stats, err
		}
		batch = next
	}
	if err := rows.Err(); err != nil {
		return stats, err
	}
	if _, err := flush(ctx, c, IndexVessels, batch, &stats); err != nil {
		return stats, err
	}
	return stats, nil
}

func strDeref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func floatDerefOrZero(f *float64) float64 {
	if f == nil {
		return 0
	}
	return *f
}
