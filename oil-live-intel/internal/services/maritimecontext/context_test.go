package maritimecontext

import (
	"encoding/json"
	"testing"
)

func TestBuildContextJSONArrayFieldsNeverNull(t *testing.T) {
	// Minimal input: no Wikidata match, no GDELT anchor, no UN/LOCODE cache loaded.
	ctx := BuildContext(ContextInput{Commodity: "diesel"})
	b, err := json.Marshal(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var parsed map[string]json.RawMessage
	if err := json.Unmarshal(b, &parsed); err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{
		"source_labels",
		"company_links",
		"nearest_ports",
		"evidence",
		"relationships",
		"counterparty_proxies",
		"limitations",
	} {
		raw, ok := parsed[field]
		if !ok {
			t.Fatalf("missing field %q", field)
		}
		if string(raw) == "null" {
			t.Fatalf("field %q serialized as null", field)
		}
		if raw[0] != '[' {
			t.Fatalf("field %q expected JSON array, got %s", field, string(raw))
		}
	}
}

func TestBuildMaritimeRelationshipsSkipsNilOwnerOperator(t *testing.T) {
	identity := map[string]any{
		"owner":    nil,
		"operator": nil,
	}
	rels := buildMaritimeRelationships(identity, "Test Vessel", "9310393", "241799000")
	if len(rels) != 0 {
		t.Fatalf("expected no relationships for nil owner/operator, got %d", len(rels))
	}
}

func TestBuildMaritimeRelationshipsIncludesOwner(t *testing.T) {
	identity := map[string]any{
		"owner":        "Acme Shipping Ltd",
		"operator":     nil,
		"source_label": "Wikidata",
		"source_url":   "https://query.wikidata.org/",
		"confidence":   0.8,
		"matched_by":   "imo",
	}
	rels := buildMaritimeRelationships(identity, "Test Vessel", "9310393", "241799000")
	if len(rels) != 1 {
		t.Fatalf("expected 1 relationship, got %d", len(rels))
	}
	if rels[0]["target_name"] != "Acme Shipping Ltd" {
		t.Fatalf("target_name = %v", rels[0]["target_name"])
	}
}

func TestEnsureMapSlice(t *testing.T) {
	if got := ensureMapSlice(nil); got == nil || len(got) != 0 {
		t.Fatalf("expected empty non-nil slice, got %#v", got)
	}
}

func TestEnsureStringSlice(t *testing.T) {
	if got := ensureStringSlice(nil); got == nil || len(got) != 0 {
		t.Fatalf("expected empty non-nil slice, got %#v", got)
	}
}
