package compliance

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

const openSanctionsURL = "https://api.opensanctions.org/search/default"

type ScreeningResult struct {
	Status     string           `json:"status"`
	Matches    []map[string]any `json:"matches"`
	Message    string           `json:"message,omitempty"`
	StatusCode int              `json:"status_code,omitempty"`
}

type Screener struct {
	client *http.Client
	apiKey string
}

func NewScreener(apiKey string) *Screener {
	apiKey = strings.TrimSpace(apiKey)
	if apiKey == "" {
		apiKey = strings.TrimSpace(os.Getenv("OPENSANCTIONS_API_KEY"))
	}
	return &Screener{
		client: &http.Client{Timeout: 10 * time.Second},
		apiKey: apiKey,
	}
}

func (s *Screener) ScreenCompany(ctx context.Context, name string, limit int) ScreeningResult {
	query := strings.TrimSpace(name)
	if query == "" {
		return ScreeningResult{Status: "unknown", Matches: []map[string]any{}, Message: "empty name"}
	}
	if limit <= 0 {
		limit = 5
	}
	u, _ := url.Parse(openSanctionsURL)
	q := u.Query()
	q.Set("q", query)
	q.Set("limit", fmt.Sprintf("%d", limit))
	u.RawQuery = q.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return ScreeningResult{Status: "unknown", Message: err.Error()}
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "MadSan-Intelligence/1.0")
	if s.apiKey != "" {
		req.Header.Set("Authorization", "ApiKey "+s.apiKey)
	}

	resp, err := s.client.Do(req)
	if err != nil {
		return ScreeningResult{Status: "unknown", Message: "network error"}
	}
	defer resp.Body.Close()

	if resp.StatusCode == 429 || resp.StatusCode >= 500 {
		return ScreeningResult{Status: "unknown", StatusCode: resp.StatusCode, Message: "rate limited or upstream error"}
	}
	if resp.StatusCode != http.StatusOK {
		return ScreeningResult{Status: "unknown", StatusCode: resp.StatusCode, Message: fmt.Sprintf("HTTP %d", resp.StatusCode)}
	}

	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	var payload struct {
		Results []map[string]any `json:"results"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return ScreeningResult{Status: "unknown", Message: "invalid JSON"}
	}

	matches := trimMatches(payload.Results, limit)
	return ScreeningResult{Status: classifyStatus(matches), Matches: matches}
}

func trimMatches(items []map[string]any, limit int) []map[string]any {
	out := make([]map[string]any, 0, limit)
	for _, item := range items {
		if len(out) >= limit {
			break
		}
		props, _ := item["properties"].(map[string]any)
		caption, _ := item["caption"].(string)
		score := toFloat(item["score"])
		out = append(out, map[string]any{
			"id":       item["id"],
			"caption":  caption,
			"schema":   item["schema"],
			"score":    score,
			"datasets": item["datasets"],
			"topics":   firstOr(item["topics"], propsKey(props, "topics")),
		})
	}
	return out
}

func propsKey(props map[string]any, key string) any {
	if props == nil {
		return nil
	}
	return props[key]
}

func firstOr(a any, b any) any {
	if a != nil {
		return a
	}
	return b
}

func classifyStatus(matches []map[string]any) string {
	if len(matches) == 0 {
		return "clear"
	}
	score := toFloat(matches[0]["score"])
	switch {
	case score >= 0.8:
		return "flagged"
	case score >= 0.5:
		return "review"
	default:
		return "clear"
	}
}

func toFloat(v any) float64 {
	switch t := v.(type) {
	case float64:
		return t
	case json.Number:
		f, _ := t.Float64()
		return f
	default:
		return 0
	}
}
