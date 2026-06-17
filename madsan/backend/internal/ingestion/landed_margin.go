package ingestion

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

const landedMarginSnapshotsJobType = "landed_margin_snapshots"

type LandedMarginOptions struct {
	Limit int `json:"limit,omitempty"`
}

type LandedMarginResult struct {
	FreightRowsWritten int64 `json:"freight_rows_written"`
	MarginRowsWritten  int64 `json:"margin_rows_written"`
	DurationMillis     int64 `json:"duration_ms"`
}

func (s *Service) processLandedMarginSnapshots(ctx context.Context, jobID uuid.UUID, payload []byte) error {
	opts := LandedMarginOptions{}
	if len(payload) > 0 {
		_ = json.Unmarshal(payload, &opts)
	}
	res, err := s.GenerateLandedMarginSnapshots(ctx, opts)
	report, _ := json.Marshal(res)
	if err != nil {
		return s.finishIntelJob(ctx, jobID, "failed", report, err)
	}
	return s.finishIntelJob(ctx, jobID, "completed", report, nil)
}

func (s *Service) GenerateLandedMarginSnapshots(ctx context.Context, opts LandedMarginOptions) (LandedMarginResult, error) {
	started := time.Now()
	if opts.Limit <= 0 {
		opts.Limit = 5000
	}
	freightTag, err := s.pool.Exec(ctx, freightCostCurvesSQL, opts.Limit)
	if err != nil {
		return LandedMarginResult{}, err
	}
	if _, err := s.pool.Exec(ctx, qualityAdjustmentsSeedSQL); err != nil {
		return LandedMarginResult{}, err
	}
	marginTag, err := s.pool.Exec(ctx, landedMarginSnapshotsSQL, opts.Limit)
	res := LandedMarginResult{
		FreightRowsWritten: freightTag.RowsAffected(),
		MarginRowsWritten:  marginTag.RowsAffected(),
		DurationMillis:     time.Since(started).Milliseconds(),
	}
	return res, err
}

const freightCostCurvesSQL = `
WITH selected AS (
	SELECT
		oc.id,
		oc.origin_country,
		oc.destination_country,
		sa.latitude AS origin_lat,
		sa.longitude AS origin_lon,
		ba.latitude AS dest_lat,
		ba.longitude AS dest_lon
	FROM opportunity_candidates oc
	JOIN assets sa ON sa.id = oc.supplier_asset_id
	JOIN assets ba ON ba.id = oc.buyer_asset_id
	WHERE oc.status = 'active'
	  AND sa.latitude IS NOT NULL AND sa.longitude IS NOT NULL
	  AND ba.latitude IS NOT NULL AND ba.longitude IS NOT NULL
	ORDER BY oc.score DESC
	LIMIT $1
)
INSERT INTO freight_cost_curves (
	corridor_key, origin_country, destination_country, vessel_class,
	distance_nm, freight_low_usd_per_bbl, freight_base_usd_per_bbl, freight_high_usd_per_bbl,
	method, evidence_label, source_key, generated_at
)
SELECT
	origin_country || ':' || destination_country,
	origin_country,
	destination_country,
	'tanker',
	ROUND((ST_Distance(
		ST_SetSRID(ST_MakePoint(origin_lon, origin_lat), 4326)::geography,
		ST_SetSRID(ST_MakePoint(dest_lon, dest_lat), 4326)::geography
	) / 1852.0)::numeric, 2),
	ROUND(((ST_Distance(
		ST_SetSRID(ST_MakePoint(origin_lon, origin_lat), 4326)::geography,
		ST_SetSRID(ST_MakePoint(dest_lon, dest_lat), 4326)::geography
	) / 1852.0) * 0.00075)::numeric, 4),
	ROUND(((ST_Distance(
		ST_SetSRID(ST_MakePoint(origin_lon, origin_lat), 4326)::geography,
		ST_SetSRID(ST_MakePoint(dest_lon, dest_lat), 4326)::geography
	) / 1852.0) * 0.00105)::numeric, 4),
	ROUND(((ST_Distance(
		ST_SetSRID(ST_MakePoint(origin_lon, origin_lat), 4326)::geography,
		ST_SetSRID(ST_MakePoint(dest_lon, dest_lat), 4326)::geography
	) / 1852.0) * 0.00145)::numeric, 4),
	'great_circle_unctad_oecd_proxy',
	'estimated',
	'open_distance_proxy_v1',
	now()
FROM selected
ON CONFLICT (corridor_key, vessel_class, method) DO UPDATE SET
	distance_nm = EXCLUDED.distance_nm,
	freight_low_usd_per_bbl = EXCLUDED.freight_low_usd_per_bbl,
	freight_base_usd_per_bbl = EXCLUDED.freight_base_usd_per_bbl,
	freight_high_usd_per_bbl = EXCLUDED.freight_high_usd_per_bbl,
	generated_at = EXCLUDED.generated_at
`

const qualityAdjustmentsSeedSQL = `
INSERT INTO quality_adjustments (
	product_code, quality_band, adjustment_low_usd_per_bbl, adjustment_base_usd_per_bbl,
	adjustment_high_usd_per_bbl, evidence_label, method
)
VALUES
	('CRUDEOIL', 'unspecified', -1.5, 0, 1.5, 'estimated', 'quality_band_placeholder_v1'),
	('LPG', 'unspecified', -2.0, 0, 2.0, 'estimated', 'quality_band_placeholder_v1'),
	('GASDIES', 'unspecified', -1.0, 0, 1.0, 'estimated', 'quality_band_placeholder_v1')
ON CONFLICT (product_code, quality_band, method) DO NOTHING
`

