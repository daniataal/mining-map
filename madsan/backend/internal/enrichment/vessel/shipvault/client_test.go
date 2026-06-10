package shipvault

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/rs/zerolog"
)

func testLogger() zerolog.Logger {
	return zerolog.Nop()
}

func TestShipSearchPath(t *testing.T) {
	t.Parallel()
	got := shipSearchPath("9304605")
	want := "/api/units/shipsearch/9304605?page=1&pageSize=50&sortColumn=name&sortDir=ASC"
	if got != want {
		t.Fatalf("shipSearchPath() = %q, want %q", got, want)
	}
}

func TestPickShipSearchVessel(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		resp shipSearchResponse
		imo  string
		want string
	}{
		{
			name: "data array exact imo match",
			resp: shipSearchResponse{Data: []map[string]any{
				{"imo": "1111111", "name": "OTHER"},
				{"imo": 9304605, "name": "TARGET"},
			}},
			imo:  "9304605",
			want: "TARGET",
		},
		{
			name: "items fallback first row",
			resp: shipSearchResponse{Items: []map[string]any{{"imo": 9304605, "name": "ONLY"}}},
			imo:  "9304605",
			want: "ONLY",
		},
		{
			name: "empty",
			resp: shipSearchResponse{},
			imo:  "9304605",
			want: "",
		},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := pickShipSearchVessel(tc.resp, tc.imo)
			if tc.want == "" {
				if got != nil {
					t.Fatalf("expected nil, got %#v", got)
				}
				return
			}
			if got == nil || got["name"] != tc.want {
				t.Fatalf("pickShipSearchVessel() = %#v, want name %q", got, tc.want)
			}
		})
	}
}

func TestGetVesselByIMO_shipsearch(t *testing.T) {
	t.Parallel()

	const imo = "9304605"
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-token" {
			t.Errorf("Authorization = %q", r.Header.Get("Authorization"))
		}
		if r.Header.Get("app") != "web" {
			t.Errorf("app = %q", r.Header.Get("app"))
		}
		if r.Header.Get("Origin") == "" {
			t.Error("missing Origin header")
		}
		if !strings.HasPrefix(r.URL.Path, "/api/units/shipsearch/"+imo) {
			t.Fatalf("path = %q", r.URL.Path)
		}
		if got := r.URL.Query().Get("pageSize"); got != "50" {
			t.Fatalf("pageSize = %q", got)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": []map[string]any{{
				"id":             "unit-9304605",
				"imo":            9304605,
				"name":           "TEST TANKER",
				"flag":           "LR",
				"vesselType":     "Oil/Chemical Tanker",
				"grossTonnage":   28500,
				"deadweightTons": 45800,
				"yearBuilt":      2005,
				"ownerId":        "company-99",
				"ownerName":      "Example Owner Ltd",
			}},
			"totalCount": 1,
		})
	}))
	defer api.Close()

	svc := &Service{
		baseURL:    api.URL,
		authMode:   AuthManual,
		tokenProv:  &staticTokenProvider{bearer: "test-token"},
		httpClient: api.Client(),
		log:        testLogger(),
	}

	raw, err := svc.GetVesselByIMO(context.Background(), imo)
	if err != nil {
		t.Fatalf("GetVesselByIMO: %v", err)
	}
	profile := parseVesselProfile(raw, imo)
	if profile.Name != "TEST TANKER" {
		t.Fatalf("name = %q", profile.Name)
	}
	if profile.ShipVaultVesselID != "unit-9304605" {
		t.Fatalf("id = %q", profile.ShipVaultVesselID)
	}
	if profile.OwnerCompanyID != "company-99" || profile.OwnerName != "Example Owner Ltd" {
		t.Fatalf("owner = %#v", profile)
	}
	if profile.VesselClass != "Oil/Chemical Tanker" || profile.BuildYear != 2005 {
		t.Fatalf("class/year = %q %d", profile.VesselClass, profile.BuildYear)
	}
}

