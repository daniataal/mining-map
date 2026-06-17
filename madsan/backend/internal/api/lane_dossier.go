package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
)

type opportunityDossierRow struct {
	ID                  string
	OpportunityType     string
	Commodity           string
	OriginCountry       string
	DestinationCountry  string
	SupplierCompanyID   string
	BuyerCompanyID      string
	SupplierAssetID     string
	BuyerAssetID        string
	VesselID            string
	LaneID              string
	Score               float64
	Confidence          float64
	EvidenceGrade       string
	SupplierReality     float64
	BuyerReality        float64
	MarketPressure      float64
	RouteFeasibility    float64
	PriceContextScore   float64
	InvestorControl     float64
	RiskDiscount        float64
	RouteSummary        string
	CargoSummary        string
	MarketSummary       string
	PriceSummary        string
	Evidence            string
	BuyerEIAEvidence    string
	CargoLinkage        string
	CargoVoyageLinked   bool
	Limitations         []string
	Tier                string
	GeneratedAt         string
	ExpiresAt           string
}

func (s *Server) getIntelOpportunityDossier(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(chi.URLParam(r, "id"))
	row, err := s.loadOpportunityDossierRow(r, id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if row == nil {
		http.Error(w, "opportunity not found", http.StatusNotFound)
		return
	}

	opportunity := map[string]any{
		"id":                  row.ID,
		"opportunity_type":    row.OpportunityType,
		"commodity":           row.Commodity,
		"origin_country":      row.OriginCountry,
		"destination_country": row.DestinationCountry,
		"supplier_company_id": row.SupplierCompanyID,
		"buyer_company_id":    row.BuyerCompanyID,
		"supplier_asset_id":   row.SupplierAssetID,
		"buyer_asset_id":      row.BuyerAssetID,
		"vessel_id":           row.VesselID,
		"lane_id":             row.LaneID,
		"score":               row.Score,
		"confidence_score":    row.Confidence,
		"evidence_grade":      row.EvidenceGrade,
		"score_breakdown": map[string]float64{
			"supplier_reality":  row.SupplierReality,
			"buyer_reality":     row.BuyerReality,
			"market_pressure":   row.MarketPressure,
			"route_feasibility": row.RouteFeasibility,
			"price_context":     row.PriceContextScore,
			"investor_control":  row.InvestorControl,
			"risk_discount":     row.RiskDiscount,
		},
		"route_summary":           jsonBlock(row.RouteSummary, "{}"),
		"cargo_summary":           jsonBlock(row.CargoSummary, "{}"),
		"market_pressure_summary": jsonBlock(row.MarketSummary, "{}"),
		"price_context":           jsonBlock(row.PriceSummary, "{}"),
		"evidence":                jsonBlock(row.Evidence, "[]"),
		"buyer_eia_evidence":      jsonBlock(row.BuyerEIAEvidence, "{}"),
		"cargo_voyage_linked":     row.CargoVoyageLinked,
		"cargo_linkage_summary":   jsonBlock(row.CargoLinkage, "{}"),
		"limitations":             row.Limitations,
		"tier":                    row.Tier,
		"generated_at":            row.GeneratedAt,
		"expires_at":              row.ExpiresAt,
	}

	brokerAlpha := s.loadBrokerAlphaSnapshot(r, row.ID)
	thesisText := stringFromAny(brokerAlpha["thesis_text"])
	if thesisText == "" {
		thesisText = buildFallbackThesisText(row)
	}

	investorPaths, _ := s.listIntelInvestorPathSnapshots(r, row.Commodity, row.OriginCountry, row.DestinationCountry, "", "", row.ID, 0, 5)
	cargoClues := s.opportunityCargoClues(r, row)
	importers := s.opportunityImporterEvidence(r, row)
	stsPredictions := s.opportunitySTSPredictions(r, row)
	marketPressure := s.profileMarketPressure(r.Context(), row.DestinationCountry, row.Commodity, 4)
	benchmarks := s.latestBenchmarks(r, row.Commodity)
	if len(benchmarks) == 0 {
		benchmarks = s.latestLegacySpotPrices(r, row.Commodity)
	}
	landedMargin := s.loadLandedMarginSnapshot(r, row.ID)
	chainBundle := s.buildOpportunityCommercialChainBundle(r, row)
	contacts := s.opportunityContactBundles(r, row)
	risk := buildOpportunityRiskBlock(row, brokerAlpha, landedMargin)
	outreachPack := buildOutreachPack(row, thesisText, contacts, risk)
	evidenceChain := buildOpportunityEvidenceChain(row, brokerAlpha, importers, cargoClues, stsPredictions, landedMargin)

	limitations := append([]string{}, row.Limitations...)
	limitations = append(limitations, commercialStringArray(brokerAlpha["limitations"])...)
	limitations = append(limitations, commercialStringArray(landedMargin["limitations"])...)
	limitations = dedupeStringList(limitations)

	writeJSON(w, map[string]any{
		"opportunity":               opportunity,
		"broker_alpha":              brokerAlpha,
		"thesis_text":               thesisText,
		"investor_paths":            investorPaths,
		"cargo_clues":               cargoClues,
		"importers":                 importers,
		"sts_predictions":           stsPredictions,
		"market_pressure":           marketPressure,
		"benchmarks":                benchmarks,
		"landed_margin":             landedMargin,
		"commercial_chain_bundle":   chainBundle,
		"contacts":                  contacts,
		"risk":                      risk,
		"outreach_pack":             outreachPack,
		"evidence_chain":            evidenceChain,
		"limitations":               limitations,
		"scenario_label":            firstNonEmpty(stringFromAny(brokerAlpha["scenario_label"]), "scenario_intelligence"),
		"message":                   "Lane dossier synthesizes open-source-backed intelligence with explicit evidence tiers; not a confirmed deal or investment advice.",
	})
}

func (s *Server) loadOpportunityDossierRow(r *http.Request, id string) (*opportunityDossierRow, error) {
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
			COALESCE(buyer_eia_evidence, '{}'::jsonb)::text,
			COALESCE(cargo_linkage_summary, '{}'::jsonb)::text,
			COALESCE(cargo_voyage_linked, false),
			COALESCE(limitations, ARRAY[]::text[]),
			tier,
			generated_at::text,
			COALESCE(expires_at::text, '')
		FROM opportunity_candidates
		WHERE status = 'active'
		  AND (id::text = $1 OR lane_id = $1)
		ORDER BY score DESC
		LIMIT 1
	`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	if !rows.Next() {
		return nil, nil
	}
	var row opportunityDossierRow
	if err := rows.Scan(
		&row.ID, &row.OpportunityType, &row.Commodity, &row.OriginCountry, &row.DestinationCountry,
		&row.SupplierCompanyID, &row.BuyerCompanyID, &row.SupplierAssetID, &row.BuyerAssetID, &row.VesselID, &row.LaneID,
		&row.Score, &row.Confidence, &row.EvidenceGrade,
		&row.SupplierReality, &row.BuyerReality, &row.MarketPressure, &row.RouteFeasibility, &row.PriceContextScore, &row.InvestorControl, &row.RiskDiscount,
		&row.RouteSummary, &row.CargoSummary, &row.MarketSummary, &row.PriceSummary, &row.Evidence, &row.BuyerEIAEvidence, &row.CargoLinkage, &row.CargoVoyageLinked,
		&row.Limitations, &row.Tier, &row.GeneratedAt, &row.ExpiresAt,
	); err != nil {
		return nil, err
	}
	return &row, nil
}

func (s *Server) loadBrokerAlphaSnapshot(r *http.Request, opportunityID string) map[string]any {
	var thesis, scenario, evidence, generatedAt, expiresAt string
	var intent, counterparty, jodi, importDep, openVessel, laneFit, priceSpread float64
	var limitations []string
	err := s.pool.QueryRow(r.Context(), `
		SELECT
			COALESCE(thesis_text, ''),
			COALESCE(scenario_label, 'scenario_intelligence'),
			COALESCE(intent_score, 0),
			COALESCE(counterparty_intent_score, 0),
			COALESCE(jodi_stress_component, 0),
			COALESCE(import_dependency_component, 0),
			COALESCE(open_vessel_proximity_component, 0),
			COALESCE(lane_fit_component, 0),
			COALESCE(price_spread_component, 0),
			COALESCE(evidence, '[]'::jsonb)::text,
			COALESCE(limitations, ARRAY[]::text[]),
			generated_at::text,
			COALESCE(expires_at::text, '')
		FROM broker_alpha_snapshots
		WHERE opportunity_id::text = $1
		  AND (expires_at IS NULL OR expires_at > now())
		ORDER BY generated_at DESC
		LIMIT 1
	`, opportunityID).Scan(&thesis, &scenario, &intent, &counterparty, &jodi, &importDep, &openVessel, &laneFit, &priceSpread, &evidence, &limitations, &generatedAt, &expiresAt)
	if err != nil {
		return map[string]any{"status": "pending", "message": "Broker alpha snapshot not yet precomputed for this lane."}
	}
	return map[string]any{
		"status":                      "ready",
		"thesis_text":                   thesis,
		"scenario_label":                scenario,
		"intent_score":                  intent,
		"counterparty_intent_score":     counterparty,
		"jodi_stress_component":         jodi,
		"import_dependency_component":   importDep,
		"open_vessel_proximity_component": openVessel,
		"lane_fit_component":            laneFit,
		"price_spread_component":        priceSpread,
		"evidence":                      jsonBlock(evidence, "[]"),
		"limitations":                   limitations,
		"generated_at":                  generatedAt,
		"expires_at":                    expiresAt,
	}
}

func (s *Server) loadLandedMarginSnapshot(r *http.Request, opportunityID string) map[string]any {
	var commodity, origin, destination, benchmarkKey, method, evidenceLabel, generatedAt, expiresAt string
	var sourcePrice, destPrice, freightLow, freightBase, freightHigh, qualityLow, qualityBase, qualityHigh, marginLow, marginBase, marginHigh float64
	var limitations []string
	err := s.pool.QueryRow(r.Context(), `
		SELECT
			COALESCE(commodity, ''),
			COALESCE(origin_country, ''),
			COALESCE(destination_country, ''),
			COALESCE(benchmark_key, ''),
			COALESCE(source_price_usd, 0),
			COALESCE(destination_price_usd, 0),
			COALESCE(freight_low_usd, 0),
			COALESCE(freight_base_usd, 0),
			COALESCE(freight_high_usd, 0),
			COALESCE(quality_low_usd, 0),
			COALESCE(quality_base_usd, 0),
			COALESCE(quality_high_usd, 0),
			COALESCE(margin_low_usd, 0),
			COALESCE(margin_base_usd, 0),
			COALESCE(margin_high_usd, 0),
			evidence_label,
			COALESCE(method, ''),
			COALESCE(limitations, ARRAY[]::text[]),
			generated_at::text,
			COALESCE(expires_at::text, '')
		FROM landed_margin_snapshots
		WHERE opportunity_id::text = $1
		  AND (expires_at IS NULL OR expires_at > now())
		ORDER BY generated_at DESC
		LIMIT 1
	`, opportunityID).Scan(
		&commodity, &origin, &destination, &benchmarkKey,
		&sourcePrice, &destPrice, &freightLow, &freightBase, &freightHigh,
		&qualityLow, &qualityBase, &qualityHigh, &marginLow, &marginBase, &marginHigh,
		&evidenceLabel, &method, &limitations, &generatedAt, &expiresAt,
	)
	if err != nil {
		return map[string]any{
			"status":  "pending",
			"message": "Landed margin bands not yet precomputed for this lane.",
		}
	}
	return map[string]any{
		"status":              "indicative_bands",
		"evidence_label":      evidenceLabel,
		"method":              method,
		"commodity":           commodity,
		"origin_country":      origin,
		"destination_country": destination,
		"benchmark_key":       benchmarkKey,
		"source_price_usd":    sourcePrice,
		"destination_price_usd": destPrice,
		"freight": map[string]any{
			"low_usd_per_bbl":  freightLow,
			"base_usd_per_bbl": freightBase,
			"high_usd_per_bbl": freightHigh,
			"evidence_label":   "estimated",
		},
		"quality_adjustment": map[string]any{
			"low_usd_per_bbl":  qualityLow,
			"base_usd_per_bbl": qualityBase,
			"high_usd_per_bbl": qualityHigh,
			"evidence_label":   "estimated",
		},
		"margin_bands_usd_per_bbl": map[string]any{
			"low":  marginLow,
			"base": marginBase,
			"high": marginHigh,
		},
		"limitations":  limitations,
		"generated_at": generatedAt,
		"expires_at":   expiresAt,
	}
}

func (s *Server) opportunityCargoClues(r *http.Request, row *opportunityDossierRow) []map[string]any {
	out := []map[string]any{}
	if row.CargoVoyageLinked {
		out = append(out, map[string]any{
			"source":         "cargo_voyage_linker",
			"summary":        jsonBlock(row.CargoSummary, "{}"),
			"linkage":        jsonBlock(row.CargoLinkage, "{}"),
			"evidence_label": "estimated",
		})
	}
	entityType := "asset"
	entityID := firstNonEmpty(row.SupplierAssetID, row.BuyerAssetID)
	if row.VesselID != "" {
		entityType = "vessel"
		entityID = row.VesselID
	}
	for _, item := range s.profileCargoMovements(r.Context(), entityType, entityID, "", 6) {
		if len(item) > 0 {
			out = append(out, item)
		}
	}
	return out
}

func (s *Server) opportunityImporterEvidence(r *http.Request, row *opportunityDossierRow) []map[string]any {
	out := []map[string]any{}
	eiaBlock := jsonBlock(row.BuyerEIAEvidence, "{}")
	var eia map[string]any
	_ = json.Unmarshal(eiaBlock, &eia)
	if matched, _ := eia["matched"].(bool); matched {
		out = append(out, map[string]any{
			"source":         "eia_company_imports",
			"evidence_label": "reported",
			"summary":        eia,
		})
	}
	if row.BuyerCompanyID != "" {
		out = append(out, s.profileImporters(r.Context(), "company", row.BuyerCompanyID, "", row.DestinationCountry, 6)...)
	}
	if row.BuyerAssetID != "" {
		for _, item := range s.profileImporters(r.Context(), "asset", row.BuyerAssetID, "", row.DestinationCountry, 6) {
			out = append(out, item)
		}
	}
	originImporters := s.laneEIAImportersByOrigin(r, row.OriginCountry, row.Commodity, 8)
	out = append(out, originImporters...)
	return dedupeImporterRows(out)
}

func (s *Server) laneEIAImportersByOrigin(r *http.Request, originCountry, commodity string, limit int) []map[string]any {
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
			COALESCE(MAX(month)::text, '')
		FROM trade_flow_facts
		WHERE source_key = 'eia_company_imports'
		  AND flow_code = 'IMPORT'
		  AND participant_name IS NOT NULL
		  AND partner_country_code ILIKE $1
		  AND ($2 = '' OR product_code ILIKE '%' || $2 || '%' OR product_name ILIKE '%' || $2 || '%')
		GROUP BY participant_company_id, participant_name, product_code, partner_country_code
		ORDER BY MAX(month) DESC NULLS LAST, SUM(quantity) DESC NULLS LAST
		LIMIT $3
	`, strings.TrimSpace(originCountry), strings.TrimSpace(commodity), limit)
	if err != nil {
		return nil
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var companyID, name, productCode, productName, partnerCountry, unit, latestMonth string
		var totalQuantity float64
		var factRows int
		if err := rows.Scan(&companyID, &name, &productCode, &productName, &partnerCountry, &totalQuantity, &unit, &factRows, &latestMonth); err != nil {
			continue
		}
		out = append(out, map[string]any{
			"company_id":     companyID,
			"name":           name,
			"product_code":   productCode,
			"product_name":   productName,
			"origin_country": map[string]string{"country_code": partnerCountry},
			"quantity":       map[string]any{"value": totalQuantity, "unit": unit},
			"rows":           factRows,
			"latest_month":   latestMonth,
			"evidence_label": "reported",
			"source":         "eia_company_imports",
		})
	}
	return out
}

