package api

import (
	"encoding/json"
)

func mergeVesselTechnicalSummary(summary map[string]any, builder string, buildYear *int, rawPayload []byte) {
	if summary == nil {
		return
	}
	if builder != "" {
		summary["builder"] = builder
	}
	if buildYear != nil && *buildYear > 0 {
		summary["build_year"] = *buildYear
	}
	if len(rawPayload) == 0 {
		return
	}
	var raw map[string]any
	if json.Unmarshal(rawPayload, &raw) != nil {
		return
	}
	specs, _ := raw["vessel_specs"].(map[string]any)
	if specs == nil {
		if detail, ok := raw["vessel_detail"].(map[string]any); ok {
			specs = detail
		}
	}
	mergeVesselSpecsIntoSummary(summary, specs)
	if v, ok := raw["estimated_value_usd"]; ok && v != nil && v != "" && v != float64(0) {
		summary["estimated_value_usd"] = v
	}
	if v, ok := raw["vessel_status"]; ok {
		if s, ok := v.(string); ok && s != "" {
			summary["vessel_status"] = s
		}
	}
	if hist, ok := raw["name_history"].([]any); ok && len(hist) > 0 {
		if _, has := summary["name_history"]; !has {
			summary["name_history"] = hist
		}
	}
}

func mergeVesselSpecsIntoSummary(summary, specs map[string]any) {
	if summary == nil || len(specs) == 0 {
		return
	}
	summary["vessel_specs"] = specs
	for _, key := range []string{
		"build_year", "vessel_class", "flag", "gross_tonnage", "deadweight_tons", "net_tonnage",
		"estimated_value_usd", "length_m", "beam_m", "depth_m", "draft_m",
		"propulsion", "engine_power_kw", "engine_power_hp",
		"capacity_grain", "capacity_bale", "capacity_teu",
		"status", "vessel_status", "builder", "yard_id", "yard_name", "yard_number", "disponent",
	} {
		if v, ok := specs[key]; ok && !isEmptySpecValue(v) {
			if key == "status" {
				if _, set := summary["vessel_status"]; !set {
					summary["vessel_status"] = v
				}
				continue
			}
			if _, set := summary[key]; !set {
				summary[key] = v
			}
		}
	}
}

func isEmptySpecValue(v any) bool {
	switch n := v.(type) {
	case nil:
		return true
	case string:
		return n == ""
	case float64:
		return n == 0
	case int:
		return n == 0
	case json.Number:
		f, _ := n.Float64()
		return f == 0
	default:
		return false
	}
}
