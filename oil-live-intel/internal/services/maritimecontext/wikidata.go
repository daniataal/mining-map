package maritimecontext

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strings"
)

const wikidataSPARQLURL = "https://query.wikidata.org/sparql"

var digitsOnly = regexp.MustCompile(`[^0-9]`)

func FetchWikidataVesselIdentity(imo, mmsi string) map[string]any {
	imo = strings.TrimSpace(imo)
	mmsi = strings.TrimSpace(mmsi)
	prop := "P587"
	matchedBy := "mmsi"
	conf := 0.52
	var raw string
	if imo != "" {
		raw = digitsOnly.ReplaceAllString(imo, "")
		prop = "P458"
		matchedBy = "imo"
		conf = 0.66
	} else if mmsi != "" {
		raw = digitsOnly.ReplaceAllString(mmsi, "")
	} else {
		return nil
	}
	if raw == "" {
		return nil
	}
	sparql := fmt.Sprintf(`
SELECT ?item ?itemLabel ?ownerLabel ?operatorLabel ?flagLabel ?registryPortLabel WHERE {
  ?item wdt:%s "%s" .
  OPTIONAL { ?item wdt:P127 ?owner . }
  OPTIONAL { ?item wdt:P137 ?operator . }
  OPTIONAL { ?item wdt:P17 ?flag . }
  OPTIONAL { ?item wdt:P532 ?registryPort . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
LIMIT 1`, prop, raw)
	client := &http.Client{Timeout: defaultHTTPTimeout}
	req, err := http.NewRequest(http.MethodGet, wikidataSPARQLURL+"?"+url.Values{
		"query":  {sparql},
		"format": {"json"},
	}.Encode(), nil)
	if err != nil {
		return nil
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "meridian-oil-live-intel/1.0")
	resp, err := client.Do(req)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return nil
	}
	var payload map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil
	}
	results, _ := payload["results"].(map[string]any)
	bindings, _ := results["bindings"].([]any)
	if len(bindings) == 0 {
		return nil
	}
	row, _ := bindings[0].(map[string]any)
	label := func(key string) any {
		if m, ok := row[key].(map[string]any); ok {
			return m["value"]
		}
		return nil
	}
	return map[string]any{
		"owner":         label("ownerLabel"),
		"operator":      label("operatorLabel"),
		"flag":          label("flagLabel"),
		"registry_port": label("registryPortLabel"),
		"matched_by":    matchedBy,
		"confidence":    conf,
		"source_label":  "Wikidata",
		"source_url":    "https://query.wikidata.org/",
	}
}