func (s *Server) opportunitySTSPredictions(r *http.Request, row *opportunityDossierRow) []map[string]any {
	out := []map[string]any{}
	for _, raw := range s.profileSTSPredictions(r.Context(), "asset", firstNonEmpty(row.SupplierAssetID, row.BuyerAssetID), "", 6) {
		out = append(out, raw)
	}
	if row.VesselID != "" {
		for _, raw := range s.profileSTSPredictions(r.Context(), "vessel", row.VesselID, "", 6) {
			out = append(out, raw)
		}
	}
	rows, err := s.pool.Query(r.Context(), `
		SELECT payload::text
		FROM predictive_signals
		WHERE signal_type = 'commercial_sts_v1'
		  AND (expires_at IS NULL OR expires_at > now())
		  AND (
			payload->>'lane_id' = $1
			OR payload->>'opportunity_id' = $2
		  )
		ORDER BY predicted_at DESC NULLS LAST, confidence_score DESC
		LIMIT 6
	`, row.LaneID, row.ID)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var raw string
			if err := rows.Scan(&raw); err == nil {
				var item map[string]any
				if err := json.Unmarshal(jsonBlock(raw, "{}"), &item); err == nil {
					out = append(out, item)
				}
			}
		}
	}
	return out
}

func (s *Server) buildOpportunityCommercialChainBundle(r *http.Request, row *opportunityDossierRow) map[string]any {
	linkedIntel := map[string]any{
		"opportunities":   []map[string]any{{"id": row.ID, "lane_id": row.LaneID, "commodity": row.Commodity}},
		"investor_paths":  s.investorPathsForBundle(r, row),
		"cargo_movements": s.opportunityCargoClues(r, row),
		"importers":       s.opportunityImporterEvidence(r, row),
		"market_pressure": s.profileMarketPressure(r.Context(), row.DestinationCountry, row.Commodity, 4),
		"benchmarks":      s.latestBenchmarks(r, row.Commodity),
		"limitations":     row.Limitations,
	}
	supplierName, supplierCountry := s.assetSummary(r.Context(), row.SupplierAssetID)
	buyerName, buyerCountry := s.assetSummary(r.Context(), row.BuyerAssetID)
	return buildCommercialChainBundle(commercialChainBundleInput{
		EntityType:  "lane",
		EntityID:    firstNonEmpty(row.LaneID, row.ID),
		Name:        row.OriginCountry + " → " + row.DestinationCountry,
		CountryCode: row.DestinationCountry,
		AssetType:   "opportunity_lane",
		Owner:       map[string]any{"company_id": row.SupplierCompanyID, "name": supplierName, "country_code": supplierCountry, "evidence_label": "reported"},
		Operator:    map[string]any{"company_id": row.BuyerCompanyID, "name": buyerName, "country_code": buyerCountry, "evidence_label": "reported"},
		Contacts:    s.opportunityContactBundles(r, row),
		LinkedIntel: linkedIntel,
		CoverageGaps: []string{
			"Lane dossier combines inferred opportunity scoring with source-backed asset and trade-flow evidence.",
		},
	})
}

