package api

import "testing"

func TestPortCallBolTier(t *testing.T) {
	cases := []struct {
		prov string
		want string
	}{
		{"live_ais", "live"},
		{"seed_port_calls", "synthetic"},
		{"synthetic", "synthetic"},
		{"unknown", "inferred"},
	}
	for _, tc := range cases {
		if got := portCallBolTier(tc.prov); got != tc.want {
			t.Fatalf("prov=%q: got %q want %q", tc.prov, got, tc.want)
		}
	}
}

func TestPositionBolTier(t *testing.T) {
	if got := positionBolTier("live_ais", "aisstream"); got != "live" {
		t.Fatalf("got %q", got)
	}
	if got := positionBolTier("inferred_port_call", "inferred_port_call"); got != "inferred" {
		t.Fatalf("got %q", got)
	}
}

func TestDeriveVesselPartiesDedupes(t *testing.T) {
	rows := []map[string]any{
		{
			"id": "a", "synthetic_bol_id": "MCR-1", "bol_tier": "synthetic", "data_provenance": "synthetic",
			"confidence": 0.8, "shipper_name": "Alpha Corp", "consignee_name": "Beta Ltd",
		},
		{
			"id": "b", "synthetic_bol_id": "MCR-2", "bol_tier": "inferred", "data_provenance": "inferred",
			"confidence": 0.6, "shipper_name": "Alpha Corp", "consignee_name": "Gamma Inc",
		},
	}
	parties := deriveVesselParties(rows)
	if len(parties) != 3 {
		t.Fatalf("expected 3 unique parties, got %d", len(parties))
	}
}

func TestExtractSourceLinks(t *testing.T) {
	ev := []byte(`["https://aisstream.io/vessels", "terminal geofence match"]`)
	meta := []byte(`{"source":"live_ais","source_url":"https://example.com/terminals/1"}`)
	links := extractSourceLinks(ev, meta)
	if len(links) < 2 {
		t.Fatalf("expected at least 2 links, got %d: %+v", len(links), links)
	}
}
