package api

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

type cargoCommercialContextInput struct {
	Source             string
	VesselID           string
	VesselName         string
	IMO                string
	MMSI               string
	VesselClass        string
	OwnerName          string
	OperatorName       string
	OwnerCompanyID     string
	OperatorCompanyID  string
	OwnerProfileJSON   string
	ShipperName        string
	ConsigneeName      string
	ShipperCompanyID   string
	ConsigneeCompanyID string
	ProductFamily      string
	LoadPort           string
	LoadCountry        string
	DischargePort      string
	DischargeCountry   string
	RouteSource        string
	RouteConfidence    float64
	LatestDestination  string
	DecodedDestination map[string]any
	QuantityMethod     string
	EvidenceLabel      string
}

func buildCargoCommercialContext(ctx context.Context, pool *pgxpool.Pool, in cargoCommercialContextInput) map[string]any {
	ownerProfile := parseJSONObject(in.OwnerProfileJSON)
	if ownerID := profileString(ownerProfile, "shipvault_company_id"); ownerID != "" {
		if extra := loadVesselShipvaultOwner(ctx, pool, ownerID); extra != nil {
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

	history := loadVesselNameHistory(ctx, pool, in.MMSI)
	summary := map[string]any{
		"mmsi":          in.MMSI,
		"imo":           in.IMO,
		"owner_name":    in.OwnerName,
		"operator_name": in.OperatorName,
	}
	if len(history) > 0 {
		summary["name_history"] = history
	}
	if len(ownerProfile) > 0 {
		summary["owner_profile"] = ownerProfile
	}

	ownerID := profileString(ownerProfile, "shipvault_company_id")
	fleetMatch := loadVesselFleetMatch(ctx, pool, ownerID, in.MMSI, in.IMO, history)
	ownershipIntel := buildVesselOwnershipIntel(summary, ownerProfile, fleetMatch)

	contacts := loadVesselCommercialContacts(ctx, pool, in.OwnerCompanyID, in.OperatorCompanyID, in.OwnerName, in.OperatorName, ownerProfile)
	if shipper := loadCompanyContactBundle(ctx, pool, in.ShipperCompanyID, "shipper", in.ShipperName, nil); shipper != nil {
		contacts = append(contacts, shipper)
	}
	if consignee := loadCompanyContactBundle(ctx, pool, in.ConsigneeCompanyID, "consignee", in.ConsigneeName, nil); consignee != nil {
		contacts = append(contacts, consignee)
	}
	contacts = dedupeCargoContactBundles(contacts)

	parties := cargoCommercialParties(in, ownerProfile)
	chainSteps := cargoCommercialChainSteps(in, ownerProfile)
	buyerIntel := loadCargoDestinationBuyerIntel(ctx, pool, in)
	if len(buyerIntel) > 0 {
		if buyerContacts := loadCargoBuyerContactBundles(ctx, pool, buyerIntel); len(buyerContacts) > 0 {
			buyerContacts = dedupeCargoContactBundles(buyerContacts)
			buyerIntel["contacts"] = buyerContacts
			buyerIntel["contactability"] = cargoContactability(buyerContacts)
			contacts = append(contacts, buyerContacts...)
			contacts = dedupeCargoContactBundles(contacts)
		}
		chainSteps = appendCargoBuyerIntelSteps(chainSteps, buyerIntel)
	}
	out := map[string]any{
		"method": "imo_mmsi_owner_manager_osint_v1",
		"identity_anchor": map[string]any{
			"vessel_name":  in.VesselName,
			"imo":          in.IMO,
			"mmsi":         in.MMSI,
			"vessel_class": in.VesselClass,
		},
		"route": map[string]any{
			"load":               map[string]string{"port": in.LoadPort, "country": in.LoadCountry},
			"discharge":          map[string]string{"port": in.DischargePort, "country": in.DischargeCountry},
			"source":             in.RouteSource,
			"confidence_score":   in.RouteConfidence,
			"latest_destination": in.LatestDestination,
		},
		"product_family":   in.ProductFamily,
		"quantity_method":  in.QuantityMethod,
		"evidence_label":   firstNonEmpty(in.EvidenceLabel, "estimated"),
		"duplicate_policy": "latest per vessel/product/load/discharge key",
		"parties":          parties,
		"chain_steps":      chainSteps,
		"contactability":   cargoContactability(contacts),
	}
	if len(ownerProfile) > 0 {
		out["owner_profile"] = ownerProfile
	}
	if len(in.DecodedDestination) > 0 {
		out["route"].(map[string]any)["decoded_destination"] = in.DecodedDestination
	}
	if len(buyerIntel) > 0 {
		out["destination_buyer_intel"] = buyerIntel
	}
	if len(contacts) > 0 {
		out["contacts"] = contacts
	}
	if ownershipIntel != nil {
		out["ownership_intel"] = ownershipIntel
		if v, ok := ownershipIntel["history_candidates"]; ok {
			out["previous_owner_candidates"] = v
		}
		if v, ok := ownershipIntel["registry_checks"]; ok {
			out["registry_checks"] = v
		}
		if v, ok := ownershipIntel["search_pivots"]; ok {
			out["search_pivots"] = v
		}
		if v, ok := ownershipIntel["tier"]; ok {
			out["ownership_confidence_tier"] = v
		}
	}
	return out
}

func parseJSONObject(raw string) map[string]any {
	raw = strings.TrimSpace(raw)
	if raw == "" || raw == "{}" {
		return nil
	}
	var out map[string]any
	if json.Unmarshal([]byte(raw), &out) != nil {
		return nil
	}
	return out
}

func cargoCommercialParties(in cargoCommercialContextInput, ownerProfile map[string]any) []map[string]any {
	var parties []map[string]any
	add := func(role, name, companyID, evidence string) {
		name = strings.TrimSpace(name)
		if name == "" {
			return
		}
		row := map[string]any{"role": role, "name": name, "evidence_label": evidence}
		if companyID != "" {
			row["company_id"] = companyID
		}
		parties = append(parties, row)
	}
	add("registered_owner", in.OwnerName, in.OwnerCompanyID, "source-backed")
	add("operator_manager", in.OperatorName, in.OperatorCompanyID, "source-backed")
	add("shipper", in.ShipperName, in.ShipperCompanyID, firstNonEmpty(in.EvidenceLabel, "inferred"))
	add("consignee", in.ConsigneeName, in.ConsigneeCompanyID, firstNonEmpty(in.EvidenceLabel, "inferred"))
	if parent := profileString(ownerProfile, "parent_name"); parent != "" {
		parties = append(parties, map[string]any{
			"role":           "parent_or_group",
			"name":           parent,
			"company_id":     profileString(ownerProfile, "parent_company_id"),
			"evidence_label": "source-backed",
		})
	}
	return parties
}

func cargoCommercialChainSteps(in cargoCommercialContextInput, ownerProfile map[string]any) []map[string]any {
	steps := []map[string]any{
		{"step": "vessel", "label": firstNonEmpty(in.VesselName, in.IMO, in.MMSI), "evidence_label": "observed"},
	}
	if in.OwnerName != "" {
		steps = append(steps, map[string]any{"step": "registered_owner", "label": in.OwnerName, "evidence_label": "source-backed"})
	}
	if parent := profileString(ownerProfile, "parent_name"); parent != "" {
		steps = append(steps, map[string]any{"step": "parent_or_group", "label": parent, "evidence_label": "source-backed"})
	}
	if in.OperatorName != "" && !strings.EqualFold(in.OperatorName, in.OwnerName) {
		steps = append(steps, map[string]any{"step": "operator_manager", "label": in.OperatorName, "evidence_label": "source-backed"})
	}
	if in.ShipperName != "" {
		steps = append(steps, map[string]any{"step": "shipper", "label": in.ShipperName, "evidence_label": firstNonEmpty(in.EvidenceLabel, "inferred")})
	}
	if in.LoadPort != "" || in.LoadCountry != "" {
		steps = append(steps, map[string]any{"step": "load", "label": strings.TrimSpace(fmt.Sprintf("%s %s", in.LoadPort, in.LoadCountry)), "evidence_label": "observed"})
	}
	steps = append(steps, map[string]any{"step": "cargo_clue", "label": firstNonEmpty(in.ProductFamily, "petroleum liquids"), "evidence_label": firstNonEmpty(in.EvidenceLabel, "estimated")})
	if in.DischargePort != "" || in.DischargeCountry != "" {
		dischargeLabel := strings.TrimSpace(fmt.Sprintf("%s %s", in.DischargePort, in.DischargeCountry))
		if decoded := decodedAISDestinationLabel(in.DecodedDestination); decoded != "" && strings.EqualFold(strings.TrimSpace(in.DischargePort), strings.TrimSpace(in.LatestDestination)) {
			dischargeLabel = decoded
		}
		steps = append(steps, map[string]any{"step": "discharge", "label": dischargeLabel, "evidence_label": "observed"})
	} else if decoded := decodedAISDestinationLabel(in.DecodedDestination); decoded != "" {
		steps = append(steps, map[string]any{"step": "ais_destination", "label": decoded, "evidence_label": "inferred"})
	}
	if in.ConsigneeName != "" {
		steps = append(steps, map[string]any{"step": "consignee", "label": in.ConsigneeName, "evidence_label": firstNonEmpty(in.EvidenceLabel, "inferred")})
	}
	return steps
}

func loadCargoDestinationBuyerIntel(ctx context.Context, pool *pgxpool.Pool, in cargoCommercialContextInput) map[string]any {
	countryCode := strings.ToUpper(firstNonEmpty(
		stringFromAny(in.DecodedDestination["country_code"]),
		in.DischargeCountry,
	))
	countryName := firstNonEmpty(
		stringFromAny(in.DecodedDestination["country_name"]),
		cargoCountryName(countryCode),
		in.DischargeCountry,
	)
	if countryCode == "" && countryName == "" {
		return nil
	}
	productCodes := cargoMarketProductCodes(in.ProductFamily)
	assetCountries := cargoAssetCountryNames(countryCode, countryName)
	assets := loadCargoBuyerAssets(ctx, pool, assetCountries, cargoAssetCommodityHints(in.ProductFamily), in.ProductFamily, in.DecodedDestination)
	pressure := loadCargoBuyerMarketPressure(ctx, pool, countryCode, productCodes)
	importers := loadCargoReportedImporters(ctx, pool, countryCode, productCodes)
	if len(assets) == 0 && len(pressure) == 0 && len(importers) == 0 {
		return nil
	}
	confidence := 30.0
	if len(in.DecodedDestination) > 0 {
		confidence += 12
	}
	if len(assets) > 0 {
		confidence += 18
	}
	if len(importers) > 0 {
		confidence += 14
	}
	if len(pressure) > 0 {
		if top := numberFromAny(pressure[0]["buyer_pressure_score"]); top > 0 {
			confidence += top * 0.25
		}
	}
	if confidence > 92 {
		confidence = 92
	}
	out := map[string]any{
		"method":           "decoded_destination_market_graph_v1",
		"destination":      map[string]any{"country_code": countryCode, "country_name": countryName, "decoded": in.DecodedDestination},
		"product_family":   in.ProductFamily,
		"confidence_score": confidence,
		"evidence_label":   "inferred",
		"limitations": []string{
			"Buyer candidates are market and asset candidates, not confirmed consignees unless importer/consignee evidence is present.",
			"Decoded AIS destination text is treated as inferred route evidence.",
		},
	}
	if len(assets) > 0 {
		out["likely_assets"] = assets
	}
	if len(pressure) > 0 {
		out["market_pressure"] = pressure
	}
	if len(importers) > 0 {
		out["reported_importers"] = importers
	}
	return out
}

func appendCargoBuyerIntelSteps(steps []map[string]any, buyerIntel map[string]any) []map[string]any {
	if pressure := recordArrayFromAny(buyerIntel["market_pressure"]); len(pressure) > 0 {
		top := pressure[0]
		label := strings.TrimSpace(fmt.Sprintf(
			"%s %s buyer pressure %.0f",
			stringFromAny(top["country_code"]),
			stringFromAny(top["product_code"]),
			numberFromAny(top["buyer_pressure_score"]),
		))
		steps = append(steps, map[string]any{"step": "destination_market", "label": label, "evidence_label": "estimated"})
	}
	if assets := recordArrayFromAny(buyerIntel["likely_assets"]); len(assets) > 0 {
		top := assets[0]
		label := firstNonEmpty(stringFromAny(top["asset_name"]), stringFromAny(top["operator_name"]), "destination buyer candidate")
		steps = append(steps, map[string]any{
			"step":           "likely_buyer_asset",
			"label":          label,
			"asset_id":       stringFromAny(top["asset_id"]),
			"company_id":     stringFromAny(top["operator_company_id"]),
			"evidence_label": "reported",
		})
		return steps
	}
	if importers := recordArrayFromAny(buyerIntel["reported_importers"]); len(importers) > 0 {
		top := importers[0]
		label := firstNonEmpty(stringFromAny(top["name"]), "reported importer")
		steps = append(steps, map[string]any{
			"step":           "reported_importer",
			"label":          label,
			"company_id":     stringFromAny(top["company_id"]),
			"evidence_label": "reported",
		})
	}
	return steps
}

func loadCargoBuyerContactBundles(ctx context.Context, pool *pgxpool.Pool, buyerIntel map[string]any) []map[string]any {
	var out []map[string]any
	for _, asset := range recordArrayFromAny(buyerIntel["likely_assets"]) {
		if len(out) >= 6 {
			break
		}
		assetName := stringFromAny(asset["asset_name"])
		if bundle := loadCompanyContactBundle(ctx, pool, stringFromAny(asset["operator_company_id"]), "likely_buyer_operator", firstNonEmpty(stringFromAny(asset["operator_name"]), assetName), nil); bundle != nil {
			bundle["asset_id"] = stringFromAny(asset["asset_id"])
			bundle["asset_name"] = assetName
			bundle["asset_type"] = stringFromAny(asset["asset_type"])
			out = append(out, bundle)
		}
		if bundle := loadCompanyContactBundle(ctx, pool, stringFromAny(asset["owner_company_id"]), "likely_buyer_owner", firstNonEmpty(stringFromAny(asset["owner_name"]), assetName), nil); bundle != nil {
			bundle["asset_id"] = stringFromAny(asset["asset_id"])
			bundle["asset_name"] = assetName
			bundle["asset_type"] = stringFromAny(asset["asset_type"])
			out = append(out, bundle)
		}
	}
	for _, importer := range recordArrayFromAny(buyerIntel["reported_importers"]) {
		if len(out) >= 8 {
			break
		}
		if bundle := loadCompanyContactBundle(ctx, pool, stringFromAny(importer["company_id"]), "reported_importer", stringFromAny(importer["name"]), nil); bundle != nil {
			bundle["product_code"] = stringFromAny(importer["product_code"])
			bundle["latest_month"] = stringFromAny(importer["latest_month"])
			bundle["import_quantity"] = importer["quantity"]
			bundle["import_unit"] = stringFromAny(importer["unit"])
			bundle["import_source"] = stringFromAny(importer["source"])
			out = append(out, bundle)
		}
	}
	return out
}

func loadCargoBuyerAssets(ctx context.Context, pool *pgxpool.Pool, countryNames []string, commodityHints []string, productFamily string, decodedDestination map[string]any) []map[string]any {
	if len(countryNames) == 0 {
		return nil
	}
	destLat := numberFromAny(decodedDestination["lat"])
	destLng := numberFromAny(decodedDestination["lng"])
	hasDestinationPoint := destLat != 0 || destLng != 0
	rows, err := pool.Query(ctx, `
		SELECT
			a.id::text,
			COALESCE(a.name, ''),
			COALESCE(a.asset_type, ''),
			COALESCE(a.country_code, ''),
			COALESCE(a.commodities_supported, ARRAY[]::text[]),
			COALESCE(op.id::text, ''),
			COALESCE(op.name, ''),
			COALESCE(owner.id::text, ''),
			COALESCE(owner.name, ''),
			a.latitude,
			a.longitude,
			COALESCE(a.confidence_score, 0)::double precision
		FROM assets a
		LEFT JOIN companies op ON op.id = a.operator_company_id
		LEFT JOIN companies owner ON owner.id = a.owner_company_id
		WHERE upper(a.country_code) = ANY($1::text[])
		  AND COALESCE(a.asset_type, '') IN ('lng_terminal', 'terminal', 'refinery', 'processing_plant', 'tank_farm')
		  AND (
			array_length($2::text[], 1) IS NULL
			OR COALESCE(a.commodities_supported, ARRAY[]::text[]) = ARRAY[]::text[]
			OR COALESCE(a.commodities_supported, ARRAY[]::text[]) && $2::text[]
		  )
		ORDER BY
			CASE
				WHEN $3 IN ('lpg', 'lng', 'gas') AND a.asset_type = 'lng_terminal' THEN 0
				WHEN $3 = 'crude_oil' AND a.asset_type IN ('refinery', 'processing_plant') THEN 0
				WHEN $3 IN ('oil_products', 'fuel_oil', 'diesel', 'naphtha') AND a.asset_type IN ('terminal', 'tank_farm', 'refinery') THEN 0
				ELSE 1
			END,
			CASE
				WHEN $4::boolean AND a.latitude IS NOT NULL AND a.longitude IS NOT NULL
				THEN ((a.latitude - $5::double precision) * (a.latitude - $5::double precision)) +
				     ((a.longitude - $6::double precision) * (a.longitude - $6::double precision))
				ELSE 999999
			END,
			COALESCE(a.confidence_score, 0) DESC,
			a.name
		LIMIT 5
	`, countryNames, commodityHints, strings.ToLower(strings.TrimSpace(productFamily)), hasDestinationPoint, destLat, destLng)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var assetID, name, assetType, country, operatorID, operatorName, ownerID, ownerName string
		var commodities []string
		var lat, lng *float64
		var confidence float64
		if err := rows.Scan(&assetID, &name, &assetType, &country, &commodities, &operatorID, &operatorName, &ownerID, &ownerName, &lat, &lng, &confidence); err != nil {
			continue
		}
		row := map[string]any{
			"asset_id":            assetID,
			"asset_name":          name,
			"asset_type":          assetType,
			"country_name":        country,
			"commodities":         commodities,
			"operator_company_id": operatorID,
			"operator_name":       operatorName,
			"owner_company_id":    ownerID,
			"owner_name":          ownerName,
			"confidence_score":    confidence,
			"evidence_label":      "reported",
		}
		if lat != nil && lng != nil {
			row["coordinates"] = map[string]float64{"latitude": *lat, "longitude": *lng}
		}
		out = append(out, row)
	}
	return out
}

func loadCargoBuyerMarketPressure(ctx context.Context, pool *pgxpool.Pool, countryCode string, productCodes []string) []map[string]any {
	if countryCode == "" || len(productCodes) == 0 {
		return nil
	}
	rows, err := pool.Query(ctx, `
		SELECT country_code, product_code, month::text,
		       COALESCE(buyer_pressure_score, 0)::double precision,
		       COALESCE(import_pressure_score, 0)::double precision,
		       COALESCE(stock_pressure_score, 0)::double precision,
		       COALESCE(components, '{}'::jsonb)::text,
		       evidence_label,
		       COALESCE(confidence_score, 0)::double precision
		FROM market_pressure_scores
		WHERE country_code = $1
		  AND product_code = ANY($2::text[])
		ORDER BY month DESC, buyer_pressure_score DESC
		LIMIT 4
	`, countryCode, productCodes)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var country, product, month, components, evidenceLabel string
		var buyer, imports, stock, confidence float64
		if err := rows.Scan(&country, &product, &month, &buyer, &imports, &stock, &components, &evidenceLabel, &confidence); err != nil {
			continue
		}
		out = append(out, map[string]any{
			"country_code":          country,
			"product_code":          product,
			"month":                 month,
			"buyer_pressure_score":  buyer,
			"import_pressure_score": imports,
			"stock_pressure_score":  stock,
			"components":            jsonBlock(components, "{}"),
			"evidence_label":        evidenceLabel,
			"confidence_score":      confidence,
		})
	}
	return out
}

