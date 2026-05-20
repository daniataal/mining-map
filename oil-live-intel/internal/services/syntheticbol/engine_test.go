package syntheticbol

import "testing"

func TestInferCommodityFamily(t *testing.T) {
	crude := true
	if got := inferCommodityFamily([]string{"crude_oil"}, &crude, nil); got != "crude_oil" {
		t.Fatalf("expected crude_oil, got %s", got)
	}
	if got := inferCommodityFamily([]string{"sulfur"}, nil, nil); got != "sulfur" {
		t.Fatalf("expected sulfur, got %s", got)
	}
}

func TestFingerprintStable(t *testing.T) {
	a := fingerprint("A", "test")
	b := fingerprint("A", "test")
	if a != b || len(a) < 8 {
		t.Fatalf("unstable: %s %s", a, b)
	}
}

func TestCorridorFingerprintDistinct(t *testing.T) {
	exportPC := "11111111-1111-1111-1111-111111111111"
	importPC := "22222222-2222-2222-2222-222222222222"
	a := fingerprint(RecipeCorridor, exportPC, importPC)
	b := fingerprint(RecipeCorridor, exportPC, "33333333-3333-3333-3333-333333333333")
	if a == b {
		t.Fatal("corridor fingerprints should differ for different import port calls")
	}
}

func TestHsForFamily(t *testing.T) {
	if hsForFamily("crude_oil") != "2709" {
		t.Fatalf("crude hs")
	}
	if hsForFamily("sulfur") != "2802" {
		t.Fatalf("sulfur hs")
	}
}
