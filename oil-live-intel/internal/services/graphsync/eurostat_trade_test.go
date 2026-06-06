package graphsync

import "testing"

func TestParseEurostatFlat(t *testing.T) {
	rows := parseEurostatFlat(map[string]any{
		"0": 123.45,
		"1": nil,
		"2": "bad",
	})
	if len(rows) != 1 {
		t.Fatalf("got %d rows want 1", len(rows))
	}
	if rows[0].TradeValueUSD != 123450 {
		t.Fatalf("trade value %v", rows[0].TradeValueUSD)
	}
	if rows[0].HSCode != eurostatDefaultHS {
		t.Fatalf("hs %q", rows[0].HSCode)
	}
}

func TestParseEurostatDimensional(t *testing.T) {
	payload := map[string]any{
		"id":   []any{"geo", "time"},
		"size": []any{1, 1},
		"dimension": map[string]any{
			"geo": map[string]any{
				"category": map[string]any{
					"index": map[string]any{"DE": 0},
					"label": map[string]any{"DE": "Germany"},
				},
			},
			"time": map[string]any{
				"category": map[string]any{
					"index": map[string]any{"2023": 0},
					"label": map[string]any{"2023": "2023"},
				},
			},
		},
		"value": map[string]any{"0": 10.0},
	}
	rows := parseEurostatJSON(payload)
	if len(rows) != 1 {
		t.Fatalf("got %d rows want 1", len(rows))
	}
	if rows[0].Reporter != "Germany" {
		t.Fatalf("reporter %q", rows[0].Reporter)
	}
	if rows[0].Year != 2023 {
		t.Fatalf("year %d", rows[0].Year)
	}
}

func TestEurostatM49Codes(t *testing.T) {
	r, p := eurostatM49Codes(eurostatMacroRow{
		ReporterISO2: "EU",
		Partner:      "Extra-EU",
		Dimensions:   map[string]string{"geo": "DE"},
	})
	if r != "DE" || p != "0" {
		t.Fatalf("m49 r=%q p=%q", r, p)
	}
}

func TestEurostatDimRole(t *testing.T) {
	if eurostatDimRole("geo") != "reporter" {
		t.Fatal("geo role")
	}
	if eurostatDimRole("partner") != "partner" {
		t.Fatal("partner role")
	}
}
