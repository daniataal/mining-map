package markets

import (
	"testing"
	"time"
)

func TestBunkerVLSFOQuoteHonestStub(t *testing.T) {
	q := bunkerVLSFOQuote(mustParseTime(t, "2026-06-09T12:00:00Z"))
	if q.Symbol != "VLSFO_SG" {
		t.Fatalf("symbol %q", q.Symbol)
	}
	if q.Tier != tierReferenceStub {
		t.Fatalf("tier %q", q.Tier)
	}
	if q.Price != vlsfoReferenceUSDMT {
		t.Fatalf("price %v", q.Price)
	}
	if q.ChangePct != nil {
		t.Fatal("expected no fake change_pct on bunker stub")
	}
	if q.Disclaimer == "" {
		t.Fatal("expected disclaimer")
	}
	meta := loadBunkerSeedMeta()
	if meta.Loaded {
		if meta.SupplierCount < 200 || meta.HubCount < 10 {
			t.Fatalf("unexpected seed counts: %+v", meta)
		}
		if q.Disclaimer == "" || len(q.Disclaimer) < 40 {
			t.Fatalf("expected seed-grounded disclaimer, got %q", q.Disclaimer)
		}
	}
}

func TestHandlerIncludesBunkerVLSFOStub(t *testing.T) {
	h := NewHandler("")
	quotes, tier, disclaimer := h.buildQuotes(time.Now().UTC())
	if tier != tierReferenceStub {
		t.Fatalf("tier %q", tier)
	}
	var vlsfo *Quote
	for i := range quotes {
		if quotes[i].Symbol == "VLSFO_SG" {
			vlsfo = &quotes[i]
			break
		}
	}
	if vlsfo == nil {
		t.Fatal("missing VLSFO_SG quote")
	}
	if vlsfo.Tier != tierReferenceStub && vlsfo.Tier != tierDerivedOpen {
		t.Fatalf("vlsfo tier %q", vlsfo.Tier)
	}
	if disclaimer == "" {
		t.Fatal("expected top-level disclaimer")
	}
}
