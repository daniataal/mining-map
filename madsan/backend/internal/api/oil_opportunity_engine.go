package api

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/madsan/intelligence/internal/markets"
)

func (s *Server) listIntelOpportunities(w http.ResponseWriter, r *http.Request) {
	limit := boundedLimit(r.URL.Query().Get("limit"), 50, 100)
	minScore, _ := strconv.ParseFloat(strings.TrimSpace(r.URL.Query().Get("min_score")), 64)
	opportunityType := firstNonEmpty(r.URL.Query().Get("opportunity_type"), r.URL.Query().Get("role"))

	rows, err := s.pool.Query(r.Context(), `
		SELECT
			id::text,
			opportunity_type,
			COALESCE(commodity, ''),
			COALESCE(origin_country, ''),
			COALESCE(destination_country, ''),
			COALESCE(supplier_company_id::text, ''),
			COALESCE(buyer_company_id::text, ''),
			COALESCE(supplier_asset_id::text, ''),
			COALESCE(buyer_asset_id::text, ''),
			COALESCE(vessel_id::text, ''),
			COALESCE(lane_id, ''),
			COALESCE(score, 0),
			COALESCE(confidence_score, 0),
			evidence_grade,
			COALESCE(supplier_reality_score, 0),
			COALESCE(buyer_reality_score, 0),
			COALESCE(market_pressure_score, 0),
			COALESCE(route_feasibility_score, 0),
			COALESCE(price_context_score, 0),
			COALESCE(investor_control_score, 0),
			COALESCE(risk_discount_score, 0),
			COALESCE(route_summary, '{}'::jsonb)::text,
			COALESCE(cargo_summary, '{}'::jsonb)::text,
			COALESCE(market_pressure_summary, '{}'::jsonb)::text,
			COALESCE(price_context, '{}'::jsonb)::text,
			COALESCE(evidence, '[]'::jsonb)::text,
			COALESCE(limitations, ARRAY[]::text[]),
			tier,
			generated_at::text,
			COALESCE(expires_at::text, '')
		FROM opportunity_candidates
		WHERE status = 'active'
		  AND ($1 = '' OR commodity ILIKE $1 OR commodity ILIKE '%' || $1 || '%')
		  AND ($2 = '' OR origin_country ILIKE $2)
		  AND ($3 = '' OR destination_country ILIKE $3)
		  AND ($4 = '' OR opportunity_type ILIKE $4)
		  AND ($5 = 0 OR COALESCE(score, 0) >= $5)
		ORDER BY score DESC, confidence_score DESC, generated_at DESC
		LIMIT $6
	`, strings.TrimSpace(r.URL.Query().Get("commodity")),
		strings.TrimSpace(firstNonEmpty(r.URL.Query().Get("origin"), r.URL.Query().Get("origin_country"))),
		strings.TrimSpace(firstNonEmpty(r.URL.Query().Get("destination"), r.URL.Query().Get("destination_country"))),
		strings.TrimSpace(opportunityType), minScore, limit)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	out := []map[string]any{}
	for rows.Next() {
		var id, typ, commodity, origin, destination, supplierCompany, buyerCompany, supplierAsset, buyerAsset, vessel, lane string
		var score, confidence, supplierReality, buyerReality, marketPressure, routeFeasibility, priceContext, investorControl, riskDiscount float64
		var evidenceGrade, routeSummary, cargoSummary, marketSummary, priceSummary, evidence, tier, generatedAt, expiresAt string
		var limitations []string
		if err := rows.Scan(&id, &typ, &commodity, &origin, &destination, &supplierCompany, &buyerCompany, &supplierAsset, &buyerAsset, &vessel, &lane,
			&score, &confidence, &evidenceGrade, &supplierReality, &buyerReality, &marketPressure, &routeFeasibility, &priceContext, &investorControl, &riskDiscount,
			&routeSummary, &cargoSummary, &marketSummary, &priceSummary, &evidence, &limitations, &tier, &generatedAt, &expiresAt); err != nil {
			continue
		}
		out = append(out, map[string]any{
			"id":                  id,
			"opportunity_type":    typ,
			"commodity":           commodity,
			"origin_country":      origin,
			"destination_country": destination,
			"supplier_company_id": supplierCompany,
			"buyer_company_id":    buyerCompany,
			"supplier_asset_id":   supplierAsset,
			"buyer_asset_id":      buyerAsset,
			"vessel_id":           vessel,
			"lane_id":             lane,
			"score":               score,
			"confidence_score":    confidence,
			"evidence_grade":      evidenceGrade,
			"score_breakdown": map[string]float64{
				"supplier_reality":  supplierReality,
				"buyer_reality":     buyerReality,
				"market_pressure":   marketPressure,
				"route_feasibility": routeFeasibility,
				"price_context":     priceContext,
				"investor_control":  investorControl,
				"risk_discount":     riskDiscount,
			},
			"route_summary":           jsonBlock(routeSummary, "{}"),
			"cargo_summary":           jsonBlock(cargoSummary, "{}"),
			"market_pressure_summary": jsonBlock(marketSummary, "{}"),
			"price_context":           jsonBlock(priceSummary, "{}"),
			"evidence":                jsonBlock(evidence, "[]"),
			"limitations":             limitations,
			"tier":                    tier,
			"generated_at":            generatedAt,
			"expires_at":              expiresAt,
		})
	}
	writeJSON(w, map[string]any{
		"count":   len(out),
		"items":   out,
		"message": "Open-source-backed opportunity candidates; identities are confirmed only when source evidence supports them.",
	})
}

func (s *Server) listIntelCargoMovements(w http.ResponseWriter, r *http.Request) {
	limit := boundedLimit(r.URL.Query().Get("limit"), 50, 100)
	commodity := strings.TrimSpace(r.URL.Query().Get("commodity"))
	country := strings.TrimSpace(firstNonEmpty(r.URL.Query().Get("country"), r.URL.Query().Get("origin"), r.URL.Query().Get("destination")))
	out := []map[string]any{}

	rows, err := s.pool.Query(r.Context(), `
		WITH enriched AS (
			SELECT
				ce.id::text AS id,
				COALESCE(v.id::text, '') AS vessel_id,
				COALESCE(v.name, '') AS vessel_name,
				COALESCE(v.imo, ve.imo, '') AS imo,
				COALESCE(v.mmsi, voy.mmsi, ve.mmsi, '') AS mmsi,
				COALESCE(ve.vessel_class, v.vessel_type, '') AS vessel_class,
				COALESCE(ve.owner_name, '') AS owner_name,
				COALESCE(ve.operator_name, '') AS operator_name,
				COALESCE(ve.owner_company_id::text, '') AS owner_company_id,
				COALESCE(ve.operator_company_id::text, '') AS operator_company_id,
				COALESCE(ve.owner_profile, '{}'::jsonb)::text AS owner_profile,
				COALESCE(voy.id::text, '') AS voyage_id,
				COALESCE(
					NULLIF(voy.load_port_name, ''),
					CASE WHEN pc.event_type ILIKE '%loading%' THEN pc.terminal_name ELSE '' END,
					''
				) AS load_port_name,
				COALESCE(
					NULLIF(voy.load_country, ''),
					CASE WHEN pc.event_type ILIKE '%loading%' THEN pc.country_code ELSE '' END,
					''
				) AS load_country,
				COALESCE(
					NULLIF(voy.discharge_port_name, ''),
					CASE WHEN pc.event_type ILIKE '%unloading%' THEN pc.terminal_name ELSE '' END,
					NULLIF(dest.destination, ''),
					''
				) AS discharge_port_name,
				COALESCE(
					NULLIF(voy.discharge_country, ''),
					CASE WHEN pc.event_type ILIKE '%unloading%' THEN pc.country_code ELSE '' END,
					''
				) AS discharge_country,
				COALESCE(ce.product_family, voy.commodity_family, '') AS product_family,
				COALESCE(ce.payload_low, 0) AS payload_low,
				COALESCE(ce.payload_best, ce.payload_tons, 0) AS payload_best,
				COALESCE(ce.payload_high, 0) AS payload_high,
				COALESCE(ce.quantity_unit, 'tons') AS quantity_unit,
				COALESCE(ce.method, '') AS method,
				COALESCE(ce.confidence_score, 0) AS confidence_score,
				ce.observed_at::text AS observed_at,
				COALESCE(ce.evidence, '[]'::jsonb)::text AS evidence,
				CASE
					WHEN voy.id IS NOT NULL THEN 'voyage_match'
					WHEN pc.id IS NOT NULL THEN 'port_call_' || COALESCE(NULLIF(pc.event_type, ''), 'visit')
					WHEN NULLIF(dest.destination, '') IS NOT NULL THEN 'ais_destination'
					ELSE ''
				END AS route_source,
				CASE
					WHEN voy.id IS NOT NULL THEN COALESCE(voy.confidence_score, 0)
					WHEN pc.id IS NOT NULL THEN COALESCE(pc.confidence_score, 0)
					WHEN NULLIF(dest.destination, '') IS NOT NULL THEN 35
					ELSE 0
				END AS route_confidence,
				COALESCE(NULLIF(dest.destination, ''), NULLIF(ce.source_payload->>'latest_destination', ''), '') AS latest_destination
			FROM cargo_estimates ce
			LEFT JOIN vessels v ON v.id = ce.vessel_id
			LEFT JOIN LATERAL (
				SELECT vy.*
				FROM voyages vy
				WHERE (ce.voyage_id IS NOT NULL AND vy.id = ce.voyage_id)
				   OR (
					ce.voyage_id IS NULL
					AND (
						(ce.vessel_id IS NOT NULL AND vy.vessel_id = ce.vessel_id)
						OR (COALESCE(v.mmsi, '') <> '' AND vy.mmsi = v.mmsi)
					)
				   )
				ORDER BY
					CASE WHEN ce.voyage_id IS NOT NULL AND vy.id = ce.voyage_id THEN 0 ELSE 1 END,
					ABS(EXTRACT(EPOCH FROM (COALESCE(vy.ended_at, vy.started_at, ce.observed_at) - ce.observed_at))) ASC,
					COALESCE(vy.confidence_score, 0) DESC
				LIMIT 1
			) voy ON true
			LEFT JOIN LATERAL (
				SELECT ve.*
				FROM vessel_enrichment ve
				WHERE (v.id IS NOT NULL AND ve.vessel_id = v.id)
				   OR (COALESCE(v.mmsi, voy.mmsi, '') <> '' AND ve.mmsi = COALESCE(v.mmsi, voy.mmsi))
				ORDER BY (ve.vessel_id = v.id) DESC, ve.fetched_at DESC
				LIMIT 1
			) ve ON true
			LEFT JOIN LATERAL (
				SELECT pc.id::text AS id,
				       COALESCE(a.name, '') AS terminal_name,
				       COALESCE(a.country_code, '') AS country_code,
				       COALESCE(pc.event_type, '') AS event_type,
				       COALESCE(pc.confidence_score, 0) AS confidence_score,
				       COALESCE(pc.departure_ts, pc.arrival_ts) AS event_ts
				FROM port_call_visits pc
				JOIN assets a ON a.id = pc.asset_id
				WHERE COALESCE(v.mmsi, voy.mmsi, ve.mmsi, '') <> ''
				  AND pc.mmsi = COALESCE(v.mmsi, voy.mmsi, ve.mmsi)
				ORDER BY
					ABS(EXTRACT(EPOCH FROM (COALESCE(pc.departure_ts, pc.arrival_ts) - ce.observed_at))) ASC,
					COALESCE(pc.confidence_score, 0) DESC
				LIMIT 1
			) pc ON true
			LEFT JOIN LATERAL (
				SELECT CASE
					WHEN UPPER(TRIM(raw.destination)) IN ('FOR ORDERS', 'FOR ORDER', 'TBA', 'UNKNOWN', 'N/A', 'NA') THEN ''
					ELSE COALESCE(raw.destination, '')
				END AS destination
				FROM (
					SELECT COALESCE(
						NULLIF(TRIM(v.destination), ''),
						NULLIF(TRIM(ap.destination), ''),
						NULLIF(TRIM(ce.source_payload->>'latest_destination'), '')
					) AS destination
					FROM (SELECT 1) seed
					LEFT JOIN LATERAL (
						SELECT destination
						FROM ais_positions ap
						WHERE COALESCE(v.mmsi, voy.mmsi, ve.mmsi, '') <> ''
						  AND ap.mmsi = COALESCE(v.mmsi, voy.mmsi, ve.mmsi)
						  AND NULLIF(TRIM(ap.destination), '') IS NOT NULL
						ORDER BY ap.ts DESC
						LIMIT 1
					) ap ON true
				) raw
			) dest ON true
			WHERE ($1 = '' OR COALESCE(ce.product_family, voy.commodity_family, '') ILIKE '%' || $1 || '%')
		),
		base AS (
			SELECT
				enriched.*,
				row_number() OVER (
					PARTITION BY vessel_id, product_family, load_country, discharge_country
					ORDER BY observed_at DESC, confidence_score DESC
				) AS rn
			FROM enriched
		)
		SELECT
			id, vessel_id, vessel_name, imo, mmsi, vessel_class, owner_name, operator_name,
			owner_company_id, operator_company_id, owner_profile, voyage_id,
			load_port_name, load_country, discharge_port_name, discharge_country,
			product_family, payload_low, payload_best, payload_high, quantity_unit, method,
			confidence_score, observed_at, evidence, route_source, route_confidence, latest_destination
		FROM base
		WHERE rn = 1
		  AND ($2 = '' OR load_country ILIKE $2 OR discharge_country ILIKE $2)
		ORDER BY observed_at DESC
		LIMIT $3
	`, commodity, country, limit)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()
	for rows.Next() {
		out = append(out, s.scanCargoEstimate(r.Context(), rows)...)
	}

	if len(out) < limit {
		mcrRows, err := s.pool.Query(r.Context(), `
				SELECT
					mcr.id::text,
					COALESCE(mcr.vessel_name, ''),
					COALESCE(mcr.imo, ''),
					COALESCE(mcr.mmsi, ''),
					COALESCE(mcr.commodity_family, ''),
					COALESCE(mcr.load_port_name, ''),
					COALESCE(mcr.load_country, ''),
					COALESCE(mcr.discharge_hint, ''),
					COALESCE(mcr.discharge_country, ''),
					COALESCE(mcr.volume_low, 0),
					COALESCE(mcr.volume_best_estimate, 0),
					COALESCE(mcr.volume_high, 0),
					COALESCE(mcr.volume_unit, 'bbl'),
					COALESCE(mcr.volume_method, mcr.recipe, ''),
					COALESCE(mcr.confidence, 0),
					COALESCE(mcr.event_date::text, ''),
					COALESCE(mcr.evidence_chain, '[]'::jsonb)::text,
					COALESCE(mcr.shipper_name, ''),
					COALESCE(mcr.consignee_name, ''),
					COALESCE(mcr.shipper_company_id::text, ''),
					COALESCE(mcr.consignee_company_id::text, ''),
				COALESCE(v.id::text, ''),
				COALESCE(ve.vessel_class, v.vessel_type, ''),
				COALESCE(ve.owner_name, ''),
				COALESCE(ve.operator_name, ''),
				COALESCE(ve.owner_company_id::text, ''),
				COALESCE(ve.operator_company_id::text, ''),
				COALESCE(ve.owner_profile, '{}'::jsonb)::text
			FROM meridian_cargo_records mcr
			LEFT JOIN vessels v ON (mcr.mmsi <> '' AND v.mmsi = mcr.mmsi) OR (mcr.imo <> '' AND v.imo = mcr.imo)
			LEFT JOIN LATERAL (
				SELECT ve.*
				FROM vessel_enrichment ve
				WHERE (v.id IS NOT NULL AND ve.vessel_id = v.id)
				   OR (mcr.mmsi <> '' AND ve.mmsi = mcr.mmsi)
				   OR (mcr.imo <> '' AND ve.imo = mcr.imo)
				ORDER BY (ve.vessel_id = v.id) DESC, ve.fetched_at DESC
				LIMIT 1
			) ve ON true
				WHERE ($1 = '' OR mcr.commodity_family ILIKE '%' || $1 || '%')
				  AND ($2 = '' OR mcr.load_country ILIKE $2 OR mcr.discharge_country ILIKE $2)
				ORDER BY mcr.event_date DESC NULLS LAST, mcr.confidence DESC
			LIMIT $3
		`, commodity, country, limit-len(out))
		if err == nil {
			defer mcrRows.Close()
			for mcrRows.Next() {
				var id, vesselName, imo, mmsi, product, loadPort, loadCountry, dischargePort, dischargeCountry, unit, method, observedAt, evidence string
				var shipperName, consigneeName, shipperCompanyID, consigneeCompanyID, vesselID, vesselClass, owner, operator, ownerCompanyID, operatorCompanyID, ownerProfile string
				var low, best, high, confidence float64
				if err := mcrRows.Scan(&id, &vesselName, &imo, &mmsi, &product, &loadPort, &loadCountry, &dischargePort, &dischargeCountry,
					&low, &best, &high, &unit, &method, &confidence, &observedAt, &evidence,
					&shipperName, &consigneeName, &shipperCompanyID, &consigneeCompanyID, &vesselID, &vesselClass, &owner, &operator, &ownerCompanyID, &operatorCompanyID, &ownerProfile); err != nil {
					continue
				}
				decodedDestination := decodeAISDestination(dischargePort)
				chain := buildCargoCommercialContext(r.Context(), s.pool, cargoCommercialContextInput{
					Source:             "meridian_cargo_records",
					VesselID:           vesselID,
					VesselName:         vesselName,
					IMO:                imo,
					MMSI:               mmsi,
					VesselClass:        vesselClass,
					OwnerName:          owner,
					OperatorName:       operator,
					OwnerCompanyID:     ownerCompanyID,
					OperatorCompanyID:  operatorCompanyID,
					OwnerProfileJSON:   ownerProfile,
					ShipperName:        shipperName,
					ConsigneeName:      consigneeName,
					ShipperCompanyID:   shipperCompanyID,
					ConsigneeCompanyID: consigneeCompanyID,
					ProductFamily:      product,
					LoadPort:           loadPort,
					LoadCountry:        loadCountry,
					DischargePort:      dischargePort,
					DischargeCountry:   dischargeCountry,
					RouteSource:        "meridian_cargo_record",
					RouteConfidence:    confidence,
					DecodedDestination: decodedDestination,
					QuantityMethod:     method,
					EvidenceLabel:      "inferred",
				})
				routeHint := map[string]any{"source": "meridian_cargo_record", "confidence_score": confidence}
				if len(decodedDestination) > 0 {
					routeHint["decoded_destination"] = decodedDestination
				}
				out = append(out, map[string]any{
					"id":               id,
					"source":           "meridian_cargo_records",
					"vessel_id":        vesselID,
					"vessel_name":      vesselName,
					"imo":              imo,
					"mmsi":             mmsi,
					"vessel_class":     vesselClass,
					"owner_name":       owner,
					"operator_name":    operator,
					"product_family":   product,
					"load":             map[string]string{"port": loadPort, "country": loadCountry},
					"discharge":        map[string]string{"port": dischargePort, "country": dischargeCountry},
					"route_hint":       routeHint,
					"quantity":         map[string]any{"low": low, "best": best, "high": high, "unit": unit, "method": method},
					"confidence":       confidence,
					"observed_at":      observedAt,
					"evidence":         jsonBlock(evidence, "[]"),
					"evidence_label":   "inferred",
					"commercial_chain": chain,
				})
			}
		}
	}

	writeJSON(w, map[string]any{
		"count":   len(out),
		"items":   out,
		"message": "Cargo movements combine observed voyages/cargo estimates with MCR-derived clues; quantities are ranges unless source-backed.",
	})
}

