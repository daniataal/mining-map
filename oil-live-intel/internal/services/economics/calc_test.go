package economics

import "testing"

func TestComputeComplete(t *testing.T) {
	vol := 100000.0
	buy := 72.0
	sell := 78.0
	freight := 500000.0
	r := Compute(Sheet{
		VolumeBBL: &vol, BuyPriceUSDPerBBL: &buy, SellPriceUSDPerBBL: &sell, FreightUSD: &freight,
	})
	if !r.Complete {
		t.Fatalf("expected complete: %+v", r)
	}
	if *r.IndicativeMarginUSD <= 0 {
		t.Fatalf("expected positive margin, got %v", *r.IndicativeMarginUSD)
	}
}

func TestComputeMissing(t *testing.T) {
	r := Compute(Sheet{})
	if r.Complete || len(r.MissingFields) == 0 {
		t.Fatal("expected missing fields")
	}
}
