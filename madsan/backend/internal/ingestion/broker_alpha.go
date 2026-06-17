package ingestion

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

const brokerAlphaSnapshotsJobType = "broker_alpha_snapshots"

type BrokerAlphaOptions struct {
	Limit int `json:"limit,omitempty"`
}

type BrokerAlphaResult struct {
	RowsWritten    int64 `json:"rows_written"`
	DurationMillis int64 `json:"duration_ms"`
}

func (s *Service) processBrokerAlphaSnapshots(ctx context.Context, jobID uuid.UUID, payload []byte) error {
	opts := BrokerAlphaOptions{}
	if len(payload) > 0 {
		_ = json.Unmarshal(payload, &opts)
	}
	res, err := s.GenerateBrokerAlphaSnapshots(ctx, opts)
	report, _ := json.Marshal(res)
	if err != nil {
		return s.finishIntelJob(ctx, jobID, "failed", report, err)
	}
	return s.finishIntelJob(ctx, jobID, "completed", report, nil)
}

func (s *Service) GenerateBrokerAlphaSnapshots(ctx context.Context, opts BrokerAlphaOptions) (BrokerAlphaResult, error) {
	started := time.Now()
	if opts.Limit <= 0 {
		opts.Limit = 5000
	}
	tag, err := s.pool.Exec(ctx, brokerAlphaSnapshotsSQL, opts.Limit)
	return BrokerAlphaResult{
		RowsWritten:    tag.RowsAffected(),
		DurationMillis: time.Since(started).Milliseconds(),
	}, err
}

