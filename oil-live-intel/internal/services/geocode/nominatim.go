package geocode

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Result is a geocoded point with provenance.
type Result struct {
	Lat         float64
	Lng         float64
	Confidence  float64
	Source      string
	DisplayName string
}

// Client geocodes register addresses via Nominatim with polite rate limiting.
type Client struct {
	BaseURL    string
	UserAgent  string
	MinDelay   time.Duration
	httpClient *http.Client
	mu         sync.Mutex
	lastCall   time.Time
	cache      map[string]*Result
}

// NewClient builds a Nominatim client from environment defaults.
func NewClient() *Client {
	delay := 1100 * time.Millisecond
	if raw := strings.TrimSpace(os.Getenv("NOMINATIM_RPS_DELAY")); raw != "" {
		if sec, err := strconv.ParseFloat(raw, 64); err == nil && sec > 0 {
			delay = time.Duration(sec * float64(time.Second))
		}
	}
	ua := strings.TrimSpace(os.Getenv("GEOCODER_USER_AGENT"))
	if ua == "" {
		ua = "meridian-bunker-geocode/1.0 (contact admin)"
	}
	base := strings.TrimSpace(os.Getenv("NOMINATIM_BASE_URL"))
	if base == "" {
		base = "https://nominatim.openstreetmap.org"
	}
	return &Client{
		BaseURL:    strings.TrimRight(base, "/"),
		UserAgent:  ua,
		MinDelay:   delay,
		httpClient: &http.Client{Timeout: 12 * time.Second},
		cache:      map[string]*Result{},
	}
}

// LookupAddress geocodes a full register address string.
func (c *Client) LookupAddress(query string) (*Result, error) {
	return c.LookupRegisterAddress(query, "")
}

// LookupRegisterAddress tries structured then simplified queries for register lines.
func (c *Client) LookupRegisterAddress(address, country string) (*Result, error) {
	parsed := ParseRegisterAddress(address, country)
	if parsed.Raw == "" {
		return nil, nil
	}

	cacheKey := parsed.Raw + "|" + parsed.Country
	c.mu.Lock()
	if hit, ok := c.cache[cacheKey]; ok {
		c.mu.Unlock()
		return hit, nil
	}
	c.mu.Unlock()

	if parsed.Structured {
		if hit, err := c.lookupStructured(parsed.Street, parsed.PostalCode, parsed.Country); err == nil && hit != nil {
			c.cacheResult(cacheKey, hit)
			return hit, nil
		}
	}
	for _, q := range RegisterAddressFallbackQueries(parsed) {
		if hit, err := c.lookupFreeText(q); err == nil && hit != nil {
			c.cacheResult(cacheKey, hit)
			return hit, nil
		}
	}

	c.cacheResult(cacheKey, nil)
	return nil, nil
}

func (c *Client) lookupStructured(street, postalCode, country string) (*Result, error) {
	c.waitRateLimit()
	endpoint := c.BaseURL + "/search?" + url.Values{
		"street":      {street},
		"postalcode":  {postalCode},
		"country":     {country},
		"format":      {"json"},
		"limit":       {"1"},
		"addressdetails": {"0"},
	}.Encode()
	return c.doSearch(endpoint)
}

func (c *Client) lookupFreeText(query string) (*Result, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return nil, nil
	}
	c.mu.Lock()
	if hit, ok := c.cache[query]; ok {
		c.mu.Unlock()
		return hit, nil
	}
	c.mu.Unlock()

	c.waitRateLimit()
	endpoint := c.BaseURL + "/search?" + url.Values{
		"q":              {query},
		"format":         {"json"},
		"limit":          {"1"},
		"addressdetails": {"0"},
	}.Encode()
	return c.doSearch(endpoint)
}

func (c *Client) doSearch(endpoint string) (*Result, error) {
	req, err := http.NewRequest(http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", c.UserAgent)
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("nominatim status %d", resp.StatusCode)
	}

	var hits []map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&hits); err != nil {
		return nil, err
	}
	if len(hits) == 0 {
		return nil, nil
	}
	hit := hits[0]
	lat, err1 := strconv.ParseFloat(fmt.Sprint(hit["lat"]), 64)
	lng, err2 := strconv.ParseFloat(fmt.Sprint(hit["lon"]), 64)
	if err1 != nil || err2 != nil {
		return nil, fmt.Errorf("nominatim parse lat/lng")
	}
	conf := 0.8
	if imp, ok := hit["importance"].(float64); ok && imp > 0 {
		conf = imp
	}
	return &Result{
		Lat:         lat,
		Lng:         lng,
		Confidence:  conf,
		Source:      "nominatim",
		DisplayName: stringFromAny(hit["display_name"]),
	}, nil
}

func (c *Client) cacheResult(key string, result *Result) {
	c.mu.Lock()
	c.cache[key] = result
	c.mu.Unlock()
}

// LegacyLookupAddress geocodes a single free-text query (tests / direct use).
func (c *Client) LegacyLookupAddress(query string) (*Result, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return nil, nil
	}
	c.mu.Lock()
	if hit, ok := c.cache[query]; ok {
		c.mu.Unlock()
		return hit, nil
	}
	c.mu.Unlock()
	c.waitRateLimit()
	endpoint := c.BaseURL + "/search?" + url.Values{
		"q":              {query},
		"format":         {"json"},
		"limit":          {"1"},
		"addressdetails": {"0"},
	}.Encode()
	result, err := c.doSearch(endpoint)
	if err != nil {
		return nil, err
	}
	c.cacheResult(query, result)
	return result, nil
}

func (c *Client) waitRateLimit() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.lastCall.IsZero() {
		elapsed := time.Since(c.lastCall)
		if elapsed < c.MinDelay {
			time.Sleep(c.MinDelay - elapsed)
		}
	}
	c.lastCall = time.Now()
}

func stringFromAny(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return fmt.Sprint(v)
}
