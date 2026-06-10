package mcr

import "testing"

func TestEstimateBarrels(t *testing.T) {
	bbl, ok := EstimateBarrels(100000, 2, 20)
	if !ok || bbl <= 0 {
		t.Fatalf("expected positive barrels, got %v ok=%v", bbl, ok)
	}
	_, ok = EstimateBarrels(0, 2, 20)
	if ok {
		t.Fatal("zero DWT should not estimate")
	}
}
