package predictive

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	STSPairPredictionSignalType = "commercial_sts_v1"
	legacySTSPairSignalType     = "sts_pair_prediction"
	defaultPairLimit            = 250
	defaultMinPairProbability   = 60
	commercialSTSModelVersion   = "commercial_sts_v1"
)

type STSPairPredictionInput struct {
	DistanceM                float64
	AvgSOG                   float64
	BothTankers              bool
	InKnownSTSZone           bool
	ZoneName                 string
	MaritimeContextType      string
	MaritimeContextDistanceM float64
	NearestTerminalDistanceM float64
	TimeSkewSeconds          float64
	FreshnessSeconds         float64
	CandidateStage           string
	ProductCompatible        bool
	HasCargoEstimate         bool
	HasDraftSignal           bool
	SupplierLinkedVessel     bool
	BuyerLinkedVessel        bool
	OpportunityMatched       bool
	SharedCommercialNetwork  bool
	MarketPressureScore      float64
	PriceContextAvailable    bool
	PriorSTSBehavior         bool
}

type STSPairPredictionScore struct {
	FuturePairProbability float64               `json:"future_pair_probability"`
	ContextLabel          string                `json:"context_label"`
	ReviewTier            string                `json:"review_tier"`
	Factors               []STSPredictionFactor `json:"factors"`
	Penalties             []string              `json:"penalties,omitempty"`
	Limitations           []string              `json:"limitations"`
	Disclaimer            string                `json:"disclaimer"`
}

type STSPredictionFactor struct {
	Name   string  `json:"name"`
	Score  float64 `json:"score"`
	Detail string  `json:"detail"`
}

type pairPredictionCandidate struct {
	PairKey                  string
	CandidateStage           string
	MMSIA                    string
	MMSIB                    string
	NameA                    string
	NameB                    string
	ClassA                   string
	ClassB                   string
	Lat                      float64
	Lon                      float64
	DistanceM                float64
	AvgSOG                   float64
	TimeSkewSeconds          float64
	FreshnessSeconds         float64
	LatestA                  time.Time
	LatestB                  time.Time
	LatA                     float64
	LonA                     float64
	LatB                     float64
	LonB                     float64
	DestinationA             string
	DestinationB             string
	OwnerCompanyA            string
	OperatorCompanyA         string
	OwnerCompanyB            string
	OperatorCompanyB         string
	InKnownSTSZone           bool
	ZoneName                 string
	MaritimeContextName      string
	MaritimeContextType      string
	MaritimeContextDistanceM float64
	NearestTerminalName      string
	NearestTerminalKind      string
	NearestTerminalDistanceM float64
	CargoAProduct            string
	CargoBProduct            string
	CargoABest               float64
	CargoBBest               float64
	ProductHint              string
	ProductCompatible        bool
	OpportunityID            string
	LaneID                   string
	OpportunityCommodity     string
	OpportunityScore         float64
	SupplierLinked           bool
	BuyerLinked              bool
	MarketPressureScore      float64
	PriceBenchmark           string
	Price                    float64
	PriceCurrency            string
	PriceUnit                string
	PriorSTSEvents           int
}

type scoredPairPrediction struct {
	pairPredictionCandidate
	Score STSPairPredictionScore
}

