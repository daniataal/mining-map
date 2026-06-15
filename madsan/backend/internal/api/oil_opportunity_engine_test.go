package api

import "testing"

func TestIntelBenchmarkHintsForLPGUseOilProductProxy(t *testing.T) {
	productHints, benchmarkHints := intelBenchmarkHints("LPG")
	if len(productHints) != 1 || productHints[0] != "CRUDEOIL" {
		t.Fatalf("product hints = %#v, want only CRUDEOIL", productHints)
	}
	want := []string{"BRENT", "WB_CRUDE_AVG", "WTI", "WB_DUBAI"}
	if len(benchmarkHints) != len(want) {
		t.Fatalf("benchmark hints = %#v, want %#v", benchmarkHints, want)
	}
	for i := range want {
		if benchmarkHints[i] != want[i] {
			t.Fatalf("benchmark hint[%d] = %q, want %q; all hints %#v", i, benchmarkHints[i], want[i], benchmarkHints)
		}
	}
}
