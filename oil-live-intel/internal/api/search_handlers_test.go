package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/mining-map/oil-live-intel/internal/services/search"
)

// stubSearchClient implements search.Client and lets each test inject the
// behaviour it wants — useful for asserting the API contract without a real
// Elasticsearch cluster.
type stubSearchClient struct {
	searchCalls []searchCall
	searchFunc  func(ctx context.Context, index string, body any) (*search.SearchResponse, error)
	pingErr     error
	counts      map[string]int64
}

type searchCall struct {
	Index string
	Body  any
}

func (s *stubSearchClient) Ping(ctx context.Context) error { return s.pingErr }

func (s *stubSearchClient) Search(ctx context.Context, index string, body any) (*search.SearchResponse, error) {
	s.searchCalls = append(s.searchCalls, searchCall{Index: index, Body: body})
	if s.searchFunc != nil {
		return s.searchFunc(ctx, index, body)
	}
	return &search.SearchResponse{}, nil
}

func (s *stubSearchClient) Bulk(ctx context.Context, body io.Reader) (*search.BulkResponse, error) {
	return &search.BulkResponse{}, nil
}

func (s *stubSearchClient) IndexExists(ctx context.Context, index string) (bool, error) {
	return true, nil
}

func (s *stubSearchClient) CreateIndex(ctx context.Context, index string, body any) error {
	return nil
}

func (s *stubSearchClient) Count(ctx context.Context, index string) (int64, error) {
	if s.counts == nil {
		return 0, nil
	}
	return s.counts[index], nil
}

func newSearchRequest(t *testing.T, q string, types string, limit int) *http.Request {
	t.Helper()
	params := url.Values{}
	if q != "" {
		params.Set("q", q)
	}
	if types != "" {
		params.Set("types", types)
	}
	if limit > 0 {
		params.Set("limit", strings.TrimSpace(itoa(limit)))
	}
	req := httptest.NewRequest(http.MethodGet, "/api/oil-live/search?"+params.Encode(), nil)
	return req
}

func itoa(n int) string {
	// avoid pulling strconv into a tiny helper.
	if n == 0 {
		return "0"
	}
	neg := false
	if n < 0 {
		neg = true
		n = -n
	}
	var buf [16]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}

func TestSearch_GracefulWhenClientNil(t *testing.T) {
	s := &Server{}
	w := httptest.NewRecorder()
	s.Search(w, newSearchRequest(t, "ras", "", 0))
	// q is non-empty → we should get the 503 + envelope.
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d", w.Code)
	}
	var body SearchResponse
	if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Error != "search_unavailable" {
		t.Errorf("error code: got %q want search_unavailable", body.Error)
	}
	if body.Hits == nil || len(body.Hits) != 0 {
		t.Errorf("Hits must be empty non-nil slice, got %v", body.Hits)
	}
	if body.Total != 0 {
		t.Errorf("Total: got %d want 0", body.Total)
	}
}

func TestSearch_EmptyQueryReturnsEmptyEnvelope(t *testing.T) {
	s := &Server{SearchClient: &stubSearchClient{}}
	w := httptest.NewRecorder()
	s.Search(w, newSearchRequest(t, "", "", 0))
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	var body SearchResponse
	if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(body.Hits) != 0 {
		t.Errorf("expected zero hits, got %d", len(body.Hits))
	}
}

