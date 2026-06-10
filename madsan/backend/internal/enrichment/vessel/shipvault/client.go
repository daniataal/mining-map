// Package shipvault provides an HTTP client for the ShipVault vessel registry API.
//
// Auth model: ShipVault's web app uses Firebase Authentication. Programmatic access
// uses Firebase REST:
//   - Login: identitytoolkit.googleapis.com/v1/accounts:signInWithPassword
//   - Refresh: securetoken.googleapis.com/v1/token
//
// Auth priority: SHIPVAULT_BEARER_TOKEN (manual) > SHIPVAULT_REFRESH_TOKEN or
// SHIPVAULT_SESSION_JSON (DevTools) > SHIPVAULT_EMAIL/PASSWORD (Firebase login).
// SHIPVAULT_FIREBASE_API_KEY is optional — discovered from app.shipvault.io when unset.
//
// Token lifecycle: Firebase JWTs expire after ~1 hour, but our Postgres cache
// (vessel_enrichment_cache) has a configurable TTL (default 7 days). Most vessel
// lookups are served from cache — the live token is only needed on cache miss or
// force-refresh.
//
// Usage:
//
//	svc, mode, err := shipvault.NewService(opts, log)
//	result, err := svc.FetchLive(ctx, imo)
package shipvault

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/rs/zerolog"
)

const (
	httpTimeout             = 15 * time.Second
	defaultCacheTTLDays     = 30 // longer default since token refresh is manual
	defaultShipVaultOrigin  = "https://www.shipvault.com"
	defaultShipVaultReferer = "https://www.shipvault.com/"
	defaultShipVaultUA      = "Mozilla/5.0 (compatible; oil-live-intel/1.0; +https://www.shipvault.com)"
)

// Service is a thread-safe ShipVault client with optional Firebase auto-auth.
// Manual tokens can be hot-swapped at runtime via UpdateToken without restarting.
type Service struct {
	baseURL             string
	cacheTTL            time.Duration
	log                 zerolog.Logger
	authMode            AuthMode
	tokenProv           tokenProvider
	httpClient          *http.Client
	persistRefreshToken RefreshTokenPersister
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
	CacheStatus    CacheStatus     `json:"cache_status"`
}

// CacheStatus makes the DB-backed registry path observable to the UI and sync-status checks.
type CacheStatus struct {
	Hit         bool   `json:"hit"`
	Source      string `json:"source"`
	Stale       bool   `json:"stale,omitempty"`
	WriteStatus string `json:"write_status,omitempty"`
	WriteError  string `json:"write_error,omitempty"`
}

// NewService creates a ShipVault client. Auto-auth performs an initial Firebase login
// so credential errors surface at startup rather than on the first enrichment request.
func NewService(opts ServiceOptions, log zerolog.Logger) (*Service, AuthMode, error) {
	ttl := time.Duration(opts.CacheTTLDays) * 24 * time.Hour
	if ttl <= 0 {
		ttl = time.Duration(defaultCacheTTLDays) * 24 * time.Hour
	}

	mode := ResolveAuthMode(opts)
	svcLog := log.With().Str("service", "shipvault").Logger()
	svc := &Service{
		baseURL:             opts.BaseURL,
		cacheTTL:            ttl,
		log:                 svcLog,
		authMode:            mode,
		httpClient:          &http.Client{Timeout: httpTimeout},
		persistRefreshToken: opts.PersistRefreshToken,
	}

	switch mode {
	case AuthManual:
		tok := strings.TrimPrefix(strings.TrimSpace(opts.BearerToken), "Bearer ")
		svc.tokenProv = &staticTokenProvider{bearer: tok}
		svc.log.Info().Str("auth", mode.String()).Msg("ShipVault enrichment configured")
	case AuthRefresh, AuthAuto:
		apiKey, err := resolveFirebaseAPIKey(context.Background(), opts, svc.httpClient)
		if err != nil {
			return nil, mode, fmt.Errorf("shipvault firebase api key: %w", err)
		}
		fb := newFirebaseAuth(opts.Email, opts.Password, apiKey, svcLog)
		if opts.PersistRefreshToken != nil {
			fb.onRefreshTokenPersist = func(rt string) {
				if err := opts.PersistRefreshToken(context.Background(), rt); err != nil {
					svcLog.Warn().Err(err).Msg("shipvault refresh token persist failed")
				}
			}
		}
		svc.tokenProv = fb
		if err := bootstrapFirebaseAuth(context.Background(), fb, opts); err != nil {
			return nil, mode, fmt.Errorf("shipvault firebase bootstrap: %w", err)
		}
		svc.log.Info().Str("auth", mode.String()).Bool("firebase_key_discovered", strings.TrimSpace(opts.FirebaseAPIKey) == "").Msg("ShipVault enrichment configured")
	case AuthDisabled:
		svc.log.Info().Str("auth", mode.String()).Msg("ShipVault enrichment not configured")
	}

	return svc, mode, nil
}

