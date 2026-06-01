package maritimecontext

import (
	"fmt"
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

// identityFieldText reads a Wikidata identity field, skipping nil and "<nil>" string artifacts.
func identityFieldText(identity map[string]any, key string) string {
	if identity == nil {
		return ""
	}
	v, ok := identity[key]
	if !ok || v == nil {
		return ""
	}
	s := cleanText(fmt.Sprint(v))
	if s == "" || strings.EqualFold(s, "<nil>") {
		return ""
	}
	return s
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

// ensureMapSlice guarantees JSON arrays serialize as [] instead of null.
func ensureMapSlice(v []map[string]any) []map[string]any {
	if v == nil {
		return []map[string]any{}
	}
	return v
}

// ensureStringSlice guarantees JSON arrays serialize as [] instead of null.
func ensureStringSlice(v []string) []string {
	if v == nil {
		return []string{}
	}
	return v
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
