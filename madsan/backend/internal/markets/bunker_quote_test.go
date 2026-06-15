package markets

import (
	"testing"
	"time"
)

func TestBuildBunkerVLSFODerivedFromBrent(t *testing.T) {
	q := buildBunkerVLSFOQuote(bunkerQuoteInput{brentPrice: 80, brentAvailable: true, brentTier: tierEIAOpenData}, time.Now().UTC())
	if q.Tier != tierDerivedOpen {
		t.Fatalf("tier %q", q.Tier)
	}
	want := 80*barrelsPerMTFuelOil + vlsfoCrackSpreadUSD
	if q.Price < want-0.01 || q.Price > want+0.01 {
		t.Fatalf("price %v want ~%v", q.Price, want)
	}
}
