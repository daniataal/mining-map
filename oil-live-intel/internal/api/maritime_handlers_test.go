package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/mining-map/oil-live-intel/internal/services/maritimecontext"
)

func TestMaritimeContextHandlerJSONArrayFields(t *testing.T) {
	s := &Server{}
	req := httptest.NewRequest(http.MethodGet, "/api/oil-live/maritime/context?commodity=diesel&country=UAE", nil)
	w := httptest.NewRecorder()
	s.MaritimeContext(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status %d body %s", w.Code, w.Body.String())
	}
	assertJSONArrayFieldsNeverNull(t, w.Body.Bytes(), []string{
		"source_labels",
		"company_links",
		"nearest_ports",
		"evidence",
		"relationships",
		"counterparty_proxies",
		"limitations",
	})
}

func TestBuildContextDirectJSONArrayFields(t *testing.T) {
	ctx := maritimecontext.BuildContext(maritimecontext.ContextInput{Commodity: "diesel"})
	b, err := json.Marshal(ctx)
	if err != nil {
		t.Fatal(err)
	}
	assertJSONArrayFieldsNeverNull(t, b, []string{
		"source_labels",
		"company_links",
		"nearest_ports",
		"evidence",
		"relationships",
		"counterparty_proxies",
		"limitations",
	})
}

func TestParseEvidenceListEmptyNotNull(t *testing.T) {
	got := parseEvidenceList(nil)
	if got == nil {
		t.Fatal("expected non-nil empty slice")
	}
	b, err := json.Marshal(map[string]any{"evidence": got})
	if err != nil {
		t.Fatal(err)
	}
	if string(b) != `{"evidence":[]}` {
		t.Fatalf("unexpected JSON: %s", string(b))
	}
}

func TestNonNilMapSliceJSON(t *testing.T) {
	b, err := json.Marshal(map[string]any{"items": nonNilMapSlice(nil)})
	if err != nil {
		t.Fatal(err)
	}
	if string(b) != `{"items":[]}` {
		t.Fatalf("unexpected JSON: %s", string(b))
	}
}

func assertJSONArrayFieldsNeverNull(t *testing.T, body []byte, fields []string) {
	t.Helper()
	var parsed map[string]json.RawMessage
	if err := json.Unmarshal(body, &parsed); err != nil {
		t.Fatal(err)
	}
	for _, field := range fields {
		raw, ok := parsed[field]
		if !ok {
			t.Fatalf("missing field %q", field)
		}
		if string(raw) == "null" {
			t.Fatalf("field %q serialized as null", field)
		}
		if len(raw) == 0 || raw[0] != '[' {
			t.Fatalf("field %q expected JSON array, got %s", field, string(raw))
		}
	}
}