// AuthMode reports how credentials are supplied.
func (s *Service) AuthMode() AuthMode { return s.authMode }

// UpdateToken hot-swaps to a manual Bearer token without restarting the service.
func (s *Service) UpdateToken(tok string) {
	tok = strings.TrimPrefix(strings.TrimSpace(tok), "Bearer ")
	s.authMode = AuthManual
	s.tokenProv = &staticTokenProvider{bearer: tok}
	s.log.Info().Str("auth", AuthManual.String()).Msg("ShipVault Bearer token updated")
}

// HasToken reports whether a usable Bearer token is available.
func (s *Service) HasToken() bool {
	if s.tokenProv == nil {
		return false
	}
	return s.tokenProv.hasToken()
}

// PersistedRefreshToken returns the Firebase refresh token when using refresh/session auth.
func (s *Service) PersistedRefreshToken() string {
	fb, ok := s.tokenProv.(*firebaseAuth)
	if !ok || fb == nil {
		return ""
	}
	return fb.refreshTokenValue()
}

// BootstrapRefreshToken replaces the refresh token, exchanges it for a JWT, and persists when configured.
func (s *Service) BootstrapRefreshToken(ctx context.Context, refreshToken string) error {
	refreshToken = strings.TrimSpace(refreshToken)
	if refreshToken == "" {
		return fmt.Errorf("empty refresh token")
	}
	fb, ok := s.tokenProv.(*firebaseAuth)
	if !ok || fb == nil {
		return fmt.Errorf("shipvault service is not using refresh-token auth")
	}
	fb.setRefreshToken(refreshToken)
	if err := fb.refreshWithToken(ctx); err != nil {
		return err
	}
	if s.persistRefreshToken != nil {
		if err := s.persistRefreshToken(ctx, refreshToken); err != nil {
			return fmt.Errorf("persist refresh token: %w", err)
		}
	}
	return nil
}

// doRequest performs an authenticated GET request to the ShipVault API.
func (s *Service) doRequest(ctx context.Context, path string, out any) error {
	return s.doRequestRetry(ctx, path, out, false)
}

func (s *Service) doRequestRetry(ctx context.Context, path string, out any, retried bool) error {
	if s.tokenProv == nil {
		return fmt.Errorf("no ShipVault token — set SHIPVAULT_BEARER_TOKEN, SHIPVAULT_REFRESH_TOKEN, SHIPVAULT_SESSION_JSON, or SHIPVAULT_EMAIL/PASSWORD")
	}

	tok, err := s.tokenProv.token(ctx)
	if err != nil {
		return fmt.Errorf("shipvault auth: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.baseURL+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json, text/plain, */*")
	req.Header.Set("app", "web")
	req.Header.Set("Authorization", "Bearer "+tok)
	// ShipVault returns 202 {} without browser-origin headers; mirror the web app.
	req.Header.Set("Origin", defaultShipVaultOrigin)
	req.Header.Set("Referer", defaultShipVaultReferer)
	req.Header.Set("User-Agent", defaultShipVaultUA)

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("shipvault upstream unavailable: %w", err)
	}
	defer resp.Body.Close()

	switch resp.StatusCode {
	case http.StatusUnauthorized:
		if !retried && (s.authMode == AuthAuto || s.authMode == AuthRefresh) {
			s.tokenProv.invalidate()
			return s.doRequestRetry(ctx, path, out, true)
		}
		if s.authMode == AuthManual {
			return fmt.Errorf("shipvault 401: manual token expired — paste a new SHIPVAULT_BEARER_TOKEN or set SHIPVAULT_REFRESH_TOKEN from DevTools (Network → sign-in or securetoken → refreshToken field)")
		}
		return fmt.Errorf("shipvault 401: unauthorized — update SHIPVAULT_REFRESH_TOKEN or SHIPVAULT_SESSION_JSON from DevTools, or paste SHIPVAULT_BEARER_TOKEN")
	case http.StatusNotFound:
		return fmt.Errorf("shipvault 404: vessel/company not found")
	case http.StatusOK, http.StatusAccepted:
		return json.NewDecoder(resp.Body).Decode(out)
	default:
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("shipvault %d: %s", resp.StatusCode, strings.TrimSpace(string(raw)))
	}
}

