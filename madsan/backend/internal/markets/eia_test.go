package markets

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestFetchEIADailySpots(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v2/petroleum/pri/spt/data/" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"response": {
				"data": [
					{"series":"RWTC","period":"2026-06-01","value":95.96},
					{"series":"RWTC","period":"2026-05-29","value":91.16},
					{"series":"RBRTE","period":"2026-06-01","value":98.29},
					{"series":"RBRTE","period":"2026-05-29","value":92.88}
				]
			}
		}`))
	}))
	defer srv.Close()

	oldBase := eiaAPIBase
	eiaAPIBase = srv.URL + "/v2"
	t.Cleanup(func() { eiaAPIBase = oldBase })

	spots, err := fetchEIADailySpots(srv.Client(), "test-key")
	if err != nil {
		t.Fatal(err)
	}
	if len(spots) != 2 {
		t.Fatalf("expected 2 series, got %d", len(spots))
	}
	wti := spots["RWTC"]
	if wti.Price != 95.96 {
		t.Fatalf("wti price %v", wti.Price)
	}
	if wti.ChangePct == nil {
		t.Fatal("expected wti change pct")
	}
}

func TestHandlerEIAOpenData(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"response": {
				"data": [
					{"series":"RWTC","period":"2026-06-01","value":95.96},
					{"series":"RWTC","period":"2026-05-29","value":91.16}
				]
			}
		}`))
	}))
	defer srv.Close()

	oldBase := eiaAPIBase
	eiaAPIBase = srv.URL + "/v2"
	t.Cleanup(func() { eiaAPIBase = oldBase })

	h := NewHandler("test-key")
	h.client = srv.Client()

	quotes, tier, _ := h.buildQuotes(mustParseTime(t, "2026-06-09T12:00:00Z"))
	if tier != tierEIAOpenData {
		t.Fatalf("tier %q", tier)
	}
	if len(quotes) < 3 {
		t.Fatalf("expected mixed quotes, got %d", len(quotes))
	}
	if quotes[0].Tier != tierEIAOpenData {
		t.Fatalf("first quote tier %q", quotes[0].Tier)
	}
	if quotes[len(quotes)-1].Tier != tierReferenceStub {
		t.Fatalf("gold tier %q", quotes[len(quotes)-1].Tier)
	}
}

func TestHandlerReferenceStubWithoutKey(t *testing.T) {
	h := NewHandler("")
	quotes, tier, disclaimer := h.buildQuotes(mustParseTime(t, "2026-06-09T12:00:00Z"))
	if tier != tierReferenceStub {
		t.Fatalf("tier %q", tier)
	}
	if len(quotes) != 4 {
		t.Fatalf("expected 4 quotes, got %d", len(quotes))
	}
	for _, q := range quotes {
		if q.Tier != tierReferenceStub {
			t.Fatalf("quote %s tier %q", q.Symbol, q.Tier)
		}
	}
	if disclaimer == "" {
		t.Fatal("expected disclaimer")
	}
}

func mustParseTime(t *testing.T, raw string) (tm time.Time) {
	t.Helper()
	var err error
	tm, err = time.Parse(time.RFC3339, raw)
	if err != nil {
		t.Fatal(err)
	}
	return tm
}
