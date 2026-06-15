package api

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

type commercialRoleContactInput struct {
	Role         string
	CompanyID    string
	FallbackName string
	Profile      map[string]any
}

type commercialChainBundleInput struct {
	EntityType        string
	EntityID          string
	Name              string
	CountryCode       string
	AssetType         string
	VesselClass       string
	IMO               string
	MMSI              string
	Owner             map[string]any
	Operator          map[string]any
	Contacts          []map[string]any
	OwnershipChain    []map[string]any
	OwnershipIntel    map[string]any
	InvestorExposures []map[string]any
	NameHistory       []map[string]any
	Infrastructure    []map[string]any
	CoverageContext   map[string]any
	CoverageGaps      []string
	LinkedIntel       map[string]any
}

func (s *Server) loadCommercialRoleContactBundles(ctx context.Context, in ...commercialRoleContactInput) []map[string]any {
	if s == nil || s.pool == nil {
		return nil
	}
	var out []map[string]any
	seen := map[string]bool{}
	for _, item := range in {
		companyID := strings.TrimSpace(item.CompanyID)
		name := strings.TrimSpace(item.FallbackName)
		if companyID == "" {
			continue
		}
		key := strings.ToLower(strings.Join([]string{item.Role, companyID, name}, "|"))
		if seen[key] {
			continue
		}
		seen[key] = true
		if bundle := loadCompanyContactBundle(ctx, s.pool, companyID, item.Role, name, item.Profile); bundle != nil {
			out = append(out, bundle)
		}
	}
	return dedupeCargoContactBundles(out)
}