// shipSearchResponse is the paginated payload from GET /api/units/shipsearch/{imo}.
type shipSearchResponse struct {
	Data       []map[string]any `json:"data"`
	Items      []map[string]any `json:"items"`
	Results    []map[string]any `json:"results"`
	Total      int              `json:"total"`
	TotalCount int              `json:"totalCount"`
}

func shipSearchPath(imo string) string {
	q := url.Values{}
	q.Set("page", "1")
	q.Set("pageSize", "50")
	q.Set("sortColumn", "name")
	q.Set("sortDir", "ASC")
	return fmt.Sprintf("/api/units/shipsearch/%s?%s", url.PathEscape(strings.TrimSpace(imo)), q.Encode())
}

func (r shipSearchResponse) vesselRows() []map[string]any {
	switch {
	case len(r.Data) > 0:
		return r.Data
	case len(r.Items) > 0:
		return r.Items
	default:
		return r.Results
	}
}

func pickShipSearchVessel(resp shipSearchResponse, imo string) map[string]any {
	rows := resp.vesselRows()
	if len(rows) == 0 {
		return nil
	}
	imoNorm := strings.TrimSpace(imo)
	for _, row := range rows {
		if imoString(row, "imo", "IMO", "imo_number") == imoNorm {
			return row
		}
	}
	return rows[0]
}

// GetVesselByIMO fetches vessel details from ShipVault by IMO via shipsearch.
func (s *Service) GetVesselByIMO(ctx context.Context, imo string) (map[string]any, error) {
	var raw json.RawMessage
	if err := s.doRequest(ctx, shipSearchPath(imo), &raw); err != nil {
		return nil, err
	}
	resp := parseShipSearchPayload(raw)
	vessel := pickShipSearchVessel(resp, imo)
	if vessel == nil {
		return nil, fmt.Errorf("shipvault 404: no vessel match for IMO %s", imo)
	}
	return vessel, nil
}

