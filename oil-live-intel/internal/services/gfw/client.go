package gfw

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const (
	defaultBaseURL     = "https://gateway.api.globalfishingwatch.org"
	presenceDataset    = "public-global-presence:latest"
	defaultHTTPTimeout = 120 * time.Second
	reportPollInterval = 3 * time.Second
	reportPollMaxWait  = 5 * time.Minute
)

// Limitations documents honest coverage caveats for UI and metadata.
var Limitations = []string{
	"GFW AIS presence is hourly gridded (~0.01° cell centers), not raw AIS messages",
	"Data lag is approximately 96 hours behind real time",
	"Sparse satellite AIS coverage in some regions (e.g. Persian Gulf) may under-count traffic",
	"Free GFW API token required; terms at https://globalfishingwatch.org/our-apis/tokens",
}

// TrackPoint is a normalized historical AIS observation for archive ingest.
type TrackPoint struct {
	MMSI           int64
	Timestamp      time.Time
	Lat            float64
	Lon            float64
	SOG            *float64
	COG            *float64
	DataSource     string
	SourceRecordID string
}

// BBox is a west/south/east/north bounding box in WGS84 degrees.
type BBox struct {
	Name                     string
	West, South, East, North float64
}

// HistoricalProvider fetches durable AIS history beyond the live rolling buffer.
type HistoricalProvider interface {
	FetchTrackPoints(ctx context.Context, mmsi int64, from, to time.Time) ([]TrackPoint, error)
}

// Client calls the GFW v3 4Wings report API for AIS vessel presence.
//
// GFW presence selects one AIS position per vessel per hour and returns gridded
// cell centers — suitable for STS proximity heuristics, not raw track replay.
type Client struct {
	APIKey     string
	BaseURL    string
	HTTPClient *http.Client
}

// New returns a GFW client. APIKey is required for live calls.
func New(apiKey string) *Client {
	return &Client{
		APIKey:  strings.TrimSpace(apiKey),
		BaseURL: defaultBaseURL,
		HTTPClient: &http.Client{
			Timeout: defaultHTTPTimeout,
		},
	}
}

// FetchBBoxTrackPoints downloads hourly AIS presence for a bbox and optional MMSI filter.
func (c *Client) FetchBBoxTrackPoints(ctx context.Context, bbox BBox, from, to time.Time, mmsi int64) ([]TrackPoint, error) {
	if c.APIKey == "" {
		return nil, ErrNotConfigured
	}
	if !from.Before(to) {
		return nil, fmt.Errorf("gfw: invalid time range")
	}
	body, err := c.requestReport(ctx, bbox, from, to, mmsi)
	if err != nil {
		return nil, err
	}
	return parsePresenceReport(body, bbox.Name)
}

// FetchTrackPoints queries all default STS archive regions for one MMSI.
func (c *Client) FetchTrackPoints(ctx context.Context, mmsi int64, from, to time.Time) ([]TrackPoint, error) {
	if mmsi <= 0 {
		return nil, fmt.Errorf("gfw: mmsi required")
	}
	var out []TrackPoint
	for _, bbox := range DefaultArchiveRegions() {
		pts, err := c.FetchBBoxTrackPoints(ctx, bbox, from, to, mmsi)
		if err != nil {
			return nil, err
		}
		out = append(out, pts...)
	}
	return out, nil
}

func (c *Client) requestReport(ctx context.Context, bbox BBox, from, to time.Time, mmsi int64) ([]byte, error) {
	q := url.Values{}
	q.Set("datasets[0]", presenceDataset)
	q.Set("format", "JSON")
	q.Set("spatial-resolution", "HIGH")
	q.Set("temporal-resolution", "HOURLY")
	q.Set("group-by", "MMSI")
	q.Set("spatial-aggregation", "true")
	q.Set("date-range", fmt.Sprintf("%s,%s", from.UTC().Format("2006-01-02"), to.UTC().Format("2006-01-02")))
	// Slow-moving vessels relevant to STS anchorage heuristics.
	q.Set("filters[0]", "speed < 3")
	if mmsi > 0 {
		q.Set("filters[1]", fmt.Sprintf("mmsi = '%d'", mmsi))
	}

	geoBody, _ := json.Marshal(map[string]any{
		"geojson": bboxPolygon(bbox),
	})

	endpoint := strings.TrimRight(c.baseURL(), "/") + "/v3/4wings/report?" + q.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(geoBody))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.APIKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.http().Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 32<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode == http.StatusTooManyRequests {
		return nil, ErrRateLimited
	}
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("gfw report %d: %s", resp.StatusCode, truncate(string(body), 300))
	}

	var status reportStatus
	if json.Unmarshal(body, &status) == nil && status.Status == "running" {
		return c.pollLastReport(ctx)
	}
	return body, nil
}