func buildCommercialChainBundle(in commercialChainBundleInput) map[string]any {
	linked := in.LinkedIntel
	paths := commercialRecordArray(linked["investor_paths"])
	opportunities := commercialRecordArray(linked["opportunities"])
	cargo := commercialRecordArray(linked["cargo_movements"])
	importers := commercialRecordArray(linked["importers"])
	marketPressure := commercialRecordArray(linked["market_pressure"])
	benchmarks := commercialRecordArray(linked["benchmarks"])

	contacts := append([]map[string]any{}, in.Contacts...)
	ownership := append([]map[string]any{}, in.OwnershipChain...)
	previousOwnerCandidates := commercialRecordArray(in.OwnershipIntel["history_candidates"])
	registryChecks := commercialRecordArray(in.OwnershipIntel["registry_checks"])
	searchPivots := commercialStringArray(in.OwnershipIntel["search_pivots"])
	limitations := commercialStringArray(linked["limitations"])
	limitations = append(limitations, in.CoverageGaps...)

	steps := make([]map[string]any, 0, 16)
	seenSteps := map[string]bool{}
	addStep := func(step map[string]any) {
		label := stringFromAny(step["label"])
		name := stringFromAny(step["name"])
		key := strings.ToLower(strings.Join([]string{
			stringFromAny(step["step"]),
			stringFromAny(step["role"]),
			label,
			name,
			stringFromAny(step["company_id"]),
			stringFromAny(step["asset_id"]),
		}, "|"))
		if key == "|||||" || seenSteps[key] {
			return
		}
		seenSteps[key] = true
		if step["evidence_label"] == nil {
			step["evidence_label"] = "reported"
		}
		steps = append(steps, step)
	}

	addStep(map[string]any{
		"step":           "entity",
		"role":           firstNonEmpty(in.EntityType, "entity"),
		"label":          firstNonEmpty(in.Name, in.EntityID),
		"entity_id":      in.EntityID,
		"country_code":   in.CountryCode,
		"asset_type":     in.AssetType,
		"vessel_class":   in.VesselClass,
		"imo":            in.IMO,
		"mmsi":           in.MMSI,
		"evidence_label": "observed",
	})
	addPartyStep := func(role string, party map[string]any) {
		if len(party) == 0 {
			return
		}
		label := firstNonEmpty(stringFromAny(party["name"]), stringFromAny(party["company_id"]))
		if label == "" {
			return
		}
		addStep(map[string]any{
			"step":           role,
			"role":           role,
			"label":          label,
			"company_id":     stringFromAny(party["company_id"]),
			"country_code":   stringFromAny(party["country_code"]),
			"evidence_label": firstNonEmpty(stringFromAny(party["evidence_label"]), "reported"),
		})
	}
	addPartyStep("owner", in.Owner)
	addPartyStep("operator", in.Operator)

	for _, row := range ownership {
		for _, part := range []struct {
			Key  string
			Step string
		}{
			{"operator", "gem_operator"},
			{"owner", "gem_owner"},
			{"parent", "gem_parent"},
		} {
			entity := commercialRecord(row[part.Key])
			label := firstNonEmpty(stringFromAny(entity["name"]), stringFromAny(entity["entity_id"]))
			if label == "" {
				continue
			}
			addStep(map[string]any{
				"step":           part.Step,
				"role":           part.Step,
				"label":          label,
				"entity_id":      stringFromAny(entity["entity_id"]),
				"share_pct":      row["share_pct"],
				"asset_name":     stringFromAny(row["asset_name"]),
				"evidence_label": firstNonEmpty(stringFromAny(row["evidence_label"]), "reported"),
			})
		}
	}

	for _, exposure := range in.InvestorExposures {
		addStep(map[string]any{
			"step":           "investor_exposure",
			"role":           "investor",
			"label":          firstNonEmpty(stringFromAny(exposure["investor_name"]), stringFromAny(exposure["investor_entity_id"])),
			"entity_id":      stringFromAny(exposure["investor_entity_id"]),
			"exposure_type":  stringFromAny(exposure["exposure_type"]),
			"exposure_value": exposure["exposure_value"],
			"evidence_label": firstNonEmpty(stringFromAny(exposure["evidence_label"]), "reported"),
		})
		if len(steps) > 18 {
			break
		}
	}
	for idx, asset := range in.Infrastructure {
		if idx >= 8 {
			break
		}
		addStep(map[string]any{
			"step":           "nearby_infrastructure",
			"role":           firstNonEmpty(stringFromAny(asset["asset_type"]), "infrastructure"),
			"label":          firstNonEmpty(stringFromAny(asset["name"]), stringFromAny(asset["asset_id"])),
			"asset_id":       stringFromAny(asset["asset_id"]),
			"distance_km":    asset["distance_km"],
			"country_code":   stringFromAny(asset["country_code"]),
			"evidence_label": firstNonEmpty(stringFromAny(asset["evidence_label"]), "reported"),
		})
	}

	controlChains := make([]map[string]any, 0, len(paths))
	for _, path := range paths {
		control := commercialRecordArray(path["control_chain"])
		if len(control) == 0 {
			continue
		}
		controlChains = append(controlChains, map[string]any{
			"path_id":           stringFromAny(path["id"]),
			"commercial_thesis": stringFromAny(path["commercial_thesis"]),
			"steps":             control,
			"score":             path["score"],
			"evidence_label":    firstNonEmpty(stringFromAny(path["evidence_label"]), stringFromAny(path["evidence_grade"]), "inferred"),
		})
		if len(controlChains) == 1 {
			for _, node := range control {
				addStep(map[string]any{
					"step":           firstNonEmpty(stringFromAny(node["step"]), "control_chain"),
					"role":           firstNonEmpty(stringFromAny(node["role"]), "control_chain"),
					"label":          firstNonEmpty(stringFromAny(node["label"]), stringFromAny(node["asset"])),
					"company_id":     stringFromAny(node["company_id"]),
					"asset_id":       stringFromAny(node["asset_id"]),
					"source_path_id": stringFromAny(path["id"]),
					"evidence_label": firstNonEmpty(stringFromAny(node["evidence_label"]), "inferred"),
				})
			}
		}
	}

	for _, item := range cargo {
		chain := commercialRecord(item["commercial_chain"])
		contacts = append(contacts, commercialRecordArray(chain["contacts"])...)
		contacts = append(contacts, commercialRecordArray(chain["commercial_contacts"])...)
		previousOwnerCandidates = append(previousOwnerCandidates, commercialRecordArray(chain["previous_owner_candidates"])...)
		registryChecks = append(registryChecks, commercialRecordArray(chain["registry_checks"])...)
		searchPivots = append(searchPivots, commercialStringArray(chain["search_pivots"])...)
		for _, step := range commercialRecordArray(chain["chain_steps"]) {
			addStep(map[string]any{
				"step":            firstNonEmpty(stringFromAny(step["step"]), "cargo_chain"),
				"role":            firstNonEmpty(stringFromAny(step["role"]), "cargo_chain"),
				"label":           firstNonEmpty(stringFromAny(step["label"]), stringFromAny(step["name"])),
				"asset_id":        stringFromAny(step["asset_id"]),
				"company_id":      stringFromAny(step["company_id"]),
				"source_cargo_id": stringFromAny(item["id"]),
				"evidence_label":  firstNonEmpty(stringFromAny(step["evidence_label"]), stringFromAny(item["evidence_label"]), "estimated"),
			})
		}
	}
	contacts = dedupeCargoContactBundles(contacts)

	for _, importer := range importers {
		addStep(map[string]any{
			"step":           "reported_importer",
			"role":           "buyer",
			"label":          firstNonEmpty(stringFromAny(importer["name"]), stringFromAny(importer["company_id"])),
			"company_id":     stringFromAny(importer["company_id"]),
			"product_code":   stringFromAny(importer["product_code"]),
			"latest_month":   stringFromAny(importer["latest_month"]),
			"evidence_label": firstNonEmpty(stringFromAny(importer["evidence_label"]), "reported"),
		})
	}
	if len(opportunities) > 0 {
		top := opportunities[0]
		addStep(map[string]any{
			"step":           "opportunity_lane",
			"role":           "commercial_lane",
			"label":          fmt.Sprintf("%s %s -> %s", firstNonEmpty(stringFromAny(top["commodity"]), "oil/gas"), stringFromAny(top["origin_country"]), stringFromAny(top["destination_country"])),
			"opportunity_id": stringFromAny(top["id"]),
			"lane_id":        stringFromAny(top["lane_id"]),
			"score":          top["score"],
			"evidence_label": firstNonEmpty(stringFromAny(top["evidence_grade"]), "inferred"),
		})
	}
	if len(marketPressure) > 0 {
		top := marketPressure[0]
		addStep(map[string]any{
			"step":                    "market_pressure",
			"role":                    "buyer_or_supplier_pressure",
			"label":                   fmt.Sprintf("%s %s pressure", stringFromAny(top["country_code"]), stringFromAny(top["product_code"])),
			"buyer_pressure_score":    top["buyer_pressure_score"],
			"supplier_pressure_score": top["supplier_availability_score"],
			"month":                   stringFromAny(top["month"]),
			"evidence_label":          firstNonEmpty(stringFromAny(top["evidence_label"]), "estimated"),
		})
	}
	if len(benchmarks) > 0 {
		top := benchmarks[0]
		addStep(map[string]any{
			"step":           "price_context",
			"role":           "open_benchmark",
			"label":          firstNonEmpty(stringFromAny(top["benchmark"]), stringFromAny(top["name"]), "open benchmark"),
			"price":          top["price"],
			"currency":       firstNonEmpty(stringFromAny(top["currency"]), "USD"),
			"unit":           stringFromAny(top["unit"]),
			"evidence_label": firstNonEmpty(stringFromAny(top["evidence_label"]), "source-backed"),
		})
	}
	for _, hist := range in.NameHistory {
		addStep(map[string]any{
			"step":           "name_history",
			"role":           "previous_name",
			"label":          firstNonEmpty(stringFromAny(hist["name"]), stringFromAny(hist["previous_name"])),
			"evidence_label": firstNonEmpty(stringFromAny(hist["evidence_label"]), "observed"),
		})
	}

	out := map[string]any{
		"method":                    "commercial_profile_chain_bundle_v1",
		"entity":                    map[string]any{"type": in.EntityType, "id": in.EntityID, "name": in.Name, "country_code": in.CountryCode},
		"chain_steps":               steps,
		"contacts":                  contacts,
		"contactability":            cargoContactability(contacts),
		"ownership":                 ownership,
		"previous_owner_candidates": dedupeCommercialRecords(previousOwnerCandidates),
		"registry_checks":           dedupeCommercialRecords(registryChecks),
		"search_pivots":             dedupeCommercialStrings(searchPivots),
		"investor_paths":            paths,
		"control_chains":            controlChains,
		"investor_exposures":        in.InvestorExposures,
		"infrastructure_context":    in.Infrastructure,
		"coverage_context":          in.CoverageContext,
		"cargo_movements":           cargo,
		"buyers":                    importers,
		"opportunities":             opportunities,
		"market_pressure":           marketPressure,
		"benchmarks":                benchmarks,
		"limitations":               dedupeCommercialStrings(append(limitations, "Observed identities and inferred opportunities are separated inside this bundle.")),
		"evidence_label":            "mixed",
	}
	if in.OwnershipIntel != nil {
		out["ownership_intel"] = in.OwnershipIntel
	}
	return out
}