func parseShipSearchPayload(raw json.RawMessage) shipSearchResponse {
	if len(raw) == 0 {
		return shipSearchResponse{}
	}
	body := bytesTrimSpace(raw)
	if len(body) == 0 || bytesEqual(body, []byte("{}")) || bytesEqual(body, []byte("null")) {
		return shipSearchResponse{}
	}
	// ShipVault shipsearch often returns a bare JSON array (text/plain body).
	if len(body) > 0 && body[0] == '[' {
		var rows []map[string]any
		if err := json.Unmarshal(body, &rows); err == nil && len(rows) > 0 {
			return shipSearchResponse{Data: rows}
		}
	}
	// Some endpoints double-encode JSON as a string.
	if len(body) > 0 && body[0] == '"' {
		var inner string
		if err := json.Unmarshal(body, &inner); err == nil && strings.TrimSpace(inner) != "" {
			return parseShipSearchPayload(json.RawMessage(inner))
		}
	}
	var direct shipSearchResponse
	if err := json.Unmarshal(body, &direct); err == nil && len(direct.vesselRows()) > 0 {
		return direct
	}
	var wrapped struct {
		Data json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(body, &wrapped); err == nil && len(wrapped.Data) > 0 {
		var nested shipSearchResponse
		if json.Unmarshal(wrapped.Data, &nested) == nil && len(nested.vesselRows()) > 0 {
			return nested
		}
		var rows []map[string]any
		if json.Unmarshal(wrapped.Data, &rows) == nil && len(rows) > 0 {
			return shipSearchResponse{Data: rows}
		}
	}
	var one map[string]any
	if err := json.Unmarshal(body, &one); err == nil {
		if imoString(one, "imo", "IMO", "imo_number") != "" || strField(one, "name", "vesselName", "vessel_name", "parentname") != "" {
			return shipSearchResponse{Data: []map[string]any{one}}
		}
	}
	return direct
}

func bytesTrimSpace(b []byte) []byte {
	return []byte(strings.TrimSpace(string(b)))
}

func bytesEqual(a, b []byte) bool {
	return string(a) == string(b)
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
// Upstream: GET /api/companies/fleet/{companyID}?page=1&pageSize=200 (bare JSON array).
func (s *Service) GetFleet(ctx context.Context, companyID string) ([]map[string]any, error) {
	companyID = strings.TrimSpace(companyID)
	if companyID == "" {
		return nil, fmt.Errorf("empty company id")
	}
	var raw json.RawMessage
	path := fmt.Sprintf("/api/companies/fleet/%s?page=1&pageSize=200", url.PathEscape(companyID))
	if err := s.doRequest(ctx, path, &raw); err != nil {
		return nil, err
	}
	rows := parseShipSearchPayload(raw).vesselRows()
	if len(rows) == 0 {
		return nil, nil
	}
	return rows, nil
}

// FetchLive pulls vessel registry facts from ShipVault by IMO (no upstream DB cache).
func (s *Service) FetchLive(ctx context.Context, imo string) (*EnrichmentResult, error) {
	imo = strings.TrimSpace(imo)
	if imo == "" {
		return nil, fmt.Errorf("no IMO number; cannot enrich via ShipVault")
	}

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

	return &EnrichmentResult{
		Vessel:         vessel,
		OwnerProfile:   ownerProfile,
		CachedAt:       time.Now().UTC(),
		DataSource:     "shipvault",
		EnrichmentTier: "registry",
		Disclaimer:     "Vessel registry data sourced from ShipVault. Values (e.g. estimated valuation) are indicative, not certified.",
		CacheStatus: CacheStatus{
			Hit:         false,
			Source:      "shipvault_live",
			WriteStatus: "not_attempted",
		},
	}, nil
}

// ─── vessel / company parsing ────────────────────────────────────────────────

func parseVesselProfile(raw map[string]any, imo string) *VesselProfile {
	if raw == nil {
		return &VesselProfile{IMO: imo}
	}
	v := &VesselProfile{IMO: imo, Raw: raw}
	v.ShipVaultVesselID = strField(raw, "id", "vessel_id", "unit_id", "parentid", "_id")
	v.Name = strField(raw, "name", "vessel_name", "vesselName", "shipName", "parentname")
	v.Flag = strField(raw, "flag", "flag_state", "flag_code", "flagState", "flagCode")
	v.VesselClass = strField(raw, "vessel_type", "vesselType", "type", "ship_type", "shipType", "class", "groupname", "groupName")
	v.Builder = strField(raw, "builder", "shipbuilder", "shipyard", "shipBuilder")
	v.OperatorName = strField(raw, "operator", "operator_name", "operatorName", "commercial_manager", "commercialManager")
	v.OwnerCompanyID = strField(raw, "owner_id", "ownerId", "owner_company_id", "registered_owner_id", "registeredOwnerId", "company_id", "companyId")
	v.OwnerName = strField(raw, "owner", "owner_name", "ownerName", "registered_owner", "registeredOwner")
	if v.OwnerCompanyID == "" {
		if ownerObj, ok := raw["owner"].(map[string]any); ok {
			v.OwnerCompanyID = strField(ownerObj, "id", "company_id", "companyId")
			if v.OwnerName == "" {
				v.OwnerName = strField(ownerObj, "name", "company_name", "companyName")
			}
		}
	}
	if v.OwnerCompanyID == "" {
		if regObj, ok := raw["registeredOwner"].(map[string]any); ok {
			v.OwnerCompanyID = strField(regObj, "id", "company_id", "companyId")
			if v.OwnerName == "" {
				v.OwnerName = strField(regObj, "name", "company_name", "companyName")
			}
		}
	}
	v.EstimatedValueUSD = floatField(raw, "estimated_value", "value_usd", "market_value", "value")
	v.GrossTonnage = floatField(raw, "gross_tonnage", "grossTonnage", "gt")
	v.DeadweightTons = floatField(raw, "deadweight", "dwt", "deadweight_tons", "deadweightTons", "tdw")
	v.BuildYear = intField(raw, "year_built", "build_year", "yearBuilt", "built")

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

func imoString(m map[string]any, keys ...string) string {
	for _, k := range keys {
		if v, ok := m[k]; ok {
			switch n := v.(type) {
			case string:
				return strings.TrimSpace(n)
			case float64:
				return fmt.Sprintf("%.0f", n)
			case int:
				return fmt.Sprintf("%d", n)
			case int64:
				return fmt.Sprintf("%d", n)
			case json.Number:
				return strings.TrimSpace(n.String())
			}
		}
	}
	return ""
}

func strField(m map[string]any, keys ...string) string {
	for _, k := range keys {
		if v, ok := m[k]; ok {
			switch s := v.(type) {
			case string:
				return strings.TrimSpace(s)
			case fmt.Stringer:
				return strings.TrimSpace(s.String())
			case float64:
				return fmt.Sprintf("%.0f", s)
			case int:
				return fmt.Sprintf("%d", s)
			case int64:
				return fmt.Sprintf("%d", s)
			case json.Number:
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