func (s *Server) investorPathsForBundle(r *http.Request, row *opportunityDossierRow) []map[string]any {
	raws, _ := s.listIntelInvestorPathSnapshots(r, row.Commodity, row.OriginCountry, row.DestinationCountry, "", "", row.ID, 0, 5)
	out := []map[string]any{}
	for _, raw := range raws {
		var item map[string]any
		if err := json.Unmarshal(raw, &item); err == nil {
			out = append(out, item)
		}
	}
	return out
}

func (s *Server) assetSummary(ctx context.Context, assetID string) (name, country string) {
	if assetID == "" {
		return "", ""
	}
	_ = s.pool.QueryRow(ctx, `
		SELECT COALESCE(name, ''), COALESCE(country_code, '')
		FROM assets WHERE id::text = $1
	`, assetID).Scan(&name, &country)
	return name, country
}

func (s *Server) opportunityContactBundles(r *http.Request, row *opportunityDossierRow) []map[string]any {
	return s.loadCommercialRoleContactBundles(r.Context(),
		commercialRoleContactInput{Role: "supplier", CompanyID: row.SupplierCompanyID},
		commercialRoleContactInput{Role: "buyer", CompanyID: row.BuyerCompanyID},
	)
}

func buildFallbackThesisText(row *opportunityDossierRow) string {
	return "Lane " + row.OriginCountry + " → " + row.DestinationCountry +
		" (" + row.Commodity + ") scores " + formatScore(row.Score) +
		" on JODI pressure and asset-backed supplier/buyer context. Broker alpha precompute pending — treat as scenario intelligence, not investment advice."
}