func (s *Server) compareIntelArbitrage(w http.ResponseWriter, r *http.Request) {
	commodity := strings.TrimSpace(r.URL.Query().Get("commodity"))
	origin := strings.TrimSpace(r.URL.Query().Get("origin"))
	destination := strings.TrimSpace(r.URL.Query().Get("destination"))
	benchmarks := s.latestBenchmarks(r, commodity)
	if len(benchmarks) == 0 {
		benchmarks = s.latestLegacySpotPrices(r, commodity)
	}
	writeJSON(w, map[string]any{
		"origin":      origin,
		"destination": destination,
		"commodity":   commodity,
		"benchmarks":  benchmarks,
		"landed_margin": map[string]any{
			"status": "indicative_context_only",
			"components": map[string]any{
				"source_price":       firstBenchmark(benchmarks),
				"destination_price":  nil,
				"freight_estimate":   map[string]string{"status": "v2_refinement", "method": "distance, vessel class, bunker proxy, port dwell"},
				"quality_adjustment": map[string]string{"status": "v2_refinement", "method": "crude assay / sulfur / API gravity bands"},
			},
		},
		"limitations": []string{
			"V1 returns benchmark spread context where open prices exist.",
			"Full freight, quality, refining penalty, and landed-cost optimization are V2.",
		},
	})
}

func (s *Server) listIntelImporters(w http.ResponseWriter, r *http.Request) {
	limit := boundedLimit(r.URL.Query().Get("limit"), 50, 100)
	commodity := strings.TrimSpace(firstNonEmpty(r.URL.Query().Get("commodity"), r.URL.Query().Get("product")))
	origin := strings.TrimSpace(firstNonEmpty(r.URL.Query().Get("origin"), r.URL.Query().Get("partner_country")))
	company := strings.TrimSpace(r.URL.Query().Get("company"))
	rows, err := s.pool.Query(r.Context(), `
		SELECT
			COALESCE(participant_company_id::text, ''),
			COALESCE(participant_name, ''),
			COALESCE(product_code, ''),
			COALESCE(MAX(NULLIF(product_name, '')), ''),
			COALESCE(partner_country_code, ''),
			COALESCE(SUM(quantity), 0)::double precision,
			COALESCE(MAX(quantity_unit), ''),
			COUNT(*)::int,
			COALESCE(MAX(month)::text, ''),
			COUNT(DISTINCT NULLIF(port_code, ''))::int,
			ARRAY_REMOVE(ARRAY_AGG(DISTINCT NULLIF(port_state, '') ORDER BY NULLIF(port_state, '')), NULL)
		FROM trade_flow_facts
		WHERE source_key = 'eia_company_imports'
		  AND flow_code = 'IMPORT'
		  AND participant_name IS NOT NULL
		  AND ($1 = '' OR product_code ILIKE '%' || $1 || '%' OR product_name ILIKE '%' || $1 || '%')
		  AND ($2 = '' OR partner_country_code ILIKE $2)
		  AND ($3 = '' OR participant_name ILIKE '%' || $3 || '%')
		GROUP BY participant_company_id, participant_name, product_code, partner_country_code
		ORDER BY MAX(month) DESC NULLS LAST, SUM(quantity) DESC NULLS LAST
		LIMIT $4
	`, commodity, origin, company, limit)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var companyID, name, productCode, productName, originCountry, unit, latestMonth string
		var totalQuantity float64
		var factRows, portCount int
		var states []string
		if err := rows.Scan(&companyID, &name, &productCode, &productName, &originCountry, &totalQuantity, &unit, &factRows, &latestMonth, &portCount, &states); err != nil {
			continue
		}
		out = append(out, map[string]any{
			"company_id":   companyID,
			"name":         name,
			"product_code": productCode,
			"product_name": productName,
			"origin_country": map[string]string{
				"country_code": originCountry,
			},
			"quantity":       map[string]any{"value": totalQuantity, "unit": unit},
			"rows":           factRows,
			"latest_month":   latestMonth,
			"port_count":     portCount,
			"port_states":    states,
			"evidence_label": "reported",
			"source":         "eia_company_imports",
		})
	}
	writeJSON(w, map[string]any{
		"count":   len(out),
		"items":   out,
		"message": "Reported U.S. petroleum importers from EIA Form EIA-814 Company Level Imports; quantities are thousand barrels.",
	})
}

func (s *Server) listIntelMarketPressure(w http.ResponseWriter, r *http.Request) {
	limit := boundedLimit(r.URL.Query().Get("limit"), 50, 200)
	rows, err := s.pool.Query(r.Context(), `
		SELECT
			country_code,
			product_code,
			month::text,
			COALESCE(buyer_pressure_score, 0),
			COALESCE(supplier_availability_score, 0),
			COALESCE(stock_pressure_score, 0),
			COALESCE(import_pressure_score, 0),
			COALESCE(export_pressure_score, 0),
			COALESCE(refinery_pressure_score, 0),
			baseline_years,
			COALESCE(components, '{}'::jsonb)::text,
			evidence_label,
			COALESCE(confidence_score, 0),
			generated_at::text
		FROM market_pressure_scores
		WHERE ($1 = '' OR country_code ILIKE $1)
		  AND ($2 = '' OR product_code ILIKE $2 OR product_code ILIKE '%' || $2 || '%')
		  AND ($3 = '' OR month::text = $3 OR to_char(month, 'YYYY-MM') = $3)
		ORDER BY month DESC, buyer_pressure_score DESC, supplier_availability_score DESC
		LIMIT $4
	`, strings.TrimSpace(firstNonEmpty(r.URL.Query().Get("country"), r.URL.Query().Get("country_code"))),
		strings.TrimSpace(firstNonEmpty(r.URL.Query().Get("product"), r.URL.Query().Get("commodity"))),
		strings.TrimSpace(r.URL.Query().Get("month")), limit)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var country, product, month, components, evidenceLabel, generatedAt string
		var buyer, supplier, stock, imports, exports, refinery, confidence float64
		var baselineYears int
		if err := rows.Scan(&country, &product, &month, &buyer, &supplier, &stock, &imports, &exports, &refinery, &baselineYears, &components, &evidenceLabel, &confidence, &generatedAt); err != nil {
			continue
		}
		out = append(out, map[string]any{
			"country_code":                country,
			"product_code":                product,
			"month":                       month,
			"buyer_pressure_score":        buyer,
			"supplier_availability_score": supplier,
			"components": map[string]any{
				"stock_pressure":    stock,
				"import_pressure":   imports,
				"export_pressure":   exports,
				"refinery_pressure": refinery,
				"raw":               jsonBlock(components, "{}"),
			},
			"baseline_years":   baselineYears,
			"evidence_label":   evidenceLabel,
			"confidence_score": confidence,
			"generated_at":     generatedAt,
		})
	}
	writeJSON(w, map[string]any{"count": len(out), "items": out, "source": "jodi_oil"})
}

func (s *Server) listIntelSTSPredictions(w http.ResponseWriter, r *http.Request) {
	limit := boundedLimit(r.URL.Query().Get("limit"), 50, 100)
	minConfidence, _ := strconv.ParseFloat(strings.TrimSpace(r.URL.Query().Get("min_confidence")), 64)
	rows, err := s.pool.Query(r.Context(), `
		SELECT
			id::text,
			signal_type,
			COALESCE(entity_type, ''),
			COALESCE(entity_id::text, ''),
			tier,
			COALESCE(confidence_score, 0),
			COALESCE(horizon_hours, 0),
			COALESCE(payload, '{}'::jsonb)::text,
			COALESCE(predicted_at::text, ''),
			COALESCE(expires_at::text, '')
		FROM predictive_signals
		WHERE signal_type = 'commercial_sts_v1'
		  AND ($1 = 0 OR COALESCE(confidence_score, 0) >= $1)
		  AND (expires_at IS NULL OR expires_at > now())
		ORDER BY predicted_at DESC NULLS LAST, confidence_score DESC
		LIMIT $2
	`, minConfidence, limit)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, signalType, entityType, entityID, tier, payload, predictedAt, expiresAt string
		var confidence float64
		var horizon int
		if err := rows.Scan(&id, &signalType, &entityType, &entityID, &tier, &confidence, &horizon, &payload, &predictedAt, &expiresAt); err != nil {
			continue
		}
		out = append(out, map[string]any{
			"id":               id,
			"signal_type":      signalType,
			"entity_type":      entityType,
			"entity_id":        entityID,
			"tier":             tier,
			"confidence_score": confidence,
			"horizon_hours":    horizon,
			"payload":          jsonBlock(payload, "{}"),
			"predicted_at":     predictedAt,
			"expires_at":       expiresAt,
			"evidence_label":   "predicted",
		})
	}
	writeJSON(w, map[string]any{
		"count":   len(out),
		"items":   out,
		"message": "Commercial STS predictions are predictive signals, not confirmed transfers.",
	})
}

func (s *Server) getCommercialProfile(w http.ResponseWriter, r *http.Request) {
	entityType := strings.ToLower(strings.TrimSpace(chi.URLParam(r, "type")))
	id := strings.TrimSpace(chi.URLParam(r, "id"))
	switch entityType {
	case "company", "companies":
		s.getCompanyCommercialProfile(w, r, id)
	case "asset", "assets":
		s.getAssetCommercialProfile(w, r, id)
	case "vessel", "vessels":
		s.getVesselCommercialProfile(w, r, id)
	default:
		http.Error(w, "unsupported entity type", http.StatusBadRequest)
	}
}

