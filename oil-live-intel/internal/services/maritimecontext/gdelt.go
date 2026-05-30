package maritimecontext

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
)

const gdeltDocURL = "https://api.gdeltproject.org/api/v2/doc/doc"

func FetchGDELTEvidence(company, country, commodity, vesselName string, limit int) []map[string]any {
	if limit <= 0 {
		limit = 8
	}
	query := buildGDELTQuery(company, country, commodity, vesselName)
	if query == "" {
		return nil
	}
	params := url.Values{}
	params.Set("query", query)
	params.Set("mode", "artlist")
	params.Set("format", "json")
	params.Set("maxrecords", fmt.Sprint(limit))
	params.Set("sort", "DateDesc")
	client := &http.Client{Timeout: defaultHTTPTimeout}
	req, err := http.NewRequest(http.MethodGet, gdeltDocURL+"?"+params.Encode(), nil)
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
	articles, _ := payload["articles"].([]any)
	out := make([]map[string]any, 0, len(articles))
	for i, raw := range articles {
		article, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		title := cleanText(fmt.Sprint(article["title"]))
		if title == "" {
			title = "Untitled article"
		}
		conf := 0.5
		if vesselName != "" || company != "" {
			conf = 0.62
		}
		matched := make([]string, 0, 4)
		for _, term := range []string{company, country, commodity, vesselName} {
			if cleanText(term) != "" {
				matched = append(matched, cleanText(term))
			}
		}
		out = append(out, map[string]any{
			"id":            fmt.Sprintf("gdelt-%d-%x", i, hashStr(cleanText(fmt.Sprint(article["url"])))),
			"title":         title,
			"url":           cleanText(fmt.Sprint(article["url"])),
			"source_label":  "GDELT DOC 2.0",
			"source_domain": nullableStr(cleanText(fmt.Sprint(article["domain"]))),
			"seen_at":       nullableStr(cleanText(fmt.Sprint(article["seendate"]))),
			"evidence_type": classifyEvidenceType(title),
			"confidence":    conf,
			"summary":       title,
			"matched_terms": matched,
		})
	}
	return out
}

func hashStr(s string) uint32 {
	var h uint32
	for i := 0; i < len(s); i++ {
		h = h*31 + uint32(s[i])
	}
	return h & 0xfffffff
}

func nullableStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}