func ScoreSTSPairPrediction(in STSPairPredictionInput) STSPairPredictionScore {
	score := 28.0
	factors := []STSPredictionFactor{}
	penalties := []string{}
	add := func(name string, pts float64, detail string) {
		factors = append(factors, STSPredictionFactor{Name: name, Score: math.Round(pts), Detail: detail})
		score += pts
	}
	penalize := func(pts float64, reason string) {
		score -= pts
		penalties = append(penalties, reason)
	}

	switch {
	case in.DistanceM <= 500:
		add("current_pair_distance", 22, fmt.Sprintf("vessels %.0f m apart", in.DistanceM))
	case in.DistanceM <= 1500:
		add("current_pair_distance", 16, fmt.Sprintf("vessels %.0f m apart", in.DistanceM))
	case in.DistanceM <= 5000:
		add("current_pair_distance", 10, fmt.Sprintf("vessels %.0f m apart", in.DistanceM))
	case in.DistanceM <= 50000:
		add("route_convergence", 4, fmt.Sprintf("vessels %.1f km apart", in.DistanceM/1000))
	default:
		add("route_convergence", -8, fmt.Sprintf("vessels %.1f km apart", in.DistanceM/1000))
		penalties = append(penalties, "pair is geographically loose")
	}
	switch {
	case in.AvgSOG <= 1.5:
		add("slow_behavior", 12, fmt.Sprintf("average speed %.1f kn", in.AvgSOG))
	case in.AvgSOG <= 3:
		add("slow_behavior", 8, fmt.Sprintf("average speed %.1f kn", in.AvgSOG))
	case in.AvgSOG <= 5:
		add("slow_behavior", 3, fmt.Sprintf("average speed %.1f kn", in.AvgSOG))
	default:
		add("slow_behavior", -8, fmt.Sprintf("average speed %.1f kn", in.AvgSOG))
		penalties = append(penalties, "pair is not slow enough for high-confidence STS")
	}
	if in.BothTankers {
		add("vessel_classes", 10, "both vessels are tanker/LNG/LPG/product-class")
	} else {
		add("vessel_classes", -12, "one or both vessels are not tanker-class")
		penalties = append(penalties, "vessel class support is weak")
	}

	contextLabel := "open water"
	if in.InKnownSTSZone {
		contextLabel = "offshore STS zone"
		add("known_sts_zone", 10, zoneDetail(true, in.ZoneName))
	}
	ctxType := strings.ToLower(strings.TrimSpace(in.MaritimeContextType))
	if isAnchorageOrPort(ctxType) && !in.InKnownSTSZone {
		penalize(25, "port/anchorage context makes this a review candidate")
		contextLabel = maritimeContextLabel(ctxType)
	} else if ctxType != "" {
		contextLabel = maritimeContextLabel(ctxType)
	}
	if in.NearestTerminalDistanceM > 0 && !in.InKnownSTSZone {
		switch {
		case in.NearestTerminalDistanceM <= 1500:
			penalize(22, "very near terminal/facility; possible port co-presence")
			contextLabel = "terminal edge"
		case in.NearestTerminalDistanceM <= 5000:
			penalize(14, "near petroleum terminal/facility")
			if contextLabel == "open water" {
				contextLabel = "terminal edge"
			}
		case in.NearestTerminalDistanceM <= 15000:
			score -= 6
		}
	}
	if in.TimeSkewSeconds > 3600 {
		penalize(12, "latest AIS fixes are not simultaneous")
	} else if in.TimeSkewSeconds > 1800 {
		score -= 6
		penalties = append(penalties, "latest AIS fixes have moderate time skew")
	}
	if in.FreshnessSeconds > 48*3600 {
		penalize(24, "AIS pair is stale")
	} else if in.FreshnessSeconds > 24*3600 {
		penalize(14, "AIS pair is older than 24 hours")
	} else if in.FreshnessSeconds > 6*3600 {
		score -= 7
		penalties = append(penalties, "AIS pair is not live-fresh")
	}

	if in.ProductCompatible {
		add("product_compatibility", 8, "vessel/cargo product families are compatible")
	} else {
		score -= 5
		penalties = append(penalties, "product family is weak or unknown")
	}
	if in.HasCargoEstimate {
		add("cargo_estimate", 8, "AIS draft/DWT cargo estimate exists")
	}
	if in.HasDraftSignal {
		add("draft_load_signal", 6, "draft change supports possible cargo activity")
	}
	if in.SupplierLinkedVessel {
		add("supplier_linked_vessel", 7, "vessel is linked to supplier-side company evidence")
	}
	if in.BuyerLinkedVessel {
		add("buyer_linked_vessel", 7, "vessel is linked to buyer-side company evidence")
	}
	if in.OpportunityMatched {
		add("opportunity_lane_match", 10, "pair maps to an active opportunity lane")
	}
	if in.SharedCommercialNetwork {
		add("shared_commercial_network", 5, "vessels share owner/operator network evidence")
	}
	if in.PriorSTSBehavior {
		add("prior_sts_behavior", 5, "pair or vessels have recent STS behavior")
	}
	if in.MarketPressureScore > 0 {
		add("market_pressure", math.Min(10, in.MarketPressureScore/10), fmt.Sprintf("JODI pressure %.0f/100", in.MarketPressureScore))
	}
	if in.PriceContextAvailable {
		add("price_context", 3, "open benchmark price context is available")
	}

	score = clamp100(math.Round(score))
	return STSPairPredictionScore{
		FuturePairProbability: score,
		ContextLabel:          contextLabel,
		ReviewTier:            pairPredictionTier(score, penalties),
		Factors:               factors,
		Penalties:             penalties,
		Limitations: []string{
			"Prediction is a commercial vessel-pair likelihood from AIS, cargo, route, and market context; it is not a confirmed transfer",
			"Plotted point is the recent AIS pair midpoint, not a title-transfer location",
			"AIS and open data do not confirm cargo grade, volume, ownership transfer, or contract terms",
		},
		Disclaimer: "Commercial STS prediction is inferred from open AIS, vessel, cargo, route, and market context; it is not a confirmed transfer.",
	}
}

func RunSTSPairPredictions(ctx context.Context, pool *pgxpool.Pool) (RunResult, error) {
	started := time.Now()
	candidates, err := loadPairPredictionCandidates(ctx, pool)
	if err != nil {
		return RunResult{}, err
	}
	scored := make([]scoredPairPrediction, 0, len(candidates))
	for _, c := range candidates {
		score := ScoreSTSPairPrediction(STSPairPredictionInput{
			DistanceM:                c.DistanceM,
			AvgSOG:                   c.AvgSOG,
			BothTankers:              true,
			InKnownSTSZone:           c.InKnownSTSZone,
			ZoneName:                 c.ZoneName,
			MaritimeContextType:      c.MaritimeContextType,
			MaritimeContextDistanceM: c.MaritimeContextDistanceM,
			NearestTerminalDistanceM: c.NearestTerminalDistanceM,
			TimeSkewSeconds:          c.TimeSkewSeconds,
			FreshnessSeconds:         c.FreshnessSeconds,
			CandidateStage:           c.CandidateStage,
			ProductCompatible:        c.ProductCompatible,
			HasCargoEstimate:         c.CargoAProduct != "" || c.CargoBProduct != "",
			HasDraftSignal:           c.CargoABest > 0 || c.CargoBBest > 0,
			SupplierLinkedVessel:     c.SupplierLinked,
			BuyerLinkedVessel:        c.BuyerLinked,
			OpportunityMatched:       c.OpportunityID != "",
			SharedCommercialNetwork:  sharedCommercialNetwork(c),
			MarketPressureScore:      c.MarketPressureScore,
			PriceContextAvailable:    c.Price > 0,
			PriorSTSBehavior:         c.PriorSTSEvents > 0,
		})
		if score.FuturePairProbability >= defaultMinPairProbability {
			scored = append(scored, scoredPairPrediction{pairPredictionCandidate: c, Score: score})
		}
	}
	written, err := upsertPairPredictions(ctx, pool, scored, time.Now().UTC())
	if err != nil {
		return RunResult{}, err
	}
	return RunResult{
		Horizons:    []int{24},
		RowsScored:  len(candidates),
		RowsWritten: written,
		DurationMS:  time.Since(started).Milliseconds(),
	}, nil
}