func (s *Server) getIntelLane(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(chi.URLParam(r, "id"))
	rows, err := s.pool.Query(r.Context(), `
		SELECT
			id::text,
			COALESCE(lane_id, ''),
			opportunity_type,
			COALESCE(commodity, ''),
			COALESCE(origin_country, ''),
			COALESCE(destination_country, ''),
			COALESCE(score, 0),
			COALESCE(route_feasibility_score, 0),
			COALESCE(route_summary, '{}'::jsonb)::text,
			COALESCE(cargo_summary, '{}'::jsonb)::text,
			COALESCE(evidence, '[]'::jsonb)::text,
			COALESCE(limitations, ARRAY[]::text[])
		FROM opportunity_candidates
		WHERE id::text = $1 OR lane_id = $1
		ORDER BY score DESC
		LIMIT 1
	`, id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()
	if !rows.Next() {
		http.Error(w, "lane not found", http.StatusNotFound)
		return
	}
	var opportunityID, laneID, typ, commodity, origin, destination, routeSummary, cargoSummary, evidence string
	var score, routeScore float64
	var limitations []string
	if err := rows.Scan(&opportunityID, &laneID, &typ, &commodity, &origin, &destination, &score, &routeScore, &routeSummary, &cargoSummary, &evidence, &limitations); err != nil {
		http.Error(w, "lane scan failed", http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]any{
		"id":                      firstNonEmpty(laneID, opportunityID),
		"opportunity_id":          opportunityID,
		"opportunity_type":        typ,
		"commodity":               commodity,
		"origin_country":          origin,
		"destination_country":     destination,
		"score":                   score,
		"route_feasibility_score": routeScore,
		"route_summary":           jsonBlock(routeSummary, "{}"),
		"cargo_summary":           jsonBlock(cargoSummary, "{}"),
		"evidence":                jsonBlock(evidence, "[]"),
		"limitations":             limitations,
	})
}

func (s *Server) listIntelInvestorPaths(w http.ResponseWriter, r *http.Request) {
	limit := boundedLimit(r.URL.Query().Get("limit"), 30, 100)
	minScore, _ := strconv.ParseFloat(strings.TrimSpace(r.URL.Query().Get("min_score")), 64)
	commodity := strings.TrimSpace(r.URL.Query().Get("commodity"))
	origin := strings.TrimSpace(firstNonEmpty(r.URL.Query().Get("origin"), r.URL.Query().Get("origin_country")))
	destination := strings.TrimSpace(firstNonEmpty(r.URL.Query().Get("destination"), r.URL.Query().Get("destination_country")))
	investor := strings.TrimSpace(r.URL.Query().Get("investor"))
	assetID := strings.TrimSpace(r.URL.Query().Get("asset_id"))
	opportunityID := strings.TrimSpace(firstNonEmpty(r.URL.Query().Get("opportunity_id"), r.URL.Query().Get("lane_id")))

	if snapshotItems, err := s.listIntelInvestorPathSnapshots(r, commodity, origin, destination, investor, assetID, opportunityID, minScore, limit); err == nil && len(snapshotItems) > 0 {
		writeJSON(w, map[string]any{
			"count":   len(snapshotItems),
			"items":   snapshotItems,
			"message": "Investor paths served from precomputed opportunity_investor_path_snapshots.",
		})
		return
	}

	rows, err := s.pool.Query(r.Context(), `
		WITH opportunity AS (
			SELECT *
			FROM opportunity_candidates
			WHERE status = 'active'
			  AND ($1 = '' OR commodity ILIKE $1 OR commodity ILIKE '%' || $1 || '%')
			  AND ($2 = '' OR origin_country ILIKE $2)
			  AND ($3 = '' OR destination_country ILIKE $3)
			  AND ($4 = 0 OR COALESCE(score, 0) >= $4)
			  AND ($5 = '' OR supplier_asset_id::text = $5 OR buyer_asset_id::text = $5 OR supplier_company_id::text = $5 OR buyer_company_id::text = $5)
			  AND ($6 = '' OR id::text = $6 OR lane_id = $6)
			  AND COALESCE(investor_control_score, 0) > 0
			ORDER BY investor_control_score DESC, score DESC, confidence_score DESC
			LIMIT 20
		)
		SELECT payload::text
		FROM (
			SELECT
				COALESCE(oc.score, 0) AS opp_score,
				COALESCE(inv.confidence_score, 0) AS investor_confidence,
				(inv.supplier_exposure AND inv.buyer_exposure) AS both_sides,
				jsonb_build_object(
					'id', oc.id::text || ':' || inv.investor_key,
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
							'label', COALESCE(
								NULLIF(supplier_ownership.items->0->>'parent_name', ''),
								NULLIF(supplier_ownership.items->0->>'owner_name', ''),
								NULLIF(sc.name, ''),
								NULLIF(so.name, ''),
								sa.name,
								'supplier control'
							),
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
							'label', COALESCE(
								NULLIF(buyer_ownership.items->0->>'parent_name', ''),
								NULLIF(buyer_ownership.items->0->>'owner_name', ''),
								NULLIF(bc.name, ''),
								NULLIF(bo.name, ''),
								ba.name,
								'buyer control'
							),
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
					'chain_segments',
						CASE
							WHEN snapshot_chain.segments IS NOT NULL THEN snapshot_chain.segments
							ELSE COALESCE(chain_geometry.segments, '[]'::jsonb) ||
								CASE
									WHEN sa.latitude IS NOT NULL AND sa.longitude IS NOT NULL AND ba.latitude IS NOT NULL AND ba.longitude IS NOT NULL
									THEN jsonb_build_array(jsonb_build_object(
										'from_step', 'supplier_asset',
										'to_step', 'buyer_asset',
										'label', COALESCE(oc.origin_country, '?') || ' -> ' || COALESCE(oc.destination_country, '?') || ' inferred commercial corridor',
										'geometry_source', 'inferred_direct_corridor',
										'evidence_label', 'inferred',
										'coordinates', jsonb_build_array(
											jsonb_build_array(sa.longitude, sa.latitude),
											jsonb_build_array(ba.longitude, ba.latitude)
										),
										'geometry', ST_AsGeoJSON(ST_MakeLine(
											ST_SetSRID(ST_MakePoint(sa.longitude, sa.latitude), 4326),
											ST_SetSRID(ST_MakePoint(ba.longitude, ba.latitude), 4326)
										))::jsonb
									))
									ELSE '[]'::jsonb
								END
						END,
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
				) ORDER BY ocs.segment_order) AS segments
				FROM opportunity_chain_segments ocs
				WHERE ocs.opportunity_id = oc.id
				  AND ocs.generated_by = 'opportunity_chain_segments_v1'
				  AND (($5 <> '' OR $6 <> '') OR ocs.geometry_source = 'inferred_direct_corridor')
			) snapshot_chain ON true
			LEFT JOIN LATERAL (
				WITH supplier_asset_route_line AS (
					SELECT
						10 AS ord,
						jsonb_build_object(
							'from_step', 'supplier_asset',
							'to_step', 'physical_route',
							'label', COALESCE(sa.name, 'supplier asset') || ' reported geometry',
							'geometry_source', 'asset_geometries',
							'source_key', ag.source_key,
							'evidence_label', 'reported',
							'geometry', ST_AsGeoJSON(ST_SimplifyPreserveTopology(COALESCE(ag.geom_simplified, ag.geom), 0.05))::jsonb
						) AS segment
					FROM asset_geometries ag
					WHERE ag.asset_id = oc.supplier_asset_id
					  AND ($5 <> '' OR $6 <> '')
					  AND snapshot_chain.segments IS NULL
					  AND GeometryType(COALESCE(ag.geom_simplified, ag.geom)) IN ('LINESTRING', 'MULTILINESTRING')
					ORDER BY ag.created_at DESC
					LIMIT 1
				),
				buyer_asset_route_line AS (
					SELECT
						40 AS ord,
						jsonb_build_object(
							'from_step', 'physical_route',
							'to_step', 'buyer_asset',
							'label', COALESCE(ba.name, 'buyer asset') || ' reported geometry',
							'geometry_source', 'asset_geometries',
							'source_key', ag.source_key,
							'evidence_label', 'reported',
							'geometry', ST_AsGeoJSON(ST_SimplifyPreserveTopology(COALESCE(ag.geom_simplified, ag.geom), 0.05))::jsonb
						) AS segment
					FROM asset_geometries ag
					WHERE ag.asset_id = oc.buyer_asset_id
					  AND ($5 <> '' OR $6 <> '')
					  AND snapshot_chain.segments IS NULL
					  AND GeometryType(COALESCE(ag.geom_simplified, ag.geom)) IN ('LINESTRING', 'MULTILINESTRING')
					ORDER BY ag.created_at DESC
					LIMIT 1
				),
				asset_route_lines AS (
					SELECT * FROM supplier_asset_route_line
					UNION ALL
					SELECT * FROM buyer_asset_route_line
				),
				endpoints AS (
					SELECT
						20 AS ord,
						'supplier_asset' AS from_step,
						'physical_route' AS to_step,
						COALESCE(sa.name, 'supplier asset') || ' GEM pipeline access' AS label,
						CASE
							WHEN sa.latitude IS NOT NULL AND sa.longitude IS NOT NULL
							THEN ST_SetSRID(ST_MakePoint(sa.longitude, sa.latitude), 4326)::geography
							ELSE NULL::geography
						END AS point
					UNION ALL
					SELECT
						30 AS ord,
						'physical_route' AS from_step,
						'buyer_asset' AS to_step,
						COALESCE(ba.name, 'buyer asset') || ' GEM pipeline access' AS label,
						CASE
							WHEN ba.latitude IS NOT NULL AND ba.longitude IS NOT NULL
							THEN ST_SetSRID(ST_MakePoint(ba.longitude, ba.latitude), 4326)::geography
							ELSE NULL::geography
						END AS point
				),
				pipeline_access AS (
					SELECT
						ep.ord,
						jsonb_build_object(
							'from_step', ep.from_step,
							'to_step', ep.to_step,
							'label', ep.label,
							'geometry_source', 'pipeline_graph_edges',
							'source_key', COALESCE(hit.metadata->>'source_key', hit.metadata->'tags'->>'source_id', ''),
							'project_id', COALESCE(hit.metadata->>'project_id', hit.metadata->'tags'->>'project_id', ''),
							'pipeline_name', COALESCE(hit.metadata->>'pipeline_name', hit.metadata->>'name', hit.metadata->'tags'->>'name', ''),
							'distance_m', round(ST_Distance(hit.geom, ep.point)::numeric, 1),
							'evidence_label', 'reported',
							'geometry', ST_AsGeoJSON(ST_SimplifyPreserveTopology(hit.geom::geometry, 0.05))::jsonb
						) AS segment
					FROM endpoints ep
					JOIN LATERAL (
						SELECT e.geom, e.metadata
						FROM pipeline_graph_edges e
						WHERE ($5 <> '' OR $6 <> '')
						  AND snapshot_chain.segments IS NULL
						  AND ep.point IS NOT NULL
						  AND e.geom IS NOT NULL
						  AND (e.osm_id LIKE 'gem:%' OR e.osm_id LIKE 'gemgeo:%')
						  AND ST_DWithin(e.geom, ep.point, 25000)
						  AND (
							COALESCE(oc.commodity, '') = ''
							OR (
								oc.commodity ILIKE '%gas%'
								AND (
									COALESCE(e.metadata->>'source_key', '') ILIKE '%gas%'
									OR COALESCE(e.metadata->'tags'->>'fuel_group', '') ILIKE '%gas%'
									OR COALESCE(e.metadata->'tags'->>'fuel', '') ILIKE '%gas%'
								)
							)
							OR (
								oc.commodity ILIKE '%lng%'
								AND (
									COALESCE(e.metadata->>'source_key', '') ILIKE '%gas%'
									OR COALESCE(e.metadata->'tags'->>'fuel_group', '') ILIKE '%gas%'
									OR COALESCE(e.metadata->'tags'->>'fuel', '') ILIKE '%gas%'
								)
							)
							OR (
								(oc.commodity ILIKE '%oil%' OR oc.commodity ILIKE '%crude%' OR oc.commodity ILIKE '%lpg%' OR oc.commodity ILIKE '%ngl%')
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
				)
				SELECT jsonb_agg(segment ORDER BY ord) FILTER (WHERE segment IS NOT NULL) AS segments
				FROM (
					SELECT * FROM asset_route_lines
					UNION ALL
					SELECT * FROM pipeline_access
				) route_segments
			) chain_geometry ON true
			WHERE ($7 = '' OR inv.investor_name ILIKE '%' || $7 || '%')
		) paths
		ORDER BY both_sides DESC, opp_score DESC, investor_confidence DESC
		LIMIT $8
	`, commodity, origin, destination, minScore, assetID, opportunityID, investor, limit)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	out := []json.RawMessage{}
	for rows.Next() {
		var raw string
		if err := rows.Scan(&raw); err != nil {
			continue
		}
		out = append(out, jsonBlock(raw, "{}"))
	}
	writeJSON(w, map[string]any{
		"count":   len(out),
		"items":   out,
		"message": "Investor paths expose named control-chain intelligence: investor exposure, supplier/buyer assets, route context, buyer pressure, cargo clues, and open price context.",
	})
}

func (s *Server) listIntelInvestorPathSnapshots(r *http.Request, commodity, origin, destination, investor, assetID, opportunityID string, minScore float64, limit int) ([]json.RawMessage, error) {
	rows, err := s.pool.Query(r.Context(), `
		SELECT payload::text
		FROM opportunity_investor_path_snapshots
		WHERE generated_by = 'opportunity_investor_paths_v1'
		  AND ($1 = '' OR commodity ILIKE $1 OR commodity ILIKE '%' || $1 || '%')
		  AND ($2 = '' OR origin_country ILIKE $2)
		  AND ($3 = '' OR destination_country ILIKE $3)
		  AND ($4 = 0 OR COALESCE(score, 0) >= $4)
		  AND ($5 = '' OR supplier_asset_id::text = $5 OR buyer_asset_id::text = $5 OR supplier_company_id::text = $5 OR buyer_company_id::text = $5)
		  AND ($6 = '' OR opportunity_id::text = $6 OR lane_id = $6)
		  AND ($7 = '' OR investor_name ILIKE '%' || $7 || '%' OR investor_entity_id = $7)
		ORDER BY investor_control_score DESC, score DESC, confidence_score DESC, generated_at DESC
		LIMIT $8
	`, commodity, origin, destination, minScore, assetID, opportunityID, investor, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []json.RawMessage{}
	for rows.Next() {
		var raw string
		if err := rows.Scan(&raw); err != nil {
			continue
		}
		out = append(out, jsonBlock(raw, "{}"))
	}
	return out, rows.Err()
}

func (s *Server) getInvestorExposure(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(chi.URLParam(r, "id"))
	limit := boundedLimit(r.URL.Query().Get("limit"), 50, 200)
	rows, err := s.pool.Query(r.Context(), `
		SELECT
			id::text,
			COALESCE(investor_entity_id, ''),
			investor_name,
			COALESCE(exposed_entity_id, ''),
			COALESCE(exposed_company_id::text, ''),
			COALESCE(exposed_asset_id::text, ''),
			exposure_type,
			COALESCE(commodity, ''),
			COALESCE(country_code, ''),
			COALESCE(exposure_value, 0),
			COALESCE(exposure_unit, ''),
			COALESCE(share_pct, 0),
			evidence_label,
			COALESCE(confidence_score, 0),
			COALESCE(raw_payload, '{}'::jsonb)::text
		FROM private_equity_exposures
		WHERE investor_entity_id = $1
		   OR lower(investor_name) = lower($1)
		   OR investor_name ILIKE '%' || $1 || '%'
		ORDER BY confidence_score DESC, exposure_value DESC NULLS LAST
		LIMIT $2
	`, id, limit)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var exposureID, investorEntity, investorName, exposedEntity, companyID, assetID, exposureType, commodity, country, unit, evidenceLabel, raw string
		var exposureValue, share, confidence float64
		if err := rows.Scan(&exposureID, &investorEntity, &investorName, &exposedEntity, &companyID, &assetID, &exposureType, &commodity, &country, &exposureValue, &unit, &share, &evidenceLabel, &confidence, &raw); err != nil {
			continue
		}
		out = append(out, map[string]any{
			"id":                 exposureID,
			"investor_entity_id": investorEntity,
			"investor_name":      investorName,
			"exposed_entity_id":  exposedEntity,
			"exposed_company_id": companyID,
			"exposed_asset_id":   assetID,
			"exposure_type":      exposureType,
			"commodity":          commodity,
			"country_code":       country,
			"exposure_value":     exposureValue,
			"exposure_unit":      unit,
			"share_pct":          share,
			"evidence_label":     evidenceLabel,
			"confidence_score":   confidence,
			"raw_payload":        jsonBlock(raw, "{}"),
		})
	}
	writeJSON(w, map[string]any{"count": len(out), "items": out})
}

func (s *Server) scanCargoEstimate(ctx context.Context, rows interface{ Scan(dest ...any) error }) []map[string]any {
	var id, vesselID, vesselName, imo, mmsi, vesselClass, owner, operator, ownerCompanyID, operatorCompanyID, ownerProfile, voyageID string
	var loadPort, loadCountry, dischargePort, dischargeCountry, product, unit, method, observedAt, evidence, routeSource, latestDestination string
	var low, best, high, confidence, routeConfidence float64
	if err := rows.Scan(&id, &vesselID, &vesselName, &imo, &mmsi, &vesselClass, &owner, &operator,
		&ownerCompanyID, &operatorCompanyID, &ownerProfile, &voyageID,
		&loadPort, &loadCountry, &dischargePort, &dischargeCountry,
		&product, &low, &best, &high, &unit, &method, &confidence, &observedAt, &evidence, &routeSource, &routeConfidence, &latestDestination); err != nil {
		return nil
	}
	decodedDestination := decodeAISDestination(latestDestination)
	chain := buildCargoCommercialContext(ctx, s.pool, cargoCommercialContextInput{
		Source:             "cargo_estimates",
		VesselID:           vesselID,
		VesselName:         vesselName,
		IMO:                imo,
		MMSI:               mmsi,
		VesselClass:        vesselClass,
		OwnerName:          owner,
		OperatorName:       operator,
		OwnerCompanyID:     ownerCompanyID,
		OperatorCompanyID:  operatorCompanyID,
		OwnerProfileJSON:   ownerProfile,
		ProductFamily:      product,
		LoadPort:           loadPort,
		LoadCountry:        loadCountry,
		DischargePort:      dischargePort,
		DischargeCountry:   dischargeCountry,
		RouteSource:        routeSource,
		RouteConfidence:    routeConfidence,
		LatestDestination:  latestDestination,
		DecodedDestination: decodedDestination,
		QuantityMethod:     method,
		EvidenceLabel:      "estimated",
	})
	routeHint := map[string]any{"source": routeSource, "confidence_score": routeConfidence, "latest_destination": latestDestination}
	if len(decodedDestination) > 0 {
		routeHint["decoded_destination"] = decodedDestination
	}
	return []map[string]any{{
		"id":               id,
		"source":           "cargo_estimates",
		"vessel_id":        vesselID,
		"voyage_id":        voyageID,
		"vessel_name":      vesselName,
		"imo":              imo,
		"mmsi":             mmsi,
		"vessel_class":     vesselClass,
		"owner_name":       owner,
		"operator_name":    operator,
		"product_family":   product,
		"load":             map[string]string{"port": loadPort, "country": loadCountry},
		"discharge":        map[string]string{"port": dischargePort, "country": dischargeCountry},
		"route_hint":       routeHint,
		"quantity":         map[string]any{"low": low, "best": best, "high": high, "unit": unit, "method": method},
		"confidence":       confidence,
		"observed_at":      observedAt,
		"evidence":         jsonBlock(evidence, "[]"),
		"evidence_label":   "estimated",
		"commercial_chain": chain,
	}}
}

func (s *Server) latestBenchmarks(r *http.Request, commodity string) []map[string]any {
	productHints, benchmarkHints := intelBenchmarkHints(commodity)
	rows, err := s.pool.Query(r.Context(), `
		WITH matched AS (
			SELECT source_key, benchmark_key, COALESCE(product_code, '') AS product_code,
			       COALESCE(country_code, '') AS country_code, price, currency, unit,
			       observed_at, evidence_label, COALESCE(confidence_score, 0) AS confidence_score
			FROM market_price_observations
			WHERE COALESCE(price, 0) > 0
			  AND (
				$1 = ''
				OR product_code ILIKE '%' || $1 || '%'
				OR benchmark_key ILIKE '%' || $1 || '%'
				OR (array_length($2::text[], 1) IS NOT NULL AND product_code = ANY($2::text[]))
				OR (array_length($3::text[], 1) IS NOT NULL AND benchmark_key = ANY($3::text[]))
			  )
		),
		latest AS (
			SELECT *,
			       row_number() OVER (
			       	PARTITION BY source_key, benchmark_key, product_code, country_code
			       	ORDER BY observed_at DESC
			       ) AS rn
			FROM matched
		)
		SELECT source_key, benchmark_key, COALESCE(product_code, ''), COALESCE(country_code, ''),
		       price, currency, unit, observed_at::text, evidence_label, confidence_score
		FROM latest
		WHERE rn = 1
		ORDER BY
			CASE
				WHEN product_code = ANY($2::text[]) THEN 0
				WHEN benchmark_key = ANY($3::text[]) THEN 1
				ELSE 2
			END,
			COALESCE(array_position($3::text[], benchmark_key), 999),
			observed_at DESC
		LIMIT 8
	`, commodity, productHints, benchmarkHints)
	if err != nil {
		return nil
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var source, benchmark, product, country, currency, unit, observedAt, evidenceLabel string
		var price, confidence float64
		if err := rows.Scan(&source, &benchmark, &product, &country, &price, &currency, &unit, &observedAt, &evidenceLabel, &confidence); err != nil {
			continue
		}
		out = append(out, map[string]any{
			"source": source, "benchmark": benchmark, "product_code": product, "country_code": country,
			"price": price, "currency": currency, "unit": unit, "observed_at": observedAt,
			"evidence_label": evidenceLabel, "confidence_score": confidence,
		})
	}
	return out
}

func intelBenchmarkHints(commodity string) ([]string, []string) {
	c := strings.ToUpper(strings.TrimSpace(commodity))
	switch c {
	case "CRUDEOIL", "OTHERCRUDE", "TOTCRUDE", "CRUDE", "OIL":
		return []string{"CRUDEOIL"}, []string{"BRENT", "WTI", "WB_DUBAI", "WB_CRUDE_AVG"}
	case "GAS", "NATGAS", "NATURAL GAS":
		return []string{"GAS"}, []string{"WB_NG_EU", "WB_NG_US", "WB_NG_INDEX"}
	case "LNG":
		return []string{"LNG", "GAS"}, []string{"WB_LNG_JP", "WB_NG_EU", "WB_NG_US"}
	case "LPG":
		return []string{"CRUDEOIL"}, []string{"BRENT", "WB_CRUDE_AVG", "WTI", "WB_DUBAI"}
	case "GASDIES", "GASOLINE", "JETKERO", "KEROSENE", "NAPHTHA", "RESFUEL", "TOTPRODS", "ONONSPEC":
		return []string{"CRUDEOIL"}, []string{"BRENT", "WB_CRUDE_AVG"}
	default:
		if strings.Contains(c, "DIESEL") || strings.Contains(c, "JET") || strings.Contains(c, "FUEL") {
			return []string{"CRUDEOIL"}, []string{"BRENT", "WB_CRUDE_AVG"}
		}
		return nil, nil
	}
}

func (s *Server) latestLegacySpotPrices(r *http.Request, commodity string) []map[string]any {
	primary, secondary := intelLegacyBenchmarkSymbols(commodity)
	rows, err := s.pool.Query(r.Context(), `
		SELECT COALESCE(price_type, ''), COALESCE(location_name, ''), price,
		       COALESCE(currency, ''), COALESCE(unit, ''), COALESCE(observed_at::text, ''), COALESCE(confidence_score, 0)
		FROM prices
		WHERE COALESCE(price, 0) > 0
		  AND price_type = 'eia_spot'
		  AND (
			$1 = ''
			OR location_name ILIKE '%' || $1 || '%'
			OR price_type ILIKE '%' || $1 || '%'
			OR ($2 <> '' AND location_name = $2)
			OR ($3 <> '' AND location_name = $3)
		  )
		ORDER BY observed_at DESC
		LIMIT 8
	`, commodity, primary, secondary)
	if err != nil {
		return nil
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var priceType, location, currency, unit, observedAt string
		var price, confidence float64
		if err := rows.Scan(&priceType, &location, &price, &currency, &unit, &observedAt, &confidence); err != nil {
			continue
		}
		out = append(out, map[string]any{
			"source": "prices", "benchmark": location, "price_type": priceType,
			"price": price, "currency": currency, "unit": unit, "observed_at": observedAt,
			"evidence_label": "observed", "confidence_score": confidence,
		})
	}
	return out
}

func intelLegacyBenchmarkSymbols(commodity string) (string, string) {
	c := strings.ToUpper(strings.TrimSpace(commodity))
	switch c {
	case "CRUDEOIL", "OTHERCRUDE", "TOTCRUDE":
		return "BRENT", "WTI"
	case "GASDIES", "GASOLINE", "JETKERO", "KEROSENE", "NAPHTHA", "LPG", "NGL", "RESFUEL":
		return "BRENT", ""
	}
	switch markets.BenchmarkSymbol(commodity) {
	case "BRENT":
		return "BRENT", "WTI"
	case "WTI":
		return "WTI", "BRENT"
	default:
		return "", ""
	}
}

func (s *Server) getCompanyCommercialProfile(w http.ResponseWriter, r *http.Request, id string) {
	var name, country, companyType, website, phone, email, raw string
	var commodities []string
	var confidence float64
	err := s.pool.QueryRow(r.Context(), `
		SELECT name, COALESCE(country_code, ''), COALESCE(company_type, ''), COALESCE(commodities, ARRAY[]::text[]),
		       COALESCE(website, ''), COALESCE(phone, ''), COALESCE(email, ''), COALESCE(confidence_score, 0),
		       COALESCE(raw_source_payload, '{}'::jsonb)::text
		FROM companies
		WHERE id = $1
	`, id).Scan(&name, &country, &companyType, &commodities, &website, &phone, &email, &confidence, &raw)
	if err != nil {
		http.Error(w, "company not found", http.StatusNotFound)
		return
	}
	var operatorAssets, ownerAssets, ownedVessels, operatedVessels int
	_ = s.pool.QueryRow(r.Context(), `SELECT COUNT(*)::int FROM assets WHERE operator_company_id = $1`, id).Scan(&operatorAssets)
	_ = s.pool.QueryRow(r.Context(), `SELECT COUNT(*)::int FROM assets WHERE owner_company_id = $1`, id).Scan(&ownerAssets)
	_ = s.pool.QueryRow(r.Context(), `SELECT COUNT(*)::int FROM vessel_enrichment WHERE owner_company_id = $1`, id).Scan(&ownedVessels)
	_ = s.pool.QueryRow(r.Context(), `SELECT COUNT(*)::int FROM vessel_enrichment WHERE operator_company_id = $1`, id).Scan(&operatedVessels)
	var importRows int
	_ = s.pool.QueryRow(r.Context(), `SELECT COUNT(*)::int FROM trade_flow_facts WHERE participant_company_id = $1`, id).Scan(&importRows)
	roles := commercialRoles(companyType, operatorAssets, ownerAssets, ownedVessels, operatedVessels)
	if importRows > 0 {
		roles = appendCommercialRole(roles, "buyer", "importer")
	}
	linkedIntel := s.entityLinkedIntel(r, "company", id, name, commodities, country)
	assets := s.companyCommercialAssets(r.Context(), id)
	tradeFlow := s.companyTradeFlowSummary(r, id)
	contacts := s.companyContacts(r, id)
	commercialContacts := s.loadCommercialRoleContactBundles(r.Context(), commercialRoleContactInput{
		Role:         "company_profile",
		CompanyID:    id,
		FallbackName: name,
	})
	investorExposures := s.entityInvestorExposures(r.Context(), "company", id, 12)
	chainBundle := buildCommercialChainBundle(commercialChainBundleInput{
		EntityType:        "company",
		EntityID:          id,
		Name:              name,
		CountryCode:       country,
		Contacts:          commercialContacts,
		InvestorExposures: investorExposures,
		LinkedIntel:       linkedIntel,
	})
	writeJSON(w, map[string]any{
		"id":                      id,
		"type":                    "company",
		"name":                    name,
		"country_code":            country,
		"commodities":             commodities,
		"roles":                   roles,
		"contactability":          map[string]string{"website": website, "phone": phone, "email": email},
		"asset_counts":            map[string]int{"operator": operatorAssets, "owner": ownerAssets, "owned_vessels": ownedVessels, "operated_vessels": operatedVessels, "import_rows": importRows},
		"assets":                  assets,
		"trade_flow_summary":      tradeFlow,
		"contacts":                contacts,
		"commercial_contacts":     commercialContacts,
		"investor_exposures":      investorExposures,
		"commercial_chain_bundle": chainBundle,
		"linked_intel":            linkedIntel,
		"confidence_score":        confidence,
		"raw_source_payload":      jsonBlock(raw, "{}"),
		"evidence_label":          "reported",
	})
}

func (s *Server) getAssetCommercialProfile(w http.ResponseWriter, r *http.Request, id string) {
	var name, assetType, country, operatorID, operatorName, ownerID, ownerName, raw string
	var commodities []string
	var confidence float64
	err := s.pool.QueryRow(r.Context(), `
		SELECT a.name, a.asset_type, COALESCE(a.country_code, ''), COALESCE(a.commodities_supported, ARRAY[]::text[]),
		       COALESCE(a.operator_company_id::text, ''), COALESCE(op.name, ''),
		       COALESCE(a.owner_company_id::text, ''), COALESCE(own.name, ''),
		       COALESCE(a.confidence_score, 0), COALESCE(a.raw_source_payload, '{}'::jsonb)::text
		FROM assets a
		LEFT JOIN companies op ON op.id = a.operator_company_id
		LEFT JOIN companies own ON own.id = a.owner_company_id
		WHERE a.id = $1
	`, id).Scan(&name, &assetType, &country, &commodities, &operatorID, &operatorName, &ownerID, &ownerName, &confidence, &raw)
	if err != nil {
		http.Error(w, "asset not found", http.StatusNotFound)
		return
	}
	linkedIntel := s.entityLinkedIntel(r, "asset", id, name, commodities, country)
	ownershipChain := s.assetOwnershipIntel(r.Context(), id)
	investorExposures := s.entityInvestorExposures(r.Context(), "asset", id, 12)
	infrastructureContext := s.assetInfrastructureContext(r.Context(), id, 12)
	coverageContext, coverageGaps := s.assetCoverageContext(r.Context(), id, 50000)
	commercialContacts := s.loadCommercialRoleContactBundles(
		r.Context(),
		commercialRoleContactInput{Role: "asset_operator", CompanyID: operatorID, FallbackName: operatorName},
		commercialRoleContactInput{Role: "asset_owner", CompanyID: ownerID, FallbackName: ownerName},
	)
	chainBundle := buildCommercialChainBundle(commercialChainBundleInput{
		EntityType:        "asset",
		EntityID:          id,
		Name:              name,
		CountryCode:       country,
		AssetType:         assetType,
		Owner:             map[string]any{"company_id": ownerID, "name": ownerName},
		Operator:          map[string]any{"company_id": operatorID, "name": operatorName},
		Contacts:          commercialContacts,
		OwnershipChain:    ownershipChain,
		InvestorExposures: investorExposures,
		Infrastructure:    infrastructureContext,
		CoverageContext:   coverageContext,
		CoverageGaps:      coverageGaps,
		LinkedIntel:       linkedIntel,
	})
	writeJSON(w, map[string]any{
		"id":                      id,
		"type":                    "asset",
		"name":                    name,
		"asset_type":              assetType,
		"country_code":            country,
		"commodities":             commodities,
		"operator":                map[string]string{"company_id": operatorID, "name": operatorName},
		"owner":                   map[string]string{"company_id": ownerID, "name": ownerName},
		"roles":                   []string{"real_asset"},
		"commercial_contacts":     commercialContacts,
		"ownership_chain":         ownershipChain,
		"investor_exposures":      investorExposures,
		"infrastructure_context":  infrastructureContext,
		"coverage_context":        coverageContext,
		"commercial_chain_bundle": chainBundle,
		"linked_intel":            linkedIntel,
		"confidence_score":        confidence,
		"raw_source":              jsonBlock(raw, "{}"),
		"evidence_label":          "reported",
	})
}

func (s *Server) getVesselCommercialProfile(w http.ResponseWriter, r *http.Request, id string) {
	var name, imo, mmsi, vesselType, ownerName, operatorName, ownerID, operatorID, vesselClass, ownerProfileRaw string
	var dwt, confidence float64
	err := s.pool.QueryRow(r.Context(), `
		SELECT COALESCE(v.name, ''), COALESCE(v.imo, ve.imo, ''), COALESCE(v.mmsi, ve.mmsi, ''),
		       COALESCE(v.vessel_type, ''), COALESCE(ve.owner_name, ''), COALESCE(ve.operator_name, ''),
		       COALESCE(ve.owner_company_id::text, ''), COALESCE(ve.operator_company_id::text, ''),
		       COALESCE(ve.vessel_class, ''), COALESCE(ve.deadweight_tons, 0),
		       COALESCE(ve.owner_profile, '{}'::jsonb)::text,
		       GREATEST(COALESCE(v.confidence_score, 0), COALESCE(ve.confidence_score, 0))
		FROM vessels v
		LEFT JOIN vessel_enrichment ve ON ve.vessel_id = v.id OR (v.mmsi IS NOT NULL AND ve.mmsi = v.mmsi)
		WHERE v.id::text = $1 OR v.imo = $1 OR v.mmsi = $1
		LIMIT 1
	`, id).Scan(&name, &imo, &mmsi, &vesselType, &ownerName, &operatorName, &ownerID, &operatorID, &vesselClass, &dwt, &ownerProfileRaw, &confidence)
	if err != nil {
		http.Error(w, "vessel not found", http.StatusNotFound)
		return
	}
	ownerProfile := parseJSONObject(ownerProfileRaw)
	if ownerID := profileString(ownerProfile, "shipvault_company_id"); ownerID != "" {
		if extra := loadVesselShipvaultOwner(r.Context(), s.pool, ownerID); extra != nil {
			if ownerProfile == nil {
				ownerProfile = map[string]any{}
			}
			for k, v := range extra {
				if _, exists := ownerProfile[k]; !exists {
					ownerProfile[k] = v
				}
			}
		}
	}
	nameHistory := loadVesselNameHistory(r.Context(), s.pool, mmsi)
	vesselSummary := map[string]any{
		"mmsi":          mmsi,
		"imo":           imo,
		"owner_name":    ownerName,
		"operator_name": operatorName,
		"name_history":  nameHistory,
	}
	if len(ownerProfile) > 0 {
		vesselSummary["owner_profile"] = ownerProfile
	}
	ownershipIntel := buildVesselOwnershipIntel(
		vesselSummary,
		ownerProfile,
		loadVesselFleetMatch(r.Context(), s.pool, profileString(ownerProfile, "shipvault_company_id"), mmsi, imo, nameHistory),
	)
	contacts := loadVesselCommercialContacts(r.Context(), s.pool, ownerID, operatorID, ownerName, operatorName, ownerProfile)
	linkedIntel := s.entityLinkedIntel(r, "vessel", id, name, []string{vesselClass, vesselType}, "")
	chainBundle := buildCommercialChainBundle(commercialChainBundleInput{
		EntityType:     "vessel",
		EntityID:       id,
		Name:           name,
		VesselClass:    vesselClass,
		IMO:            imo,
		MMSI:           mmsi,
		Owner:          map[string]any{"company_id": ownerID, "name": ownerName},
		Operator:       map[string]any{"company_id": operatorID, "name": operatorName},
		Contacts:       contacts,
		OwnershipIntel: ownershipIntel,
		NameHistory:    nameHistory,
		LinkedIntel:    linkedIntel,
	})
	writeJSON(w, map[string]any{
		"id":                      id,
		"type":                    "vessel",
		"name":                    name,
		"imo":                     imo,
		"mmsi":                    mmsi,
		"vessel_type":             vesselType,
		"vessel_class":            vesselClass,
		"deadweight_tons":         dwt,
		"owner":                   map[string]string{"company_id": ownerID, "name": ownerName},
		"operator":                map[string]string{"company_id": operatorID, "name": operatorName},
		"roles":                   []string{"shipowner_route_evidence"},
		"commercial_contacts":     contacts,
		"commercial_chain_bundle": chainBundle,
		"name_history":            nameHistory,
		"owner_profile":           ownerProfile,
		"ownership_intel":         ownershipIntel,
		"linked_intel":            linkedIntel,
		"confidence_score":        confidence,
		"evidence_label":          "reported",
	})
}

func (s *Server) entityLinkedIntel(r *http.Request, entityType, id, name string, commodities []string, country string) map[string]any {
	commodity := firstCommodityHint(commodities)
	investorPaths := []json.RawMessage{}
	if entityType != "vessel" {
		if rows, err := s.listIntelInvestorPathSnapshots(r, "", "", "", "", id, "", 0, 8); err == nil {
			investorPaths = rows
		}
	}
	benchmarks := s.latestBenchmarks(r, commodity)
	if len(benchmarks) == 0 {
		benchmarks = s.latestLegacySpotPrices(r, commodity)
	}
	out := map[string]any{
		"entity_type":     entityType,
		"entity_id":       id,
		"entity_name":     name,
		"evidence_label":  "mixed",
		"investor_paths":  investorPaths,
		"opportunities":   s.profileOpportunities(r.Context(), entityType, id, name, 10),
		"cargo_movements": s.profileCargoMovements(r.Context(), entityType, id, name, 10),
		"importers":       s.profileImporters(r.Context(), entityType, id, name, country, 8),
		"sts_predictions": s.profileSTSPredictions(r.Context(), entityType, id, name, 8),
		"market_pressure": s.profileMarketPressure(r.Context(), country, commodity, 6),
		"benchmarks":      benchmarks,
		"limitations": []string{
			"Observed identities and inferred opportunities are kept separate.",
			"Cargo quantity and buyer links remain estimates unless source evidence explicitly confirms them.",
		},
	}
	if entityType == "company" {
		out["assets"] = s.companyCommercialAssets(r.Context(), id)
		out["investor_exposures"] = s.entityInvestorExposures(r.Context(), "company", id, 12)
	}
	if entityType == "asset" {
		out["ownership_chain"] = s.assetOwnershipIntel(r.Context(), id)
		out["investor_exposures"] = s.entityInvestorExposures(r.Context(), "asset", id, 12)
	}
	return out
}

func firstCommodityHint(values []string) string {
	for _, value := range values {
		clean := strings.TrimSpace(value)
		if clean == "" {
			continue
		}
		upper := strings.ToUpper(clean)
		switch {
		case strings.Contains(upper, "LNG"):
			return "LNG"
		case strings.Contains(upper, "GAS"):
			return "GAS"
		case strings.Contains(upper, "LPG"):
			return "LPG"
		case strings.Contains(upper, "CRUDE") || strings.Contains(upper, "OIL") || strings.Contains(upper, "PETROLEUM"):
			return "OIL"
		default:
			return clean
		}
	}
	return "OIL"
}

func (s *Server) profileOpportunities(ctx context.Context, entityType, id, name string, limit int) []json.RawMessage {
	rows, err := s.pool.Query(ctx, `
		SELECT jsonb_build_object(
			'id', oc.id::text,
			'opportunity_type', oc.opportunity_type,
			'commodity', COALESCE(oc.commodity, ''),
			'origin_country', COALESCE(oc.origin_country, ''),
			'destination_country', COALESCE(oc.destination_country, ''),
			'supplier_company_id', COALESCE(oc.supplier_company_id::text, ''),
			'buyer_company_id', COALESCE(oc.buyer_company_id::text, ''),
			'supplier_asset_id', COALESCE(oc.supplier_asset_id::text, ''),
			'buyer_asset_id', COALESCE(oc.buyer_asset_id::text, ''),
			'vessel_id', COALESCE(oc.vessel_id::text, ''),
			'lane_id', COALESCE(oc.lane_id, ''),
			'score', COALESCE(oc.score, 0)::double precision,
			'confidence_score', COALESCE(oc.confidence_score, 0)::double precision,
			'evidence_grade', COALESCE(oc.evidence_grade, 'inferred'),
			'score_breakdown', jsonb_build_object(
				'supplier_reality', COALESCE(oc.supplier_reality_score, 0)::double precision,
				'buyer_reality', COALESCE(oc.buyer_reality_score, 0)::double precision,
				'market_pressure', COALESCE(oc.market_pressure_score, 0)::double precision,
				'route_feasibility', COALESCE(oc.route_feasibility_score, 0)::double precision,
				'price_context', COALESCE(oc.price_context_score, 0)::double precision,
				'investor_control', COALESCE(oc.investor_control_score, 0)::double precision,
				'risk_discount', COALESCE(oc.risk_discount_score, 0)::double precision
			),
			'route_summary', COALESCE(oc.route_summary, '{}'::jsonb),
			'cargo_summary', COALESCE(oc.cargo_summary, '{}'::jsonb),
			'market_pressure_summary', COALESCE(oc.market_pressure_summary, '{}'::jsonb),
			'price_context', COALESCE(oc.price_context, '{}'::jsonb),
			'evidence', COALESCE(oc.evidence, '[]'::jsonb),
			'limitations', COALESCE(oc.limitations, ARRAY[]::text[]),
			'tier', oc.tier,
			'generated_at', oc.generated_at::text,
			'expires_at', COALESCE(oc.expires_at::text, '')
		)::text
		FROM opportunity_candidates oc
		WHERE oc.status = 'active'
		  AND (
			($2 IN ('asset', 'company') AND (
				oc.supplier_asset_id::text = $1
				OR oc.buyer_asset_id::text = $1
				OR oc.supplier_company_id::text = $1
				OR oc.buyer_company_id::text = $1
			))
			OR ($2 = 'vessel' AND (
				oc.vessel_id::text = $1
				OR EXISTS (
					SELECT 1 FROM vessels v
					WHERE v.id = oc.vessel_id
					  AND (v.id::text = $1 OR v.imo = $1 OR v.mmsi = $1 OR ($3 <> '' AND v.name ILIKE '%' || $3 || '%'))
				)
			))
			OR ($3 <> '' AND oc.evidence::text ILIKE '%' || $3 || '%')
		  )
		ORDER BY oc.score DESC, oc.confidence_score DESC, oc.generated_at DESC
		LIMIT $4
	`, id, entityType, strings.TrimSpace(name), limit)
	if err != nil {
		return nil
	}
	defer rows.Close()
	out := []json.RawMessage{}
	for rows.Next() {
		var raw string
		if err := rows.Scan(&raw); err != nil {
			continue
		}
		out = append(out, jsonBlock(raw, "{}"))
	}
	return out
}

func (s *Server) profileCargoMovements(ctx context.Context, entityType, id, name string, limit int) []map[string]any {
	rows, err := s.pool.Query(ctx, `
		SELECT
			ce.id::text AS id,
			COALESCE(v.id::text, '') AS vessel_id,
			COALESCE(v.name, '') AS vessel_name,
			COALESCE(v.imo, ve.imo, '') AS imo,
			COALESCE(v.mmsi, voy.mmsi, ve.mmsi, '') AS mmsi,
			COALESCE(ve.vessel_class, v.vessel_type, '') AS vessel_class,
			COALESCE(ve.owner_name, '') AS owner_name,
			COALESCE(ve.operator_name, '') AS operator_name,
			COALESCE(ve.owner_company_id::text, '') AS owner_company_id,
			COALESCE(ve.operator_company_id::text, '') AS operator_company_id,
			COALESCE(ve.owner_profile, '{}'::jsonb)::text AS owner_profile,
			COALESCE(voy.id::text, '') AS voyage_id,
			COALESCE(NULLIF(voy.load_port_name, ''), CASE WHEN pc.event_type ILIKE '%loading%' THEN pc.terminal_name ELSE '' END, '') AS load_port_name,
			COALESCE(NULLIF(voy.load_country, ''), CASE WHEN pc.event_type ILIKE '%loading%' THEN pc.country_code ELSE '' END, '') AS load_country,
			COALESCE(NULLIF(voy.discharge_port_name, ''), CASE WHEN pc.event_type ILIKE '%unloading%' THEN pc.terminal_name ELSE '' END, NULLIF(dest.destination, ''), '') AS discharge_port_name,
			COALESCE(NULLIF(voy.discharge_country, ''), CASE WHEN pc.event_type ILIKE '%unloading%' THEN pc.country_code ELSE '' END, '') AS discharge_country,
			COALESCE(ce.product_family, voy.commodity_family, '') AS product_family,
			COALESCE(ce.payload_low, 0) AS payload_low,
			COALESCE(ce.payload_best, ce.payload_tons, 0) AS payload_best,
			COALESCE(ce.payload_high, 0) AS payload_high,
			COALESCE(ce.quantity_unit, 'tons') AS quantity_unit,
			COALESCE(ce.method, '') AS method,
			COALESCE(ce.confidence_score, 0) AS confidence_score,
			ce.observed_at::text AS observed_at,
			COALESCE(ce.evidence, '[]'::jsonb)::text AS evidence,
			CASE
				WHEN voy.id IS NOT NULL THEN 'voyage_match'
				WHEN pc.id IS NOT NULL THEN 'port_call_' || COALESCE(NULLIF(pc.event_type, ''), 'visit')
				WHEN NULLIF(dest.destination, '') IS NOT NULL THEN 'ais_destination'
				ELSE ''
			END AS route_source,
			CASE
				WHEN voy.id IS NOT NULL THEN COALESCE(voy.confidence_score, 0)
				WHEN pc.id IS NOT NULL THEN COALESCE(pc.confidence_score, 0)
				WHEN NULLIF(dest.destination, '') IS NOT NULL THEN 35
				ELSE 0
			END AS route_confidence,
			COALESCE(NULLIF(dest.destination, ''), NULLIF(ce.source_payload->>'latest_destination', ''), '') AS latest_destination
		FROM cargo_estimates ce
		LEFT JOIN vessels v ON v.id = ce.vessel_id
		LEFT JOIN LATERAL (
			SELECT vy.*
			FROM voyages vy
			WHERE (ce.voyage_id IS NOT NULL AND vy.id = ce.voyage_id)
			   OR (
				ce.voyage_id IS NULL
				AND (
					(ce.vessel_id IS NOT NULL AND vy.vessel_id = ce.vessel_id)
					OR (COALESCE(v.mmsi, '') <> '' AND vy.mmsi = v.mmsi)
				)
			   )
			ORDER BY
				CASE WHEN ce.voyage_id IS NOT NULL AND vy.id = ce.voyage_id THEN 0 ELSE 1 END,
				ABS(EXTRACT(EPOCH FROM (COALESCE(vy.ended_at, vy.started_at, ce.observed_at) - ce.observed_at))) ASC,
				COALESCE(vy.confidence_score, 0) DESC
			LIMIT 1
		) voy ON true
		LEFT JOIN LATERAL (
			SELECT ve.*
			FROM vessel_enrichment ve
			WHERE (v.id IS NOT NULL AND ve.vessel_id = v.id)
			   OR (COALESCE(v.mmsi, voy.mmsi, '') <> '' AND ve.mmsi = COALESCE(v.mmsi, voy.mmsi))
			ORDER BY (ve.vessel_id = v.id) DESC, ve.fetched_at DESC
			LIMIT 1
		) ve ON true
		LEFT JOIN LATERAL (
			SELECT pc.id::text AS id,
			       COALESCE(a.name, '') AS terminal_name,
			       COALESCE(a.country_code, '') AS country_code,
			       COALESCE(pc.event_type, '') AS event_type,
			       COALESCE(pc.confidence_score, 0) AS confidence_score,
			       COALESCE(pc.departure_ts, pc.arrival_ts) AS event_ts
			FROM port_call_visits pc
			JOIN assets a ON a.id = pc.asset_id
			WHERE COALESCE(v.mmsi, voy.mmsi, ve.mmsi, '') <> ''
			  AND pc.mmsi = COALESCE(v.mmsi, voy.mmsi, ve.mmsi)
			ORDER BY
				CASE WHEN $2 = 'asset' AND pc.asset_id::text = $1 THEN 0 ELSE 1 END,
				ABS(EXTRACT(EPOCH FROM (COALESCE(pc.departure_ts, pc.arrival_ts) - ce.observed_at))) ASC,
				COALESCE(pc.confidence_score, 0) DESC
			LIMIT 1
		) pc ON true
		LEFT JOIN LATERAL (
			SELECT CASE
				WHEN UPPER(TRIM(raw.destination)) IN ('FOR ORDERS', 'FOR ORDER', 'TBA', 'UNKNOWN', 'N/A', 'NA') THEN ''
				ELSE COALESCE(raw.destination, '')
			END AS destination
			FROM (
				SELECT COALESCE(
					NULLIF(TRIM(v.destination), ''),
					NULLIF(TRIM(ap.destination), ''),
					NULLIF(TRIM(ce.source_payload->>'latest_destination'), '')
				) AS destination
				FROM (SELECT 1) seed
				LEFT JOIN LATERAL (
					SELECT destination
					FROM ais_positions ap
					WHERE COALESCE(v.mmsi, voy.mmsi, ve.mmsi, '') <> ''
					  AND ap.mmsi = COALESCE(v.mmsi, voy.mmsi, ve.mmsi)
					  AND NULLIF(TRIM(ap.destination), '') IS NOT NULL
					ORDER BY ap.ts DESC
					LIMIT 1
				) ap ON true
			) raw
		) dest ON true
		WHERE (
			($2 = 'vessel' AND (
				ce.vessel_id::text = $1
				OR v.id::text = $1
				OR v.mmsi = $1
				OR v.imo = $1
				OR ve.mmsi = $1
				OR ve.imo = $1
				OR ($3 <> '' AND v.name ILIKE '%' || $3 || '%')
			))
			OR ($2 = 'company' AND (
				ve.owner_company_id::text = $1
				OR ve.operator_company_id::text = $1
			))
			OR ($2 = 'asset' AND EXISTS (
				SELECT 1
				FROM port_call_visits pc2
				WHERE pc2.asset_id::text = $1
				  AND pc2.mmsi = COALESCE(v.mmsi, voy.mmsi, ve.mmsi, '')
			))
		)
		ORDER BY ce.observed_at DESC NULLS LAST, ce.confidence_score DESC
		LIMIT $4
	`, id, entityType, strings.TrimSpace(name), limit)
	out := []map[string]any{}
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			out = append(out, s.scanCargoEstimate(ctx, rows)...)
		}
	}
	if len(out) < limit {
		out = append(out, s.profileMeridianCargoMovements(ctx, entityType, id, name, limit-len(out))...)
	}
	if entityType == "asset" && len(out) < limit {
		out = append(out, s.profileNearbyMeridianCargoMovements(ctx, id, limit-len(out))...)
	}
	return out
}

