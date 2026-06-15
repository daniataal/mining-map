package markets

import (
	"testing"
	"time"
)

func TestEIASpotSeriesMeta(t *testing.T) {
	if len(eiaSpotSeries) < 2 {
		t.Fatal("expected WTI and Brent series")
	}
	wti := eiaSpotSeries["RWTC"]
	if wti.Symbol != "WTI" {
		t.Fatalf("wti symbol %q", wti.Symbol)
	}
	_ = time.Now() // package compiles with time import from eia.go shared
}
