package compliance

import "testing"

func TestEvaluateDealEmbargo(t *testing.T) {
	ev, err := EvaluateDeal(DealContext{
		Commodity:     "VLSFO",
		SellerCountry: "Iran",
		BuyerCountry:  "UAE",
		Location:      "Fujairah",
	})
	if err != nil {
		t.Fatal(err)
	}
	if ev.Recommendation != "block" {
		t.Fatalf("expected block, got %s", ev.Recommendation)
	}
}

func TestCommodityFamily(t *testing.T) {
	if CommodityFamily("EN590 diesel") != "oil" {
		t.Fatal("expected oil")
	}
}