const landedMarginSnapshotsSQL = `
WITH selected AS (
	SELECT
		oc.id,
		COALESCE(oc.lane_id, '') AS lane_id,
		COALESCE(oc.commodity, '') AS commodity,
		COALESCE(oc.origin_country, '') AS origin_country,
		COALESCE(oc.destination_country, '') AS destination_country,
		COALESCE((oc.price_context->>'price')::double precision, 0) AS source_price,
		COALESCE(oc.price_context->>'benchmark_key', '') AS benchmark_key,
		fc.freight_low_usd_per_bbl,
		fc.freight_base_usd_per_bbl,
		fc.freight_high_usd_per_bbl,
		qa.adjustment_low_usd_per_bbl,
		qa.adjustment_base_usd_per_bbl,
		qa.adjustment_high_usd_per_bbl
	FROM opportunity_candidates oc
	LEFT JOIN freight_cost_curves fc
	  ON fc.corridor_key = oc.origin_country || ':' || oc.destination_country
	 AND fc.vessel_class = 'tanker'
	 AND fc.method = 'great_circle_unctad_oecd_proxy'
	LEFT JOIN quality_adjustments qa
	  ON qa.product_code = COALESCE(NULLIF(oc.commodity, ''), 'CRUDEOIL')
	 AND qa.quality_band = 'unspecified'
	 AND qa.method = 'quality_band_placeholder_v1'
	WHERE oc.status = 'active'
	ORDER BY oc.score DESC
	LIMIT $1
)
INSERT INTO landed_margin_snapshots (
	opportunity_id, lane_id, commodity, origin_country, destination_country,
	benchmark_key, source_price_usd, destination_price_usd,
	freight_low_usd, freight_base_usd, freight_high_usd,
	quality_low_usd, quality_base_usd, quality_high_usd,
	margin_low_usd, margin_base_usd, margin_high_usd,
	evidence_label, method, limitations, generated_at, expires_at
)
SELECT
	id,
	NULLIF(lane_id, ''),
	commodity,
	origin_country,
	destination_country,
	NULLIF(benchmark_key, ''),
	NULLIF(source_price, 0),
	NULL,
	COALESCE(freight_low_usd_per_bbl, 0),
	COALESCE(freight_base_usd_per_bbl, 0),
	COALESCE(freight_high_usd_per_bbl, 0),
	COALESCE(adjustment_low_usd_per_bbl, 0),
	COALESCE(adjustment_base_usd_per_bbl, 0),
	COALESCE(adjustment_high_usd_per_bbl, 0),
	CASE WHEN source_price > 0 THEN ROUND((source_price - COALESCE(freight_high_usd_per_bbl, 0) + COALESCE(adjustment_low_usd_per_bbl, 0))::numeric, 4) ELSE NULL END,
	CASE WHEN source_price > 0 THEN ROUND((source_price - COALESCE(freight_base_usd_per_bbl, 0) + COALESCE(adjustment_base_usd_per_bbl, 0))::numeric, 4) ELSE NULL END,
	CASE WHEN source_price > 0 THEN ROUND((source_price - COALESCE(freight_low_usd_per_bbl, 0) + COALESCE(adjustment_high_usd_per_bbl, 0))::numeric, 4) ELSE NULL END,
	'estimated',
	'benchmark_minus_freight_plus_quality_proxy_v1',
	ARRAY[
		'Landed margin bands are scenario estimates — not guaranteed deal prices.',
		'Freight uses great-circle UNCTAD/OECD-style distance proxy; quality bands are placeholders until assay data is wired.',
		'Destination benchmark price may be absent; margin requires open source benchmark context.'
	],
	now(),
	now() + interval '36 hours'
FROM selected
ON CONFLICT (opportunity_id) DO UPDATE SET
	lane_id = EXCLUDED.lane_id,
	commodity = EXCLUDED.commodity,
	origin_country = EXCLUDED.origin_country,
	destination_country = EXCLUDED.destination_country,
	benchmark_key = EXCLUDED.benchmark_key,
	source_price_usd = EXCLUDED.source_price_usd,
	destination_price_usd = EXCLUDED.destination_price_usd,
	freight_low_usd = EXCLUDED.freight_low_usd,
	freight_base_usd = EXCLUDED.freight_base_usd,
	freight_high_usd = EXCLUDED.freight_high_usd,
	quality_low_usd = EXCLUDED.quality_low_usd,
	quality_base_usd = EXCLUDED.quality_base_usd,
	quality_high_usd = EXCLUDED.quality_high_usd,
	margin_low_usd = EXCLUDED.margin_low_usd,
	margin_base_usd = EXCLUDED.margin_base_usd,
	margin_high_usd = EXCLUDED.margin_high_usd,
	evidence_label = EXCLUDED.evidence_label,
	method = EXCLUDED.method,
	limitations = EXCLUDED.limitations,
	generated_at = EXCLUDED.generated_at,
	expires_at = EXCLUDED.expires_at
`
