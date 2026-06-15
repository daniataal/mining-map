package confidence

import "testing"

func TestScoreCaps(t *testing.T) {
	got := Score(95, map[string]bool{"government_source": true})
	if got != 100 {
		t.Fatalf("expected cap 100, got %v", got)
	}
	got = Score(10, map[string]bool{"sanctions_risk": true})
	if got != 0 {
		t.Fatalf("expected floor 0, got %v", got)
	}
}

func TestStatusBands(t *testing.T) {
	if Status(85) != "verified" {
		t.Fatal("expected verified")
	}
	if Status(55) != "partially_verified" {
		t.Fatal("expected partially_verified")
	}
}
