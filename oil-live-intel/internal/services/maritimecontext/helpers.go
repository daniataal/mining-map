package maritimecontext

import (
	"regexp"
	"strings"
	"time"
)

var nonAlnum = regexp.MustCompile(`[^a-z0-9]+`)

func normalizeToken(s string) string {
	return strings.Trim(nonAlnum.ReplaceAllString(strings.ToLower(strings.TrimSpace(s)), " "), " ")
}

func cleanText(s string) string {
	return strings.TrimSpace(s)
}

func nowISO() string {
	return time.Now().UTC().Format(time.RFC3339)
}

func classifyEvidenceType(title string) string {
	n := normalizeToken(title)
	switch {
	case containsAny(n, "buyer", "seller", "offtake", "supply deal", "purchase"):
		return "counterparty_signal"
	case containsAny(n, "sanction", "seized", "detained", "attack", "spill", "collision", "fire"):
		return "risk_signal"
	case containsAny(n, "tanker", "shipment", "cargo", "terminal", "port", "load", "loading", "discharge", "lng", "lpg"):
		return "shipment_signal"
	default:
		return "maritime_context"
	}
}

func containsAny(hay string, terms ...string) bool {
	for _, t := range terms {
		if strings.Contains(hay, t) {
			return true
		}
	}
	return false
}

func buildGDELTQuery(company, country, commodity, vesselName string) string {
	var anchors []string
	if vesselName != "" {
		anchors = append(anchors, `"`+cleanText(vesselName)+`"`)
	} else if company != "" {
		anchors = append(anchors, `"`+cleanText(company)+`"`)
	} else if country != "" {
		anchors = append(anchors, `"`+cleanText(country)+`"`)
	}
	terms := []string{"(tanker OR vessel OR shipping OR terminal OR port OR cargo OR crude OR oil OR LNG OR LPG)"}
	ct := normalizeToken(commodity)
	if ct != "" {
		if strings.Contains(ct, "gas") || strings.Contains(ct, "lng") || strings.Contains(ct, "lpg") {
			terms = append(terms, "(gas OR LNG OR LPG)")
		} else {
			terms = append(terms, "(oil OR crude OR petroleum OR refinery)")
		}
	}
	if country != "" && vesselName == "" {
		terms = append(terms, `"`+cleanText(country)+`"`)
	}
	if len(anchors) == 0 {
		return ""
	}
	return strings.TrimSpace(strings.Join(append(anchors, terms...), " "))
}