func TestSearch_DispatchesPerType_AndShapesResponse(t *testing.T) {
	stub := &stubSearchClient{
		searchFunc: func(ctx context.Context, index string, body any) (*search.SearchResponse, error) {
			res := &search.SearchResponse{}
			res.Hits.Total.Value = 1
			switch index {
			case search.IndexCargo:
				res.Hits.Hits = []struct {
					ID     string          `json:"_id"`
					Index  string          `json:"_index"`
					Score  float64         `json:"_score"`
					Source json.RawMessage `json:"_source"`
				}{
					{ID: "cargo-1", Index: search.IndexCargo, Score: 1.5, Source: json.RawMessage(`{"shipper_name":"Acme"}`)},
				}
			case search.IndexCompanies:
				res.Hits.Hits = []struct {
					ID     string          `json:"_id"`
					Index  string          `json:"_index"`
					Score  float64         `json:"_score"`
					Source json.RawMessage `json:"_source"`
				}{
					{ID: "co-1", Index: search.IndexCompanies, Score: 2.0, Source: json.RawMessage(`{"name":"Acme Oil"}`)},
				}
			}
			return res, nil
		},
	}
	s := &Server{SearchClient: stub}
	w := httptest.NewRecorder()
	s.Search(w, newSearchRequest(t, "acme", "cargo,company", 5))
	if w.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	var body SearchResponse
	if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Query != "acme" {
		t.Errorf("Query: %q want %q", body.Query, "acme")
	}
	if body.Total != 2 {
		t.Errorf("Total: %d want 2", body.Total)
	}
	if len(body.Hits) != 2 {
		t.Fatalf("Hits: %d want 2", len(body.Hits))
	}
	// Score-desc means the company hit (2.0) comes first.
	if body.Hits[0].Type != "company" || body.Hits[0].ID != "co-1" {
		t.Errorf("first hit should be company/co-1, got %+v", body.Hits[0])
	}
	if body.Hits[1].Type != "cargo" || body.Hits[1].ID != "cargo-1" {
		t.Errorf("second hit should be cargo/cargo-1, got %+v", body.Hits[1])
	}
	// Both indices should have been queried with the per-type fields.
	wantedIndices := map[string]bool{search.IndexCargo: false, search.IndexCompanies: false}
	for _, c := range stub.searchCalls {
		wantedIndices[c.Index] = true
	}
	for idx, called := range wantedIndices {
		if !called {
			t.Errorf("expected search call to %s", idx)
		}
	}
	// types=cargo,company means we should NOT have hit terminals/vessels.
	for _, c := range stub.searchCalls {
		if c.Index == search.IndexTerminals || c.Index == search.IndexVessels {
			t.Errorf("unexpected search call to %s when types=cargo,company", c.Index)
		}
	}
}

func TestSearch_503WhenAllShardsFail(t *testing.T) {
	stub := &stubSearchClient{
		searchFunc: func(ctx context.Context, index string, body any) (*search.SearchResponse, error) {
			return nil, errors.New("connection refused")
		},
	}
	s := &Server{SearchClient: stub}
	w := httptest.NewRecorder()
	s.Search(w, newSearchRequest(t, "acme", "", 0))
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503 when all shards fail, got %d body=%s", w.Code, w.Body.String())
	}
	var body SearchResponse
	if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Error != "search_unavailable" {
		t.Errorf("expected error=search_unavailable, got %q", body.Error)
	}
	if len(body.Hits) != 0 {
		t.Errorf("expected empty hits on 503, got %d", len(body.Hits))
	}
}

func TestSearchHealth_ReturnsCountsWhenES_Up(t *testing.T) {
	stub := &stubSearchClient{counts: map[string]int64{
		search.IndexCargo:     12,
		search.IndexCompanies: 3,
		search.IndexTerminals: 4,
		search.IndexVessels:   8,
	}}
	s := &Server{SearchClient: stub}
	req := httptest.NewRequest(http.MethodGet, "/api/oil-live/search/health", nil)
	w := httptest.NewRecorder()
	s.SearchHealthHandler(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status=%d", w.Code)
	}
	var body SearchHealth
	if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Status != "ok" {
		t.Errorf("status: %q want ok", body.Status)
	}
	if body.Indices[search.IndexCargo] != 12 || body.Indices[search.IndexCompanies] != 3 {
		t.Errorf("counts not surfaced: %+v", body.Indices)
	}
}

func TestSearchHealth_UnavailableWhenPingFails(t *testing.T) {
	stub := &stubSearchClient{pingErr: errors.New("nope")}
	s := &Server{SearchClient: stub}
	req := httptest.NewRequest(http.MethodGet, "/api/oil-live/search/health", nil)
	w := httptest.NewRecorder()
	s.SearchHealthHandler(w, req)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d", w.Code)
	}
	var body SearchHealth
	if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Status != "unavailable" {
		t.Errorf("status: %q want unavailable", body.Status)
	}
}

func TestSearchHealth_UnavailableWhenClientNil(t *testing.T) {
	s := &Server{}
	req := httptest.NewRequest(http.MethodGet, "/api/oil-live/search/health", nil)
	w := httptest.NewRecorder()
	s.SearchHealthHandler(w, req)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503 when client nil, got %d", w.Code)
	}
}
