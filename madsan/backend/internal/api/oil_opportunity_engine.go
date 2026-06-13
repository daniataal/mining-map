package api

import (
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
		SELECT
			ce.id::text,
			COALESCE(v.id::text, ''),
			COALESCE(v.name, ''),
			COALESCE(v.imo, ve.imo, ''),
			COALESCE(v.mmsi, voy.mmsi, ve.mmsi, ''),
			COALESCE(ve.vessel_class, v.vessel_type, ''),
			COALESCE(ve.owner_name, ''),
			COALESCE(ve.operator_name, ''),
			COALESCE(voy.load_port_name, ''),
			COALESCE(voy.load_country, ''),
			COALESCE(voy.discharge_port_name, ''),
			COALESCE(voy.discharge_country, ''),
			COALESCE(ce.product_family, voy.commodity_family, ''),
			COALESCE(ce.payload_low, 0),
			COALESCE(ce.payload_best, ce.payload_tons, 0),
			COALESCE(ce.payload_high, 0),
			COALESCE(ce.quantity_unit, 'tons'),
			COALESCE(ce.method, ''),
			COALESCE(ce.confidence_score, 0),
			ce.observed_at::text,
			COALESCE(ce.evidence, '[]'::jsonb)::text
		FROM cargo_estimates ce
		LEFT JOIN vessels v ON v.id = ce.vessel_id
		LEFT JOIN voyages voy ON voy.id = ce.voyage_id
		LEFT JOIN vessel_enrichment ve ON ve.vessel_id = v.id OR (v.mmsi IS NOT NULL AND ve.mmsi = v.mmsi)
		WHERE ($1 = '' OR COALESCE(ce.product_family, voy.commodity_family, '') ILIKE '%' || $1 || '%')
		  AND ($2 = '' OR voy.load_country ILIKE $2 OR voy.discharge_country ILIKE $2)
		ORDER BY ce.observed_at DESC
		LIMIT $3
	`, commodity, country, limit)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()
	for rows.Next() {
		out = append(out, scanCargoEstimate(rows)...)
	}

	if len(out) < limit {
		mcrRows, err := s.pool.Query(r.Context(), `
			SELECT
				id::text,
				COALESCE(vessel_name, ''),
				COALESCE(imo, ''),
				COALESCE(mmsi, ''),
				COALESCE(commodity_family, ''),
				COALESCE(load_port_name, ''),
				COALESCE(load_country, ''),
				COALESCE(discharge_hint, ''),
				COALESCE(discharge_country, ''),
				COALESCE(volume_low, 0),
				COALESCE(volume_best_estimate, 0),
				COALESCE(volume_high, 0),
				COALESCE(volume_unit, 'bbl'),
				COALESCE(volume_method, recipe, ''),
				COALESCE(confidence, 0),
				COALESCE(event_date::text, ''),
				COALESCE(evidence_chain, '[]'::jsonb)::text
			FROM meridian_cargo_records
			WHERE ($1 = '' OR commodity_family ILIKE '%' || $1 || '%')
			  AND ($2 = '' OR load_country ILIKE $2 OR discharge_country ILIKE $2)
			ORDER BY event_date DESC NULLS LAST, confidence DESC
			LIMIT $3
		`, commodity, country, limit-len(out))
		if err == nil {
			defer mcrRows.Close()
			for mcrRows.Next() {
				var id, vesselName, imo, mmsi, product, loadPort, loadCountry, dischargePort, dischargeCountry, unit, method, observedAt, evidence string
				var low, best, high, confidence float64
				if err := mcrRows.Scan(&id, &vesselName, &imo, &mmsi, &product, &loadPort, &loadCountry, &dischargePort, &dischargeCountry,
					&low, &best, &high, &unit, &method, &confidence, &observedAt, &evidence); err != nil {
					continue
				}
				out = append(out, map[string]any{
					"id":             id,
					"source":         "meridian_cargo_records",
					"vessel_name":    vesselName,
					"imo":            imo,
					"mmsi":           mmsi,
					"product_family": product,
					"load":           map[string]string{"port": loadPort, "country": loadCountry},
					"discharge":      map[string]string{"port": dischargePort, "country": dischargeCountry},
					"quantity":       map[string]any{"low": low, "best": best, "high": high, "unit": unit, "method": method},
					"confidence":     confidence,
					"observed_at":    observedAt,
					"evidence":       jsonBlock(evidence, "[]"),
					"evidence_label": "inferred",
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
						jsonb_build_object('step', 'investor', 'label', inv.investor_name, 'evidence_label', 'reported'),
						jsonb_build_object('step', 'supplier_operator', 'label', COALESCE(sc.name, so.name, sa.name, 'supplier side'), 'asset', COALESCE(sa.name, ''), 'evidence_label', 'reported'),
						jsonb_build_object('step', 'route_asset', 'label', COALESCE(oc.origin_country, '?') || ' -> ' || COALESCE(oc.destination_country, '?'), 'asset', COALESCE(sa.name, '') || ' -> ' || COALESCE(ba.name, ''), 'evidence_label', 'inferred'),
						jsonb_build_object('step', 'cargo_or_vessel', 'label', CASE WHEN cargo.items IS NULL THEN 'cargo clue pending' ELSE 'cargo clues attached' END, 'evidence_label', CASE WHEN cargo.items IS NULL THEN 'not_attached' ELSE 'estimated' END),
						jsonb_build_object('step', 'buyer_operator', 'label', COALESCE(bc.name, bo.name, ba.name, 'buyer side'), 'asset', COALESCE(ba.name, ''), 'evidence_label', 'reported'),
						jsonb_build_object('step', 'price_context', 'label', COALESCE(oc.price_context->>'benchmark_key', oc.price_context->>'benchmark', 'open benchmark pending'), 'evidence_label', COALESCE(oc.price_context->>'evidence_label', 'estimated'))
					),
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

func scanCargoEstimate(rows interface{ Scan(dest ...any) error }) []map[string]any {
	var id, vesselID, vesselName, imo, mmsi, vesselClass, owner, operator, loadPort, loadCountry, dischargePort, dischargeCountry, product, unit, method, observedAt, evidence string
	var low, best, high, confidence float64
	if err := rows.Scan(&id, &vesselID, &vesselName, &imo, &mmsi, &vesselClass, &owner, &operator, &loadPort, &loadCountry, &dischargePort, &dischargeCountry,
		&product, &low, &best, &high, &unit, &method, &confidence, &observedAt, &evidence); err != nil {
		return nil
	}
	return []map[string]any{{
		"id":             id,
		"source":         "cargo_estimates",
		"vessel_id":      vesselID,
		"vessel_name":    vesselName,
		"imo":            imo,
		"mmsi":           mmsi,
		"vessel_class":   vesselClass,
		"owner_name":     owner,
		"operator_name":  operator,
		"product_family": product,
		"load":           map[string]string{"port": loadPort, "country": loadCountry},
		"discharge":      map[string]string{"port": dischargePort, "country": dischargeCountry},
		"quantity":       map[string]any{"low": low, "best": best, "high": high, "unit": unit, "method": method},
		"confidence":     confidence,
		"observed_at":    observedAt,
		"evidence":       jsonBlock(evidence, "[]"),
		"evidence_label": "estimated",
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
	writeJSON(w, map[string]any{
		"id":                 id,
		"type":               "company",
		"name":               name,
		"country_code":       country,
		"commodities":        commodities,
		"roles":              roles,
		"contactability":     map[string]string{"website": website, "phone": phone, "email": email},
		"asset_counts":       map[string]int{"operator": operatorAssets, "owner": ownerAssets, "owned_vessels": ownedVessels, "operated_vessels": operatedVessels, "import_rows": importRows},
		"trade_flow_summary": s.companyTradeFlowSummary(r, id),
		"contacts":           s.companyContacts(r, id),
		"confidence_score":   confidence,
		"raw_source_payload": jsonBlock(raw, "{}"),
		"evidence_label":     "reported",
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
	writeJSON(w, map[string]any{
		"id":               id,
		"type":             "asset",
		"name":             name,
		"asset_type":       assetType,
		"country_code":     country,
		"commodities":      commodities,
		"operator":         map[string]string{"company_id": operatorID, "name": operatorName},
		"owner":            map[string]string{"company_id": ownerID, "name": ownerName},
		"roles":            []string{"real_asset"},
		"confidence_score": confidence,
		"raw_source":       jsonBlock(raw, "{}"),
		"evidence_label":   "reported",
	})
}

func (s *Server) getVesselCommercialProfile(w http.ResponseWriter, r *http.Request, id string) {
	var name, imo, mmsi, vesselType, ownerName, operatorName, ownerID, operatorID, vesselClass string
	var dwt, confidence float64
	err := s.pool.QueryRow(r.Context(), `
		SELECT COALESCE(v.name, ''), COALESCE(v.imo, ve.imo, ''), COALESCE(v.mmsi, ve.mmsi, ''),
		       COALESCE(v.vessel_type, ''), COALESCE(ve.owner_name, ''), COALESCE(ve.operator_name, ''),
		       COALESCE(ve.owner_company_id::text, ''), COALESCE(ve.operator_company_id::text, ''),
		       COALESCE(ve.vessel_class, ''), COALESCE(ve.deadweight_tons, 0),
		       GREATEST(COALESCE(v.confidence_score, 0), COALESCE(ve.confidence_score, 0))
		FROM vessels v
		LEFT JOIN vessel_enrichment ve ON ve.vessel_id = v.id OR (v.mmsi IS NOT NULL AND ve.mmsi = v.mmsi)
		WHERE v.id::text = $1 OR v.imo = $1 OR v.mmsi = $1
		LIMIT 1
	`, id).Scan(&name, &imo, &mmsi, &vesselType, &ownerName, &operatorName, &ownerID, &operatorID, &vesselClass, &dwt, &confidence)
	if err != nil {
		http.Error(w, "vessel not found", http.StatusNotFound)
		return
	}
	writeJSON(w, map[string]any{
		"id":               id,
		"type":             "vessel",
		"name":             name,
		"imo":              imo,
		"mmsi":             mmsi,
		"vessel_type":      vesselType,
		"vessel_class":     vesselClass,
		"deadweight_tons":  dwt,
		"owner":            map[string]string{"company_id": ownerID, "name": ownerName},
		"operator":         map[string]string{"company_id": operatorID, "name": operatorName},
		"roles":            []string{"shipowner_route_evidence"},
		"confidence_score": confidence,
		"evidence_label":   "reported",
	})
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
