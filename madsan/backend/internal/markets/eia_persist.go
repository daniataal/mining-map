package markets

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PersistDailySpots upserts EIA daily WTI/Brent spot rows into prices (idempotent per symbol+period).
func PersistDailySpots(ctx context.Context, pool *pgxpool.Pool, apiKey string, client *http.Client) (int, error) {
	if pool == nil || apiKey == "" {
		return 0, fmt.Errorf("pool and EIA_API_KEY required")
	}
	cache := newEIACache()
	spots, err := cache.get(apiKey, client)
	if err != nil {
		return 0, err
	}
	var sourceID uuid.UUID
	_ = pool.QueryRow(ctx, `
		INSERT INTO sources (source_name, slug, source_type, source_category, license, commercial_use_ok, reliability_score)
		VALUES ('EIA open data daily spot', 'eia_daily_spot', 'api', 'market_data', 'open_data', true, 85)
		ON CONFLICT (source_name) DO UPDATE SET slug = COALESCE(sources.slug, EXCLUDED.slug)
		RETURNING id
	`).Scan(&sourceID)
	if sourceID == uuid.Nil {
		_ = pool.QueryRow(ctx, `SELECT id FROM sources WHERE slug = 'eia_daily_spot' LIMIT 1`).Scan(&sourceID)
	}

	written := 0
	for series, meta := range eiaSpotSeries {
		spot, ok := spots[series]
		if !ok || spot.Price <= 0 {
			continue
		}
		observed := spot.Period
		if observed.IsZero() {
			observed = time.Now().UTC()
		}
		raw, _ := json.Marshal(map[string]any{
			"eia_series": series,
			"symbol":     meta.Symbol,
			"label":      meta.Label,
			"tier":       tierEIAOpenData,
		})
		tag, err := pool.Exec(ctx, `
			INSERT INTO prices (location_name, price, currency, unit, price_type, observed_at, source_id, confidence_score, raw_payload)
			VALUES ($1, $2, 'USD', '/bbl', 'eia_spot', $3, $4, 90, $5)
			ON CONFLICT (location_name, price_type, observed_at) WHERE price_type = 'eia_spot'
			DO UPDATE SET price = EXCLUDED.price, raw_payload = EXCLUDED.raw_payload
		`, meta.Symbol, spot.Price, observed, sourceID, raw)
		if err != nil {
			return written, err
		}
		if tag.RowsAffected() > 0 {
			written++
		}
	}
	return written, nil
}
