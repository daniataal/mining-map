package markets

import (
	"testing"
	"time"
)

func TestBenchmarkSymbol(t *testing.T) {
	cases := map[string]string{
		"VLSFO":          "VLSFO_SG",
		"EN590 diesel":   "VLSFO_SG",
		"Jet A-1":        "VLSFO_SG",
		"Brent crude":    "BRENT",
		"fuel oil 380":   "BRENT",
		"WTI Midland":    "WTI",
		"Gold (AU)":      "GOLD",
		"Copper cathode": "",
	}
	for commodity, want := range cases {
		if got := BenchmarkSymbol(commodity); got != want {
			t.Fatalf("BenchmarkSymbol(%q) = %q, want %q", commodity, got, want)
		}
	}
}

func TestPriceComparable(t *testing.T) {
	if !PriceComparable("Brent crude", "bbl") {
		t.Fatal("bbl crude should be comparable")
	}
	if !PriceComparable("VLSFO", "MT") {
		t.Fatal("VLSFO MT should be comparable to VLSFO_SG benchmark")
	}
	if !PriceComparable("Gold (AU)", "oz") {
		t.Fatal("gold oz should be comparable")
	}
}

func TestLookupBenchmark(t *testing.T) {
	h := NewHandler("")
	q, ok := h.LookupBenchmark("VLSFO", time.Now().UTC())
	if !ok || q.Symbol != "VLSFO_SG" {
		t.Fatalf("lookup failed: ok=%v symbol=%q", ok, q.Symbol)
	}
}
