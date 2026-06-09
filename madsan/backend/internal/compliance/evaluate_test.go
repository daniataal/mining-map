package compliance

import "testing"

func TestEvaluateDealEmbargo(t *testing.T) {
	ev, err := EvaluateDeal(DealContext{
		Commodity:     "VLSFO",
		SellerCountry: "Iran",
		BuyerCountry:  "UAE",
		Location:      "Fujairah",
		Seller:        "Test Seller",
		Buyer:         "Test Buyer",
	})
	if err != nil {
		t.Fatal(err)
	}
	if ev.Recommendation != "block" {
		t.Fatalf("expected block, got %s", ev.Recommendation)
	}
	if ev.RulesVersion != "1.0.0" {
		t.Fatalf("rules version: %s", ev.RulesVersion)
	}
}

func TestEvaluateDealRussiaCorridor(t *testing.T) {
	ev, err := EvaluateDeal(DealContext{
		Commodity:     "crude oil",
		SellerCountry: "Russia",
		BuyerCountry:  "India",
		Seller:        "Rosneft",
		Buyer:         "Indian Oil",
	})
	if err != nil {
		t.Fatal(err)
	}
	if ev.Recommendation != "block" {
		t.Fatalf("expected block for Russia oil corridor, got %s", ev.Recommendation)
	}
}

func TestEvaluateDealConflictMineral(t *testing.T) {
	ev, err := EvaluateDeal(DealContext{
		Commodity:     "gold",
		SellerCountry: "Democratic Republic of Congo",
		BuyerCountry:  "Switzerland",
		Seller:        "DRC Miner",
		Buyer:         "Swiss Refiner",
	})
	if err != nil {
		t.Fatal(err)
	}
	if ev.Recommendation != "block" {
		t.Fatalf("expected block for DRC gold, got %s", ev.Recommendation)
	}
}

func TestEvaluateDealClean(t *testing.T) {
	ev, err := EvaluateDeal(DealContext{
		Commodity:     "VLSFO",
		SellerCountry: "Singapore",
		BuyerCountry:  "UAE",
		Location:      "Singapore",
		Seller:        "Bunker Co",
		Buyer:         "Shipping Line",
		PriceUSD:      500_000,
	})
	if err != nil {
		t.Fatal(err)
	}
	if ev.Recommendation == "block" {
		t.Fatalf("unexpected block: %+v", ev.Checks)
	}
}

func TestCommodityFamily(t *testing.T) {
	cases := map[string]string{
		"EN590 diesel": "oil",
		"LNG cargo":    "gas",
		"gold dore":    "mining",
		"VLSFO":        "oil",
	}
	for in, want := range cases {
		if got := CommodityFamily(in); got != want {
			t.Fatalf("%q: got %q want %q", in, got, want)
		}
	}
}
