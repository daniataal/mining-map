package ingestion

import "testing"

func TestPayloadHelpers(t *testing.T) {
	m := map[string]any{
		"imo":   " 1234567 ",
		"force": true,
		"asset_id": "abc",
	}
	if got := payloadString(m, "imo"); got != "1234567" {
		t.Fatalf("imo = %q", got)
	}
	if !payloadBool(m, "force") {
		t.Fatal("expected force true")
	}
	if payloadString(m, "missing") != "" {
		t.Fatal("expected empty missing key")
	}
}