func TestGetVesselByIMO_shipsearchRealShape(t *testing.T) {
	t.Parallel()

	const imo = "9304605"
	// Captured from ShipVault GET /api/units/shipsearch/9304605 (text/plain top-level array).
	const fixture = `[{"id":120202,"parentname":"MINERVA SYMPHONY","name":"MT MINERVA SYMPHONY","thumbnailuri":null,"status":"ACTIVE","groupname":"CRUDE OIL TANKER","parentid":120202,"imo":9304605,"built":2006,"owner":"MINERVA MARINE","tdw":159450,"gt":83722,"flag":"GRC","value":37377989}]`

	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		_, _ = w.Write([]byte(fixture))
	}))
	defer api.Close()

	svc := &Service{
		baseURL:    api.URL,
		authMode:   AuthManual,
		tokenProv:  &staticTokenProvider{bearer: "test-token"},
		httpClient: api.Client(),
		log:        testLogger(),
	}

	raw, err := svc.GetVesselByIMO(context.Background(), imo)
	if err != nil {
		t.Fatalf("GetVesselByIMO: %v", err)
	}
	profile := parseVesselProfile(raw, imo)
	if profile.Name != "MT MINERVA SYMPHONY" {
		t.Fatalf("name = %q", profile.Name)
	}
	if profile.ShipVaultVesselID != "120202" {
		t.Fatalf("id = %q", profile.ShipVaultVesselID)
	}
	if profile.OwnerName != "MINERVA MARINE" {
		t.Fatalf("owner = %q", profile.OwnerName)
	}
	if profile.VesselClass != "CRUDE OIL TANKER" || profile.BuildYear != 2006 {
		t.Fatalf("class/year = %q %d", profile.VesselClass, profile.BuildYear)
	}
	if profile.GrossTonnage != 83722 || profile.DeadweightTons != 159450 {
		t.Fatalf("tonnage = gt %v dwt %v", profile.GrossTonnage, profile.DeadweightTons)
	}
	if profile.EstimatedValueUSD != 37377989 {
		t.Fatalf("value = %v", profile.EstimatedValueUSD)
	}
}

func TestGetVesselByIMO_shipsearchEmpty(t *testing.T) {
	t.Parallel()

	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"data": []any{}, "totalCount": 0})
	}))
	defer api.Close()

	svc := &Service{
		baseURL:    api.URL,
		authMode:   AuthManual,
		tokenProv:  &staticTokenProvider{bearer: "test-token"},
		httpClient: api.Client(),
		log:        testLogger(),
	}

	_, err := svc.GetVesselByIMO(context.Background(), "9304605")
	if err == nil || !strings.Contains(err.Error(), "shipvault 404") {
		t.Fatalf("expected 404-style error, got %v", err)
	}
}

func TestGetVesselByIMO_networkError(t *testing.T) {
	t.Parallel()

	svc := &Service{
		baseURL:    "http://127.0.0.1:1",
		authMode:   AuthManual,
		tokenProv:  &staticTokenProvider{bearer: "test-token"},
		httpClient: &http.Client{Timeout: 0},
		log:        testLogger(),
	}

	_, err := svc.GetVesselByIMO(context.Background(), "9304605")
	if err == nil {
		t.Fatal("expected error")
	}
	if !strings.Contains(err.Error(), "shipvault upstream unavailable") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestParseShipSearchPayload(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		raw  string
		want string
	}{
		{
			name: "data array",
			raw:  `{"data":[{"imo":9304605,"name":"ALPHA"}],"totalCount":1}`,
			want: "ALPHA",
		},
		{
			name: "nested data items",
			raw:  `{"data":{"items":[{"imo":"9304605","name":"BETA"}]}}`,
			want: "BETA",
		},
		{
			name: "single vessel object",
			raw:  `{"imo":9304605,"name":"GAMMA","id":"v-1"}`,
			want: "GAMMA",
		},
		{
			name: "top-level array shipsearch",
			raw:  `[{"id":120202,"name":"MT MINERVA SYMPHONY","imo":9304605,"groupname":"CRUDE OIL TANKER","owner":"MINERVA MARINE","built":2006}]`,
			want: "MT MINERVA SYMPHONY",
		},
		{
			name: "empty object body",
			raw:  `{}`,
			want: "",
		},
		{
			name: "empty",
			raw:  `[]`,
			want: "",
		},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			resp := parseShipSearchPayload(json.RawMessage(tc.raw))
			got := pickShipSearchVessel(resp, "9304605")
			if tc.want == "" {
				if got != nil {
					t.Fatalf("expected nil, got %#v", got)
				}
				return
			}
			if got == nil || got["name"] != tc.want {
				t.Fatalf("got %#v, want name %q", got, tc.want)
			}
		})
	}
}

func TestParseVesselProfile_nestedOwner(t *testing.T) {
	t.Parallel()
	raw := map[string]any{
		"id":   "v1",
		"name": "NESTED OWNER SHIP",
		"registeredOwner": map[string]any{
			"id":   "co-7",
			"name": "Nested Owner SA",
		},
	}
	v := parseVesselProfile(raw, "1234567")
	if v.OwnerCompanyID != "co-7" || v.OwnerName != "Nested Owner SA" {
		t.Fatalf("owner = %#v", v)
	}
}
