package ingestion

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"

	"github.com/google/uuid"

	"github.com/madsan/intelligence/internal/sources"
)

// Storage inventory estimation from open data only.
//
// Method (every output carries it):
//  1. OSM storage-tank points (ODbL) are clustered into sites with DBSCAN
//     (~500 m). Tank count per site is real observed data.
//  2. Capacity is a RANGE from industry-typical tank sizes by site scale —
//     OSM rarely carries tank dimensions, so we never output a single number.
//  3. Fill rate is a RANGE anchored at the EIA's published working-storage
//     utilization (~55-75% for US crude/products, EIA storage capacity
//     report). Outside the US the same band is applied as a heuristic and the
//     confidence drops to "low".
//  4. Live EIA weekly stocks give a build/draw trend annotation (US only).
//
// This is deliberately a bounded estimate, not a measurement. Satellite
// floating-roof analysis (the commercial approach) can later tighten bands.

const storageInventoryJobType = "storage_inventory_estimate"

// Per-tank capacity bands (barrels) by site scale are inlined in the SQL:
// >=20 tanks: 50-150 kbbl/tank (major terminal, floating-roof scale),
// >=5 tanks: 20-100 kbbl/tank (mid-size), else 5-50 kbbl/tank (small depot).
const (
	storageFillLow  = 0.55
	storageFillHigh = 0.75
	storageFillSrc  = "EIA working storage utilization reference band (55-75%); non-US sites use the same band as a heuristic"
)

func (s *Service) processStorageInventory(ctx context.Context, jobID uuid.UUID) error {
	started := time.Now()

	trend, trendErr := fetchEIACrudeStockTrend(ctx, s.cfg.EIAAPIKey)

	// Cluster OSM tank points into sites and upsert range estimates in one
	// statement set. ST_ClusterDBSCAN runs on geometry; eps 0.005 deg ~ 500 m.
	tag, err := s.pool.Exec(ctx, `
		WITH tanks AS (
			SELECT id, name, country_code, geom::geometry AS g
			FROM assets
			WHERE asset_type = 'tank_farm' AND geom IS NOT NULL
		),
		clustered AS (
			SELECT *, ST_ClusterDBSCAN(g, eps := 0.005, minpoints := 1) OVER () AS cluster_id
			FROM tanks
		),
		sites AS (
			SELECT
				cluster_id,
				COUNT(*)::int AS tank_count,
				ST_Y(ST_Centroid(ST_Collect(g))) AS lat,
				ST_X(ST_Centroid(ST_Collect(g))) AS lon,
				MODE() WITHIN GROUP (ORDER BY country_code) AS country_code,
				MIN(NULLIF(name,'')) FILTER (WHERE name NOT LIKE 'OSM node%') AS name
			FROM clustered
			GROUP BY cluster_id
		)
		INSERT INTO storage_site_estimates (
			site_key, name, country_code, tank_count, centroid_lat, centroid_lon, geom,
			capacity_bbl_low, capacity_bbl_high, fill_rate_low, fill_rate_high, fill_rate_source,
			inventory_bbl_low, inventory_bbl_high, method, confidence, computed_at
		)
		SELECT
			'osm:' || round(lon::numeric, 4) || ':' || round(lat::numeric, 4),
			COALESCE(name, 'Tank site (' || tank_count || ' tanks)'),
			country_code,
			tank_count,
			lat, lon,
			ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography,
			tank_count * CASE WHEN tank_count >= 20 THEN 50000 WHEN tank_count >= 5 THEN 20000 ELSE 5000 END,
			tank_count * CASE WHEN tank_count >= 20 THEN 150000 WHEN tank_count >= 5 THEN 100000 ELSE 50000 END,
			$1::numeric, $2::numeric, $3,
			tank_count * CASE WHEN tank_count >= 20 THEN 50000 WHEN tank_count >= 5 THEN 20000 ELSE 5000 END * $1::numeric,
			tank_count * CASE WHEN tank_count >= 20 THEN 150000 WHEN tank_count >= 5 THEN 100000 ELSE 50000 END * $2::numeric,
			'osm_tank_cluster_v1: OSM tank count (observed) x typical tank size band x EIA utilization band',
			CASE WHEN country_code = 'US' THEN 'inferred' ELSE 'low' END,
			now()
		FROM sites
		ON CONFLICT (site_key) DO UPDATE SET
			name = EXCLUDED.name,
			country_code = EXCLUDED.country_code,
			tank_count = EXCLUDED.tank_count,
			capacity_bbl_low = EXCLUDED.capacity_bbl_low,
			capacity_bbl_high = EXCLUDED.capacity_bbl_high,
			fill_rate_low = EXCLUDED.fill_rate_low,
			fill_rate_high = EXCLUDED.fill_rate_high,
			fill_rate_source = EXCLUDED.fill_rate_source,
			inventory_bbl_low = EXCLUDED.inventory_bbl_low,
			inventory_bbl_high = EXCLUDED.inventory_bbl_high,
			method = EXCLUDED.method,
			confidence = EXCLUDED.confidence,
			computed_at = now()
	`, storageFillLow, storageFillHigh, storageFillSrc)
	if err != nil {
		return s.finishIntelJob(ctx, jobID, "failed", nil, err)
	}

	report := map[string]any{
		"sites_upserted": tag.RowsAffected(),
		"fill_band":      []float64{storageFillLow, storageFillHigh},
		"duration_ms":    time.Since(started).Milliseconds(),
	}
	if trendErr == nil && trend != nil {
		// Served by the storage summary API from this job's result_report.
		report["us_crude_stock_trend"] = trend
	} else if trendErr != nil {
		report["eia_trend_error"] = trendErr.Error()
	}
	b, _ := json.Marshal(report)
	return s.finishIntelJob(ctx, jobID, "completed", b, nil)
}