func (c *Client) pollLastReport(ctx context.Context) ([]byte, error) {
	deadline := time.Now().Add(reportPollMaxWait)
	endpoint := strings.TrimRight(c.baseURL(), "/") + "/v3/4wings/last-report"
	for time.Now().Before(deadline) {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(reportPollInterval):
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("Authorization", "Bearer "+c.APIKey)
		resp, err := c.http().Do(req)
		if err != nil {
			return nil, err
		}
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 32<<20))
		resp.Body.Close()
		if resp.StatusCode == http.StatusNotFound {
			continue
		}
		if resp.StatusCode >= 400 {
			return nil, fmt.Errorf("gfw last-report %d: %s", resp.StatusCode, truncate(string(body), 300))
		}
		var status reportStatus
		if json.Unmarshal(body, &status) == nil && status.Status == "running" {
			continue
		}
		return body, nil
	}
	return nil, fmt.Errorf("gfw report timed out after %s", reportPollMaxWait)
}

type reportStatus struct {
	Status string `json:"status"`
}

type presenceReport struct {
	Entries []map[string]json.RawMessage `json:"entries"`
}

func parsePresenceReport(body []byte, region string) ([]TrackPoint, error) {
	var report presenceReport
	if err := json.Unmarshal(body, &report); err != nil {
		return nil, fmt.Errorf("gfw parse report: %w", err)
	}
	var out []TrackPoint
	for _, entry := range report.Entries {
		for datasetKey, raw := range entry {
			_ = datasetKey
			var rows []map[string]any
			if err := json.Unmarshal(raw, &rows); err != nil {
				continue
			}
			for _, row := range rows {
				pt, ok := mapPresenceRow(row, region)
				if ok {
					out = append(out, pt)
				}
			}
		}
	}
	return out, nil
}

func mapPresenceRow(row map[string]any, region string) (TrackPoint, bool) {
	mmsiStr := stringField(row, "mmsi")
	if mmsiStr == "" {
		return TrackPoint{}, false
	}
	mmsi, err := strconv.ParseInt(mmsiStr, 10, 64)
	if err != nil || mmsi <= 0 {
		return TrackPoint{}, false
	}
	lat, okLat := floatField(row, "lat")
	lon, okLon := floatField(row, "lon")
	if !okLat || !okLon {
		return TrackPoint{}, false
	}
	ts, ok := parsePresenceDate(row["date"])
	if !ok {
		return TrackPoint{}, false
	}
	var sog *float64
	if v, ok := floatField(row, "speed"); ok {
		sog = &v
	}
	sourceID := fmt.Sprintf("gfw:%s:%d:%s", region, mmsi, ts.UTC().Format("2006-01-02T15"))
	return TrackPoint{
		MMSI:           mmsi,
		Timestamp:      ts.UTC(),
		Lat:            lat,
		Lon:            lon,
		SOG:            sog,
		DataSource:     "gfw",
		SourceRecordID: sourceID,
	}, true
}

func parsePresenceDate(v any) (time.Time, bool) {
	s := strings.TrimSpace(fmt.Sprint(v))
	if s == "" || s == "<nil>" {
		return time.Time{}, false
	}
	layouts := []string{
		time.RFC3339,
		"2006-01-02T15:04:05",
		"2006-01-02 15:04:05",
		"2006-01-02T15",
		"2006-01-02",
	}
	for _, layout := range layouts {
		if t, err := time.Parse(layout, s); err == nil {
			return t, true
		}
	}
	return time.Time{}, false
}

func bboxPolygon(b BBox) map[string]any {
	return map[string]any{
		"type": "Polygon",
		"coordinates": [][][]float64{{
			{b.West, b.South},
			{b.East, b.South},
			{b.East, b.North},
			{b.West, b.North},
			{b.West, b.South},
		}},
	}
}

func stringField(row map[string]any, key string) string {
	v, ok := row[key]
	if !ok || v == nil {
		return ""
	}
	return strings.TrimSpace(fmt.Sprint(v))
}

func floatField(row map[string]any, key string) (float64, bool) {
	v, ok := row[key]
	if !ok || v == nil {
		return 0, false
	}
	switch n := v.(type) {
	case float64:
		return n, true
	case json.Number:
		f, err := n.Float64()
		return f, err == nil
	case string:
		f, err := strconv.ParseFloat(strings.TrimSpace(n), 64)
		return f, err == nil
	case int:
		return float64(n), true
	case int64:
		return float64(n), true
	default:
		return 0, false
	}
}

func (c *Client) baseURL() string {
	if strings.TrimSpace(c.BaseURL) != "" {
		return c.BaseURL
	}
	return defaultBaseURL
}

func (c *Client) http() *http.Client {
	if c.HTTPClient != nil {
		return c.HTTPClient
	}
	return &http.Client{Timeout: defaultHTTPTimeout}
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}

// ErrNotConfigured means GFW_API_KEY is missing.
var ErrNotConfigured = fmt.Errorf("gfw api key not configured")

// ErrRateLimited is returned on HTTP 429 (one concurrent report per token by default).
var ErrRateLimited = fmt.Errorf("gfw rate limited")

// ErrNotIntegrated is kept for callers that expect the legacy stub error.
var ErrNotIntegrated = ErrNotConfigured
