package osmtiles

import "strings"

// ClassifyPipelineSubstance infers oil | gas | water | other | unknown from OSM tag keys only.
func ClassifyPipelineSubstance(tags map[string]string) string {
	if pre := normTag(tags["pipeline_substance"]); pre != "" {
		switch pre {
		case "oil", "gas", "water", "other", "unknown":
			return pre
		}
	}
	if mapped := substanceTagMap[normTag(tags["substance"])]; mapped != "" {
		return mapped
	}
	if mapped := typeTagMap[normTag(tags["type"])]; mapped != "" {
		return mapped
	}
	usage := normTag(tags["usage"])
	if usage == "water" || usage == "drinking_water" || usage == "irrigation" {
		return "water"
	}
	content := normTag(tags["content"])
	if content == "water" || content == "drinking_water" {
		return "water"
	}
	return "unknown"
}

func normTag(value string) string {
	return strings.ToLower(strings.TrimSpace(strings.ReplaceAll(value, " ", "_")))
}

var substanceTagMap = map[string]string{
	"oil":            "oil",
	"crude":          "oil",
	"crude_oil":      "oil",
	"petroleum":      "oil",
	"gas":            "gas",
	"natural_gas":    "gas",
	"lng":            "gas",
	"lpg":            "gas",
	"methane":        "gas",
	"water":          "water",
	"drinking_water": "water",
	"wastewater":     "water",
	"sewage":         "water",
}

var typeTagMap = map[string]string{
	"oil":   "oil",
	"gas":   "gas",
	"water": "water",
}
