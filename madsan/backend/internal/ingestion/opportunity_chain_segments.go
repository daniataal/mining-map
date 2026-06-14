package ingestion

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

const opportunityChainSegmentsJobType = "opportunity_chain_segments"

type OpportunityChainSegmentOptions struct {
	Limit                int     `json:"limit,omitempty"`
	MaxPipelineDistanceM float64 `json:"max_pipeline_distance_m,omitempty"`
	SimplifyTolerance    float64 `json:"simplify_tolerance,omitempty"`
}

type OpportunityChainSegmentResult struct {
	RowsWritten       int64 `json:"rows_written"`
	PathRowsWritten   int64 `json:"path_rows_written"`
	PathRefreshMillis int64 `json:"path_refresh_ms"`
	DurationMillis    int64 `json:"duration_ms"`
}

func (s *Service) processOpportunityChainSegments(ctx context.Context, jobID uuid.UUID, payload []byte) error {
	opts := OpportunityChainSegmentOptions{}
	if len(payload) > 0 {
		_ = json.Unmarshal(payload, &opts)
	}
	res, err := s.GenerateOpportunityChainSegments(ctx, opts)
	report, _ := json.Marshal(res)
	if err != nil {
		return s.finishIntelJob(ctx, jobID, "failed", report, err)
	}
	return s.finishIntelJob(ctx, jobID, "completed", report, nil)
}

func (s *Service) GenerateOpportunityChainSegments(ctx context.Context, opts OpportunityChainSegmentOptions) (OpportunityChainSegmentResult, error) {
	started := time.Now()
	if opts.Limit <= 0 {
		opts.Limit = 5000
	}
	if opts.MaxPipelineDistanceM <= 0 {
		opts.MaxPipelineDistanceM = 25000
	}
	if opts.SimplifyTolerance <= 0 {
		opts.SimplifyTolerance = 0.05
	}

	res := OpportunityChainSegmentResult{}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return res, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx, `
		DELETE FROM opportunity_chain_segments ocs
		WHERE ocs.generated_by = 'opportunity_chain_segments_v1'
		  AND NOT EXISTS (
			SELECT 1 FROM opportunity_candidates oc
			WHERE oc.id = ocs.opportunity_id
			  AND oc.status = 'active'
		  )
	`); err != nil {
		return res, err
	}

	if _, err := tx.Exec(ctx, `
		WITH selected AS (
			SELECT id
			FROM opportunity_candidates
			WHERE status = 'active'
			ORDER BY score DESC, confidence_score DESC, generated_at DESC
			LIMIT $1
		)
		DELETE FROM opportunity_chain_segments ocs
		USING selected
		WHERE ocs.opportunity_id = selected.id
		  AND ocs.generated_by = 'opportunity_chain_segments_v1'
	`, opts.Limit); err != nil {
		return res, err
	}

	tag, err := tx.Exec(ctx, opportunityChainSegmentsSQL, opts.Limit, opts.MaxPipelineDistanceM, opts.SimplifyTolerance)
	if err != nil {
		return res, err
	}
	if err := tx.Commit(ctx); err != nil {
		return res, err
	}
	res.RowsWritten = tag.RowsAffected()
	pathStarted := time.Now()
	pathRows, err := s.RefreshOpportunityInvestorPathSnapshots(ctx, opts.Limit)
	if err != nil {
		return res, err
	}
	res.PathRowsWritten = pathRows
	res.PathRefreshMillis = time.Since(pathStarted).Milliseconds()
	res.DurationMillis = time.Since(started).Milliseconds()
	return res, nil
}