func commercialRecord(value any) map[string]any {
	switch v := value.(type) {
	case map[string]any:
		return v
	case map[string]string:
		out := make(map[string]any, len(v))
		for key, val := range v {
			out[key] = val
		}
		return out
	case json.RawMessage:
		var out map[string]any
		if json.Unmarshal(v, &out) == nil {
			return out
		}
	case string:
		var out map[string]any
		if strings.HasPrefix(strings.TrimSpace(v), "{") && json.Unmarshal([]byte(v), &out) == nil {
			return out
		}
	}
	return nil
}

func commercialRecordArray(value any) []map[string]any {
	switch rows := value.(type) {
	case []map[string]any:
		return rows
	case []json.RawMessage:
		out := make([]map[string]any, 0, len(rows))
		for _, row := range rows {
			if m := commercialRecord(row); m != nil {
				out = append(out, m)
			}
		}
		return out
	case []any:
		out := make([]map[string]any, 0, len(rows))
		for _, row := range rows {
			if m := commercialRecord(row); m != nil {
				out = append(out, m)
			}
		}
		return out
	default:
		if m := commercialRecord(value); m != nil {
			return []map[string]any{m}
		}
	}
	return nil
}

func commercialStringArray(value any) []string {
	switch rows := value.(type) {
	case []string:
		return rows
	case []any:
		out := make([]string, 0, len(rows))
		for _, row := range rows {
			if text := stringFromAny(row); text != "" {
				out = append(out, text)
			}
		}
		return out
	default:
		if text := stringFromAny(value); text != "" {
			return []string{text}
		}
	}
	return nil
}

func dedupeCommercialRecords(in []map[string]any) []map[string]any {
	seen := map[string]bool{}
	var out []map[string]any
	for _, row := range in {
		key := strings.ToLower(firstNonEmpty(
			stringFromAny(row["id"]),
			stringFromAny(row["query"]),
			stringFromAny(row["name"]),
			stringFromAny(row["label"]),
			fmt.Sprint(row),
		))
		if key == "" || seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, row)
	}
	return out
}

func dedupeCommercialStrings(in []string) []string {
	seen := map[string]bool{}
	var out []string
	for _, value := range in {
		value = strings.TrimSpace(value)
		key := strings.ToLower(value)
		if value == "" || seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, value)
	}
	return out
}