func (s *Server) profileMeridianCargoMovements(ctx context.Context, entityType, id, name string, limit int) []map[string]any {
	if limit <= 0 {
		return nil
	}
	rows, err := s.pool.Query(ctx, `
		SELECT
			mcr.id::text,
			COALESCE(mcr.vessel_name, ''),
			COALESCE(mcr.imo, ''),
			COALESCE(mcr.mmsi, ''),
			COALESCE(mcr.commodity_family, ''),
			COALESCE(mcr.load_port_name, ''),
			COALESCE(mcr.load_country, ''),
			COALESCE(mcr.discharge_hint, ''),
			COALESCE(mcr.discharge_country, ''),
			COALESCE(mcr.volume_low, 0),
			COALESCE(mcr.volume_best_estimate, 0),
			COALESCE(mcr.volume_high, 0),
			COALESCE(mcr.volume_unit, 'bbl'),
			COALESCE(mcr.volume_method, mcr.recipe, ''),
			COALESCE(mcr.confidence, 0),
			COALESCE(mcr.event_date::text, ''),
			COALESCE(mcr.evidence_chain, '[]'::jsonb)::text,
			COALESCE(mcr.shipper_name, ''),
			COALESCE(mcr.consignee_name, ''),
			COALESCE(mcr.shipper_company_id::text, ''),
			COALESCE(mcr.consignee_company_id::text, ''),
			COALESCE(v.id::text, ''),
			COALESCE(ve.vessel_class, v.vessel_type, ''),
			COALESCE(ve.owner_name, ''),
			COALESCE(ve.operator_name, ''),
			COALESCE(ve.owner_company_id::text, ''),
			COALESCE(ve.operator_company_id::text, ''),
			COALESCE(ve.owner_profile, '{}'::jsonb)::text
		FROM meridian_cargo_records mcr
		LEFT JOIN vessels v ON (mcr.mmsi <> '' AND v.mmsi = mcr.mmsi) OR (mcr.imo <> '' AND v.imo = mcr.imo)
		LEFT JOIN LATERAL (
			SELECT ve.*
			FROM vessel_enrichment ve
			WHERE (v.id IS NOT NULL AND ve.vessel_id = v.id)
			   OR (mcr.mmsi <> '' AND ve.mmsi = mcr.mmsi)
			   OR (mcr.imo <> '' AND ve.imo = mcr.imo)
			ORDER BY (ve.vessel_id = v.id) DESC, ve.fetched_at DESC
			LIMIT 1
		) ve ON true
		WHERE (
			($2 = 'vessel' AND (
				mcr.mmsi = $1
				OR mcr.imo = $1
				OR v.id::text = $1
				OR ($3 <> '' AND mcr.vessel_name ILIKE '%' || $3 || '%')
			))
			OR ($2 = 'company' AND (
				mcr.shipper_company_id::text = $1
				OR mcr.consignee_company_id::text = $1
				OR ve.owner_company_id::text = $1
				OR ve.operator_company_id::text = $1
			))
			OR ($2 = 'asset' AND mcr.load_terminal_id::text = $1)
		)
		ORDER BY mcr.event_date DESC NULLS LAST, mcr.confidence DESC
		LIMIT $4
	`, id, entityType, strings.TrimSpace(name), limit)
	if err != nil {
		return nil
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		if item := s.scanMeridianCargo(ctx, rows); item != nil {
			out = append(out, item)
		}
	}
	return out
}