func (s *Service) RefreshOpportunityInvestorPathSnapshots(ctx context.Context, limit int) (int64, error) {
	if limit <= 0 {
		limit = 5000
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx, `
		DELETE FROM opportunity_investor_path_snapshots oips
		WHERE oips.generated_by = 'opportunity_investor_paths_v1'
		  AND NOT EXISTS (
			SELECT 1 FROM opportunity_candidates oc
			WHERE oc.id = oips.opportunity_id
			  AND oc.status = 'active'
		  )
	`); err != nil {
		return 0, err
	}
	if _, err := tx.Exec(ctx, `
		WITH selected AS (
			SELECT id
			FROM opportunity_candidates
			WHERE status = 'active'
			ORDER BY score DESC, confidence_score DESC, generated_at DESC
			LIMIT $1
		)
		DELETE FROM opportunity_investor_path_snapshots oips
		USING selected
		WHERE oips.opportunity_id = selected.id
		  AND oips.generated_by = 'opportunity_investor_paths_v1'
	`, limit); err != nil {
		return 0, err
	}
	tag, err := tx.Exec(ctx, opportunityInvestorPathSnapshotsSQL, limit)
	if err != nil {
		return 0, err
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

const opportunityChainSegmentsSQL = `
WITH selected AS (
	SELECT *
	FROM opportunity_candidates
	WHERE status = 'active'
	ORDER BY score DESC, confidence_score DESC, generated_at DESC
	LIMIT $1
),
base AS (
	SELECT
		oc.id,
		oc.lane_id,
		oc.commodity,
		oc.origin_country,
		oc.destination_country,
		oc.supplier_asset_id,
		oc.buyer_asset_id,
		sa.name AS supplier_asset_name,
		sa.latitude AS supplier_latitude,
		sa.longitude AS supplier_longitude,
		ba.name AS buyer_asset_name,
		ba.latitude AS buyer_latitude,
		ba.longitude AS buyer_longitude
	FROM selected oc
	LEFT JOIN assets sa ON sa.id = oc.supplier_asset_id
	LEFT JOIN assets ba ON ba.id = oc.buyer_asset_id
)
INSERT INTO opportunity_chain_segments (
	opportunity_id,
	lane_id,
	segment_order,
	from_step,
	to_step,
	label,
	geometry_source,
	source_key,
	project_id,
	pipeline_name,
	distance_m,
	evidence_label,
	geom,
	properties,
	generated_by,
	generated_at
)
SELECT
	b.id,
	b.lane_id,
	seg.ord,
	seg.from_step,
	seg.to_step,
	seg.label,
	seg.geometry_source,
	seg.source_key,
	seg.project_id,
	seg.pipeline_name,
	seg.distance_m,
	seg.evidence_label,
	seg.geom,
	seg.properties,
	'opportunity_chain_segments_v1',
	now()
FROM base b
JOIN LATERAL (
	WITH supplier_asset_route_line AS (
		SELECT
			10 AS ord,
			'supplier_asset' AS from_step,
			'physical_route' AS to_step,
			COALESCE(b.supplier_asset_name, 'supplier asset') || ' reported geometry' AS label,
			'asset_geometries' AS geometry_source,
			ag.source_key,
			COALESCE(ag.source_asset_id, '') AS project_id,
			COALESCE(b.supplier_asset_name, '') AS pipeline_name,
			NULL::numeric AS distance_m,
			'reported' AS evidence_label,
			ST_SimplifyPreserveTopology(COALESCE(ag.geom_simplified, ag.geom), $3) AS geom,
			jsonb_build_object('asset_id', COALESCE(b.supplier_asset_id::text, ''), 'side', 'supplier') AS properties
		FROM asset_geometries ag
		WHERE ag.asset_id = b.supplier_asset_id
		  AND GeometryType(COALESCE(ag.geom_simplified, ag.geom)) IN ('LINESTRING', 'MULTILINESTRING')
		ORDER BY ag.created_at DESC
		LIMIT 1
	),
	buyer_asset_route_line AS (
		SELECT
			40 AS ord,
			'physical_route' AS from_step,
			'buyer_asset' AS to_step,
			COALESCE(b.buyer_asset_name, 'buyer asset') || ' reported geometry' AS label,
			'asset_geometries' AS geometry_source,
			ag.source_key,
			COALESCE(ag.source_asset_id, '') AS project_id,
			COALESCE(b.buyer_asset_name, '') AS pipeline_name,
			NULL::numeric AS distance_m,
			'reported' AS evidence_label,
			ST_SimplifyPreserveTopology(COALESCE(ag.geom_simplified, ag.geom), $3) AS geom,
			jsonb_build_object('asset_id', COALESCE(b.buyer_asset_id::text, ''), 'side', 'buyer') AS properties
		FROM asset_geometries ag
		WHERE ag.asset_id = b.buyer_asset_id
		  AND GeometryType(COALESCE(ag.geom_simplified, ag.geom)) IN ('LINESTRING', 'MULTILINESTRING')
		ORDER BY ag.created_at DESC
		LIMIT 1
	),
	endpoints AS (
		SELECT
			20 AS ord,
			'supplier_asset' AS from_step,
			'physical_route' AS to_step,
			COALESCE(b.supplier_asset_name, 'supplier asset') || ' GEM pipeline access' AS label,
			CASE
				WHEN b.supplier_latitude IS NOT NULL AND b.supplier_longitude IS NOT NULL
				THEN ST_SetSRID(ST_MakePoint(b.supplier_longitude, b.supplier_latitude), 4326)::geography
				ELSE NULL::geography
			END AS point,
			'supplier' AS side
		UNION ALL
		SELECT
			30 AS ord,
			'physical_route' AS from_step,
			'buyer_asset' AS to_step,
			COALESCE(b.buyer_asset_name, 'buyer asset') || ' GEM pipeline access' AS label,
			CASE
				WHEN b.buyer_latitude IS NOT NULL AND b.buyer_longitude IS NOT NULL
				THEN ST_SetSRID(ST_MakePoint(b.buyer_longitude, b.buyer_latitude), 4326)::geography
				ELSE NULL::geography
			END AS point,
			'buyer' AS side
	),
	pipeline_access AS (
		SELECT
			ep.ord,
			ep.from_step,
			ep.to_step,
			ep.label,
			'pipeline_graph_edges' AS geometry_source,
			COALESCE(hit.metadata->>'source_key', hit.metadata->'tags'->>'source_id', '') AS source_key,
			COALESCE(hit.metadata->>'project_id', hit.metadata->'tags'->>'project_id', '') AS project_id,
			COALESCE(hit.metadata->>'pipeline_name', hit.metadata->>'name', hit.metadata->'tags'->>'name', '') AS pipeline_name,
			round(ST_Distance(hit.geom, ep.point)::numeric, 1) AS distance_m,
			'reported' AS evidence_label,
			ST_SimplifyPreserveTopology(hit.geom::geometry, $3) AS geom,
			jsonb_build_object(
				'side', ep.side,
				'osm_id', hit.osm_id,
				'fuel', COALESCE(hit.metadata->'tags'->>'fuel', ''),
				'fuel_group', COALESCE(hit.metadata->'tags'->>'fuel_group', '')
			) AS properties
		FROM endpoints ep
		JOIN LATERAL (
			SELECT e.osm_id, e.geom, e.metadata
			FROM pipeline_graph_edges e
			WHERE ep.point IS NOT NULL
			  AND e.geom IS NOT NULL
			  AND (e.osm_id LIKE 'gem:%' OR e.osm_id LIKE 'gemgeo:%')
			  AND ST_DWithin(e.geom, ep.point, $2)
			  AND (
				COALESCE(b.commodity, '') = ''
				OR (
					b.commodity ILIKE '%gas%'
					AND (
						COALESCE(e.metadata->>'source_key', '') ILIKE '%gas%'
						OR COALESCE(e.metadata->'tags'->>'fuel_group', '') ILIKE '%gas%'
						OR COALESCE(e.metadata->'tags'->>'fuel', '') ILIKE '%gas%'
					)
				)
				OR (
					b.commodity ILIKE '%lng%'
					AND (
						COALESCE(e.metadata->>'source_key', '') ILIKE '%gas%'
						OR COALESCE(e.metadata->'tags'->>'fuel_group', '') ILIKE '%gas%'
						OR COALESCE(e.metadata->'tags'->>'fuel', '') ILIKE '%gas%'
					)
				)
				OR (
					(b.commodity ILIKE '%oil%' OR b.commodity ILIKE '%crude%' OR b.commodity ILIKE '%lpg%' OR b.commodity ILIKE '%ngl%')
					AND (
						COALESCE(e.metadata->>'source_key', '') ILIKE '%oil%'
						OR COALESCE(e.metadata->>'source_key', '') ILIKE '%ngl%'
						OR COALESCE(e.metadata->'tags'->>'fuel_group', '') ILIKE '%oil%'
						OR COALESCE(e.metadata->'tags'->>'fuel', '') ILIKE '%oil%'
						OR COALESCE(e.metadata->'tags'->>'fuel', '') ILIKE '%ngl%'
					)
				)
			  )
			ORDER BY e.geom <-> ep.point
			LIMIT 1
		) hit ON true
	),
	direct_corridor AS (
		SELECT
			80 AS ord,
			'supplier_asset' AS from_step,
			'buyer_asset' AS to_step,
			COALESCE(b.origin_country, '?') || ' -> ' || COALESCE(b.destination_country, '?') || ' inferred commercial corridor' AS label,
			'inferred_direct_corridor' AS geometry_source,
			'' AS source_key,
			'' AS project_id,
			'' AS pipeline_name,
			NULL::numeric AS distance_m,
			'inferred' AS evidence_label,
			ST_MakeLine(
				ST_SetSRID(ST_MakePoint(b.supplier_longitude, b.supplier_latitude), 4326),
				ST_SetSRID(ST_MakePoint(b.buyer_longitude, b.buyer_latitude), 4326)
			) AS geom,
			jsonb_build_object('origin_country', COALESCE(b.origin_country, ''), 'destination_country', COALESCE(b.destination_country, '')) AS properties
		WHERE b.supplier_latitude IS NOT NULL
		  AND b.supplier_longitude IS NOT NULL
		  AND b.buyer_latitude IS NOT NULL
		  AND b.buyer_longitude IS NOT NULL
	)
	SELECT * FROM supplier_asset_route_line
	UNION ALL
	SELECT * FROM buyer_asset_route_line
	UNION ALL
	SELECT * FROM pipeline_access
	UNION ALL
	SELECT * FROM direct_corridor
) seg ON true
WHERE seg.geom IS NOT NULL
  AND NOT ST_IsEmpty(seg.geom)
ON CONFLICT (opportunity_id, segment_order, geometry_source, from_step, to_step, generated_by)
DO UPDATE SET
	lane_id = EXCLUDED.lane_id,
	label = EXCLUDED.label,
	source_key = EXCLUDED.source_key,
	project_id = EXCLUDED.project_id,
	pipeline_name = EXCLUDED.pipeline_name,
	distance_m = EXCLUDED.distance_m,
	evidence_label = EXCLUDED.evidence_label,
	geom = EXCLUDED.geom,
	properties = EXCLUDED.properties,
	generated_at = now()
`

const opportunityInvestorPathSnapshotsSQL = `
WITH opportunity AS (
	SELECT *
	FROM opportunity_candidates
	WHERE status = 'active'
	  AND COALESCE(investor_control_score, 0) > 0
	ORDER BY score DESC, confidence_score DESC, generated_at DESC
	LIMIT $1
),
paths AS (
	SELECT
		oc.id AS opportunity_id,
		oc.lane_id,
		oc.commodity,
		oc.origin_country,
		oc.destination_country,
		oc.supplier_asset_id,
		oc.buyer_asset_id,
		oc.supplier_company_id,
		oc.buyer_company_id,
		COALESCE(oc.score, 0) AS score,
		COALESCE(oc.confidence_score, 0) AS confidence_score,
		COALESCE(oc.investor_control_score, 0) AS investor_control_score,
		COALESCE(NULLIF(inv.investor_entity_id, ''), lower(inv.investor_name)) AS investor_key,
		inv.investor_name,
		COALESCE(inv.investor_entity_id, '') AS investor_entity_id,
		jsonb_build_object(
			'id', oc.id::text || ':' || COALESCE(NULLIF(inv.investor_entity_id, ''), lower(inv.investor_name)),
			'opportunity_id', oc.id::text,
			'lane_id', COALESCE(oc.lane_id, ''),
			'commodity', COALESCE(oc.commodity, ''),
			'origin_country', COALESCE(oc.origin_country, ''),
			'destination_country', COALESCE(oc.destination_country, ''),
			'score', COALESCE(oc.score, 0)::double precision,
			'confidence_score', COALESCE(oc.confidence_score, 0)::double precision,
			'investor_control_score', COALESCE(oc.investor_control_score, 0)::double precision,
			'evidence_grade', COALESCE(oc.evidence_grade, 'inferred'),
			'evidence_label', 'inferred',
			'investor', jsonb_build_object(
				'entity_id', COALESCE(inv.investor_entity_id, ''),
				'name', inv.investor_name,
				'exposure_role', CASE
					WHEN inv.supplier_exposure AND inv.buyer_exposure THEN 'both_sides'
					WHEN inv.supplier_exposure THEN 'supplier_side'
					WHEN inv.buyer_exposure THEN 'buyer_side'
					ELSE 'portfolio_context'
				END,
				'exposure_count', inv.exposure_count,
				'exposure_value', COALESCE(inv.exposure_value, 0)::double precision,
				'exposure_unit', COALESCE(inv.exposure_unit, ''),
				'exposure_types', inv.exposure_types,
				'confidence_score', COALESCE(inv.confidence_score, 0)::double precision
			),
			'commercial_thesis',
				inv.investor_name || ' is exposed to ' ||
				CASE
					WHEN inv.supplier_exposure AND inv.buyer_exposure THEN 'both sides of '
					WHEN inv.supplier_exposure THEN 'the supplier side of '
					WHEN inv.buyer_exposure THEN 'the buyer side of '
					ELSE 'the commercial context around '
				END ||
				COALESCE(oc.commodity, 'oil/gas') || ' lane ' ||
				COALESCE(oc.origin_country, '?') || ' -> ' || COALESCE(oc.destination_country, '?') ||
				'. Supplier asset: ' || COALESCE(sa.name, 'unknown') ||
				'; buyer asset: ' || COALESCE(ba.name, 'unknown') ||
				CASE
					WHEN COALESCE(oc.price_context, '{}'::jsonb) <> '{}'::jsonb THEN '; latest open benchmark context is available.'
					ELSE '; price context is pending.'
				END,
			'supplier', jsonb_build_object(
				'asset_id', COALESCE(sa.id::text, ''),
				'asset_name', COALESCE(sa.name, ''),
				'asset_type', COALESCE(sa.asset_type, ''),
				'country_code', COALESCE(sa.country_code, oc.origin_country, ''),
				'latitude', sa.latitude,
				'longitude', sa.longitude,
				'operator_company_id', COALESCE(sc.id::text, ''),
				'operator_name', COALESCE(sc.name, ''),
				'owner_company_id', COALESCE(so.id::text, ''),
				'owner_name', COALESCE(so.name, ''),
				'gem_ownership', COALESCE(supplier_ownership.items, '[]'::jsonb),
				'investor_exposed', inv.supplier_exposure,
				'evidence_label', 'reported'
			),
			'buyer', jsonb_build_object(
				'asset_id', COALESCE(ba.id::text, ''),
				'asset_name', COALESCE(ba.name, ''),
				'asset_type', COALESCE(ba.asset_type, ''),
				'country_code', COALESCE(ba.country_code, oc.destination_country, ''),
				'latitude', ba.latitude,
				'longitude', ba.longitude,
				'operator_company_id', COALESCE(bc.id::text, ''),
				'operator_name', COALESCE(bc.name, ''),
				'owner_company_id', COALESCE(bo.id::text, ''),
				'owner_name', COALESCE(bo.name, ''),
				'gem_ownership', COALESCE(buyer_ownership.items, '[]'::jsonb),
				'importer_evidence', COALESCE(importer.items, '[]'::jsonb),
				'investor_exposed', inv.buyer_exposure,
				'evidence_label', 'reported'
			),
			'route', jsonb_build_object(
				'lane_id', COALESCE(oc.lane_id, ''),
				'summary', COALESCE(oc.route_summary, '{}'::jsonb),
				'supplier_geometry', EXISTS (SELECT 1 FROM asset_geometries ag WHERE ag.asset_id = oc.supplier_asset_id),
				'buyer_geometry', EXISTS (SELECT 1 FROM asset_geometries ag WHERE ag.asset_id = oc.buyer_asset_id),
				'pipeline_or_terminal_context', CASE
					WHEN COALESCE(sa.asset_type, '') IN ('pipeline', 'terminal', 'lng_terminal', 'storage', 'tank_farm')
					  OR COALESCE(ba.asset_type, '') IN ('pipeline', 'terminal', 'lng_terminal', 'storage', 'tank_farm')
					THEN true ELSE false END,
				'evidence_label', 'inferred'
			),
			'market', jsonb_build_object(
				'supplier_availability_score', COALESCE(oc.market_pressure_summary->>'supplier_availability_score', '0')::double precision,
				'buyer_pressure_score', COALESCE(oc.market_pressure_summary->>'buyer_pressure_score', '0')::double precision,
				'pressure_summary', COALESCE(oc.market_pressure_summary, '{}'::jsonb),
				'evidence_label', 'estimated'
			),
			'cargo', jsonb_build_object(
				'items', COALESCE(cargo.items, '[]'::jsonb),
				'evidence_label', CASE WHEN cargo.items IS NULL THEN 'not_attached' ELSE 'estimated' END
			),
			'price_context', COALESCE(oc.price_context, '{}'::jsonb),
			'exposures', inv.exposures,
			'control_chain', jsonb_build_array(
				jsonb_build_object(
					'step', 'investor',
					'role', 'capital_control',
					'label', inv.investor_name,
					'short_label', 'Investor',
					'entity_id', COALESCE(inv.investor_entity_id, ''),
					'exposure_role', CASE
						WHEN inv.supplier_exposure AND inv.buyer_exposure THEN 'both_sides'
						WHEN inv.supplier_exposure THEN 'supplier_side'
						WHEN inv.buyer_exposure THEN 'buyer_side'
						ELSE 'portfolio_context'
					END,
					'exposure_types', inv.exposure_types,
					'evidence_label', 'reported'
				),
				jsonb_build_object(
					'step', 'supplier_control',
					'role', 'owner_or_operator',
					'label', COALESCE(NULLIF(supplier_ownership.items->0->>'parent_name', ''), NULLIF(supplier_ownership.items->0->>'owner_name', ''), NULLIF(sc.name, ''), NULLIF(so.name, ''), sa.name, 'supplier control'),
					'short_label', 'Supplier control',
					'company_id', COALESCE(sc.id::text, so.id::text, ''),
					'asset_id', COALESCE(sa.id::text, ''),
					'asset', COALESCE(sa.name, ''),
					'country_code', COALESCE(sa.country_code, oc.origin_country, ''),
					'evidence_label', 'reported'
				),
				jsonb_build_object(
					'step', 'supplier_asset',
					'role', 'source_asset',
					'label', COALESCE(sa.name, 'supplier asset'),
					'short_label', 'Supplier asset',
					'asset_id', COALESCE(sa.id::text, ''),
					'asset_type', COALESCE(sa.asset_type, ''),
					'country_code', COALESCE(sa.country_code, oc.origin_country, ''),
					'coordinates', jsonb_build_object('latitude', sa.latitude, 'longitude', sa.longitude),
					'evidence_label', 'reported'
				),
				jsonb_build_object(
					'step', 'physical_route',
					'role', 'route_or_terminal_access',
					'label', COALESCE(oc.origin_country, '?') || ' -> ' || COALESCE(oc.destination_country, '?'),
					'short_label', 'Route',
					'lane_id', COALESCE(oc.lane_id, ''),
					'asset', COALESCE(sa.name, '') || ' -> ' || COALESCE(ba.name, ''),
					'pipeline_or_terminal_context', CASE
						WHEN COALESCE(sa.asset_type, '') IN ('pipeline', 'terminal', 'lng_terminal', 'storage', 'tank_farm')
						  OR COALESCE(ba.asset_type, '') IN ('pipeline', 'terminal', 'lng_terminal', 'storage', 'tank_farm')
						THEN true ELSE false END,
					'coordinates', CASE
						WHEN sa.latitude IS NOT NULL AND sa.longitude IS NOT NULL AND ba.latitude IS NOT NULL AND ba.longitude IS NOT NULL
						THEN jsonb_build_object('latitude', (sa.latitude + ba.latitude) / 2.0, 'longitude', (sa.longitude + ba.longitude) / 2.0)
						ELSE '{}'::jsonb
					END,
					'evidence_label', 'inferred'
				),
				jsonb_build_object(
					'step', 'cargo_or_vessel',
					'role', 'movement_clue',
					'label', CASE
						WHEN cargo.items IS NULL OR jsonb_array_length(cargo.items) = 0 THEN 'cargo clue pending'
						ELSE COALESCE(NULLIF(cargo.items->0->>'vessel_name', ''), 'cargo clue') || ' / ' ||
							COALESCE(NULLIF(cargo.items->0->>'product_family', ''), COALESCE(oc.commodity, 'product'))
					END,
					'short_label', 'Cargo clue',
					'vessel_name', COALESCE(cargo.items->0->>'vessel_name', ''),
					'product_family', COALESCE(cargo.items->0->>'product_family', oc.commodity, ''),
					'quantity_best', cargo.items->0->'quantity_best',
					'unit', COALESCE(cargo.items->0->>'unit', ''),
					'coordinates', CASE
						WHEN sa.latitude IS NOT NULL AND sa.longitude IS NOT NULL AND ba.latitude IS NOT NULL AND ba.longitude IS NOT NULL
						THEN jsonb_build_object('latitude', (sa.latitude + ba.latitude) / 2.0, 'longitude', (sa.longitude + ba.longitude) / 2.0)
						ELSE '{}'::jsonb
					END,
					'evidence_label', CASE WHEN cargo.items IS NULL THEN 'not_attached' ELSE 'estimated' END
				),
				jsonb_build_object(
					'step', 'buyer_asset',
					'role', 'demand_asset',
					'label', COALESCE(ba.name, 'buyer asset'),
					'short_label', 'Buyer asset',
					'asset_id', COALESCE(ba.id::text, ''),
					'asset_type', COALESCE(ba.asset_type, ''),
					'country_code', COALESCE(ba.country_code, oc.destination_country, ''),
					'coordinates', jsonb_build_object('latitude', ba.latitude, 'longitude', ba.longitude),
					'evidence_label', 'reported'
				),
				jsonb_build_object(
					'step', 'buyer_control',
					'role', 'owner_or_operator',
					'label', COALESCE(NULLIF(buyer_ownership.items->0->>'parent_name', ''), NULLIF(buyer_ownership.items->0->>'owner_name', ''), NULLIF(bc.name, ''), NULLIF(bo.name, ''), ba.name, 'buyer control'),
					'short_label', 'Buyer control',
					'company_id', COALESCE(bc.id::text, bo.id::text, ''),
					'asset_id', COALESCE(ba.id::text, ''),
					'asset', COALESCE(ba.name, ''),
					'country_code', COALESCE(ba.country_code, oc.destination_country, ''),
					'evidence_label', 'reported'
				),
				jsonb_build_object(
					'step', 'price_spread',
					'role', 'market_context',
					'label', COALESCE(oc.price_context->>'benchmark_key', oc.price_context->>'benchmark', 'open benchmark pending'),
					'short_label', 'Price',
					'benchmark_key', COALESCE(oc.price_context->>'benchmark_key', oc.price_context->>'benchmark', ''),
					'price', oc.price_context->'price',
					'currency', COALESCE(oc.price_context->>'currency', ''),
					'unit', COALESCE(oc.price_context->>'unit', ''),
					'evidence_label', COALESCE(oc.price_context->>'evidence_label', 'estimated')
				)
			),
			'chain_segments', COALESCE(chain_segments.items, '[]'::jsonb),
			'evidence', COALESCE(oc.evidence, '[]'::jsonb),
			'limitations', COALESCE(oc.limitations, ARRAY[]::text[]),
			'generated_at', oc.generated_at::text
		) AS payload
	FROM opportunity oc
	LEFT JOIN assets sa ON sa.id = oc.supplier_asset_id
	LEFT JOIN companies sc ON sc.id = oc.supplier_company_id
	LEFT JOIN companies so ON so.id = sa.owner_company_id
	LEFT JOIN assets ba ON ba.id = oc.buyer_asset_id
	LEFT JOIN companies bc ON bc.id = oc.buyer_company_id
	LEFT JOIN companies bo ON bo.id = ba.owner_company_id
	JOIN LATERAL (
		WITH raw_exposures AS (
			SELECT 'supplier' AS side, pe.*
			FROM private_equity_exposures pe
			WHERE pe.exposed_asset_id = oc.supplier_asset_id
			   OR pe.exposed_company_id = oc.supplier_company_id
			   OR pe.exposed_entity_id IN (
				   SELECT owner_entity_id FROM gem_asset_ownership WHERE asset_id = oc.supplier_asset_id
				   UNION SELECT parent_entity_id FROM gem_asset_ownership WHERE asset_id = oc.supplier_asset_id
				   UNION SELECT operator_entity_id FROM gem_asset_ownership WHERE asset_id = oc.supplier_asset_id
			   )
			UNION ALL
			SELECT 'buyer' AS side, pe.*
			FROM private_equity_exposures pe
			WHERE pe.exposed_asset_id = oc.buyer_asset_id
			   OR pe.exposed_company_id = oc.buyer_company_id
			   OR pe.exposed_entity_id IN (
				   SELECT owner_entity_id FROM gem_asset_ownership WHERE asset_id = oc.buyer_asset_id
				   UNION SELECT parent_entity_id FROM gem_asset_ownership WHERE asset_id = oc.buyer_asset_id
				   UNION SELECT operator_entity_id FROM gem_asset_ownership WHERE asset_id = oc.buyer_asset_id
			   )
		),
		ranked AS (
			SELECT *,
				   row_number() OVER (
					   PARTITION BY COALESCE(NULLIF(investor_entity_id, ''), lower(investor_name))
					   ORDER BY confidence_score DESC, exposure_value DESC NULLS LAST
				   ) AS rn
			FROM raw_exposures
		)
		SELECT
			COALESCE(NULLIF(investor_entity_id, ''), lower(investor_name)) AS investor_key,
			COALESCE(MAX(NULLIF(investor_entity_id, '')), '') AS investor_entity_id,
			MAX(investor_name) AS investor_name,
			bool_or(side = 'supplier') AS supplier_exposure,
			bool_or(side = 'buyer') AS buyer_exposure,
			COUNT(*)::int AS exposure_count,
			COALESCE(SUM(exposure_value), 0)::double precision AS exposure_value,
			COALESCE(MAX(NULLIF(exposure_unit, '')), '') AS exposure_unit,
			ARRAY_REMOVE(ARRAY_AGG(DISTINCT NULLIF(exposure_type, '') ORDER BY NULLIF(exposure_type, '')), NULL) AS exposure_types,
			MAX(confidence_score)::double precision AS confidence_score,
			jsonb_agg(
				jsonb_build_object(
					'side', side,
					'exposure_type', exposure_type,
					'commodity', COALESCE(commodity, ''),
					'country_code', COALESCE(country_code, ''),
					'exposure_value', COALESCE(exposure_value, 0)::double precision,
					'exposure_unit', COALESCE(exposure_unit, ''),
					'share_pct', COALESCE(share_pct, 0)::double precision,
					'evidence_label', evidence_label,
					'confidence_score', COALESCE(confidence_score, 0)::double precision,
					'raw_project_name', COALESCE(raw_payload->>'Project Name', raw_payload->>'ProjectName', raw_payload->>'Terminal Name', '')
				)
				ORDER BY confidence_score DESC, exposure_value DESC NULLS LAST
			) FILTER (WHERE rn <= 6) AS exposures
		FROM ranked
		GROUP BY COALESCE(NULLIF(investor_entity_id, ''), lower(investor_name))
	) inv ON true
	LEFT JOIN LATERAL (
		SELECT jsonb_agg(DISTINCT jsonb_build_object(
			'owner_entity_id', COALESCE(ga.owner_entity_id, ''),
			'owner_name', COALESCE(owner.name, ''),
			'parent_entity_id', COALESCE(ga.parent_entity_id, ''),
			'parent_name', COALESCE(parent.name, ''),
			'share_pct', COALESCE(ga.share_pct, 0)::double precision,
			'evidence_label', ga.evidence_label
		)) AS items
		FROM gem_asset_ownership ga
		LEFT JOIN gem_entities owner ON owner.entity_id = ga.owner_entity_id
		LEFT JOIN gem_entities parent ON parent.entity_id = ga.parent_entity_id
		WHERE ga.asset_id = oc.supplier_asset_id
	) supplier_ownership ON true
	LEFT JOIN LATERAL (
		SELECT jsonb_agg(DISTINCT jsonb_build_object(
			'owner_entity_id', COALESCE(ga.owner_entity_id, ''),
			'owner_name', COALESCE(owner.name, ''),
			'parent_entity_id', COALESCE(ga.parent_entity_id, ''),
			'parent_name', COALESCE(parent.name, ''),
			'share_pct', COALESCE(ga.share_pct, 0)::double precision,
			'evidence_label', ga.evidence_label
		)) AS items
		FROM gem_asset_ownership ga
		LEFT JOIN gem_entities owner ON owner.entity_id = ga.owner_entity_id
		LEFT JOIN gem_entities parent ON parent.entity_id = ga.parent_entity_id
		WHERE ga.asset_id = oc.buyer_asset_id
	) buyer_ownership ON true
	LEFT JOIN LATERAL (
		SELECT jsonb_agg(jsonb_build_object(
			'id', id,
			'vessel_name', vessel_name,
			'product_family', product_family,
			'quantity_best', quantity_best,
			'unit', unit,
			'load_country', load_country,
			'discharge_country', discharge_country,
			'observed_at', observed_at,
			'evidence_label', evidence_label
		) ORDER BY observed_at DESC) AS items
		FROM (
			SELECT ce.id::text AS id, COALESCE(v.name, '') AS vessel_name,
				   COALESCE(ce.product_family, voy.commodity_family, '') AS product_family,
				   COALESCE(ce.payload_best, ce.payload_tons, 0)::double precision AS quantity_best,
				   COALESCE(ce.quantity_unit, 'tons') AS unit,
				   COALESCE(voy.load_country, '') AS load_country,
				   COALESCE(voy.discharge_country, '') AS discharge_country,
				   ce.observed_at::text AS observed_at,
				   'estimated' AS evidence_label
			FROM cargo_estimates ce
			LEFT JOIN voyages voy ON voy.id = ce.voyage_id
			LEFT JOIN vessels v ON v.id = ce.vessel_id
			WHERE COALESCE(ce.product_family, voy.commodity_family, '') ILIKE '%' || COALESCE(oc.commodity, '') || '%'
			   OR voy.load_country ILIKE oc.origin_country
			   OR voy.discharge_country ILIKE oc.destination_country
			ORDER BY ce.observed_at DESC
			LIMIT 3
		) cargo_rows
	) cargo ON true
	LEFT JOIN LATERAL (
		SELECT jsonb_agg(jsonb_build_object(
			'from_step', ocs.from_step,
			'to_step', ocs.to_step,
			'label', ocs.label,
			'geometry_source', ocs.geometry_source,
			'source_key', COALESCE(ocs.source_key, ''),
			'project_id', COALESCE(ocs.project_id, ''),
			'pipeline_name', COALESCE(ocs.pipeline_name, ''),
			'distance_m', ocs.distance_m,
			'evidence_label', ocs.evidence_label,
			'geometry', ST_AsGeoJSON(ocs.geom)::jsonb,
			'properties', COALESCE(ocs.properties, '{}'::jsonb),
			'generated_at', ocs.generated_at::text
		) ORDER BY ocs.segment_order) AS items
		FROM opportunity_chain_segments ocs
		WHERE ocs.opportunity_id = oc.id
		  AND ocs.generated_by = 'opportunity_chain_segments_v1'
	) chain_segments ON true
	LEFT JOIN LATERAL (
		SELECT jsonb_agg(jsonb_build_object(
			'company_id', COALESCE(participant_company_id::text, ''),
			'name', COALESCE(participant_name, ''),
			'product_code', COALESCE(product_code, ''),
			'origin_country', COALESCE(partner_country_code, ''),
			'quantity', COALESCE(total_quantity, 0)::double precision,
			'unit', COALESCE(quantity_unit, ''),
			'latest_month', COALESCE(latest_month::text, ''),
			'ports', port_count,
			'evidence_label', 'reported'
		) ORDER BY latest_month DESC NULLS LAST, total_quantity DESC NULLS LAST) AS items
		FROM (
			SELECT participant_company_id, participant_name, product_code, partner_country_code, MAX(quantity_unit) AS quantity_unit,
				   SUM(quantity) AS total_quantity, MAX(month) AS latest_month, COUNT(DISTINCT NULLIF(port_code, ''))::int AS port_count
			FROM trade_flow_facts
			WHERE source_key = 'eia_company_imports'
			  AND flow_code = 'IMPORT'
			  AND (
				participant_company_id = oc.buyer_company_id
				OR (bc.name IS NOT NULL AND participant_name ILIKE '%' || bc.name || '%')
			  )
			GROUP BY participant_company_id, participant_name, product_code, partner_country_code
			ORDER BY MAX(month) DESC NULLS LAST, SUM(quantity) DESC NULLS LAST
			LIMIT 4
		) imports
	) importer ON true
)
INSERT INTO opportunity_investor_path_snapshots (
	id,
	opportunity_id,
	lane_id,
	commodity,
	origin_country,
	destination_country,
	investor_name,
	investor_entity_id,
	supplier_asset_id,
	buyer_asset_id,
	supplier_company_id,
	buyer_company_id,
	score,
	confidence_score,
	investor_control_score,
	evidence_label,
	payload,
	generated_by,
	generated_at
)
SELECT
	payload->>'id',
	opportunity_id,
	lane_id,
	commodity,
	origin_country,
	destination_country,
	investor_name,
	investor_entity_id,
	supplier_asset_id,
	buyer_asset_id,
	supplier_company_id,
	buyer_company_id,
	score,
	confidence_score,
	investor_control_score,
	'inferred',
	payload,
	'opportunity_investor_paths_v1',
	now()
FROM paths
ON CONFLICT (id) DO UPDATE SET
	opportunity_id = EXCLUDED.opportunity_id,
	lane_id = EXCLUDED.lane_id,
	commodity = EXCLUDED.commodity,
	origin_country = EXCLUDED.origin_country,
	destination_country = EXCLUDED.destination_country,
	investor_name = EXCLUDED.investor_name,
	investor_entity_id = EXCLUDED.investor_entity_id,
	supplier_asset_id = EXCLUDED.supplier_asset_id,
	buyer_asset_id = EXCLUDED.buyer_asset_id,
	supplier_company_id = EXCLUDED.supplier_company_id,
	buyer_company_id = EXCLUDED.buyer_company_id,
	score = EXCLUDED.score,
	confidence_score = EXCLUDED.confidence_score,
	investor_control_score = EXCLUDED.investor_control_score,
	evidence_label = EXCLUDED.evidence_label,
	payload = EXCLUDED.payload,
	generated_at = now()
`