func loadPairPredictionCandidates(ctx context.Context, pool *pgxpool.Pool) ([]pairPredictionCandidate, error) {
	rows, err := pool.Query(ctx, `
		WITH reference AS (
			SELECT COALESCE(MAX(ts), now()) AS max_ts FROM ais_positions
		),
		latest_all AS (
			SELECT DISTINCT ON (p.mmsi)
				p.mmsi,
				p.ts,
				p.lat,
				p.lon,
				p.geom,
				COALESCE(p.speed_knots, 0) AS speed_knots,
				COALESCE(p.destination, '') AS destination,
				COALESCE(v.id::text, '') AS vessel_id,
				COALESCE(v.name, '') AS name,
				COALESCE(ve.vessel_class, v.vessel_type, '') AS vessel_type,
				COALESCE(ve.owner_company_id::text, '') AS owner_company_id,
				COALESCE(ve.operator_company_id::text, '') AS operator_company_id,
				EXTRACT(EPOCH FROM ((SELECT max_ts FROM reference) - p.ts)) AS freshness_seconds
			FROM ais_positions p
			JOIN vessels v ON v.mmsi = p.mmsi
			LEFT JOIN vessel_enrichment ve ON ve.mmsi = p.mmsi
			WHERE p.ts >= (SELECT max_ts FROM reference) - interval '72 hours'
			  AND p.geom IS NOT NULL
			  AND (
			    lower(COALESCE(ve.vessel_class, v.vessel_type, '')) LIKE '%tanker%'
			    OR lower(COALESCE(ve.vessel_class, v.vessel_type, '')) LIKE '%crude%'
			    OR lower(COALESCE(ve.vessel_class, v.vessel_type, '')) LIKE '%product%'
			    OR lower(COALESCE(ve.vessel_class, v.vessel_type, '')) LIKE '%chemical%'
			    OR lower(COALESCE(ve.vessel_class, v.vessel_type, '')) LIKE '%lng%'
			    OR lower(COALESCE(ve.vessel_class, v.vessel_type, '')) LIKE '%lpg%'
			  )
			ORDER BY p.mmsi, p.ts DESC
		),
		latest AS (
			SELECT *
			FROM latest_all
			ORDER BY ts DESC
			LIMIT 300
		),
		cargo AS (
			SELECT DISTINCT ON (ce.vessel_id)
				ce.vessel_id::text AS vessel_id,
				COALESCE(ce.product_family, '') AS product_family,
				COALESCE(ce.payload_best, ce.payload_tons, 0)::double precision AS payload_best
			FROM cargo_estimates ce
			WHERE ce.observed_at >= (SELECT max_ts FROM reference) - interval '14 days'
			ORDER BY ce.vessel_id, ce.observed_at DESC
		),
		pairs AS (
			SELECT
				LEAST(a.mmsi, b.mmsi) || ':' || GREATEST(a.mmsi, b.mmsi) AS pair_key,
				CASE
					WHEN ST_DWithin(a.geom, b.geom, 5000::double precision) THEN 'close_pair'
					ELSE 'commercial_convergence'
				END AS candidate_stage,
				a.mmsi AS mmsi_a,
				b.mmsi AS mmsi_b,
				a.name AS name_a,
				b.name AS name_b,
				a.vessel_type AS class_a,
				b.vessel_type AS class_b,
				((a.lat + b.lat) / 2.0) AS lat,
				((a.lon + b.lon) / 2.0) AS lon,
				ST_Distance(a.geom, b.geom) AS distance_m,
				((a.speed_knots + b.speed_knots) / 2.0) AS avg_sog,
				abs(extract(epoch FROM (a.ts - b.ts))) AS time_skew_seconds,
				GREATEST(a.freshness_seconds, b.freshness_seconds) AS freshness_seconds,
				a.ts AS latest_a,
				b.ts AS latest_b,
				a.lat AS lat_a,
				a.lon AS lon_a,
				b.lat AS lat_b,
				b.lon AS lon_b,
				a.destination AS destination_a,
				b.destination AS destination_b,
				a.owner_company_id AS owner_company_a,
				a.operator_company_id AS operator_company_a,
				b.owner_company_id AS owner_company_b,
				b.operator_company_id AS operator_company_b,
				COALESCE(ca.product_family, '') AS cargo_a_product,
				COALESCE(cb.product_family, '') AS cargo_b_product,
				COALESCE(ca.payload_best, 0)::double precision AS cargo_a_best,
				COALESCE(cb.payload_best, 0)::double precision AS cargo_b_best,
				ST_SetSRID(ST_MakePoint((a.lon + b.lon) / 2.0, (a.lat + b.lat) / 2.0), 4326)::geography AS midpoint
			FROM latest a
			JOIN latest b ON a.mmsi < b.mmsi
			LEFT JOIN cargo ca ON ca.vessel_id = a.vessel_id
			LEFT JOIN cargo cb ON cb.vessel_id = b.vessel_id
			WHERE abs(extract(epoch FROM (a.ts - b.ts))) <= 3600
			  AND (
				(
					abs(a.lat - b.lat) <= 0.06
					AND abs(a.lon - b.lon) <= 0.06
					AND ST_DWithin(a.geom, b.geom, 5000::double precision)
					AND ((a.speed_knots + b.speed_knots) / 2.0) <= 5
				)
				OR (
					abs(a.lat - b.lat) <= 0.6
					AND abs(a.lon - b.lon) <= 0.6
					AND ST_DWithin(a.geom, b.geom, 50000::double precision)
					AND ((a.speed_knots + b.speed_knots) / 2.0) <= 4.5
					AND NULLIF(lower(a.destination), '') IS NOT NULL
					AND lower(a.destination) = lower(b.destination)
				)
			  )
		),
		candidate_pairs AS (
			SELECT *
			FROM pairs
			ORDER BY
				CASE WHEN candidate_stage = 'close_pair' THEN 0 ELSE 1 END,
				distance_m ASC,
				avg_sog ASC
			LIMIT $1
		),
		enriched AS (
			SELECT
				p.*,
				CASE
					WHEN p.cargo_a_product <> '' AND p.cargo_a_product = p.cargo_b_product THEN p.cargo_a_product
					WHEN p.cargo_a_product <> '' THEN p.cargo_a_product
					WHEN p.cargo_b_product <> '' THEN p.cargo_b_product
					WHEN lower(p.class_a || ' ' || p.class_b) LIKE '%lng%' THEN 'lng'
					WHEN lower(p.class_a || ' ' || p.class_b) LIKE '%lpg%' THEN 'lpg'
					WHEN lower(p.class_a || ' ' || p.class_b) LIKE '%product%' OR lower(p.class_a || ' ' || p.class_b) LIKE '%chemical%' THEN 'oil_products'
					ELSE 'crude_oil'
				END AS product_hint
			FROM candidate_pairs p
		)
		SELECT
			e.pair_key,
			e.candidate_stage,
			e.mmsi_a,
			e.mmsi_b,
			e.name_a,
			e.name_b,
			e.class_a,
			e.class_b,
			e.lat,
			e.lon,
			e.distance_m,
			e.avg_sog,
			e.time_skew_seconds,
			e.freshness_seconds,
			e.latest_a,
			e.latest_b,
			e.lat_a,
			e.lon_a,
			e.lat_b,
			e.lon_b,
			e.destination_a,
			e.destination_b,
			e.owner_company_a,
			e.operator_company_a,
			e.owner_company_b,
			e.operator_company_b,
			(z.name IS NOT NULL) AS in_known_sts_zone,
			COALESCE(z.name, '') AS zone_name,
			COALESCE(mc.name, '') AS maritime_context_name,
			COALESCE(mc.kind, '') AS maritime_context_type,
			COALESCE(mc.distance_m, 0)::double precision AS maritime_context_distance_m,
			COALESCE(term.name, '') AS nearest_terminal_name,
			COALESCE(term.kind, '') AS nearest_terminal_kind,
			COALESCE(term.distance_m, 0)::double precision AS nearest_terminal_distance_m,
			e.cargo_a_product,
			e.cargo_b_product,
			e.cargo_a_best,
			e.cargo_b_best,
			e.product_hint,
			CASE
				WHEN e.cargo_a_product = '' OR e.cargo_b_product = '' THEN true
				WHEN e.cargo_a_product = e.cargo_b_product THEN true
				WHEN e.product_hint IN ('crude_oil','oil_products') AND e.cargo_a_product IN ('crude_oil','oil_products','petroleum_liquids') AND e.cargo_b_product IN ('crude_oil','oil_products','petroleum_liquids') THEN true
				WHEN e.product_hint IN ('lpg','lng') AND e.cargo_a_product = e.product_hint AND e.cargo_b_product = e.product_hint THEN true
				ELSE false
			END AS product_compatible,
			COALESCE(opp.id, '') AS opportunity_id,
			COALESCE(opp.lane_id, '') AS lane_id,
			COALESCE(opp.commodity, '') AS opportunity_commodity,
			COALESCE(opp.score, 0)::double precision AS opportunity_score,
			COALESCE(role.supplier_linked, false) AS supplier_linked,
			COALESCE(role.buyer_linked, false) AS buyer_linked,
			COALESCE(mp.pressure_score, 0)::double precision AS market_pressure_score,
			COALESCE(px.benchmark, '') AS price_benchmark,
			COALESCE(px.price, 0)::double precision AS price,
			COALESCE(px.currency, '') AS price_currency,
			COALESCE(px.unit, '') AS price_unit,
			COALESCE(prior.prior_events, 0)::int AS prior_sts_events
		FROM enriched e
		LEFT JOIN LATERAL (
			SELECT name
			FROM sts_zones z
			WHERE z.geom IS NOT NULL AND ST_DWithin(z.geom, e.midpoint, 25000::double precision)
			ORDER BY ST_Distance(z.geom, e.midpoint)
			LIMIT 1
		) z ON true
		LEFT JOIN LATERAL (
			SELECT COALESCE(NULLIF(port_name,''), NULLIF(name,''), context_type) AS name,
			       COALESCE(context_type,'') AS kind,
			       ST_Distance(geom, e.midpoint) AS distance_m
			FROM maritime_context_zones
			WHERE geom IS NOT NULL
			  AND ST_DWithin(geom, e.midpoint, GREATEST(15000::double precision, COALESCE(radius_m, 0)))
			ORDER BY ST_Distance(geom, e.midpoint)
			LIMIT 1
		) mc ON true
		LEFT JOIN LATERAL (
			SELECT COALESCE(name,'') AS name, COALESCE(asset_type,'') AS kind, ST_Distance(geom, e.midpoint) AS distance_m
			FROM assets
			WHERE geom IS NOT NULL
			  AND asset_type IN ('terminal','port','refinery','tank_farm','storage','berth','lng_terminal')
			  AND ST_DWithin(geom, e.midpoint, 15000::double precision)
			ORDER BY ST_Distance(geom, e.midpoint)
			LIMIT 1
		) term ON true
		LEFT JOIN LATERAL (
			SELECT
				EXISTS (
					SELECT 1
					FROM opportunity_candidates oc
					WHERE oc.status = 'active'
					  AND (
						(e.product_hint = 'crude_oil' AND oc.commodity IN ('CRUDEOIL','OTHERCRUDE','NGL'))
						OR (e.product_hint = 'oil_products' AND oc.commodity IN ('GASDIES','GASOLINE','JETKERO','KEROSENE','NAPHTHA','RESFUEL'))
						OR (e.product_hint = 'lpg' AND oc.commodity IN ('LPG','NGL'))
						OR (e.product_hint = 'lng' AND oc.commodity IN ('GAS','LNG'))
					  )
					  AND oc.supplier_company_id::text IN (e.owner_company_a, e.operator_company_a, e.owner_company_b, e.operator_company_b)
				) AS supplier_linked,
				EXISTS (
					SELECT 1
					FROM opportunity_candidates oc
					WHERE oc.status = 'active'
					  AND (
						(e.product_hint = 'crude_oil' AND oc.commodity IN ('CRUDEOIL','OTHERCRUDE','NGL'))
						OR (e.product_hint = 'oil_products' AND oc.commodity IN ('GASDIES','GASOLINE','JETKERO','KEROSENE','NAPHTHA','RESFUEL'))
						OR (e.product_hint = 'lpg' AND oc.commodity IN ('LPG','NGL'))
						OR (e.product_hint = 'lng' AND oc.commodity IN ('GAS','LNG'))
					  )
					  AND oc.buyer_company_id::text IN (e.owner_company_a, e.operator_company_a, e.owner_company_b, e.operator_company_b)
				) AS buyer_linked
		) role ON true
		LEFT JOIN LATERAL (
			SELECT
				oc.id::text AS id,
				COALESCE(oc.lane_id, '') AS lane_id,
				COALESCE(oc.commodity, '') AS commodity,
				COALESCE(oc.score, 0) AS score
			FROM opportunity_candidates oc
			WHERE oc.status = 'active'
			  AND (
				(e.product_hint = 'crude_oil' AND oc.commodity IN ('CRUDEOIL','OTHERCRUDE','NGL'))
				OR (e.product_hint = 'oil_products' AND oc.commodity IN ('GASDIES','GASOLINE','JETKERO','KEROSENE','NAPHTHA','RESFUEL'))
				OR (e.product_hint = 'lpg' AND oc.commodity IN ('LPG','NGL'))
				OR (e.product_hint = 'lng' AND oc.commodity IN ('GAS','LNG'))
			  )
			  AND oc.supplier_company_id::text IN (e.owner_company_a, e.operator_company_a, e.owner_company_b, e.operator_company_b)
			  AND oc.buyer_company_id::text IN (e.owner_company_a, e.operator_company_a, e.owner_company_b, e.operator_company_b)
			ORDER BY oc.score DESC NULLS LAST
			LIMIT 1
		) opp ON true
		LEFT JOIN LATERAL (
			SELECT GREATEST(MAX(buyer_pressure_score), MAX(supplier_availability_score), MAX((buyer_pressure_score + supplier_availability_score) / 2.0)) AS pressure_score
			FROM market_pressure_scores m
			WHERE m.source_key = 'jodi_oil'
			  AND m.month = (SELECT MAX(month) FROM market_pressure_scores WHERE source_key = 'jodi_oil')
			  AND m.product_code = COALESCE(NULLIF(opp.commodity, ''), CASE
					WHEN e.product_hint = 'crude_oil' THEN 'CRUDEOIL'
					WHEN e.product_hint = 'oil_products' THEN 'GASDIES'
					WHEN e.product_hint = 'lpg' THEN 'LPG'
					WHEN e.product_hint = 'lng' THEN 'GAS'
					ELSE 'CRUDEOIL'
			  END)
		) mp ON true
		LEFT JOIN LATERAL (
			SELECT location_name AS benchmark, price, currency, unit
			FROM prices
			WHERE price_type = 'eia_spot'
			  AND price > 0
			  AND (
				(e.product_hint IN ('crude_oil','oil_products','lpg') AND location_name = 'BRENT')
				OR location_name = 'WTI'
			  )
			ORDER BY CASE WHEN location_name = 'BRENT' THEN 0 ELSE 1 END, observed_at DESC
			LIMIT 1
		) px ON true
		LEFT JOIN LATERAL (
			SELECT COUNT(*) AS prior_events
			FROM core_signals cs
			WHERE cs.signal_type = 'sts'
			  AND cs.observed_at >= (SELECT max_ts FROM reference) - interval '30 days'
			  AND (
				(cs.payload->>'mmsi_a' IN (e.mmsi_a, e.mmsi_b))
				OR (cs.payload->>'mmsi_b' IN (e.mmsi_a, e.mmsi_b))
			  )
		) prior ON true
		ORDER BY
			CASE WHEN e.candidate_stage = 'close_pair' THEN 0 ELSE 1 END,
			COALESCE(opp.score, 0) DESC,
			e.distance_m ASC,
			e.avg_sog ASC
		LIMIT $1
	`, defaultPairLimit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []pairPredictionCandidate{}
	for rows.Next() {
		var c pairPredictionCandidate
		if err := rows.Scan(
			&c.PairKey, &c.CandidateStage, &c.MMSIA, &c.MMSIB, &c.NameA, &c.NameB, &c.ClassA, &c.ClassB,
			&c.Lat, &c.Lon, &c.DistanceM, &c.AvgSOG, &c.TimeSkewSeconds, &c.FreshnessSeconds,
			&c.LatestA, &c.LatestB, &c.LatA, &c.LonA, &c.LatB, &c.LonB,
			&c.DestinationA, &c.DestinationB, &c.OwnerCompanyA, &c.OperatorCompanyA, &c.OwnerCompanyB, &c.OperatorCompanyB,
			&c.InKnownSTSZone, &c.ZoneName, &c.MaritimeContextName, &c.MaritimeContextType,
			&c.MaritimeContextDistanceM, &c.NearestTerminalName, &c.NearestTerminalKind, &c.NearestTerminalDistanceM,
			&c.CargoAProduct, &c.CargoBProduct, &c.CargoABest, &c.CargoBBest, &c.ProductHint, &c.ProductCompatible,
			&c.OpportunityID, &c.LaneID, &c.OpportunityCommodity, &c.OpportunityScore, &c.SupplierLinked, &c.BuyerLinked,
			&c.MarketPressureScore, &c.PriceBenchmark, &c.Price, &c.PriceCurrency, &c.PriceUnit, &c.PriorSTSEvents,
		); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func upsertPairPredictions(ctx context.Context, pool *pgxpool.Pool, pairs []scoredPairPrediction, now time.Time) (int, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `
		UPDATE predictive_signals
		SET expires_at = now()
		WHERE signal_type IN ($1, $2)
		  AND (expires_at IS NULL OR expires_at > now())
	`, STSPairPredictionSignalType, legacySTSPairSignalType); err != nil {
		return 0, err
	}
	written := 0
	for _, pair := range pairs {
		payload, _ := json.Marshal(pairPredictionPayload(pair, now))
		tag, err := tx.Exec(ctx, `
			UPDATE predictive_signals SET
				tier = 'prediction',
				confidence_score = $2::numeric,
				horizon_hours = 24,
				payload = $3::jsonb,
				predicted_at = now(),
				geom = ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography,
				expires_at = now() + interval '2 hours'
			WHERE signal_type = $1 AND payload->>'pair_key' = $6
		`, STSPairPredictionSignalType, pair.Score.FuturePairProbability, payload, pair.Lon, pair.Lat, pair.PairKey)
		if err != nil {
			return written, err
		}
		if tag.RowsAffected() > 0 {
			written += int(tag.RowsAffected())
			continue
		}
		tag, err = tx.Exec(ctx, `
			INSERT INTO predictive_signals (
				signal_type, entity_type, tier, confidence_score, horizon_hours,
				payload, predicted_at, geom, expires_at
			)
			VALUES (
				$1, 'vessel_pair', 'prediction', $2::numeric, 24,
				$3::jsonb, now(), ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography,
				now() + interval '2 hours'
			)
		`, STSPairPredictionSignalType, pair.Score.FuturePairProbability, payload, pair.Lon, pair.Lat)
		if err != nil {
			return written, err
		}
		written += int(tag.RowsAffected())
	}
	if err := tx.Commit(ctx); err != nil {
		return written, err
	}
	return written, nil
}

func pairPredictionPayload(pair scoredPairPrediction, now time.Time) map[string]any {
	title := stsPairTitle(pair.NameA, pair.NameB, pair.MMSIA, pair.MMSIB)
	payload := map[string]any{
		"pair_key":                pair.PairKey,
		"model_version":           commercialSTSModelVersion,
		"prediction_kind":         "commercial_vessel_pair",
		"name":                    title,
		"event_title":             title,
		"mmsi_a":                  pair.MMSIA,
		"mmsi_b":                  pair.MMSIB,
		"vessel_a_name":           pair.NameA,
		"vessel_b_name":           pair.NameB,
		"vessel_a_class":          pair.ClassA,
		"vessel_b_class":          pair.ClassB,
		"event_lat":               pair.Lat,
		"event_lon":               pair.Lon,
		"future_pair_probability": pair.Score.FuturePairProbability,
		"confidence_score":        pair.Score.FuturePairProbability,
		"horizon_hours":           24,
		"context_label":           pair.Score.ContextLabel,
		"review_tier":             pair.Score.ReviewTier,
		"candidate_stage":         pair.CandidateStage,
		"distance_m":              pair.DistanceM,
		"avg_sog":                 pair.AvgSOG,
		"time_skew_seconds":       pair.TimeSkewSeconds,
		"freshness_seconds":       pair.FreshnessSeconds,
		"latest_a":                pair.LatestA.UTC().Format(time.RFC3339),
		"latest_b":                pair.LatestB.UTC().Format(time.RFC3339),
		"vessel_a_position":       map[string]any{"lat": pair.LatA, "lon": pair.LonA, "ts": pair.LatestA.UTC().Format(time.RFC3339)},
		"vessel_b_position":       map[string]any{"lat": pair.LatB, "lon": pair.LonB, "ts": pair.LatestB.UTC().Format(time.RFC3339)},
		"vessel_a_destination":    pair.DestinationA,
		"vessel_b_destination":    pair.DestinationB,
		"known_sts_zone":          pair.InKnownSTSZone,
		"zone_name":               pair.ZoneName,
		"product_hint":            pair.ProductHint,
		"product_compatible":      pair.ProductCompatible,
		"quantity_range":          quantityRange(pair),
		"supplier_candidate":      commercialSidePayload(pair.SupplierLinked, pair.OwnerCompanyA, pair.OperatorCompanyA, pair.OwnerCompanyB, pair.OperatorCompanyB),
		"buyer_candidate":         commercialSidePayload(pair.BuyerLinked, pair.OwnerCompanyA, pair.OperatorCompanyA, pair.OwnerCompanyB, pair.OperatorCompanyB),
		"lane_id":                 pair.LaneID,
		"opportunity_ids":         stringList(pair.OpportunityID),
		"opportunity_commodity":   pair.OpportunityCommodity,
		"opportunity_score":       pair.OpportunityScore,
		"route_rationale":         routeRationale(pair),
		"market_pressure":         map[string]any{"score": pair.MarketPressureScore, "source": "jodi_oil"},
		"price_context":           priceContext(pair),
		"prior_sts_events":        pair.PriorSTSEvents,
		"factors":                 pair.Score.Factors,
		"penalties":               pair.Score.Penalties,
		"evidence_chain":          evidenceChain(pair),
		"limitations":             pair.Score.Limitations,
		"disclaimer":              pair.Score.Disclaimer,
		"predicted_at":            now.UTC().Format(time.RFC3339),
	}
	if pair.MaritimeContextName != "" || pair.MaritimeContextType != "" {
		payload["maritime_context"] = map[string]any{
			"name":       pair.MaritimeContextName,
			"kind":       pair.MaritimeContextType,
			"distance_m": pair.MaritimeContextDistanceM,
		}
	}
	if pair.NearestTerminalName != "" || pair.NearestTerminalKind != "" {
		payload["nearest_oil_terminal"] = map[string]any{
			"name":       pair.NearestTerminalName,
			"kind":       pair.NearestTerminalKind,
			"distance_m": pair.NearestTerminalDistanceM,
		}
	}
	return payload
}

func quantityRange(pair scoredPairPrediction) map[string]any {
	best := math.Max(pair.CargoABest, pair.CargoBBest)
	if best <= 0 {
		return map[string]any{"status": "unknown"}
	}
	return map[string]any{
		"low":    math.Round(best * 0.75),
		"best":   math.Round(best),
		"high":   math.Round(best * 1.25),
		"unit":   "tons",
		"method": "ais_draft_delta_v1",
	}
}

func commercialSidePayload(linked bool, ownerA, operatorA, ownerB, operatorB string) map[string]any {
	return map[string]any{
		"linked":        linked,
		"owner_a":       ownerA,
		"operator_a":    operatorA,
		"owner_b":       ownerB,
		"operator_b":    operatorB,
		"evidence":      "vessel owner/operator company match where available",
		"evidence_tier": "reported_or_inferred",
	}
}

func routeRationale(pair scoredPairPrediction) string {
	if pair.LaneID != "" {
		return "matched active opportunity lane " + pair.LaneID
	}
	if pair.DestinationA != "" && strings.EqualFold(pair.DestinationA, pair.DestinationB) {
		return "vessels share AIS destination " + pair.DestinationA
	}
	if pair.CandidateStage == "close_pair" {
		return "close slow tanker pair with commercial context pending"
	}
	return "route convergence candidate with commercial context pending"
}

func priceContext(pair scoredPairPrediction) map[string]any {
	if pair.Price <= 0 {
		return map[string]any{"status": "not_available"}
	}
	return map[string]any{
		"benchmark":      pair.PriceBenchmark,
		"price":          pair.Price,
		"currency":       pair.PriceCurrency,
		"unit":           pair.PriceUnit,
		"evidence_label": "observed",
	}
}

func evidenceChain(pair scoredPairPrediction) []map[string]any {
	out := []map[string]any{
		{"label": "observed", "source": "ais_positions", "detail": "recent vessel pair positions", "distance_m": pair.DistanceM, "avg_sog": pair.AvgSOG},
		{"label": "reported", "source": "vessels", "detail": "vessel class and identity", "mmsi_a": pair.MMSIA, "mmsi_b": pair.MMSIB},
	}
	if pair.CargoAProduct != "" || pair.CargoBProduct != "" {
		out = append(out, map[string]any{"label": "estimated", "source": "cargo_estimates", "product_a": pair.CargoAProduct, "product_b": pair.CargoBProduct})
	}
	if pair.OpportunityID != "" {
		out = append(out, map[string]any{"label": "inferred", "source": "opportunity_candidates", "opportunity_id": pair.OpportunityID, "lane_id": pair.LaneID})
	}
	if pair.MarketPressureScore > 0 {
		out = append(out, map[string]any{"label": "estimated", "source": "jodi_oil", "score": pair.MarketPressureScore})
	}
	return out
}

func stringList(v string) []string {
	v = strings.TrimSpace(v)
	if v == "" {
		return []string{}
	}
	return []string{v}
}

func sharedCommercialNetwork(c pairPredictionCandidate) bool {
	idsA := []string{c.OwnerCompanyA, c.OperatorCompanyA}
	idsB := []string{c.OwnerCompanyB, c.OperatorCompanyB}
	for _, a := range idsA {
		a = strings.TrimSpace(a)
		if a == "" {
			continue
		}
		for _, b := range idsB {
			if a == strings.TrimSpace(b) {
				return true
			}
		}
	}
	return false
}

func stsPairTitle(nameA, nameB, mmsiA, mmsiB string) string {
	a := strings.TrimSpace(nameA)
	b := strings.TrimSpace(nameB)
	if a == "" {
		a = "MMSI " + strings.TrimSpace(mmsiA)
	}
	if b == "" {
		b = "MMSI " + strings.TrimSpace(mmsiB)
	}
	return a + " <-> " + b
}

func pairPredictionTier(score float64, penalties []string) string {
	switch {
	case score < 45:
		return "low"
	case len(penalties) > 0:
		return "review"
	case score >= 80:
		return "high"
	case score >= 65:
		return "medium"
	default:
		return "review"
	}
}

func Status(ctx context.Context, pool *pgxpool.Pool) StatusResponse {
	if pool == nil {
		return ScaffoldStatus()
	}
	var count int
	var latest sql.NullTime
	err := pool.QueryRow(ctx, `
		SELECT count(*)::int, max(predicted_at)
		FROM predictive_signals
		WHERE signal_type = $1
		  AND tier = 'prediction'
		  AND COALESCE(confidence_score, 0) >= 35
		  AND (expires_at IS NULL OR expires_at > now())
	`, STSPairPredictionSignalType).Scan(&count, &latest)
	if err != nil {
		if isMissingPredictiveTable(err) {
			return ScaffoldStatus()
		}
		st := ScaffoldStatus()
		st.Message = "Predictive status query failed"
		st.Limitations = append(st.Limitations, err.Error())
		return st
	}
	if count == 0 {
		return StatusResponse{
			Tier:    "prediction",
			Status:  "no_candidates",
			Message: "Commercial STS prediction job is active; no current vessel pairs are above threshold",
			SignalTypes: []string{
				STSPairPredictionSignalType,
			},
			Signals: []any{},
			Limitations: []string{
				"no map prediction is shown when no vessel pair clears the threshold",
				"commercial predictions depend on AIS freshness, tanker classification, cargo estimates, and opportunity context",
				"AIS does not confirm cargo transfer, cargo grade, or title change",
			},
		}
	}
	latestAt := ""
	if latest.Valid {
		latestAt = latest.Time.UTC().Format(time.RFC3339)
	}
	return StatusResponse{
		Tier:    "prediction",
		Status:  "available",
		Message: "Commercial STS predictions are available",
		SignalTypes: []string{
			STSPairPredictionSignalType,
		},
		Signals: []any{
			map[string]any{"signal_type": STSPairPredictionSignalType, "active_rows": count, "latest_predicted_at": latestAt},
		},
		Limitations: []string{
			"commercial STS predictions are likely vessel-pair candidates, not confirmed transfers",
			"confidence depends on AIS freshness and open commercial evidence",
			"deterministic first version; no trained classifier is served",
		},
	}
}

func zoneDetail(inZone bool, name string) string {
	if !inZone {
		return "outside known STS zones"
	}
	if strings.TrimSpace(name) == "" {
		return "inside known STS zone"
	}
	return "inside known STS zone: " + strings.TrimSpace(name)
}

func maritimeContextLabel(t string) string {
	t = strings.ToLower(strings.TrimSpace(t))
	switch {
	case strings.Contains(t, "anchorage"):
		return "port anchorage"
	case strings.Contains(t, "berth"):
		return "berth"
	case strings.Contains(t, "port"), strings.Contains(t, "harbour"), strings.Contains(t, "harbor"):
		return "port"
	default:
		return t
	}
}

func isAnchorageOrPort(t string) bool {
	t = strings.ToLower(strings.TrimSpace(t))
	return strings.Contains(t, "anchorage") || strings.Contains(t, "port") || strings.Contains(t, "harbour") || strings.Contains(t, "harbor") || strings.Contains(t, "berth")
}

func clamp100(v float64) float64 {
	if v < 0 {
		return 0
	}
	if v > 100 {
		return 100
	}
	return v
}

func isMissingPredictiveTable(err error) bool {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code == "42P01" || pgErr.Code == "42703"
	}
	return false
}