func loadCargoReportedImporters(ctx context.Context, pool *pgxpool.Pool, countryCode string, productCodes []string) []map[string]any {
	if countryCode == "" || len(productCodes) == 0 {
		return nil
	}
	rows, err := pool.Query(ctx, `
		SELECT
			COALESCE(participant_company_id::text, ''),
			COALESCE(participant_name, ''),
			COALESCE(product_code, ''),
			COALESCE(MAX(NULLIF(product_name, '')), ''),
			COALESCE(SUM(quantity), 0)::double precision,
			COALESCE(MAX(quantity_unit), ''),
			COALESCE(MAX(month)::text, ''),
			COUNT(DISTINCT NULLIF(port_code, ''))::int,
			ARRAY_REMOVE(ARRAY_AGG(DISTINCT NULLIF(port_name, '') ORDER BY NULLIF(port_name, '')), NULL)
		FROM trade_flow_facts
		WHERE source_key = 'eia_company_imports'
		  AND flow_code = 'IMPORT'
		  AND reporter_country_code = $1
		  AND product_code = ANY($2::text[])
		  AND participant_name IS NOT NULL
		GROUP BY participant_company_id, participant_name, product_code
		ORDER BY MAX(month) DESC NULLS LAST, SUM(quantity) DESC NULLS LAST
		LIMIT 4
	`, countryCode, productCodes)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var companyID, name, product, productName, unit, latestMonth string
		var quantity float64
		var portCount int
		var ports []string
		if err := rows.Scan(&companyID, &name, &product, &productName, &quantity, &unit, &latestMonth, &portCount, &ports); err != nil {
			continue
		}
		out = append(out, map[string]any{
			"company_id":       companyID,
			"name":             name,
			"product_code":     product,
			"product_name":     productName,
			"quantity":         quantity,
			"unit":             unit,
			"latest_month":     latestMonth,
			"port_count":       portCount,
			"ports":            ports,
			"evidence_label":   "reported",
			"source":           "eia_company_imports",
			"confidence_score": 88,
		})
	}
	return out
}

