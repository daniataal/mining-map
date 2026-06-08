package osmtiles

import (
	"regexp"
	"strings"
)

// ClassifyPipelineSubstance infers oil | gas | water | other | unknown from OSM tags and names.
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
	if usage == "oil" || usage == "gas" {
		return usage
	}
	content := normTag(tags["content"])
	if content == "water" || content == "drinking_water" {
		return "water"
	}

	haystack := nameHaystack(tags)
	if haystack != "" {
		waterHit := waterKeywords.MatchString(haystack)
		oilHit := oilKeywords.MatchString(haystack)
		gasHit := gasKeywords.MatchString(haystack)
		if waterHit && !oilHit && !gasHit {
			return "water"
		}
		if gasHit && !waterHit && !oilHit {
			return "gas"
		}
		if oilHit && !waterHit && !gasHit {
			return "oil"
		}
		if waterHit {
			return "water"
		}
	}

	if tags["man_made"] == "pipeline" {
		return "unknown"
	}
	return "unknown"
}

func nameHaystack(tags map[string]string) string {
	keys := []string{"name", "name:en", "name:ar", "name:he", "description", "ref"}
	var parts []string
	for _, key := range keys {
		if v := strings.TrimSpace(tags[key]); v != "" {
			parts = append(parts, v)
		}
	}
	return strings.Join(parts, " ")
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

var oilKeywords = regexp.MustCompile(`(?i)\b(oil|crude|petroleum|pipeline\s+oil|نفط|נפט)\b`)
var gasKeywords = regexp.MustCompile(`(?i)\b(natural\s+gas|lng|lpg|methane|gas\s+pipeline|גז)\b`)
var waterKeywords = regexp.MustCompile(`(?i)(مياه|מים|water|wasser|eau|aqueduct|irrigation|sewer|sewage|wastewater|drinking\s+water|water\s+main|watermain|water\s+supply|water\s+project)`)