func buildOpportunityRiskBlock(row *opportunityDossierRow, brokerAlpha, landedMargin map[string]any) map[string]any {
	return map[string]any{
		"risk_discount_score": row.RiskDiscount,
		"evidence_grade":      row.EvidenceGrade,
		"tier":                row.Tier,
		"confidence_score":    row.Confidence,
		"broker_alpha_ready":  stringFromAny(brokerAlpha["status"]) == "ready",
		"margin_ready":        stringFromAny(landedMargin["status"]) == "indicative_bands",
		"flags": []string{
			"cargo_quantity_is_estimate_unless_voyage_linked",
			"benchmark_spread_not_deal_price",
			"counterparty_identity_requires_verification",
		},
		"evidence_label": "mixed",
	}
}

func buildOutreachPack(row *opportunityDossierRow, thesis string, contacts []map[string]any, risk map[string]any) map[string]any {
	return map[string]any{
		"thesis_preview": thesis,
		"lane": map[string]string{
			"id":          firstNonEmpty(row.LaneID, row.ID),
			"origin":      row.OriginCountry,
			"destination": row.DestinationCountry,
			"commodity":   row.Commodity,
		},
		"contacts": contacts,
		"verify_checklist": []string{
			"Confirm supplier asset operator and export entitlement",
			"Confirm buyer/import terminal capacity and product fit",
			"Validate cargo quantity against voyage or terminal evidence",
			"Check sanctions, registry, and beneficial ownership before outreach",
		},
		"risk":           risk,
		"evidence_label": "inferred",
	}
}