func cargoMarketProductCodes(productFamily string) []string {
	switch strings.ToLower(strings.TrimSpace(productFamily)) {
	case "lpg":
		return []string{"LPG", "TOTPRODS"}
	case "crude_oil", "crude":
		return []string{"CRUDEOIL", "TOTCRUDE", "OTHERCRUDE"}
	case "diesel", "gasoil", "gasdies":
		return []string{"GASDIES", "TOTPRODS"}
	case "fuel_oil", "resfuel":
		return []string{"RESFUEL", "TOTPRODS"}
	case "naphtha":
		return []string{"NAPHTHA", "TOTPRODS"}
	case "gasoline":
		return []string{"GASOLINE", "TOTPRODS"}
	case "kerosene", "jet":
		return []string{"KEROSENE", "JETKERO", "TOTPRODS"}
	default:
		return []string{"TOTPRODS", "GASDIES", "RESFUEL", "GASOLINE", "NAPHTHA", "LPG"}
	}
}

func cargoAssetCommodityHints(productFamily string) []string {
	switch strings.ToLower(strings.TrimSpace(productFamily)) {
	case "lpg":
		return []string{"LPG", "NGL", "Gas", "LNG", "Oil"}
	case "lng", "gas":
		return []string{"LNG", "Gas"}
	case "crude_oil", "crude":
		return []string{"Oil", "Crude oil", "Crude Oil"}
	default:
		return []string{"Oil", "Petroleum", "Crude oil", "Crude Oil", "LPG", "NGL"}
	}
}

