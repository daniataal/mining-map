// Package shipvault provides an HTTP client for the ShipVault vessel registry API.
//
// Auth model: ShipVault uses Firebase Google OAuth in its web app. Since OAuth
// tokens cannot be obtained programmatically without a browser, we accept a
// pre-copied Bearer token via the SHIPVAULT_BEARER_TOKEN env var.
//
// Token lifecycle: Firebase JWTs expire after ~1 hour, but our Postgres cache
// (vessel_enrichment_cache) has a configurable TTL (default 30 days). Most
// vessel lookups are served from cache — the live token is only needed when a
// vessel has never been fetched before, or when force-refreshing.
//
// How to get a fresh token:
//  1. Open https://app.shipvault.io in your browser.
//  2. Open DevTools → Network tab.
//  3. Click any vessel.
//  4. Find the request to shipvaultapi-gjb8c.ondigitalocean.app.
//  5. Copy the value of the "Authorization" header (everything after "Bearer ").
//  6. Set SHIPVAULT_BEARER_TOKEN=<paste here> in your .env and restart oil-live-intel.
//
// Usage:
//
//	svc := shipvault.NewService(cfg, log)
//	result, err := svc.EnrichVessel(ctx, pool, mmsi, imo, false)
package shipvault

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"
)

const (
	httpTimeout         = 15 * time.Second
	defaultCacheTTLDays = 30 // longer default since token refresh is manual
)

// Service is a thread-safe ShipVault client that uses a static Bearer token.
// The token can be hot-swapped at runtime via UpdateToken without restarting.
type Service struct {
	baseURL  string
	cacheTTL time.Duration
	log      zerolog.Logger

	mu    sync.RWMutex
	token string // current Bearer token (may be empty if never set)

	httpClient *http.Client
}

// VesselProfile is the structured data returned by GetVessel.
type VesselProfile struct {
	ShipVaultVesselID string             `json:"shipvault_vessel_id"`
	IMO               string             `json:"imo"`
	Name              string             `json:"name"`
	Flag              string             `json:"flag"`
	VesselClass       string             `json:"vessel_class"`
	GrossTonnage      float64            `json:"gross_tonnage"`
	DeadweightTons    float64            `json:"deadweight_tons"`
	BuildYear         int                `json:"build_year"`
	Builder           string             `json:"builder"`
	OwnerCompanyID    string             `json:"owner_company_id"`
	OwnerName         string             `json:"owner_name"`
	OperatorName      string             `json:"operator_name"`
	EstimatedValueUSD float64            `json:"estimated_value_usd"`
	NameHistory       []NameHistoryEntry `json:"name_history"`
	Raw               map[string]any     `json:"raw,omitempty"`
}

// NameHistoryEntry is one entry in a vessel's name history.
type NameHistoryEntry struct {
	Name     string `json:"name"`
	FromDate string `json:"from_date,omitempty"`
	ToDate   string `json:"to_date,omitempty"`
}

// CompanyProfile is the structured data returned by GetCompany.
type CompanyProfile struct {
	ShipVaultCompanyID string         `json:"shipvault_company_id"`
	Name               string         `json:"name"`
	Country            string         `json:"country"`
	FleetSize          int            `json:"fleet_size"`
	Fleet              []FleetItem    `json:"fleet,omitempty"`
	Raw                map[string]any `json:"raw,omitempty"`
}

// FleetItem is one vessel in a company's fleet.
type FleetItem struct {
	IMO  string `json:"imo"`
	MMSI string `json:"mmsi,omitempty"`
	Name string `json:"name"`
	Type string `json:"type,omitempty"`
}

// EnrichmentResult is the combined vessel+owner data returned to callers.
type EnrichmentResult struct {
	Vessel         *VesselProfile  `json:"vessel"`
	OwnerProfile   *CompanyProfile `json:"owner_profile,omitempty"`
	CachedAt       time.Time       `json:"cached_at"`
	DataSource     string          `json:"data_source"`
	EnrichmentTier string          `json:"enrichment_tier"`
	Disclaimer     string          `json:"disclaimer"`
}

// NewService creates a new ShipVault service using a static Bearer token.
// bearerToken is the raw JWT (without the "Bearer " prefix).
func NewService(
	baseURL, bearerToken string,
	cacheTTLDays int,
	log zerolog.Logger,
) *Service {
	ttl := time.Duration(cacheTTLDays) * 24 * time.Hour
	if ttl <= 0 {
		ttl = time.Duration(defaultCacheTTLDays) * 24 * time.Hour
	}
	svc := &Service{
		baseURL:    baseURL,
		cacheTTL:   ttl,
		log:        log.With().Str("service", "shipvault").Logger(),
		httpClient: &http.Client{Timeout: httpTimeout},
		token:      strings.TrimPrefix(strings.TrimSpace(bearerToken), "Bearer "),
	}
	if svc.token != "" {
		svc.log.Info().Msg("ShipVault token loaded from SHIPVAULT_BEARER_TOKEN")
	} else {
		svc.log.Warn().Msg("ShipVault service started with no token — enrichment will be skipped for uncached vessels until SHIPVAULT_BEARER_TOKEN is set")
	}
	return svc
}