func buildOpportunityEvidenceChain(row *opportunityDossierRow, brokerAlpha map[string]any, importers, cargoClues []map[string]any, sts []map[string]any, landedMargin map[string]any) []map[string]any {
	chain := []map[string]any{
		{"step": "opportunity", "label": "inferred", "source": "opportunity_candidates", "id": row.ID},
		{"step": "market_pressure", "label": "estimated", "source": "jodi_oil", "country": row.DestinationCountry},
	}
	if stringFromAny(brokerAlpha["status"]) == "ready" {
		chain = append(chain, map[string]any{"step": "broker_alpha", "label": "predicted", "source": "broker_alpha_snapshots", "scenario_label": brokerAlpha["scenario_label"]})
	}
	if len(importers) > 0 {
		chain = append(chain, map[string]any{"step": "buyer_imports", "label": "reported", "source": "eia_company_imports", "count": len(importers)})
	}
	if len(cargoClues) > 0 {
		chain = append(chain, map[string]any{"step": "cargo", "label": "estimated", "source": "cargo_estimates", "count": len(cargoClues)})
	}
	if len(sts) > 0 {
		chain = append(chain, map[string]any{"step": "sts", "label": "predicted", "source": "commercial_sts_v1", "count": len(sts)})
	}
	if stringFromAny(landedMargin["status"]) == "indicative_bands" {
		chain = append(chain, map[string]any{"step": "landed_margin", "label": "estimated", "source": "landed_margin_snapshots"})
	}
	return chain
}

