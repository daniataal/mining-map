package ingestion

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const oilOpportunityCandidatesJobType = "oil_opportunity_candidates"

type OilOpportunityOptions struct {
	Month              string  `json:"month,omitempty"`
	MinBuyerPressure   float64 `json:"min_buyer_pressure,omitempty"`
	MinSupplierScore   float64 `json:"min_supplier_score,omitempty"`
	MaxAssetsPerMarket int     `json:"max_assets_per_market,omitempty"`
	Limit              int     `json:"limit,omitempty"`
}

type OilOpportunityResult struct {
	Month          string `json:"month"`
	RowsWritten    int64  `json:"rows_written"`
	ChainSegments  int64  `json:"chain_segments"`
	ChainRefreshMs int64  `json:"chain_refresh_ms"`
	DurationMillis int64  `json:"duration_ms"`
}

func (s *Service) processOilOpportunityCandidates(ctx context.Context, jobID uuid.UUID, payload []byte) error {
	opts := OilOpportunityOptions{}
	if len(payload) > 0 {
		_ = json.Unmarshal(payload, &opts)
	}
	res, err := s.GenerateOilOpportunityCandidates(ctx, opts)
	report, _ := json.Marshal(res)
	if err != nil {
		return s.finishIntelJob(ctx, jobID, "failed", report, err)
	}
	return s.finishIntelJob(ctx, jobID, "completed", report, nil)
}