const brokerAlphaSnapshotsSQL = `
WITH selected AS (
	SELECT
		oc.id,
		COALESCE(oc.lane_id, '') AS lane_id,
		COALESCE(oc.commodity, '') AS commodity,
		COALESCE(oc.origin_country, '') AS origin_country,
		COALESCE(oc.destination_country, '') AS destination_country,
		COALESCE(oc.score, 0)::double precision AS score,
		COALESCE((oc.market_pressure_summary->>'buyer_pressure_score')::double precision, 0) AS buyer_pressure,
		COALESCE(oc.market_pressure_score, 0)::double precision AS market_pressure,
		COALESCE(oc.price_context_score, 0)::double precision AS price_context_score,
		COALESCE(oc.buyer_reality_score, 0)::double precision AS buyer_reality,
		COALESCE(oc.market_pressure_summary, '{}'::jsonb) AS market_pressure_summary,
		COALESCE(oc.price_context, '{}'::jsonb) AS price_context,
		COALESCE(oc.buyer_eia_evidence, '{}'::jsonb) AS buyer_eia_evidence,
		COALESCE(oc.supplier_asset_id, oc.buyer_asset_id) AS anchor_asset_id
	FROM opportunity_candidates oc
	WHERE oc.status = 'active'
	ORDER BY oc.score DESC, oc.confidence_score DESC, oc.generated_at DESC
	LIMIT $1
),
open_vessels AS (
	SELECT
		s.id AS opportunity_id,
		COUNT(DISTINCT sol.mmsi)::int AS open_vessel_count,
		COALESCE(MAX(sol.confidence_score), 0)::double precision AS max_open_confidence
	FROM selected s
	JOIN opportunity_candidates oc ON oc.id = s.id
	LEFT JOIN assets ba ON ba.id = oc.buyer_asset_id
	LEFT JOIN sts_open_vessel_leads sol
	  ON (sol.expires_at IS NULL OR sol.expires_at > now())
	 AND ba.latitude IS NOT NULL
	 AND ba.longitude IS NOT NULL
	 AND sol.lat IS NOT NULL
	 AND sol.lon IS NOT NULL
	 AND ST_DWithin(
		ST_SetSRID(ST_MakePoint(sol.lon, sol.lat), 4326)::geography,
		ST_SetSRID(ST_MakePoint(ba.longitude, ba.latitude), 4326)::geography,
		500000
	 )
	GROUP BY s.id
),
scored AS (
	SELECT
		s.*,
		COALESCE(ov.open_vessel_count, 0) AS open_vessel_count,
		COALESCE(ov.max_open_confidence, 0) AS max_open_confidence,
		LEAST(100, COALESCE((s.market_pressure_summary->>'buyer_pressure_score')::double precision, s.buyer_pressure)) AS jodi_stress,
		LEAST(100,
			COALESCE((s.buyer_eia_evidence->>'importer_rows')::double precision, 0) * 8
			+ CASE WHEN COALESCE((s.buyer_eia_evidence->>'matched')::boolean, false) THEN 25 ELSE 0 END
		) AS import_dependency,
		LEAST(100, COALESCE(ov.open_vessel_count, 0) * 12 + COALESCE(ov.max_open_confidence, 0) * 0.35) AS open_vessel_proximity,
		LEAST(100, s.score * 0.65) AS lane_fit,
		LEAST(100, s.price_context_score + CASE WHEN (s.price_context->>'price') IS NOT NULL THEN 15 ELSE 0 END) AS price_spread
	FROM selected s
	LEFT JOIN open_vessels ov ON ov.opportunity_id = s.id
)
INSERT INTO broker_alpha_snapshots (
	opportunity_id,
	lane_id,
	intent_score,
	counterparty_intent_score,
	jodi_stress_component,
	import_dependency_component,
	open_vessel_proximity_component,
	lane_fit_component,
	price_spread_component,
	thesis_text,
	scenario_label,
	evidence,
	limitations,
	generated_at,
	expires_at
)
SELECT
	id,
	NULLIF(lane_id, ''),
	ROUND((
		jodi_stress * 0.28
		+ import_dependency * 0.22
		+ open_vessel_proximity * 0.18
		+ lane_fit * 0.17
		+ price_spread * 0.15
	)::numeric, 2),
	ROUND((
		jodi_stress * 0.30
		+ import_dependency * 0.25
		+ open_vessel_proximity * 0.15
		+ lane_fit * 0.15
		+ price_spread * 0.15
	)::numeric, 2),
	ROUND(jodi_stress::numeric, 2),
	ROUND(import_dependency::numeric, 2),
	ROUND(open_vessel_proximity::numeric, 2),
	ROUND(lane_fit::numeric, 2),
	ROUND(price_spread::numeric, 2),
	format(
		'Scenario intelligence: %s lane %s → %s shows elevated counterparty intent (JODI buyer stress %.0f, import dependency %.0f). %s open-vessel proximity signal. Benchmark context %s. This is commodity scenario intelligence — not stock or investment advice.',
		NULLIF(commodity, 'oil/gas'),
		NULLIF(origin_country, '?'),
		NULLIF(destination_country, '?'),
		jodi_stress,
		import_dependency,
		CASE WHEN open_vessel_count > 0 THEN format('%s nearby open-to-STS vessel clue(s)', open_vessel_count) ELSE 'No' END,
		CASE WHEN price_context_score > 0 THEN 'available' ELSE 'pending' END
	),
	'scenario_intelligence',
	jsonb_build_array(
		jsonb_build_object('label', 'estimated', 'source', 'jodi_oil', 'component', 'buyer_stress'),
		jsonb_build_object('label', 'reported', 'source', 'eia_company_imports', 'component', 'import_dependency', 'matched', COALESCE((buyer_eia_evidence->>'matched')::boolean, false)),
		jsonb_build_object('label', 'observed', 'source', 'sts_open_vessel_leads', 'component', 'open_vessel_proximity', 'count', open_vessel_count),
		jsonb_build_object('label', 'inferred', 'source', 'opportunity_candidates', 'component', 'lane_fit'),
		jsonb_build_object('label', 'reported', 'source', 'market_price_observations', 'component', 'price_spread')
	),
	ARRAY[
		'Broker alpha is precomputed scenario intelligence for commodity origination — not stock, equity, or investment advice.',
		'Counterparty intent combines JODI stress, reported import dependency, open-vessel proximity, lane fit, and benchmark spread context.',
		'Open-vessel and cargo clues remain estimates until manifest or terminal confirmation.'
	],
	now(),
	now() + interval '36 hours'
FROM scored
ON CONFLICT (opportunity_id) DO UPDATE SET
	lane_id = EXCLUDED.lane_id,
	intent_score = EXCLUDED.intent_score,
	counterparty_intent_score = EXCLUDED.counterparty_intent_score,
	jodi_stress_component = EXCLUDED.jodi_stress_component,
	import_dependency_component = EXCLUDED.import_dependency_component,
	open_vessel_proximity_component = EXCLUDED.open_vessel_proximity_component,
	lane_fit_component = EXCLUDED.lane_fit_component,
	price_spread_component = EXCLUDED.price_spread_component,
	thesis_text = EXCLUDED.thesis_text,
	scenario_label = EXCLUDED.scenario_label,
	evidence = EXCLUDED.evidence,
	limitations = EXCLUDED.limitations,
	generated_at = EXCLUDED.generated_at,
	expires_at = EXCLUDED.expires_at
`

func BrokerAlphaThesis(commodity, origin, destination string, jodiStress, importDep float64, openCount int, priceReady bool) string {
	priceCtx := "pending"
	if priceReady {
		priceCtx = "available"
	}
	openPhrase := "No nearby open-to-STS vessel clue"
	if openCount > 0 {
		openPhrase = fmt.Sprintf("%d nearby open-to-STS vessel clue(s)", openCount)
	}
	return fmt.Sprintf(
		"Scenario intelligence: %s lane %s → %s shows elevated counterparty intent (JODI buyer stress %.0f, import dependency %.0f). %s. Benchmark context %s. This is commodity scenario intelligence — not stock or investment advice.",
		strings.TrimSpace(commodity),
		strings.TrimSpace(origin),
		strings.TrimSpace(destination),
		jodiStress,
		importDep,
		openPhrase,
		priceCtx,
	)
}