func cargoAssetCountryNames(countryCode, countryName string) []string {
	seen := map[string]bool{}
	var out []string
	add := func(value string) {
		value = strings.ToUpper(strings.TrimSpace(value))
		if value == "" || seen[value] {
			return
		}
		seen[value] = true
		out = append(out, value)
	}
	add(countryName)
	add(cargoCountryName(countryCode))
	switch strings.ToUpper(countryCode) {
	case "US":
		add("UNITED STATES")
		add("UNITED STATES OF AMERICA")
	case "GB":
		add("UNITED KINGDOM")
	case "KR":
		add("SOUTH KOREA")
	}
	return out
}

func cargoCountryName(countryCode string) string {
	if countryCode == "" {
		return ""
	}
	return aisCountryNames[strings.ToUpper(countryCode)]
}

func recordArrayFromAny(value any) []map[string]any {
	switch rows := value.(type) {
	case []map[string]any:
		return rows
	case []any:
		out := make([]map[string]any, 0, len(rows))
		for _, row := range rows {
			if m, ok := row.(map[string]any); ok {
				out = append(out, m)
			}
		}
		return out
	default:
		return nil
	}
}

func numberFromAny(value any) float64 {
	switch n := value.(type) {
	case float64:
		return n
	case float32:
		return float64(n)
	case int:
		return float64(n)
	case int64:
		return float64(n)
	case json.Number:
		v, _ := n.Float64()
		return v
	default:
		return 0
	}
}

