package maritimecontext

import (
	"fmt"
	"net/url"
	"strings"
)

type ContextInput struct {
	Company     string
	Country     string
	CountryISO2 string
	Commodity   string
	Lat         *float64
	Lng         *float64
	VesselName  string
	MMSI        string
	IMO         string
	Destination string
}

// BuildContext assembles open-data maritime screening context for traders.
// API shape matches legacy Python /api/maritime/context for frontend parity.
func BuildContext(in ContextInput) map[string]any {
	identity := FetchWikidataVesselIdentity(in.IMO, in.MMSI)
	relationships := buildMaritimeRelationships(identity, in.VesselName, in.IMO, in.MMSI)
	owner, operator := "", ""
	if identity != nil {
		owner = cleanText(fmt.Sprint(identity["owner"]))
		operator = cleanText(fmt.Sprint(identity["operator"]))
	}
	companyLinks := buildCompanyLinks(in.Company, in.VesselName, owner, operator)
	matchedPort := MatchDestinationToPort(in.Destination, in.CountryISO2)
	nearestPorts := FindNearestPorts(in.CountryISO2, in.Lat, in.Lng, 5)
	evidence := FetchGDELTEvidence(in.Company, in.Country, in.Commodity, in.VesselName, 8)
	counterpartyProxies := buildCounterpartyProxies(in.Commodity, matchedPort, nearestPorts, evidence)

	sourceLabels := []string{"UN/LOCODE", "GDELT DOC 2.0", "OpenCorporates search"}
	if identity != nil {
		sourceLabels = append(sourceLabels, "Wikidata")
	}
	limitations := []string{
		"Open/free data does not provide reliable bill-of-lading buyer/seller coverage at commercial depth.",
		"Buyer/seller context here is a proxy assembled from ports, corporate registries, Wikidata vessel links, and news evidence.",
		"GDELT evidence is news-derived and should be treated as screening context, not documentary proof of title or cargo ownership.",
	}
	if identity == nil {
		limitations = append(limitations, "No open vessel ownership/operator match was found in Wikidata for the provided IMO/MMSI.")
	}
	return map[string]any{
		"source_labels":        sourceLabels,
		"data_as_of":           nowISO(),
		"company_links":        companyLinks,
		"nearest_ports":        nearestPorts,
		"evidence":             evidence,
		"identity":             identity,
		"relationships":        relationships,
		"counterparty_proxies": counterpartyProxies,
		"bol_coverage_note": ("True bill-of-lading buyer/seller data is usually commercial or government-restricted. " +
			"This MVP exposes open proxies and raw evidence instead of pretending to have full B/L coverage."),
		"limitations": limitations,
	}
}

func buildMaritimeRelationships(identity map[string]any, vesselName, imo, mmsi string) []map[string]any {
	if identity == nil {
		return []map[string]any{}
	}
	ref := cleanText(imo)
	if ref == "" {
		ref = cleanText(mmsi)
	}
	if ref == "" {
		ref = cleanText(vesselName)
	}
	if ref == "" {
		ref = "unknown-vessel"
	}
	out := make([]map[string]any, 0, 2)
	for _, relType := range []string{"owner", "operator"} {
		target := cleanText(fmt.Sprint(identity[relType]))
		if target == "" {
			continue
		}
		out = append(out, map[string]any{
			"id":                 fmt.Sprintf("vessel:%s:%s:%s", ref, relType, strings.ToLower(target)),
			"source_entity_kind": "vessel",
			"source_entity_ref":  ref,
			"target_entity_kind": "entity",
			"target_entity_ref":  nil,
			"target_name":        target,
			"relationship_type":  relType,
			"relationship_label": nil,
			"ownership_pct":      nil,
			"effective_date":     nil,
			"source_name":        identity["source_label"],
			"source_url":         identity["source_url"],
			"source_type":        "open_knowledge_graph",
			"confidence_score":   identity["confidence"],
			"raw_payload": map[string]any{
				"matched_by":    identity["matched_by"],
				"flag":          identity["flag"],
				"registry_port": identity["registry_port"],
			},
			"extracted_from": fmt.Sprintf("wikidata.%s", relType),
			"verified_at":    nil,
			"last_seen_at":   nowISO(),
		})
	}
	return out
}

func buildCompanyLinks(company, vesselName, owner, operator string) []map[string]any {
	seen := map[string]bool{}
	var candidates []string
	for _, label := range []string{company, vesselName, owner, operator} {
		c := cleanText(label)
		if c == "" || seen[strings.ToLower(c)] {
			continue
		}
		seen[strings.ToLower(c)] = true
		candidates = append(candidates, c)
	}
	out := make([]map[string]any, 0, 3)
	for i, candidate := range candidates {
		if i >= 3 {
			break
		}
		out = append(out, map[string]any{
			"label":        fmt.Sprintf("OpenCorporates: %s", candidate),
			"url":          fmt.Sprintf("https://opencorporates.com/companies?q=%s", url.QueryEscape(candidate)),
			"source_label": "OpenCorporates",
			"description":  "Open company-registry search",
			"company_name": candidate,
			"confidence":   0.5,
		})
	}
	return out
}

func buildCounterpartyProxies(commodity string, matchedPort map[string]any, nearestPorts []map[string]any, evidence []map[string]any) []map[string]any {
	out := make([]map[string]any, 0, 4)
	commodityLabel := cleanText(commodity)
	if commodityLabel == "" {
		commodityLabel = "oil and gas"
	}
	if matchedPort != nil {
		name := fmt.Sprint(matchedPort["name"])
		cc := fmt.Sprint(matchedPort["country_iso2"])
		out = append(out, map[string]any{
			"id":           "destination-port",
			"label":        fmt.Sprintf("Destination port proxy: %s", name),
			"description":  fmt.Sprintf("Open/free MVP can treat %s (%s) as the likely discharge jurisdiction or routing anchor, but not as a confirmed buyer or seller.", name, cc),
			"proxy_type":   "destination_port_proxy",
			"confidence":   matchedPort["confidence"],
			"source_label": matchedPort["source_label"],
			"url":          matchedPort["source_url"],
		})
	}
	if len(nearestPorts) > 0 {
		first := nearestPorts[0]
		name := fmt.Sprint(first["name"])
		out = append(out, map[string]any{
			"id":           "nearest-port",
			"label":        fmt.Sprintf("Nearest export route proxy: %s", name),
			"description":  fmt.Sprintf("The nearest open port context for %s is %s. This helps route screening, but it is still not bill-of-lading proof.", commodityLabel, name),
			"proxy_type":   "nearest_port_proxy",
			"confidence":   first["confidence"],
			"source_label": first["source_label"],
			"url":          first["source_url"],
		})
	}
	for _, article := range evidence {
		if fmt.Sprint(article["evidence_type"]) != "counterparty_signal" {
			continue
		}
		out = append(out, map[string]any{
			"id":           article["id"],
			"label":        "News-based counterparty signal",
			"description":  article["title"],
			"proxy_type":   "news_counterparty_signal",
			"confidence":   article["confidence"],
			"source_label": article["source_label"],
			"url":          article["url"],
		})
	}
	return out
}