type meridianCargoScanRow struct {
	ID                 string
	VesselName         string
	IMO                string
	MMSI               string
	Product            string
	LoadPort           string
	LoadCountry        string
	DischargePort      string
	DischargeCountry   string
	Unit               string
	Method             string
	ObservedAt         string
	Evidence           string
	ShipperName        string
	ConsigneeName      string
	ShipperCompanyID   string
	ConsigneeCompanyID string
	VesselID           string
	VesselClass        string
	Owner              string
	Operator           string
	OwnerCompanyID     string
	OperatorCompanyID  string
	OwnerProfile       string
	Low                float64
	Best               float64
	High               float64
	Confidence         float64
}

func scanMeridianCargoRow(rows interface{ Scan(dest ...any) error }) (meridianCargoScanRow, bool) {
	var row meridianCargoScanRow
	if err := rows.Scan(&row.ID, &row.VesselName, &row.IMO, &row.MMSI, &row.Product, &row.LoadPort, &row.LoadCountry, &row.DischargePort, &row.DischargeCountry,
		&row.Low, &row.Best, &row.High, &row.Unit, &row.Method, &row.Confidence, &row.ObservedAt, &row.Evidence,
		&row.ShipperName, &row.ConsigneeName, &row.ShipperCompanyID, &row.ConsigneeCompanyID, &row.VesselID, &row.VesselClass, &row.Owner, &row.Operator, &row.OwnerCompanyID, &row.OperatorCompanyID, &row.OwnerProfile); err != nil {
		return meridianCargoScanRow{}, false
	}
	return row, true
}