func cargoContactability(bundles []map[string]any) map[string]any {
	out := map[string]any{
		"score":           0,
		"direct_channels": 0,
		"source_links":    0,
		"best_label":      "no_contact_source",
	}
	direct := 0
	sourceLinks := 0
	for _, bundle := range bundles {
		if stringFromAny(bundle["email"]) != "" || stringFromAny(bundle["phone"]) != "" {
			direct++
		}
		if stringFromAny(bundle["website"]) != "" ||
			stringFromAny(bundle["source_url"]) != "" ||
			stringFromAny(bundle["register_source_url"]) != "" ||
			stringFromAny(bundle["source_ref"]) != "" {
			sourceLinks++
		}
		if rows, ok := bundle["contacts"].([]map[string]any); ok {
			for _, row := range rows {
				if stringFromAny(row["email"]) != "" || stringFromAny(row["phone"]) != "" {
					direct++
				}
				if stringFromAny(row["source_url"]) != "" || stringFromAny(row["source_ref"]) != "" || stringFromAny(row["evidence"]) != "" {
					sourceLinks++
				}
			}
		}
	}
	score := 0
	label := "no_contact_source"
	switch {
	case direct > 0:
		score = 90
		label = "direct_channel"
	case sourceLinks > 0:
		score = 55
		label = "source_link_only"
	}
	out["score"] = score
	out["direct_channels"] = direct
	out["source_links"] = sourceLinks
	out["best_label"] = label
	return out
}

func dedupeCargoContactBundles(in []map[string]any) []map[string]any {
	seen := map[string]bool{}
	var out []map[string]any
	for _, bundle := range in {
		key := strings.ToLower(strings.Join([]string{
			fmt.Sprint(bundle["role"]),
			fmt.Sprint(bundle["company_id"]),
			fmt.Sprint(bundle["name"]),
		}, "|"))
		if key == "||" || seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, bundle)
	}
	return out
}
