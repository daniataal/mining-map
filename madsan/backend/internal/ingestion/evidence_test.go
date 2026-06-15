package ingestion

import "testing"

func TestClaimsForBunkerSupplier(t *testing.T) {
	lat, lng := 25.0, 55.0
	rec := NormalizedRecord{
		EntityType:  "company",
		Name:        "Test Bunker Co",
		CountryCode: "AE",
		Latitude:    &lat,
		Longitude:   &lng,
		Commodities: []string{"vlsfo"},
		SourceSlug:  "bunker_seed",
		RawPayload: map[string]any{
			"phone":         "+971123",
			"register_tier": "official_register",
			"source_url":    "https://example.gov/register",
		},
	}
	claims := claimsForRecord(rec)
	if len(claims) < 5 {
		t.Fatalf("expected multiple claims, got %d", len(claims))
	}
	found := map[string]bool{}
	for _, c := range claims {
		found[c.Type] = true
	}
	for _, want := range []string{"name", "country_code", "coordinates", "phone", "source_url", "register_tier", "commodities"} {
		if !found[want] {
			t.Fatalf("missing claim %s", want)
		}
	}
}
