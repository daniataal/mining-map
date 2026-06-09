package markets

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"sync"
	"time"
)

var eiaAPIBase = "https://api.eia.gov/v2"

const (
	eiaCacheTTL    = 20 * time.Minute
	eiaHTTPTimeout = 12 * time.Second
)

// EIA daily spot series (USD/bbl) — published with typical 1-day lag, not exchange tick data.
var eiaSpotSeries = map[string]struct {
	Symbol string
	Label  string
}{
	"RWTC":  {Symbol: "WTI", Label: "WTI Cushing"},
	"RBRTE": {Symbol: "BRENT", Label: "Brent Europe"},
}

type eiaSpot struct {
	Price     float64
	ChangePct *float64
	Period    time.Time
}

type eiaCache struct {
	mu      sync.RWMutex
	fetched time.Time
	ttl     time.Duration
	spots   map[string]eiaSpot
	err     error
}

func newEIACache() *eiaCache {
	return &eiaCache{ttl: eiaCacheTTL, spots: map[string]eiaSpot{}}
}

func (c *eiaCache) get(apiKey string, client *http.Client) (map[string]eiaSpot, error) {
	c.mu.RLock()
	if apiKey != "" && time.Since(c.fetched) < c.ttl && (len(c.spots) > 0 || c.err != nil) {
		spots, err := c.spots, c.err
		c.mu.RUnlock()
		return spots, err
	}
	c.mu.RUnlock()

	c.mu.Lock()
	defer c.mu.Unlock()
	if apiKey != "" && time.Since(c.fetched) < c.ttl && (len(c.spots) > 0 || c.err != nil) {
		return c.spots, c.err
	}

	spots, err := fetchEIADailySpots(client, apiKey)
	c.spots = spots
	c.err = err
	c.fetched = time.Now().UTC()
	return spots, err
}

func fetchEIADailySpots(client *http.Client, apiKey string) (map[string]eiaSpot, error) {
	if apiKey == "" {
		return nil, nil
	}
	if client == nil {
		client = &http.Client{Timeout: eiaHTTPTimeout}
	}

	q := url.Values{}
	q.Set("api_key", apiKey)
	q.Set("frequency", "daily")
	q.Set("data[0]", "value")
	for series := range eiaSpotSeries {
		q.Add("facets[series][]", series)
	}
	q.Set("sort[0][column]", "period")
	q.Set("sort[0][direction]", "desc")
	q.Set("length", "5000")

	reqURL := eiaAPIBase + "/petroleum/pri/spt/data/?" + q.Encode()
	resp, err := client.Get(reqURL)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("eia api status %d", resp.StatusCode)
	}

	var payload struct {
		Response struct {
			Data []struct {
				Series string  `json:"series"`
				Period string  `json:"period"`
				Value  float64 `json:"value"`
			} `json:"data"`
		} `json:"response"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, err
	}

	bySeries := map[string][]struct {
		period time.Time
		value  float64
	}{}
	for _, row := range payload.Response.Data {
		if row.Series == "" || row.Value <= 0 {
			continue
		}
		period, err := parseEIAPeriod(row.Period)
		if err != nil {
			continue
		}
		bySeries[row.Series] = append(bySeries[row.Series], struct {
			period time.Time
			value  float64
		}{period, row.Value})
	}

	out := make(map[string]eiaSpot, len(bySeries))
	for series, rows := range bySeries {
		sort.Slice(rows, func(i, j int) bool { return rows[i].period.After(rows[j].period) })
		if len(rows) == 0 {
			continue
		}
		latest := rows[0]
		spot := eiaSpot{Price: latest.value, Period: latest.period}
		if len(rows) > 1 && rows[1].value > 0 {
			chg := (latest.value - rows[1].value) / rows[1].value * 100
			spot.ChangePct = &chg
		}
		out[series] = spot
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("eia api returned no spot rows")
	}
	return out, nil
}

func parseEIAPeriod(raw string) (time.Time, error) {
	if t, err := time.Parse("2006-01-02", raw); err == nil {
		return t.UTC(), nil
	}
	if t, err := time.Parse("2006-01", raw); err == nil {
		return t.UTC(), nil
	}
	if yr, err := strconv.Atoi(raw); err == nil {
		return time.Date(yr, 1, 1, 0, 0, 0, 0, time.UTC), nil
	}
	return time.Time{}, fmt.Errorf("unknown eia period %q", raw)
}