// EIACrudeStockTrend annotates whether US commercial crude stocks are building
// or drawing, from the EIA weekly series (open data).
type EIACrudeStockTrend struct {
	LatestKBBL  float64 `json:"latest_kbbl"`
	PrevKBBL    float64 `json:"prev_kbbl"`
	Period      string  `json:"period"`
	Direction   string  `json:"direction"` // building | drawing | flat
	WeeklyDelta float64 `json:"weekly_delta_kbbl"`
}

func fetchEIACrudeStockTrend(ctx context.Context, apiKey string) (*EIACrudeStockTrend, error) {
	if apiKey == "" {
		return nil, fmt.Errorf("EIA_API_KEY not set")
	}
	q := url.Values{}
	q.Set("api_key", apiKey)
	q.Set("frequency", "weekly")
	q.Set("data[0]", "value")
	q.Set("facets[series][]", "WCESTUS1") // US ending stocks of crude oil excl. SPR, kbbl
	q.Set("sort[0][column]", "period")
	q.Set("sort[0][direction]", "desc")
	q.Set("length", "2")
	u := "https://api.eia.gov/v2/petroleum/stoc/wstk/data/?" + q.Encode()

	reqCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	resp, err := sources.HTTPClient().Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return nil, fmt.Errorf("eia stocks http %d: %s", resp.StatusCode, string(body))
	}
	var parsed struct {
		Response struct {
			Data []struct {
				Period string      `json:"period"`
				Value  json.Number `json:"value"`
			} `json:"data"`
		} `json:"response"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return nil, err
	}
	if len(parsed.Response.Data) < 2 {
		return nil, fmt.Errorf("eia stocks: insufficient data points")
	}
	latest, prev := parsed.Response.Data[0], parsed.Response.Data[1]
	latestVal, _ := latest.Value.Float64()
	prevVal, _ := prev.Value.Float64()
	delta := latestVal - prevVal
	dir := "flat"
	if delta > 100 {
		dir = "building"
	} else if delta < -100 {
		dir = "drawing"
	}
	return &EIACrudeStockTrend{
		LatestKBBL:  latestVal,
		PrevKBBL:    prevVal,
		Period:      latest.Period,
		Direction:   dir,
		WeeklyDelta: delta,
	}, nil
}