func (s *Server) scanMeridianCargo(ctx context.Context, rows interface{ Scan(dest ...any) error }) map[string]any {
	row, ok := scanMeridianCargoRow(rows)
	if !ok {
		return nil
	}
	return s.meridianCargoItem(ctx, row, "meridian_cargo_records", "meridian_cargo_record", "inferred", nil)
}

func (s *Server) meridianCargoItem(ctx context.Context, row meridianCargoScanRow, source, routeSource, evidenceLabel string, assetContext map[string]any) map[string]any {
	if evidenceLabel == "" {
		evidenceLabel = "inferred"
	}
	decodedDestination := decodeAISDestination(row.DischargePort)
	chain := buildCargoCommercialContext(ctx, s.pool, cargoCommercialContextInput{
		Source:             source,
		VesselID:           row.VesselID,
		VesselName:         row.VesselName,
		IMO:                row.IMO,
		MMSI:               row.MMSI,
		VesselClass:        row.VesselClass,
		OwnerName:          row.Owner,
		OperatorName:       row.Operator,
		OwnerCompanyID:     row.OwnerCompanyID,
		OperatorCompanyID:  row.OperatorCompanyID,
		OwnerProfileJSON:   row.OwnerProfile,
		ShipperName:        row.ShipperName,
		ConsigneeName:      row.ConsigneeName,
		ShipperCompanyID:   row.ShipperCompanyID,
		ConsigneeCompanyID: row.ConsigneeCompanyID,
		ProductFamily:      row.Product,
		LoadPort:           row.LoadPort,
		LoadCountry:        row.LoadCountry,
		DischargePort:      row.DischargePort,
		DischargeCountry:   row.DischargeCountry,
		RouteSource:        routeSource,
		RouteConfidence:    row.Confidence,
		DecodedDestination: decodedDestination,
		QuantityMethod:     row.Method,
		EvidenceLabel:      evidenceLabel,
	})
	routeHint := map[string]any{"source": routeSource, "confidence_score": row.Confidence}
	if len(decodedDestination) > 0 {
		routeHint["decoded_destination"] = decodedDestination
	}
	item := map[string]any{
		"id":               row.ID,
		"source":           source,
		"vessel_id":        row.VesselID,
		"vessel_name":      row.VesselName,
		"imo":              row.IMO,
		"mmsi":             row.MMSI,
		"vessel_class":     row.VesselClass,
		"owner_name":       row.Owner,
		"operator_name":    row.Operator,
		"product_family":   row.Product,
		"load":             map[string]string{"port": row.LoadPort, "country": row.LoadCountry},
		"discharge":        map[string]string{"port": row.DischargePort, "country": row.DischargeCountry},
		"route_hint":       routeHint,
		"quantity":         map[string]any{"low": row.Low, "best": row.Best, "high": row.High, "unit": row.Unit, "method": row.Method},
		"confidence":       row.Confidence,
		"observed_at":      row.ObservedAt,
		"evidence":         jsonBlock(row.Evidence, "[]"),
		"evidence_label":   evidenceLabel,
		"commercial_chain": chain,
	}
	if len(assetContext) > 0 {
		routeHint["asset_context"] = assetContext
		item["asset_context"] = assetContext
		item["linkage"] = "nearby_terminal_cluster_context"
		item["limitations"] = []string{"Cargo record is attached to a nearby terminal-cluster asset, not the selected asset id; use as contextual evidence until exact port-call/voyage linkage is available."}
		chain["asset_context"] = assetContext
		chain["limitations"] = item["limitations"]
		if steps, ok := chain["chain_steps"].([]map[string]any); ok {
			contextStep := map[string]any{
				"step":           "nearby_terminal_cluster",
				"label":          firstNonEmpty(stringFromAny(assetContext["asset_name"]), stringFromAny(assetContext["name"])),
				"asset_id":       stringFromAny(assetContext["asset_id"]),
				"asset_type":     stringFromAny(assetContext["asset_type"]),
				"distance_km":    numberFromAny(assetContext["distance_km"]),
				"evidence_label": "inferred",
			}
			chain["chain_steps"] = append(steps, contextStep)
		}
	}
	return item
}

func (s *Server) profileNearbyMeridianCargoMovements(ctx context.Context, assetID string, limit int) []map[string]any {
	if limit <= 0 {
		return nil
	}
	rows, err := s.pool.Query(ctx, `
		WITH target AS (
			SELECT id, name, latitude, longitude
			FROM assets
			WHERE id::text = $1
			  AND latitude IS NOT NULL
			  AND longitude IS NOT NULL
			LIMIT 1
		),
		nearby_assets AS (
			SELECT
				a.id,
				COALESCE(a.name, '') AS asset_name,
				COALESCE(a.asset_type, '') AS asset_type,
				COALESCE(a.country_code, '') AS country_code,
				ROUND((ST_Distance(
					ST_SetSRID(ST_MakePoint(a.longitude, a.latitude), 4326)::geography,
					ST_SetSRID(ST_MakePoint(t.longitude, t.latitude), 4326)::geography
				) / 1000)::numeric, 2)::double precision AS distance_km
			FROM target t
			JOIN assets a ON a.id <> t.id
			WHERE a.latitude IS NOT NULL
			  AND a.longitude IS NOT NULL
			  AND COALESCE(a.asset_type, '') IN ('terminal', 'tank_farm', 'storage', 'refinery', 'processing_plant', 'pipeline', 'lng_terminal', 'port')
			  AND ST_DWithin(
				ST_SetSRID(ST_MakePoint(a.longitude, a.latitude), 4326)::geography,
				ST_SetSRID(ST_MakePoint(t.longitude, t.latitude), 4326)::geography,
				15000
			  )
			  AND NOT (
				lower(COALESCE(a.name, '')) = lower(COALESCE(t.name, ''))
				AND ST_Distance(
					ST_SetSRID(ST_MakePoint(a.longitude, a.latitude), 4326)::geography,
					ST_SetSRID(ST_MakePoint(t.longitude, t.latitude), 4326)::geography
				) < 1000
			  )
		)
		SELECT
			mcr.id::text,
			COALESCE(mcr.vessel_name, ''),
			COALESCE(mcr.imo, ''),
			COALESCE(mcr.mmsi, ''),
			COALESCE(mcr.commodity_family, ''),
			COALESCE(mcr.load_port_name, ''),
			COALESCE(mcr.load_country, ''),
			COALESCE(mcr.discharge_hint, ''),
			COALESCE(mcr.discharge_country, ''),
			COALESCE(mcr.volume_low, 0),
			COALESCE(mcr.volume_best_estimate, 0),
			COALESCE(mcr.volume_high, 0),
			COALESCE(mcr.volume_unit, 'bbl'),
			COALESCE(mcr.volume_method, mcr.recipe, ''),
			COALESCE(mcr.confidence, 0),
			COALESCE(mcr.event_date::text, ''),
			COALESCE(mcr.evidence_chain, '[]'::jsonb)::text,
			COALESCE(mcr.shipper_name, ''),
			COALESCE(mcr.consignee_name, ''),
			COALESCE(mcr.shipper_company_id::text, ''),
			COALESCE(mcr.consignee_company_id::text, ''),
			COALESCE(v.id::text, ''),
			COALESCE(ve.vessel_class, v.vessel_type, ''),
			COALESCE(ve.owner_name, ''),
			COALESCE(ve.operator_name, ''),
			COALESCE(ve.owner_company_id::text, ''),
			COALESCE(ve.operator_company_id::text, ''),
			COALESCE(ve.owner_profile, '{}'::jsonb)::text,
			na.id::text AS context_asset_id,
			na.asset_name,
			na.asset_type,
			na.country_code,
			na.distance_km
		FROM nearby_assets na
		JOIN meridian_cargo_records mcr ON mcr.load_terminal_id = na.id
		LEFT JOIN vessels v ON (mcr.mmsi <> '' AND v.mmsi = mcr.mmsi) OR (mcr.imo <> '' AND v.imo = mcr.imo)
		LEFT JOIN LATERAL (
			SELECT ve.*
			FROM vessel_enrichment ve
			WHERE (v.id IS NOT NULL AND ve.vessel_id = v.id)
			   OR (mcr.mmsi <> '' AND ve.mmsi = mcr.mmsi)
			   OR (mcr.imo <> '' AND ve.imo = mcr.imo)
			ORDER BY (ve.vessel_id = v.id) DESC, ve.fetched_at DESC
			LIMIT 1
		) ve ON true
		ORDER BY mcr.event_date DESC NULLS LAST, mcr.confidence DESC, na.distance_km ASC
		LIMIT $2
	`, assetID, limit)
	if err != nil {
		return nil
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var row meridianCargoScanRow
		var contextAssetID, contextAssetName, contextAssetType, contextCountry string
		var distance float64
		if err := rows.Scan(&row.ID, &row.VesselName, &row.IMO, &row.MMSI, &row.Product, &row.LoadPort, &row.LoadCountry, &row.DischargePort, &row.DischargeCountry,
			&row.Low, &row.Best, &row.High, &row.Unit, &row.Method, &row.Confidence, &row.ObservedAt, &row.Evidence,
			&row.ShipperName, &row.ConsigneeName, &row.ShipperCompanyID, &row.ConsigneeCompanyID, &row.VesselID, &row.VesselClass, &row.Owner, &row.Operator, &row.OwnerCompanyID, &row.OperatorCompanyID, &row.OwnerProfile,
			&contextAssetID, &contextAssetName, &contextAssetType, &contextCountry, &distance); err != nil {
			continue
		}
		assetContext := map[string]any{
			"asset_id":       contextAssetID,
			"asset_name":     contextAssetName,
			"asset_type":     contextAssetType,
			"country_code":   contextCountry,
			"distance_km":    distance,
			"match_method":   "nearby_terminal_cluster_v1",
			"evidence_label": "inferred",
		}
		if item := s.meridianCargoItem(ctx, row, "nearby_meridian_cargo_records", "nearby_terminal_cluster", "inferred", assetContext); item != nil {
			out = append(out, item)
		}
	}
	return out
}