// UpdateToken hot-swaps the Bearer token without restarting the service.
// This is called by the admin token-update endpoint.
func (s *Service) UpdateToken(tok string) {
	tok = strings.TrimPrefix(strings.TrimSpace(tok), "Bearer ")
	s.mu.Lock()
	s.token = tok
	s.mu.Unlock()
	s.log.Info().Msg("ShipVault Bearer token updated")
}

// HasToken reports whether a non-empty Bearer token is loaded.
func (s *Service) HasToken() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.token != ""
}

// currentToken returns the current bearer token (thread-safe).
func (s *Service) currentToken() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.token
}

// doRequest performs an authenticated GET request to the ShipVault API.
func (s *Service) doRequest(ctx context.Context, path string, out any) error {
	tok := s.currentToken()
	if tok == "" {
		return fmt.Errorf("no ShipVault token — set SHIPVAULT_BEARER_TOKEN in .env")
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.baseURL+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json, text/plain, */*")
	req.Header.Set("App", "web")
	req.Header.Set("Authorization", "Bearer "+tok)

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("shipvault http: %w", err)
	}
	defer resp.Body.Close()

	switch resp.StatusCode {
	case http.StatusUnauthorized:
		return fmt.Errorf("shipvault 401: token expired — copy a fresh token from DevTools and set SHIPVAULT_BEARER_TOKEN")
	case http.StatusNotFound:
		return fmt.Errorf("shipvault 404: vessel/company not found")
	case http.StatusOK:
		return json.NewDecoder(resp.Body).Decode(out)
	default:
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("shipvault %d: %s", resp.StatusCode, strings.TrimSpace(string(raw)))
	}
}

// GetVesselByIMO fetches vessel details from ShipVault by IMO number.
func (s *Service) GetVesselByIMO(ctx context.Context, imo string) (map[string]any, error) {
	var raw map[string]any
	if err := s.doRequest(ctx, "/api/vessels?imo="+imo, &raw); err != nil {
		return nil, err
	}
	return raw, nil
}

// GetVesselByVesselID fetches vessel details by ShipVault's internal vessel ID.
func (s *Service) GetVesselByVesselID(ctx context.Context, vesselID string) (map[string]any, error) {
	var raw map[string]any
	if err := s.doRequest(ctx, "/api/vessels/"+vesselID, &raw); err != nil {
		return nil, err
	}
	return raw, nil
}

// GetCompany fetches company/owner profile by ShipVault's internal company ID.
func (s *Service) GetCompany(ctx context.Context, companyID string) (map[string]any, error) {
	var raw map[string]any
	if err := s.doRequest(ctx, "/api/companies/"+companyID, &raw); err != nil {
		return nil, err
	}
	return raw, nil
}

// GetFleet fetches the fleet list for a company.
func (s *Service) GetFleet(ctx context.Context, companyID string) ([]map[string]any, error) {
	var raw struct {
		Data  []map[string]any `json:"data"`
		Items []map[string]any `json:"items"`
	}
	if err := s.doRequest(ctx, "/api/companies/"+companyID+"/fleet?page=1&pageSize=200", &raw); err != nil {
		return nil, err
	}
	if len(raw.Data) > 0 {
		return raw.Data, nil
	}
	return raw.Items, nil
}

// EnrichVessel checks the DB cache, fetches from ShipVault on cache miss,
// persists the result, and returns it.
// forceRefresh=true bypasses the TTL check and always re-fetches from ShipVault.
func (s *Service) EnrichVessel(ctx context.Context, pool *pgxpool.Pool, mmsi int64, imo string, forceRefresh bool) (*EnrichmentResult, error) {
	if imo == "" {
		return nil, fmt.Errorf("no IMO number; cannot enrich via ShipVault")
	}

	// 1. Serve from cache if available and not force-refreshing.
	if !forceRefresh {
		cached, err := loadFromCache(ctx, pool, imo)
		if err == nil && cached != nil {
			return cached, nil
		}
	}

	// 2. Fetch from ShipVault (requires a valid token).
	vesselRaw, err := s.GetVesselByIMO(ctx, imo)
	if err != nil {
		return nil, fmt.Errorf("shipvault vessel lookup: %w", err)
	}

	vessel := parseVesselProfile(vesselRaw, imo)

	var companyRaw map[string]any
	var fleet []map[string]any
	if vessel.OwnerCompanyID != "" {
		companyRaw, _ = s.GetCompany(ctx, vessel.OwnerCompanyID)
		fleet, _ = s.GetFleet(ctx, vessel.OwnerCompanyID)
	}

	ownerProfile := parseCompanyProfile(companyRaw, vessel.OwnerCompanyID, fleet)

	result := &EnrichmentResult{
		Vessel:         vessel,
		OwnerProfile:   ownerProfile,
		CachedAt:       time.Now().UTC(),
		DataSource:     "shipvault",
		EnrichmentTier: "registry",
		Disclaimer:     "Vessel registry data sourced from ShipVault. Values (e.g. estimated valuation) are indicative, not certified.",
	}

	// 3. Persist to cache asynchronously so the request stays fast.
	go func() {
		bgCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := upsertCache(bgCtx, pool, mmsi, imo, result); err != nil {
			s.log.Warn().Err(err).Str("imo", imo).Msg("shipvault cache upsert failed")
		}
	}()

	return result, nil
}

// ─── vessel / company parsing ────────────────────────────────────────────────

func parseVesselProfile(raw map[string]any, imo string) *VesselProfile {
	if raw == nil {
		return &VesselProfile{IMO: imo}
	}
	v := &VesselProfile{IMO: imo, Raw: raw}
	v.ShipVaultVesselID = strField(raw, "id", "vessel_id", "_id")
	v.Name = strField(raw, "name", "vessel_name")
	v.Flag = strField(raw, "flag", "flag_state", "flag_code")
	v.VesselClass = strField(raw, "vessel_type", "type", "ship_type", "class")
	v.Builder = strField(raw, "builder", "shipbuilder", "shipyard")
	v.OperatorName = strField(raw, "operator", "operator_name", "commercial_manager")
	v.OwnerCompanyID = strField(raw, "owner_id", "owner_company_id", "registered_owner_id", "company_id")
	v.OwnerName = strField(raw, "owner", "owner_name", "registered_owner")
	v.EstimatedValueUSD = floatField(raw, "estimated_value", "value_usd", "market_value")
	v.GrossTonnage = floatField(raw, "gross_tonnage", "gt")
	v.DeadweightTons = floatField(raw, "deadweight", "dwt", "deadweight_tons")
	v.BuildYear = intField(raw, "year_built", "build_year", "built")

	if hist := sliceField(raw, "name_history", "names", "previous_names"); hist != nil {
		for _, item := range hist {
			if m, ok := item.(map[string]any); ok {
				entry := NameHistoryEntry{
					Name:     strField(m, "name"),
					FromDate: strField(m, "from", "from_date", "start_date"),
					ToDate:   strField(m, "to", "to_date", "end_date"),
				}
				if entry.Name != "" {
					v.NameHistory = append(v.NameHistory, entry)
				}
			}
		}
	}
	return v
}

func parseCompanyProfile(raw map[string]any, companyID string, fleetRaw []map[string]any) *CompanyProfile {
	if raw == nil && len(fleetRaw) == 0 {
		return nil
	}
	c := &CompanyProfile{ShipVaultCompanyID: companyID, Raw: raw}
	if raw != nil {
		c.Name = strField(raw, "name", "company_name")
		c.Country = strField(raw, "country", "country_code", "flag")
		c.FleetSize = intField(raw, "fleet_size", "fleet_count", "total_vessels")
	}
	for _, f := range fleetRaw {
		if f == nil {
			continue
		}
		c.Fleet = append(c.Fleet, FleetItem{
			IMO:  strField(f, "imo"),
			MMSI: strField(f, "mmsi"),
			Name: strField(f, "name", "vessel_name"),
			Type: strField(f, "type", "vessel_type", "ship_type"),
		})
	}
	if c.FleetSize == 0 && len(c.Fleet) > 0 {
		c.FleetSize = len(c.Fleet)
	}
	return c
}

// ─── field-extraction helpers ────────────────────────────────────────────────

func strField(m map[string]any, keys ...string) string {
	for _, k := range keys {
		if v, ok := m[k]; ok {
			switch s := v.(type) {
			case string:
				return strings.TrimSpace(s)
			case fmt.Stringer:
				return strings.TrimSpace(s.String())
			}
		}
	}
	return ""
}

func floatField(m map[string]any, keys ...string) float64 {
	for _, k := range keys {
		if v, ok := m[k]; ok {
			switch n := v.(type) {
			case float64:
				return n
			case int:
				return float64(n)
			case json.Number:
				f, _ := n.Float64()
				return f
			}
		}
	}
	return 0
}

func intField(m map[string]any, keys ...string) int {
	for _, k := range keys {
		if v, ok := m[k]; ok {
			switch n := v.(type) {
			case float64:
				return int(n)
			case int:
				return n
			case json.Number:
				i, _ := n.Int64()
				return int(i)
			}
		}
	}
	return 0
}

func sliceField(m map[string]any, keys ...string) []any {
	for _, k := range keys {
		if v, ok := m[k]; ok {
			if s, ok := v.([]any); ok {
				return s
			}
		}
	}
	return nil
}
