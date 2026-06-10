package equasis

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"strings"
	"sync"
	"time"
)

const defaultBaseURL = "https://www.equasis.org"

// Client performs authenticated, rate-limited lookups on the Equasis public registry.
// Equasis forbids bulk automated harvesting; keep rate limits conservative and use a registered account.
type Client struct {
	email    string
	password string
	baseURL  string
	interval time.Duration

	http     *http.Client
	mu       sync.Mutex
	loggedIn bool
	lastReq  time.Time
}

// NewClient builds an Equasis session client. minInterval defaults to 5s when zero.
func NewClient(email, password string, minInterval time.Duration) (*Client, error) {
	email = strings.TrimSpace(email)
	password = strings.TrimSpace(password)
	if email == "" || password == "" {
		return nil, fmt.Errorf("equasis: email and password required")
	}
	if minInterval <= 0 {
		minInterval = 5 * time.Second
	}
	jar, err := cookiejar.New(nil)
	if err != nil {
		return nil, err
	}
	return &Client{
		email:    email,
		password: password,
		baseURL:  defaultBaseURL,
		interval: minInterval,
		http: &http.Client{
			Timeout: 45 * time.Second,
			Jar:     jar,
		},
	}, nil
}

// LookupByIMO fetches ship info for a single IMO number.
func (c *Client) LookupByIMO(ctx context.Context, imo string) (ShipRecord, error) {
	imo = normalizeIMO(imo)
	if imo == "" {
		return ShipRecord{}, fmt.Errorf("equasis: IMO required")
	}
	if err := c.ensureLogin(ctx); err != nil {
		return ShipRecord{}, err
	}
	shipURL := fmt.Sprintf("%s/EquasisWeb/restricted/ShipInfo?fs=ShipInfo&P_IMO=%s", c.baseURL, url.QueryEscape(imo))
	body, err := c.get(ctx, shipURL)
	if err != nil {
		return ShipRecord{}, err
	}
	rec, err := ParseShipInfo(body, imo)
	if err != nil {
		return ShipRecord{}, err
	}
	if rec.IMO == "" {
		rec.IMO = imo
	}
	return rec, nil
}

func (c *Client) ensureLogin(ctx context.Context) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.loggedIn {
		return nil
	}
	loginURL := c.baseURL + "/EquasisWeb/authen/HomePage?fs=HomePage"
	form := url.Values{
		"j_email":    {c.email},
		"j_password": {c.password},
		"submit":     {"Ok"},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, loginURL, strings.NewReader(form.Encode()))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("User-Agent", userAgent)
	body, err := c.do(req)
	if err != nil {
		return fmt.Errorf("equasis login: %w", err)
	}
	text := string(body)
	if strings.Contains(text, "Your login (e-mail) or/and password are unknown") {
		return fmt.Errorf("equasis login: invalid credentials")
	}
	if strings.Contains(text, "Please Login first") && !strings.Contains(strings.ToLower(text), "welcome") {
		return fmt.Errorf("equasis login: session not established")
	}
	c.loggedIn = true
	return nil
}

func (c *Client) get(ctx context.Context, rawURL string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", userAgent)
	return c.do(req)
}

func (c *Client) do(req *http.Request) ([]byte, error) {
	c.throttle()
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		c.loggedIn = false
		return nil, fmt.Errorf("equasis http %d: auth required", resp.StatusCode)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("equasis http %d", resp.StatusCode)
	}
	text := string(body)
	if strings.Contains(text, "Please Login first") {
		c.loggedIn = false
		return nil, fmt.Errorf("equasis: session expired")
	}
	if strings.Contains(text, "No ship has been found") || strings.Contains(text, "No result has been found") {
		return nil, ErrNotFound
	}
	return body, nil
}

func (c *Client) throttle() {
	if c.lastReq.IsZero() {
		c.lastReq = time.Now()
		return
	}
	wait := c.interval - time.Since(c.lastReq)
	if wait > 0 {
		time.Sleep(wait)
	}
	c.lastReq = time.Now()
}

func normalizeIMO(imo string) string {
	imo = strings.TrimSpace(imo)
	imo = strings.TrimPrefix(strings.ToUpper(imo), "IMO")
	imo = strings.TrimSpace(imo)
	for _, r := range imo {
		if r < '0' || r > '9' {
			return ""
		}
	}
	if len(imo) != 7 {
		return ""
	}
	return imo
}

const userAgent = "madsan-vessel-enrich/1.0 (+https://github.com/mining-map; due-diligence registry lookup)"