func (s *Server) profileImporters(ctx context.Context, entityType, id, name, country string, limit int) []map[string]any {
	rows, err := s.pool.Query(ctx, `
		WITH target_asset AS (
			SELECT
				a.id::text AS asset_id,
				COALESCE(a.name, '') AS asset_name,
				COALESCE(a.country_code, '') AS country_code,
				COALESCE(op.id::text, '') AS operator_company_id,
				COALESCE(op.name, '') AS operator_name,
				COALESCE(own.id::text, '') AS owner_company_id,
				COALESCE(own.name, '') AS owner_name
			FROM assets a
			LEFT JOIN companies op ON op.id = a.operator_company_id
			LEFT JOIN companies own ON own.id = a.owner_company_id
			WHERE a.id::text = $1
			LIMIT 1
		),
		matched AS (
			SELECT t.*
			FROM trade_flow_facts t
			LEFT JOIN target_asset ta ON true
			WHERE t.source_key = 'eia_company_imports'
			  AND t.flow_code = 'IMPORT'
			  AND t.participant_name IS NOT NULL
			  AND (
				($2 = 'company' AND (
					t.participant_company_id::text = $1
					OR ($3 <> '' AND t.participant_name ILIKE '%' || $3 || '%')
				))
				OR ($2 = 'asset' AND (
					t.participant_company_id::text IN (ta.operator_company_id, ta.owner_company_id)
					OR (ta.operator_name <> '' AND t.participant_name ILIKE '%' || ta.operator_name || '%')
					OR (ta.owner_name <> '' AND t.participant_name ILIKE '%' || ta.owner_name || '%')
					OR (ta.asset_name <> '' AND t.participant_name ILIKE '%' || ta.asset_name || '%')
					OR (ta.country_code <> '' AND t.reporter_country_code ILIKE ta.country_code)
				))
			  )
		)
		SELECT
			COALESCE(participant_company_id::text, ''),
			COALESCE(participant_name, ''),
			COALESCE(product_code, ''),
			COALESCE(MAX(NULLIF(product_name, '')), ''),
			COALESCE(partner_country_code, ''),
			COALESCE(SUM(quantity), 0)::double precision,
			COALESCE(MAX(quantity_unit), ''),
			COUNT(*)::int,
			COALESCE(MAX(month)::text, ''),
			COUNT(DISTINCT NULLIF(port_code, ''))::int,
			ARRAY_REMOVE(ARRAY_AGG(DISTINCT NULLIF(port_state, '') ORDER BY NULLIF(port_state, '')), NULL)
		FROM matched
		GROUP BY participant_company_id, participant_name, product_code, partner_country_code
		ORDER BY MAX(month) DESC NULLS LAST, SUM(quantity) DESC NULLS LAST
		LIMIT $4
	`, id, entityType, strings.TrimSpace(name), limit)
	if err != nil {
		return nil
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var companyID, participantName, productCode, productName, originCountry, unit, latestMonth string
		var totalQuantity float64
		var factRows, portCount int
		var states []string
		if err := rows.Scan(&companyID, &participantName, &productCode, &productName, &originCountry, &totalQuantity, &unit, &factRows, &latestMonth, &portCount, &states); err != nil {
			continue
		}
		out = append(out, map[string]any{
			"company_id":   companyID,
			"name":         participantName,
			"product_code": productCode,
			"product_name": productName,
			"origin_country": map[string]string{
				"country_code": originCountry,
			},
			"quantity":       map[string]any{"value": totalQuantity, "unit": unit},
			"rows":           factRows,
			"latest_month":   latestMonth,
			"port_count":     portCount,
			"port_states":    states,
			"evidence_label": "reported",
			"source":         "eia_company_imports",
		})
	}
	return out
}

func (s *Server) profileSTSPredictions(ctx context.Context, entityType, id, name string, limit int) []map[string]any {
	if entityType != "vessel" {
		return nil
	}
	rows, err := s.pool.Query(ctx, `
		SELECT
			id::text,
			signal_type,
			COALESCE(entity_type, ''),
			COALESCE(entity_id::text, ''),
			tier,
			COALESCE(confidence_score, 0),
			COALESCE(horizon_hours, 0),
			COALESCE(payload, '{}'::jsonb)::text,
			COALESCE(predicted_at::text, ''),
			COALESCE(expires_at::text, '')
		FROM predictive_signals
		WHERE signal_type = 'commercial_sts_v1'
		  AND (expires_at IS NULL OR expires_at > now())
		  AND (
			entity_id::text = $1
			OR payload->>'mmsi_a' = $1
			OR payload->>'mmsi_b' = $1
			OR payload->>'vessel_a_mmsi' = $1
			OR payload->>'vessel_b_mmsi' = $1
			OR ($2 <> '' AND (
				payload->>'vessel_a_name' ILIKE '%' || $2 || '%'
				OR payload->>'vessel_b_name' ILIKE '%' || $2 || '%'
				OR payload->>'vessel_a' ILIKE '%' || $2 || '%'
				OR payload->>'vessel_b' ILIKE '%' || $2 || '%'
			))
		  )
		ORDER BY predicted_at DESC NULLS LAST, confidence_score DESC
		LIMIT $3
	`, id, strings.TrimSpace(name), limit)
	if err != nil {
		return nil
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, signalType, rowEntityType, entityID, tier, payload, predictedAt, expiresAt string
		var confidence float64
		var horizon int
		if err := rows.Scan(&id, &signalType, &rowEntityType, &entityID, &tier, &confidence, &horizon, &payload, &predictedAt, &expiresAt); err != nil {
			continue
		}
		out = append(out, map[string]any{
			"id":               id,
			"signal_type":      signalType,
			"entity_type":      rowEntityType,
			"entity_id":        entityID,
			"tier":             tier,
			"confidence_score": confidence,
			"horizon_hours":    horizon,
			"payload":          jsonBlock(payload, "{}"),
			"predicted_at":     predictedAt,
			"expires_at":       expiresAt,
			"evidence_label":   "predicted",
		})
	}
	return out
}

func (s *Server) profileMarketPressure(ctx context.Context, country, commodity string, limit int) []map[string]any {
	country = strings.TrimSpace(country)
	if country == "" {
		return nil
	}
	productHints, _ := intelBenchmarkHints(commodity)
	rows, err := s.pool.Query(ctx, `
		SELECT country_code, product_code, month::text,
		       COALESCE(buyer_pressure_score, 0)::double precision,
		       COALESCE(supplier_availability_score, 0)::double precision,
		       COALESCE(stock_pressure_score, 0)::double precision,
		       COALESCE(import_pressure_score, 0)::double precision,
		       COALESCE(export_pressure_score, 0)::double precision,
		       COALESCE(refinery_pressure_score, 0)::double precision,
		       baseline_years,
		       COALESCE(components, '{}'::jsonb)::text,
		       evidence_label,
		       COALESCE(confidence_score, 0)::double precision,
		       generated_at::text
		FROM market_pressure_scores
		WHERE country_code ILIKE $1
		  AND (array_length($2::text[], 1) IS NULL OR product_code = ANY($2::text[]))
		ORDER BY month DESC, buyer_pressure_score DESC, supplier_availability_score DESC
		LIMIT $3
	`, country, productHints, limit)
	if err != nil {
		return nil
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var rowCountry, product, month, components, evidenceLabel, generatedAt string
		var buyer, supplier, stock, imports, exports, refinery, confidence float64
		var baselineYears int
		if err := rows.Scan(&rowCountry, &product, &month, &buyer, &supplier, &stock, &imports, &exports, &refinery, &baselineYears, &components, &evidenceLabel, &confidence, &generatedAt); err != nil {
			continue
		}
		out = append(out, map[string]any{
			"country_code":                rowCountry,
			"product_code":                product,
			"month":                       month,
			"buyer_pressure_score":        buyer,
			"supplier_availability_score": supplier,
			"components": map[string]any{
				"stock_pressure":    stock,
				"import_pressure":   imports,
				"export_pressure":   exports,
				"refinery_pressure": refinery,
				"raw":               jsonBlock(components, "{}"),
			},
			"baseline_years":   baselineYears,
			"evidence_label":   evidenceLabel,
			"confidence_score": confidence,
			"generated_at":     generatedAt,
		})
	}
	return out
}

func (s *Server) companyCommercialAssets(ctx context.Context, companyID string) []map[string]any {
	rows, err := s.pool.Query(ctx, `
		SELECT
			a.id::text,
			COALESCE(a.name, ''),
			COALESCE(a.asset_type, ''),
			COALESCE(a.country_code, ''),
			COALESCE(a.commodities_supported, ARRAY[]::text[]),
			CASE
				WHEN a.operator_company_id::text = $1 AND a.owner_company_id::text = $1 THEN 'operator_owner'
				WHEN a.operator_company_id::text = $1 THEN 'operator'
				WHEN a.owner_company_id::text = $1 THEN 'owner'
				ELSE 'linked'
			END,
			a.latitude,
			a.longitude,
			COALESCE(a.confidence_score, 0)::double precision,
			COALESCE(a.raw_source_payload, '{}'::jsonb)::text
		FROM assets a
		WHERE a.operator_company_id::text = $1 OR a.owner_company_id::text = $1
		ORDER BY a.confidence_score DESC NULLS LAST, a.name
		LIMIT 25
	`, companyID)
	if err != nil {
		return nil
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, name, assetType, country, role, raw string
		var commodities []string
		var lat, lng *float64
		var confidence float64
		if err := rows.Scan(&id, &name, &assetType, &country, &commodities, &role, &lat, &lng, &confidence, &raw); err != nil {
			continue
		}
		row := map[string]any{
			"asset_id":         id,
			"name":             name,
			"asset_type":       assetType,
			"country_code":     country,
			"commodities":      commodities,
			"role":             role,
			"confidence_score": confidence,
			"evidence_label":   "reported",
			"raw_source":       jsonBlock(raw, "{}"),
		}
		if lat != nil && lng != nil {
			row["coordinates"] = map[string]float64{"latitude": *lat, "longitude": *lng}
		}
		out = append(out, row)
	}
	return out
}

func (s *Server) assetOwnershipIntel(ctx context.Context, assetID string) []map[string]any {
	rows, err := s.pool.Query(ctx, `
		SELECT
			COALESCE(ga.gem_asset_id, ''),
			COALESCE(ga.gem_unit_id, ''),
			COALESCE(ga.asset_name, ''),
			COALESCE(ga.asset_type, ''),
			COALESCE(ga.country_code, ''),
			COALESCE(ga.operator_entity_id, ''),
			COALESCE(op.name, ''),
			COALESCE(ga.owner_entity_id, ''),
			COALESCE(owner.name, ''),
			COALESCE(ga.parent_entity_id, ''),
			COALESCE(parent.name, ''),
			COALESCE(ga.share_pct, 0)::double precision,
			COALESCE(ga.share_imputed, false),
			ga.evidence_label,
			COALESCE(ga.raw_payload, '{}'::jsonb)::text
		FROM gem_asset_ownership ga
		LEFT JOIN gem_entities op ON op.entity_id = ga.operator_entity_id
		LEFT JOIN gem_entities owner ON owner.entity_id = ga.owner_entity_id
		LEFT JOIN gem_entities parent ON parent.entity_id = ga.parent_entity_id
		WHERE ga.asset_id::text = $1
		ORDER BY ga.share_pct DESC NULLS LAST, ga.created_at DESC
		LIMIT 20
	`, assetID)
	if err != nil {
		return nil
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var gemAssetID, gemUnitID, assetName, assetType, country, operatorID, operatorName, ownerID, ownerName, parentID, parentName, evidenceLabel, raw string
		var share float64
		var shareImputed bool
		if err := rows.Scan(&gemAssetID, &gemUnitID, &assetName, &assetType, &country, &operatorID, &operatorName, &ownerID, &ownerName, &parentID, &parentName, &share, &shareImputed, &evidenceLabel, &raw); err != nil {
			continue
		}
		out = append(out, map[string]any{
			"gem_asset_id":   gemAssetID,
			"gem_unit_id":    gemUnitID,
			"asset_name":     assetName,
			"asset_type":     assetType,
			"country_code":   country,
			"operator":       map[string]string{"entity_id": operatorID, "name": operatorName},
			"owner":          map[string]string{"entity_id": ownerID, "name": ownerName},
			"parent":         map[string]string{"entity_id": parentID, "name": parentName},
			"share_pct":      share,
			"share_imputed":  shareImputed,
			"evidence_label": evidenceLabel,
			"raw_source":     jsonBlock(raw, "{}"),
		})
	}
	return out
}