func dedupeImporterRows(items []map[string]any) []map[string]any {
	seen := map[string]bool{}
	out := []map[string]any{}
	for _, item := range items {
		key := strings.ToLower(strings.Join([]string{
			stringFromAny(item["company_id"]),
			stringFromAny(item["name"]),
			stringFromAny(item["source"]),
		}, "|"))
		if key == "||" || seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, item)
	}
	return out
}

func dedupeStringList(items []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, item := range items {
		item = strings.TrimSpace(item)
		if item == "" || seen[item] {
			continue
		}
		seen[item] = true
		out = append(out, item)
	}
	return out
}

func formatScore(v float64) string {
	return strings.TrimRight(strings.TrimRight(strings.Replace(fmt.Sprintf("%.1f", v), ".0", "", 1), "0"), ".")
}

func (s *Server) listIntelSTSOpenVessels(w http.ResponseWriter, r *http.Request) {
	limit := boundedLimit(r.URL.Query().Get("limit"), 50, 200)
	minConfidence, _ := strconv.ParseFloat(strings.TrimSpace(r.URL.Query().Get("min_confidence")), 64)
	label := strings.TrimSpace(r.URL.Query().Get("label"))
	zone := strings.TrimSpace(r.URL.Query().Get("zone"))
	rows, err := s.pool.Query(r.Context(), `
		SELECT
			id::text,
			COALESCE(vessel_id::text, ''),
			mmsi,
			COALESCE(imo, ''),
			COALESCE(vessel_name, ''),
			COALESCE(vessel_class, ''),
			COALESCE(zone_label, ''),
			COALESCE(latest_destination, ''),
			COALESCE(nav_status, ''),
			COALESCE(loitering_hours, 0),
			COALESCE(latest_draft_m, 0),
			COALESCE(draft_trend, ''),
			COALESCE(product_family, ''),
			COALESCE(owner_name, ''),
			COALESCE(operator_name, ''),
			COALESCE(owner_company_id::text, ''),
			COALESCE(operator_company_id::text, ''),
			COALESCE(contacts, '[]'::jsonb)::text,
			lead_label,
			COALESCE(confidence_score, 0),
			evidence_labels,
			COALESCE(evidence, '[]'::jsonb)::text,
			COALESCE(limitations, ARRAY[]::text[]),
			lat,
			lon,
			generated_at::text,
			COALESCE(expires_at::text, '')
		FROM sts_open_vessel_leads
		WHERE (expires_at IS NULL OR expires_at > now())
		  AND ($1 = 0 OR COALESCE(confidence_score, 0) >= $1)
		  AND ($2 = '' OR lead_label ILIKE $2)
		  AND ($3 = '' OR zone_label ILIKE '%' || $3 || '%' OR latest_destination ILIKE '%' || $3 || '%')
		ORDER BY confidence_score DESC, loitering_hours DESC NULLS LAST, generated_at DESC
		LIMIT $4
	`, minConfidence, label, zone, limit)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, vesselID, mmsi, imo, name, vesselClass, zoneLabel, destination, navStatus, draftTrend, productFamily, owner, operator, ownerCompany, operatorCompany, contacts, leadLabel, evidence, generatedAt, expiresAt string
		var loitering, draft, confidence float64
		var evidenceLabels, limitations []string
		var lat, lon *float64
		if err := rows.Scan(&id, &vesselID, &mmsi, &imo, &name, &vesselClass, &zoneLabel, &destination, &navStatus, &loitering, &draft, &draftTrend, &productFamily, &owner, &operator, &ownerCompany, &operatorCompany, &contacts, &leadLabel, &confidence, &evidenceLabels, &evidence, &limitations, &lat, &lon, &generatedAt, &expiresAt); err != nil {
			continue
		}
		out = append(out, map[string]any{
			"id":                id,
			"vessel_id":         vesselID,
			"mmsi":              mmsi,
			"imo":               imo,
			"vessel_name":       name,
			"vessel_class":      vesselClass,
			"zone_label":        zoneLabel,
			"latest_destination": destination,
			"nav_status":        navStatus,
			"loitering_hours":   loitering,
			"latest_draft_m":    draft,
			"draft_trend":       draftTrend,
			"product_family":    productFamily,
			"owner":             map[string]string{"name": owner, "company_id": ownerCompany},
			"operator":          map[string]string{"name": operator, "company_id": operatorCompany},
			"contacts":          jsonBlock(contacts, "[]"),
			"lead_label":        leadLabel,
			"confidence_score":  confidence,
			"evidence_labels":   evidenceLabels,
			"evidence":          jsonBlock(evidence, "[]"),
			"limitations":       limitations,
			"position":          map[string]any{"lat": lat, "lon": lon},
			"generated_at":      generatedAt,
			"expires_at":        expiresAt,
			"evidence_label":    "mixed",
		})
	}
	writeJSON(w, map[string]any{
		"count":   len(out),
		"items":   out,
		"message": "Open-to-STS vessel leads from AIS destination keywords and loitering; buyer/cargo owner not confirmed.",
	})
}

