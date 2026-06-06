package cache

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/rs/zerolog"
)

func TestBuildKeySortsQueryParams(t *testing.T) {
	q := url.Values{}
	q.Set("b", "2")
	q.Set("a", "1")
	q.Add("a", "3")

	got := BuildKey("GET", "/api/oil-live/map/country-borders", q)
	want := "GET /api/oil-live/map/country-borders?a=1&a=3&b=2"
	if got != want {
		t.Fatalf("BuildKey() = %q, want %q", got, want)
	}
}

func TestTTLForPath(t *testing.T) {
	cases := map[string]time.Duration{
		"/api/oil-live/maritime/stats":              30 * time.Second,
		"/api/oil-live/licenses/country-summary":    120 * time.Second,
		"/api/oil-live/map/country-borders":         120 * time.Second,
		"/api/oil-live/sanctions/country-summary":   120 * time.Second,
		"/api/oil-live/intelligence/country/Brazil": 120 * time.Second,
		"/api/oil-live/vessels/live":                0,
	}
	for path, want := range cases {
		if got := TTLForPath(path); got != want {
			t.Errorf("TTLForPath(%q) = %v, want %v", path, got, want)
		}
	}
}

func TestCacheDisabledWhenURLUnset(t *testing.T) {
	c := New("", zerolog.Nop())
	if c.Enabled() {
		t.Fatal("expected cache disabled with empty URL")
	}
	if got := c.Get(context.Background(), "k"); got != nil {
		t.Fatalf("Get on disabled cache should return nil, got %+v", got)
	}
	// Set must not panic when disabled.
	c.Set(context.Background(), "k", Entry{StatusCode: 200, Body: []byte(`{}`)}, time.Minute)
}

func TestCacheFailOpenOnInvalidURL(t *testing.T) {
	c := New("not-a-valid-redis-url", zerolog.Nop())
	if c.Enabled() {
		t.Fatal("expected cache disabled for invalid URL")
	}
}

func TestMiddlewarePassesThroughWhenDisabled(t *testing.T) {
	c := New("", zerolog.Nop())
	called := false
	h := c.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(200)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	req := httptest.NewRequest("GET", "/api/oil-live/maritime/stats", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if !called {
		t.Fatal("handler not called when cache disabled")
	}
	if rec.Code != 200 {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
}

func TestEncodeDecodeEntry(t *testing.T) {
	in := Entry{
		StatusCode:   200,
		CacheControl: "public, max-age=120",
		Body:         []byte(`{"countries":[]}`),
	}
	data, err := encodeEntry(in)
	if err != nil {
		t.Fatal(err)
	}
	var out Entry
	if err := decodeEntry(data, &out); err != nil {
		t.Fatal(err)
	}
	if out.StatusCode != in.StatusCode || out.CacheControl != in.CacheControl || string(out.Body) != string(in.Body) {
		t.Fatalf("round-trip mismatch: %+v vs %+v", out, in)
	}
}