func (s *Server) entityInvestorExposures(ctx context.Context, entityType, id string, limit int) []map[string]any {
	rows, err := s.pool.Query(ctx, `
		SELECT
			id::text,
			COALESCE(investor_entity_id, ''),
			investor_name,
			COALESCE(exposed_entity_id, ''),
			COALESCE(exposed_company_id::text, ''),
			COALESCE(exposed_asset_id::text, ''),
			exposure_type,
			COALESCE(commodity, ''),
			COALESCE(country_code, ''),
			COALESCE(exposure_value, 0)::double precision,
			COALESCE(exposure_unit, ''),
			COALESCE(share_pct, 0)::double precision,
			evidence_label,
			COALESCE(confidence_score, 0)::double precision,
			COALESCE(raw_payload, '{}'::jsonb)::text
		FROM private_equity_exposures
		WHERE ($1 = 'asset' AND exposed_asset_id::text = $2)
		   OR ($1 = 'company' AND exposed_company_id::text = $2)
		ORDER BY confidence_score DESC, exposure_value DESC NULLS LAST
		LIMIT $3
	`, entityType, id, limit)
	if err != nil {
		return nil
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var exposureID, investorEntity, investorName, exposedEntity, companyID, assetID, exposureType, commodity, country, unit, evidenceLabel, raw string
		var exposureValue, share, confidence float64
		if err := rows.Scan(&exposureID, &investorEntity, &investorName, &exposedEntity, &companyID, &assetID, &exposureType, &commodity, &country, &exposureValue, &unit, &share, &evidenceLabel, &confidence, &raw); err != nil {
			continue
		}
		out = append(out, map[string]any{
			"id":                 exposureID,
			"investor_entity_id": investorEntity,
			"investor_name":      investorName,
			"exposed_entity_id":  exposedEntity,
			"exposed_company_id": companyID,
			"exposed_asset_id":   assetID,
			"exposure_type":      exposureType,
			"commodity":          commodity,
			"country_code":       country,
			"exposure_value":     exposureValue,
			"exposure_unit":      unit,
			"share_pct":          share,
			"evidence_label":     evidenceLabel,
			"confidence_score":   confidence,
			"raw_payload":        jsonBlock(raw, "{}"),
		})
	}
	return out
}

func (s *Server) assetInfrastructureContext(ctx context.Context, assetID string, limit int) []map[string]any {
	if limit <= 0 {
		limit = 12
	}
	rows, err := s.pool.Query(ctx, `
		WITH target AS (
			SELECT id, name, latitude, longitude
			FROM assets
			WHERE id::text = $1
			  AND latitude IS NOT NULL
			  AND longitude IS NOT NULL
			LIMIT 1
		)
		SELECT
			a.id::text,
			COALESCE(a.name, ''),
			COALESCE(a.asset_type, ''),
			COALESCE(a.country_code, ''),
			COALESCE(a.commodities_supported, ARRAY[]::text[]),
			COALESCE(op.id::text, ''),
			COALESCE(op.name, ''),
			COALESCE(own.id::text, ''),
			COALESCE(own.name, ''),
			a.latitude,
			a.longitude,
			ROUND((ST_Distance(
				ST_SetSRID(ST_MakePoint(a.longitude, a.latitude), 4326)::geography,
				ST_SetSRID(ST_MakePoint(t.longitude, t.latitude), 4326)::geography
			) / 1000)::numeric, 2)::double precision,
			COALESCE(a.confidence_score, 0)::double precision
		FROM target t
		JOIN assets a ON a.id <> t.id
		LEFT JOIN companies op ON op.id = a.operator_company_id
		LEFT JOIN companies own ON own.id = a.owner_company_id
		WHERE a.latitude IS NOT NULL
		  AND a.longitude IS NOT NULL
		  AND COALESCE(a.asset_type, '') IN ('terminal', 'tank_farm', 'storage', 'refinery', 'processing_plant', 'pipeline', 'lng_terminal', 'port')
		  AND ST_DWithin(
			ST_SetSRID(ST_MakePoint(a.longitude, a.latitude), 4326)::geography,
			ST_SetSRID(ST_MakePoint(t.longitude, t.latitude), 4326)::geography,
			15000
		  )
		  AND NOT (
			lower(COALESCE(a.name, '')) = lower(COALESCE(t.name, ''))
			AND ST_Distance(
				ST_SetSRID(ST_MakePoint(a.longitude, a.latitude), 4326)::geography,
				ST_SetSRID(ST_MakePoint(t.longitude, t.latitude), 4326)::geography
			) < 1000
		  )
		ORDER BY
			ST_Distance(
				ST_SetSRID(ST_MakePoint(a.longitude, a.latitude), 4326)::geography,
				ST_SetSRID(ST_MakePoint(t.longitude, t.latitude), 4326)::geography
			),
			COALESCE(a.confidence_score, 0) DESC,
			a.name
		LIMIT $2
	`, assetID, limit)
	if err != nil {
		return nil
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, name, assetType, country, operatorID, operatorName, ownerID, ownerName string
		var commodities []string
		var lat, lng, distance, confidence float64
		if err := rows.Scan(&id, &name, &assetType, &country, &commodities, &operatorID, &operatorName, &ownerID, &ownerName, &lat, &lng, &distance, &confidence); err != nil {
			continue
		}
		out = append(out, map[string]any{
			"asset_id":            id,
			"name":                name,
			"asset_type":          assetType,
			"country_code":        country,
			"commodities":         commodities,
			"operator_company_id": operatorID,
			"operator_name":       operatorName,
			"owner_company_id":    ownerID,
			"owner_name":          ownerName,
			"coordinates":         map[string]float64{"latitude": lat, "longitude": lng},
			"distance_km":         distance,
			"confidence_score":    confidence,
			"evidence_label":      "reported",
			"source":              "madsan_assets_nearby_cluster",
		})
	}
	return out
}

func (s *Server) assetCoverageContext(ctx context.Context, assetID string, radiusM float64) (map[string]any, []string) {
	if radiusM <= 0 {
		radiusM = 50000
	}
	var portCalls, meridianCargo, cargoEstimates, nearbyPortCalls, nearbyMeridianCargo, nearbyCargoEstimates, aisNearby, aisNearby7d int
	_ = s.pool.QueryRow(ctx, `SELECT COUNT(*)::int FROM port_call_visits WHERE asset_id::text = $1`, assetID).Scan(&portCalls)
	_ = s.pool.QueryRow(ctx, `SELECT COUNT(*)::int FROM meridian_cargo_records WHERE load_terminal_id::text = $1`, assetID).Scan(&meridianCargo)
	_ = s.pool.QueryRow(ctx, `
		SELECT COUNT(*)::int
		FROM cargo_estimates ce
		JOIN vessels v ON v.id = ce.vessel_id
		JOIN port_call_visits pc ON pc.mmsi = v.mmsi
		WHERE pc.asset_id::text = $1
	`, assetID).Scan(&cargoEstimates)
	nearbyAssetCTE := `
		WITH target AS (
			SELECT id, name, latitude, longitude
			FROM assets
			WHERE id::text = $1
			  AND latitude IS NOT NULL
			  AND longitude IS NOT NULL
			LIMIT 1
		),
		nearby_assets AS (
			SELECT a.id
			FROM target t
			JOIN assets a ON a.id <> t.id
			WHERE a.latitude IS NOT NULL
			  AND a.longitude IS NOT NULL
			  AND COALESCE(a.asset_type, '') IN ('terminal', 'tank_farm', 'storage', 'refinery', 'processing_plant', 'pipeline', 'lng_terminal', 'port')
			  AND ST_DWithin(
				ST_SetSRID(ST_MakePoint(a.longitude, a.latitude), 4326)::geography,
				ST_SetSRID(ST_MakePoint(t.longitude, t.latitude), 4326)::geography,
				15000
			  )
			  AND NOT (
				lower(COALESCE(a.name, '')) = lower(COALESCE(t.name, ''))
				AND ST_Distance(
					ST_SetSRID(ST_MakePoint(a.longitude, a.latitude), 4326)::geography,
					ST_SetSRID(ST_MakePoint(t.longitude, t.latitude), 4326)::geography
				) < 1000
			  )
		)
	`
	_ = s.pool.QueryRow(ctx, nearbyAssetCTE+`SELECT COUNT(*)::int FROM port_call_visits pc JOIN nearby_assets na ON na.id = pc.asset_id`, assetID).Scan(&nearbyPortCalls)
	_ = s.pool.QueryRow(ctx, nearbyAssetCTE+`SELECT COUNT(*)::int FROM meridian_cargo_records mcr JOIN nearby_assets na ON na.id = mcr.load_terminal_id`, assetID).Scan(&nearbyMeridianCargo)
	_ = s.pool.QueryRow(ctx, nearbyAssetCTE+`
		SELECT COUNT(*)::int
		FROM cargo_estimates ce
		JOIN vessels v ON v.id = ce.vessel_id
		JOIN port_call_visits pc ON pc.mmsi = v.mmsi
		JOIN nearby_assets na ON na.id = pc.asset_id
	`, assetID).Scan(&nearbyCargoEstimates)
	_ = s.pool.QueryRow(ctx, `
		WITH target AS (
			SELECT latitude, longitude
			FROM assets
			WHERE id::text = $1
			  AND latitude IS NOT NULL
			  AND longitude IS NOT NULL
			LIMIT 1
		)
		SELECT COUNT(*)::int
		FROM target t
		JOIN ais_positions ap ON ST_DWithin(
			ST_SetSRID(ST_MakePoint(ap.lon, ap.lat), 4326)::geography,
			ST_SetSRID(ST_MakePoint(t.longitude, t.latitude), 4326)::geography,
			$2
		)
	`, assetID, radiusM).Scan(&aisNearby)
	_ = s.pool.QueryRow(ctx, `
		WITH target AS (
			SELECT latitude, longitude
			FROM assets
			WHERE id::text = $1
			  AND latitude IS NOT NULL
			  AND longitude IS NOT NULL
			LIMIT 1
		)
		SELECT COUNT(*)::int
		FROM target t
		JOIN ais_positions ap ON ap.ts >= now() - interval '7 days'
		  AND ST_DWithin(
			ST_SetSRID(ST_MakePoint(ap.lon, ap.lat), 4326)::geography,
			ST_SetSRID(ST_MakePoint(t.longitude, t.latitude), 4326)::geography,
			$2
		  )
	`, assetID, radiusM).Scan(&aisNearby7d)

	gaps := []string{}
	if portCalls == 0 {
		if nearbyPortCalls > 0 {
			gaps = append(gaps, "No exact port-call visits are attached to this asset yet; nearby terminal-cluster visits are contextual.")
		} else {
			gaps = append(gaps, "No exact port-call visits are attached to this asset yet.")
		}
	}
	if meridianCargo == 0 && cargoEstimates == 0 {
		if nearbyMeridianCargo > 0 || nearbyCargoEstimates > 0 {
			gaps = append(gaps, "No exact cargo record is attached to this asset yet; nearby terminal-cluster cargo is contextual until exact port-call/voyage evidence arrives.")
		} else {
			gaps = append(gaps, "No cargo record is attached to this asset yet; cargo views are contextual until port-call/voyage evidence arrives.")
		}
	}
	if aisNearby7d == 0 {
		gaps = append(gaps, "No recent AIS observations within the local radius; treat missing vessel activity as provider coverage, not proof of inactivity.")
	}
	return map[string]any{
		"method":                        "asset_terminal_context_v1",
		"radius_m":                      radiusM,
		"port_call_visits":              portCalls,
		"meridian_cargo_records":        meridianCargo,
		"cargo_estimates":               cargoEstimates,
		"nearby_port_call_visits":       nearbyPortCalls,
		"nearby_meridian_cargo_records": nearbyMeridianCargo,
		"nearby_cargo_estimates":        nearbyCargoEstimates,
		"ais_positions_nearby":          aisNearby,
		"ais_positions_7d":              aisNearby7d,
		"evidence_label":                "reported",
	}, gaps
}

func (s *Server) companyContacts(r *http.Request, companyID string) []map[string]any {
	rows, err := s.pool.Query(r.Context(), `
		SELECT COALESCE(name, ''), COALESCE(email, ''), COALESCE(phone, ''), COALESCE(role, ''),
		       COALESCE(evidence_snippet, ''), COALESCE(confidence_score, 0), COALESCE(verification_status, '')
		FROM contacts
		WHERE company_id = $1
		ORDER BY confidence_score DESC NULLS LAST, created_at DESC
		LIMIT 20
	`, companyID)
	if err != nil {
		return nil
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var name, email, phone, role, evidence, status string
		var confidence float64
		if err := rows.Scan(&name, &email, &phone, &role, &evidence, &confidence, &status); err != nil {
			continue
		}
		out = append(out, map[string]any{
			"name": name, "email": email, "phone": phone, "role": role,
			"evidence": evidence, "confidence_score": confidence, "verification_status": status,
		})
	}
	return out
}

func commercialRoles(companyType string, operatorAssets, ownerAssets, ownedVessels, operatedVessels int) []string {
	seen := map[string]bool{}
	out := []string{}
	add := func(role string) {
		role = strings.TrimSpace(role)
		if role == "" || seen[role] {
			return
		}
		seen[role] = true
		out = append(out, role)
	}
	add(companyType)
	if operatorAssets > 0 {
		add("operator")
		add("supplier")
	}
	if ownerAssets > 0 {
		add("owner")
	}
	if ownedVessels > 0 {
		add("shipowner")
	}
	if operatedVessels > 0 {
		add("vessel_operator")
	}
	return out
}

func appendCommercialRole(roles []string, values ...string) []string {
	seen := map[string]bool{}
	for _, role := range roles {
		seen[role] = true
	}
	for _, role := range values {
		role = strings.TrimSpace(role)
		if role == "" || seen[role] {
			continue
		}
		seen[role] = true
		roles = append(roles, role)
	}
	return roles
}

func (s *Server) companyTradeFlowSummary(r *http.Request, companyID string) []map[string]any {
	rows, err := s.pool.Query(r.Context(), `
		SELECT
			COALESCE(month::text, ''),
			COALESCE(reporter_country_code, ''),
			COALESCE(partner_country_code, ''),
			COALESCE(product_code, ''),
			COALESCE(product_name, ''),
			COALESCE(quantity, 0)::double precision,
			COALESCE(quantity_unit, ''),
			COALESCE(port_name, ''),
			COALESCE(port_state, ''),
			COALESCE(evidence_label, ''),
			COALESCE(raw_payload, '{}'::jsonb)::text
		FROM trade_flow_facts
		WHERE participant_company_id = $1
		ORDER BY month DESC NULLS LAST, quantity DESC NULLS LAST
		LIMIT 10
	`, companyID)
	if err != nil {
		return nil
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var month, reporter, partner, product, productName, unit, portName, portState, evidenceLabel, raw string
		var quantity float64
		if err := rows.Scan(&month, &reporter, &partner, &product, &productName, &quantity, &unit, &portName, &portState, &evidenceLabel, &raw); err != nil {
			continue
		}
		out = append(out, map[string]any{
			"month": month,
			"flow":  "IMPORT",
			"reporter": map[string]string{
				"country_code": reporter,
			},
			"origin": map[string]string{
				"country_code": partner,
			},
			"product_code": product,
			"product_name": productName,
			"quantity":     map[string]any{"value": quantity, "unit": unit},
			"port":         map[string]string{"name": portName, "state": portState},
			"evidence":     evidenceLabel,
			"raw_source":   jsonBlock(raw, "{}"),
		})
	}
	return out
}

func boundedLimit(raw string, fallback, max int) int {
	limit, _ := strconv.Atoi(strings.TrimSpace(raw))
	if limit <= 0 {
		limit = fallback
	}
	if limit > max {
		return max
	}
	return limit
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func jsonBlock(raw string, fallback string) json.RawMessage {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		raw = fallback
	}
	if !json.Valid([]byte(raw)) {
		raw = fallback
	}
	return json.RawMessage(raw)
}

func firstBenchmark(items []map[string]any) map[string]any {
	if len(items) == 0 {
		return nil
	}
	return items[0]
}