func (s *Service) GenerateOilOpportunityCandidates(ctx context.Context, opts OilOpportunityOptions) (OilOpportunityResult, error) {
	started := time.Now()
	if opts.MinBuyerPressure <= 0 {
		opts.MinBuyerPressure = 75
	}
	if opts.MinSupplierScore <= 0 {
		opts.MinSupplierScore = 70
	}
	if opts.MaxAssetsPerMarket <= 0 {
		opts.MaxAssetsPerMarket = 3
	}
	if opts.Limit <= 0 {
		opts.Limit = 5000
	}

	var month time.Time
	var err error
	if opts.Month != "" {
		month, err = parseJODIMonth(opts.Month)
		if err != nil {
			return OilOpportunityResult{}, err
		}
	} else {
		err = s.pool.QueryRow(ctx, `
			SELECT COALESCE(MAX(month), DATE '1900-01-01')
			FROM market_pressure_scores
			WHERE source_key = 'jodi_oil'
		`).Scan(&month)
		if err != nil {
			return OilOpportunityResult{}, err
		}
	}
	res := OilOpportunityResult{Month: formatMonth(month)}
	if month.Year() == 1900 {
		res.DurationMillis = time.Since(started).Milliseconds()
		return res, nil
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return res, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	_, err = tx.Exec(ctx, `
		CREATE TEMP TABLE tmp_country_aliases (
			iso_code TEXT NOT NULL,
			country_name TEXT NOT NULL
		) ON COMMIT DROP
	`)
	if err != nil {
		return res, err
	}
	if _, err := tx.CopyFrom(ctx, pgx.Identifier{"tmp_country_aliases"}, []string{"iso_code", "country_name"}, pgx.CopyFromRows(countryAliasRows())); err != nil {
		return res, err
	}

	if _, err := tx.Exec(ctx, `
		DELETE FROM opportunity_candidates
		WHERE metadata->>'generator' = 'oil_opportunity_v1'
		  AND metadata->>'market_month' = $1
	`, formatMonth(month)); err != nil {
		return res, err
	}

	tag, err := tx.Exec(ctx, oilOpportunitySQL, month, opts.MinBuyerPressure, opts.MinSupplierScore, opts.MaxAssetsPerMarket, opts.Limit)
	if err != nil {
		return res, err
	}
	if err := tx.Commit(ctx); err != nil {
		return res, err
	}
	res.RowsWritten = tag.RowsAffected()
	chainRes, err := s.GenerateOpportunityChainSegments(ctx, OpportunityChainSegmentOptions{Limit: opts.Limit})
	if err != nil {
		return res, err
	}
	res.ChainSegments = chainRes.RowsWritten
	res.ChainRefreshMs = chainRes.DurationMillis
	res.DurationMillis = time.Since(started).Milliseconds()
	return res, nil
}

const oilOpportunitySQL = `
WITH pressure AS (
	SELECT *
	FROM market_pressure_scores
	WHERE source_key = 'jodi_oil'
	  AND month = $1
	  AND confidence_score >= 0.70
	  AND product_code IN (
		'CRUDEOIL',
		'OTHERCRUDE',
		'NGL',
		'LPG',
		'NAPHTHA',
		'GASOLINE',
		'KEROSENE',
		'JETKERO',
		'GASDIES',
		'RESFUEL'
	  )
),
buyer_markets AS (
	SELECT
		p.*,
		a.country_name AS buyer_country_name
	FROM pressure p
	JOIN tmp_country_aliases a ON a.iso_code = p.country_code
	WHERE p.buyer_pressure_score >= $2
),
supplier_markets AS (
	SELECT
		p.*,
		a.country_name AS supplier_country_name
	FROM pressure p
	JOIN tmp_country_aliases a ON a.iso_code = p.country_code
	WHERE p.supplier_availability_score >= $3
),
buyer_assets AS (
	SELECT *
	FROM (
		SELECT
			bm.country_code AS buyer_country,
			bm.buyer_country_name,
			bm.product_code,
			bm.month,
			bm.buyer_pressure_score,
			bm.components AS buyer_components,
			a.id AS buyer_asset_id,
			a.name AS buyer_asset_name,
			a.asset_type AS buyer_asset_type,
			COALESCE(a.operator_company_id, a.owner_company_id) AS buyer_company_id,
			COALESCE(a.confidence_score, 0) AS buyer_asset_confidence,
			EXISTS (
				SELECT 1 FROM private_equity_exposures pe
				WHERE pe.exposed_asset_id = a.id
				   OR pe.exposed_company_id = COALESCE(a.operator_company_id, a.owner_company_id)
			) AS buyer_has_investor_exposure,
			EXISTS (
				SELECT 1 FROM asset_geometries ag
				WHERE ag.asset_id = a.id
			) AS buyer_has_geometry,
			row_number() OVER (
				PARTITION BY bm.country_code, bm.product_code
				ORDER BY COALESCE(a.confidence_score, 0) DESC, a.updated_at DESC NULLS LAST
			) AS rn
		FROM buyer_markets bm
		JOIN assets a ON upper(a.country_code) = bm.buyer_country_name
		WHERE COALESCE(a.operator_company_id, a.owner_company_id) IS NOT NULL
		  AND a.asset_type IN ('refinery', 'terminal', 'lng_terminal', 'storage', 'tank_farm', 'processing_plant', 'plant', 'port')
		  AND oil_asset_supports_product(a.commodities_supported, a.raw_source_payload, bm.product_code)
	) ranked
	WHERE rn <= $4
),
supplier_assets AS (
	SELECT *
	FROM (
		SELECT
			sm.country_code AS supplier_country,
			sm.supplier_country_name,
			sm.product_code,
			sm.month,
			sm.supplier_availability_score,
			sm.components AS supplier_components,
			a.id AS supplier_asset_id,
			a.name AS supplier_asset_name,
			a.asset_type AS supplier_asset_type,
			COALESCE(a.operator_company_id, a.owner_company_id) AS supplier_company_id,
			COALESCE(a.confidence_score, 0) AS supplier_asset_confidence,
			EXISTS (
				SELECT 1 FROM asset_production_facts ap
				WHERE ap.asset_id = a.id OR (a.legacy_id IS NOT NULL AND ap.gem_asset_id = a.legacy_id)
			) AS has_gem_production,
			EXISTS (
				SELECT 1 FROM asset_reserve_facts ar
				WHERE ar.asset_id = a.id OR (a.legacy_id IS NOT NULL AND ar.gem_asset_id = a.legacy_id)
			) AS has_gem_reserves,
			EXISTS (
				SELECT 1 FROM gem_asset_ownership go
				WHERE go.asset_id = a.id OR (a.legacy_id IS NOT NULL AND go.gem_asset_id = a.legacy_id)
			) AS has_gem_ownership,
			EXISTS (
				SELECT 1 FROM private_equity_exposures pe
				WHERE pe.exposed_asset_id = a.id
				   OR pe.exposed_company_id = COALESCE(a.operator_company_id, a.owner_company_id)
			) AS supplier_has_investor_exposure,
			EXISTS (
				SELECT 1 FROM asset_geometries ag
				WHERE ag.asset_id = a.id
			) AS supplier_has_geometry,
			row_number() OVER (
				PARTITION BY sm.country_code, sm.product_code
				ORDER BY
					CASE WHEN EXISTS (
						SELECT 1 FROM asset_production_facts ap
						WHERE ap.asset_id = a.id OR (a.legacy_id IS NOT NULL AND ap.gem_asset_id = a.legacy_id)
					) THEN 0 ELSE 1 END,
					CASE WHEN EXISTS (
						SELECT 1 FROM asset_reserve_facts ar
						WHERE ar.asset_id = a.id OR (a.legacy_id IS NOT NULL AND ar.gem_asset_id = a.legacy_id)
					) THEN 0 ELSE 1 END,
					CASE WHEN a.legacy_table = 'gem_global_extraction_tracker' THEN 0 ELSE 1 END,
					CASE WHEN a.asset_type IN ('processing_plant', 'pipeline', 'terminal') THEN 0 ELSE 1 END,
					COALESCE(a.confidence_score, 0) DESC,
					a.updated_at DESC NULLS LAST
			) AS rn
		FROM supplier_markets sm
		JOIN assets a ON upper(a.country_code) = sm.supplier_country_name
		WHERE COALESCE(a.operator_company_id, a.owner_company_id) IS NOT NULL
		  AND a.asset_type IN ('processing_plant', 'pipeline', 'terminal', 'lng_terminal', 'storage', 'tank_farm', 'refinery')
		  AND (
			a.legacy_table <> 'gem_global_extraction_tracker'
			OR sm.product_code IN ('CRUDEOIL', 'OTHERCRUDE', 'NGL')
		  )
		  AND (
			sm.product_code IN ('CRUDEOIL', 'OTHERCRUDE', 'NGL')
			OR a.asset_type IN ('refinery', 'terminal', 'lng_terminal', 'storage', 'tank_farm')
		  )
		  AND oil_asset_supports_product(a.commodities_supported, a.raw_source_payload, sm.product_code)
	) ranked
	WHERE rn <= $4
),
pairs AS (
	SELECT
		s.product_code,
		s.supplier_country,
		b.buyer_country,
		s.supplier_company_id,
		b.buyer_company_id,
		s.supplier_asset_id,
		b.buyer_asset_id,
		s.supplier_availability_score,
		b.buyer_pressure_score,
		s.supplier_asset_confidence,
		b.buyer_asset_confidence,
		s.supplier_asset_name,
		b.buyer_asset_name,
		s.supplier_asset_type,
		b.buyer_asset_type,
		s.has_gem_production,
		s.has_gem_reserves,
		s.has_gem_ownership,
		s.supplier_has_investor_exposure,
		b.buyer_has_investor_exposure,
		s.supplier_has_geometry,
		b.buyer_has_geometry,
		COALESCE(px.benchmark_key, '') AS benchmark_key,
		COALESCE(px.price, 0)::double precision AS benchmark_price,
		COALESCE(px.currency, '') AS benchmark_currency,
		COALESCE(px.unit, '') AS benchmark_unit,
		COALESCE(px.observed_at::text, '') AS benchmark_observed_at,
		COALESCE(px.evidence_label, '') AS benchmark_evidence_label,
		COALESCE(px.source_key, '') AS benchmark_source_key,
		EXISTS (
			SELECT 1
			FROM private_equity_exposures spe
			JOIN private_equity_exposures bpe
			  ON COALESCE(NULLIF(spe.investor_entity_id, ''), lower(spe.investor_name)) =
				 COALESCE(NULLIF(bpe.investor_entity_id, ''), lower(bpe.investor_name))
			WHERE (spe.exposed_asset_id = s.supplier_asset_id OR spe.exposed_company_id = s.supplier_company_id)
			  AND (bpe.exposed_asset_id = b.buyer_asset_id OR bpe.exposed_company_id = b.buyer_company_id)
		) AS shared_investor_path,
		s.supplier_components,
		b.buyer_components,
		(
			s.supplier_availability_score * 0.34
			+ b.buyer_pressure_score * 0.34
			+ LEAST(100, (s.supplier_asset_confidence + b.buyer_asset_confidence) * 50) * 0.22
			+ LEAST(100,
				45
				+ CASE WHEN s.has_gem_production THEN 20 ELSE 0 END
				+ CASE WHEN s.has_gem_reserves THEN 15 ELSE 0 END
				+ CASE WHEN s.has_gem_ownership THEN 10 ELSE 0 END
				+ CASE WHEN s.supplier_has_geometry THEN 10 ELSE 0 END
				+ CASE WHEN b.buyer_has_geometry THEN 5 ELSE 0 END
			) * 0.10
			+ CASE WHEN s.supplier_has_geometry THEN 4 ELSE 0 END
			+ CASE WHEN b.buyer_has_geometry THEN 2 ELSE 0 END
			+ CASE WHEN COALESCE(px.price, 0) > 0 THEN 3 ELSE 0 END
			+ CASE
				WHEN EXISTS (
					SELECT 1
					FROM private_equity_exposures spe
					JOIN private_equity_exposures bpe
					  ON COALESCE(NULLIF(spe.investor_entity_id, ''), lower(spe.investor_name)) =
						 COALESCE(NULLIF(bpe.investor_entity_id, ''), lower(bpe.investor_name))
					WHERE (spe.exposed_asset_id = s.supplier_asset_id OR spe.exposed_company_id = s.supplier_company_id)
					  AND (bpe.exposed_asset_id = b.buyer_asset_id OR bpe.exposed_company_id = b.buyer_company_id)
				) THEN 8
				WHEN s.supplier_has_investor_exposure AND b.buyer_has_investor_exposure THEN 5
				WHEN s.supplier_has_investor_exposure OR b.buyer_has_investor_exposure THEN 2
				ELSE 0
			  END
		) AS score
	FROM supplier_assets s
	JOIN buyer_assets b
	  ON b.product_code = s.product_code
	 AND b.buyer_country <> s.supplier_country
	LEFT JOIN LATERAL (
		SELECT source_key, benchmark_key, price, currency, unit, observed_at, evidence_label
		FROM market_price_observations mpo
		WHERE COALESCE(mpo.price, 0) > 0
		  AND (
			(s.product_code IN ('CRUDEOIL', 'OTHERCRUDE', 'NGL') AND mpo.product_code = 'CRUDEOIL')
			OR (s.product_code IN ('GASDIES','GASOLINE','JETKERO','KEROSENE','NAPHTHA','RESFUEL') AND mpo.benchmark_key IN ('BRENT','WB_CRUDE_AVG'))
			OR (s.product_code = 'LPG' AND mpo.benchmark_key IN ('BRENT','WB_CRUDE_AVG','WTI','WB_DUBAI'))
		  )
		ORDER BY
			CASE
				WHEN s.product_code = mpo.product_code THEN 0
				WHEN mpo.benchmark_key = 'BRENT' THEN 1
				ELSE 2
			END,
			array_position(ARRAY['BRENT','WB_CRUDE_AVG','WTI','WB_DUBAI','WB_LNG_JP','WB_NG_EU','WB_NG_US']::text[], mpo.benchmark_key),
			observed_at DESC
		LIMIT 1
	) px ON true
)
INSERT INTO opportunity_candidates (
	opportunity_type,
	commodity,
	origin_country,
	destination_country,
	supplier_company_id,
	buyer_company_id,
	supplier_asset_id,
	buyer_asset_id,
	lane_id,
	score,
	confidence_score,
	evidence_grade,
	supplier_reality_score,
	buyer_reality_score,
	market_pressure_score,
	route_feasibility_score,
	price_context_score,
	investor_control_score,
	risk_discount_score,
	route_summary,
	cargo_summary,
	market_pressure_summary,
	price_context,
	evidence,
	limitations,
	tier,
	status,
	generated_at,
	expires_at,
	metadata
)
SELECT
	'supplier_buyer_lane',
	product_code,
	supplier_country,
	buyer_country,
	supplier_company_id,
	buyer_company_id,
	supplier_asset_id,
	buyer_asset_id,
	'oil:' || product_code || ':' || supplier_country || ':' || buyer_country,
	ROUND(LEAST(100, score)::numeric, 2),
	0.72,
	'inferred',
	ROUND(LEAST(100,
		supplier_availability_score
		+ CASE WHEN has_gem_production THEN 6 ELSE 0 END
		+ CASE WHEN has_gem_reserves THEN 4 ELSE 0 END
		+ CASE WHEN has_gem_ownership THEN 5 ELSE 0 END
	)::numeric, 2),
	ROUND(buyer_pressure_score::numeric, 2),
	ROUND(((supplier_availability_score + buyer_pressure_score) / 2)::numeric, 2),
	LEAST(100,
		45
		+ CASE WHEN has_gem_production THEN 20 ELSE 0 END
		+ CASE WHEN has_gem_reserves THEN 15 ELSE 0 END
		+ CASE WHEN has_gem_ownership THEN 10 ELSE 0 END
		+ CASE WHEN supplier_has_geometry THEN 10 ELSE 0 END
		+ CASE WHEN buyer_has_geometry THEN 5 ELSE 0 END
	),
	CASE WHEN benchmark_price > 0 THEN 35 ELSE 0 END,
	CASE
		WHEN shared_investor_path THEN 80
		WHEN supplier_has_investor_exposure AND buyer_has_investor_exposure THEN 55
		WHEN supplier_has_investor_exposure OR buyer_has_investor_exposure THEN 35
		ELSE 0
	END,
	10,
	jsonb_build_object(
		'origin_country', supplier_country,
		'destination_country', buyer_country,
		'product_code', product_code,
		'route_status', 'market_and_asset_backed_lane',
		'route_evidence', 'JODI pressure plus source-backed assets; vessel route confirmation pending'
	),
	jsonb_build_object(
		'status', 'not_attached',
		'message', 'Attach AIS/voyage/STST candidate in commercial_sts_v1 and cargo_estimates jobs'
	),
	jsonb_build_object(
		'supplier_availability_score', supplier_availability_score,
		'buyer_pressure_score', buyer_pressure_score,
		'gem_supplier_evidence', jsonb_build_object(
			'production', has_gem_production,
			'reserves', has_gem_reserves,
			'ownership', has_gem_ownership,
			'mapped_geometry', supplier_has_geometry
		),
		'buyer_asset_evidence', jsonb_build_object(
			'mapped_geometry', buyer_has_geometry
		),
		'investor_control', jsonb_build_object(
			'supplier_exposure', supplier_has_investor_exposure,
			'buyer_exposure', buyer_has_investor_exposure,
			'shared_investor_path', shared_investor_path
		),
		'supplier_components', supplier_components,
		'buyer_components', buyer_components
	),
	CASE WHEN benchmark_price > 0 THEN jsonb_build_object(
		'source', benchmark_source_key,
		'benchmark_key', benchmark_key,
		'price', benchmark_price,
		'currency', benchmark_currency,
		'unit', benchmark_unit,
		'observed_at', benchmark_observed_at,
		'evidence_label', benchmark_evidence_label,
		'context', CASE
			WHEN product_code = 'LPG' THEN 'open monthly crude benchmark proxy for LPG/NGL context; not a confirmed LPG deal price'
			WHEN product_code IN ('GASDIES','GASOLINE','JETKERO','KEROSENE','NAPHTHA','RESFUEL') THEN 'open monthly crude benchmark proxy for refined-products context; not a confirmed product deal price'
			ELSE 'open monthly benchmark; not a confirmed deal price'
		END
	) ELSE '{}'::jsonb END,
	jsonb_build_array(
		jsonb_build_object('label', 'estimated', 'source', 'jodi_oil', 'month', to_char($1::date, 'YYYY-MM'), 'product_code', product_code),
		jsonb_build_object(
			'label', 'reported',
			'source', 'assets',
			'role', 'supplier_asset',
			'asset_id', supplier_asset_id,
			'asset_name', supplier_asset_name,
			'asset_type', supplier_asset_type,
			'gem_production', has_gem_production,
			'gem_reserves', has_gem_reserves,
			'gem_ownership', has_gem_ownership,
			'mapped_geometry', supplier_has_geometry
		),
		jsonb_build_object('label', 'reported', 'source', 'assets', 'role', 'buyer_asset', 'asset_id', buyer_asset_id, 'asset_name', buyer_asset_name, 'asset_type', buyer_asset_type, 'mapped_geometry', buyer_has_geometry),
		jsonb_build_object('label', 'inferred', 'source', 'private_equity_exposures', 'role', 'investor_control_path', 'supplier_exposure', supplier_has_investor_exposure, 'buyer_exposure', buyer_has_investor_exposure, 'shared_investor_path', shared_investor_path)
	),
	ARRAY[
		'Opportunity is a source-backed lane candidate, not a confirmed sale contract.',
		'Buyer/supplier identity is attached through asset/operator evidence; cargo and route confirmation are pending.',
		'Country matching uses ISO-to-name aliases until company registry normalization is complete.'
	],
	'inferred',
	'active',
	now(),
	now() + interval '45 days',
	jsonb_build_object('generator', 'oil_opportunity_v1', 'market_month', to_char($1::date, 'YYYY-MM'))
FROM pairs
ORDER BY score DESC
LIMIT $5
`

func countryAliasRows() [][]any {
	aliases := []struct {
		iso  string
		name string
	}{
		{"AE", "UNITED ARAB EMIRATES"}, {"AO", "ANGOLA"}, {"AR", "ARGENTINA"}, {"AT", "AUSTRIA"},
		{"AU", "AUSTRALIA"}, {"AZ", "AZERBAIJAN"}, {"BE", "BELGIUM"}, {"BG", "BULGARIA"},
		{"BH", "BAHRAIN"}, {"BR", "BRAZIL"}, {"CA", "CANADA"}, {"CH", "SWITZERLAND"},
		{"CL", "CHILE"}, {"CN", "CHINA"}, {"CO", "COLOMBIA"}, {"CY", "CYPRUS"},
		{"CZ", "CZECHIA"}, {"CZ", "CZECH REPUBLIC"}, {"DE", "GERMANY"}, {"DK", "DENMARK"},
		{"DZ", "ALGERIA"}, {"EC", "ECUADOR"}, {"EE", "ESTONIA"}, {"EG", "EGYPT"},
		{"ES", "SPAIN"}, {"FI", "FINLAND"}, {"FR", "FRANCE"}, {"GB", "UNITED KINGDOM"},
		{"GE", "GEORGIA"}, {"GR", "GREECE"}, {"HK", "HONG KONG"}, {"HR", "CROATIA"},
		{"HU", "HUNGARY"}, {"ID", "INDONESIA"}, {"IE", "IRELAND"}, {"IL", "ISRAEL"},
		{"IN", "INDIA"}, {"IQ", "IRAQ"}, {"IR", "IRAN"}, {"IT", "ITALY"},
		{"JP", "JAPAN"}, {"KR", "SOUTH KOREA"}, {"KW", "KUWAIT"}, {"KZ", "KAZAKHSTAN"},
		{"LB", "LEBANON"}, {"LT", "LITHUANIA"}, {"LU", "LUXEMBOURG"}, {"LV", "LATVIA"},
		{"LY", "LIBYA"}, {"MA", "MOROCCO"}, {"MX", "MEXICO"}, {"MY", "MALAYSIA"},
		{"NG", "NIGERIA"}, {"NL", "NETHERLANDS"}, {"NO", "NORWAY"}, {"NZ", "NEW ZEALAND"},
		{"OM", "OMAN"}, {"PE", "PERU"}, {"PH", "PHILIPPINES"}, {"PK", "PAKISTAN"},
		{"PL", "POLAND"}, {"PT", "PORTUGAL"}, {"QA", "QATAR"}, {"RO", "ROMANIA"},
		{"RS", "SERBIA"}, {"RU", "RUSSIA"}, {"SA", "SAUDI ARABIA"}, {"SE", "SWEDEN"},
		{"SG", "SINGAPORE"}, {"SI", "SLOVENIA"}, {"SK", "SLOVAKIA"}, {"TH", "THAILAND"},
		{"TN", "TUNISIA"}, {"TR", "TURKEY"}, {"TW", "TAIWAN"}, {"UA", "UKRAINE"},
		{"US", "UNITED STATES"}, {"US", "UNITED STATES OF AMERICA"}, {"UY", "URUGUAY"},
		{"VE", "VENEZUELA"}, {"VN", "VIETNAM"}, {"ZA", "SOUTH AFRICA"},
	}
	rows := make([][]any, 0, len(aliases))
	for _, alias := range aliases {
		rows = append(rows, []any{alias.iso, alias.name})
	}
	return rows
}
