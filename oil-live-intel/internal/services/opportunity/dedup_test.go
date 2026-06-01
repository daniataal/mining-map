package opportunity

import "testing"

func TestDedupeAndDiversify_collapsesSameTerminal(t *testing.T) {
	items := []map[string]any{
		{"id": "a", "opportunity_type": "possible_cargo_flip", "terminal_id": "t1", "terminal_country": "Saudi Arabia", "title": "Possible short-haul flip at Ras Tanura", "confidence": 0.7},
		{"id": "b", "opportunity_type": "possible_cargo_flip", "terminal_id": "t1", "terminal_country": "Saudi Arabia", "title": "Possible short-haul flip at Ras Tanura", "confidence": 0.9},
		{"id": "c", "opportunity_type": "possible_cargo_flip", "terminal_id": "t2", "terminal_country": "UAE", "title": "Possible short-haul flip at Fujairah", "confidence": 0.8},
	}
	out := DedupeAndDiversify(items, 10)
	if len(out) != 2 {
		t.Fatalf("expected 2 diverse rows, got %d", len(out))
	}
	if itemID(out[0]) != "b" {
		t.Fatalf("expected highest conf for t1, got %s", itemID(out[0]))
	}
}

func TestDedupeAndDiversify_titleFingerprintWithoutTerminal(t *testing.T) {
	items := []map[string]any{
		{"id": "a", "opportunity_type": "x", "title": "Foo Bar", "confidence": 0.6},
		{"id": "b", "opportunity_type": "x", "title": "foo bar", "confidence": 0.8},
	}
	out := DedupeAndDiversify(items, 5)
	if len(out) != 1 || itemID(out[0]) != "b" {
		t.Fatalf("expected single deduped row b, got %#v", out)
	}
}