func (s *Server) loadFreightCurve(r *http.Request, origin, destination, commodity string) map[string]any {
	var distanceNM, low, base, high float64
	var method, evidenceLabel, sourceKey string
	err := s.pool.QueryRow(r.Context(), `
		SELECT
			COALESCE(distance_nm, 0),
			COALESCE(freight_low_usd_per_bbl, 0),
			COALESCE(freight_base_usd_per_bbl, 0),
			COALESCE(freight_high_usd_per_bbl, 0),
			COALESCE(method, ''),
			evidence_label,
			COALESCE(source_key, '')
		FROM freight_cost_curves
		WHERE corridor_key = $1
		  AND vessel_class = 'tanker'
		ORDER BY generated_at DESC
		LIMIT 1
	`, strings.TrimSpace(origin)+":"+strings.TrimSpace(destination)).Scan(&distanceNM, &low, &base, &high, &method, &evidenceLabel, &sourceKey)
	if err != nil {
		return map[string]any{"status": "pending", "message": "Freight curve not yet computed for this corridor."}
	}
	return map[string]any{
		"status":         "ready",
		"origin_country": origin,
		"destination_country": destination,
		"commodity":      commodity,
		"distance_nm":    distanceNM,
		"low_usd_per_bbl":  low,
		"base_usd_per_bbl": base,
		"high_usd_per_bbl": high,
		"method":         method,
		"source_key":     sourceKey,
		"evidence_label": evidenceLabel,
	}
}

func (s *Server) loadQualityAdjustment(r *http.Request, commodity string) map[string]any {
	product := firstNonEmpty(strings.TrimSpace(commodity), "CRUDEOIL")
	var low, base, high float64
	var method, evidenceLabel string
	err := s.pool.QueryRow(r.Context(), `
		SELECT
			COALESCE(adjustment_low_usd_per_bbl, 0),
			COALESCE(adjustment_base_usd_per_bbl, 0),
			COALESCE(adjustment_high_usd_per_bbl, 0),
			COALESCE(method, ''),
			evidence_label
		FROM quality_adjustments
		WHERE product_code ILIKE $1
		   OR ($1 = '' AND product_code = 'CRUDEOIL')
		ORDER BY generated_at DESC
		LIMIT 1
	`, product).Scan(&low, &base, &high, &method, &evidenceLabel)
	if err != nil {
		return map[string]any{"status": "pending", "message": "Quality adjustment band not yet available for this product."}
	}
	return map[string]any{
		"status":           "ready",
		"product_code":     product,
		"low_usd_per_bbl":  low,
		"base_usd_per_bbl": base,
		"high_usd_per_bbl": high,
		"method":           method,
		"evidence_label":   evidenceLabel,
	}
}
