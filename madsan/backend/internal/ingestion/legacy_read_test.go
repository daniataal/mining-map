package ingestion

import "testing"

func TestNormalizeLegacyLicenseRow(t *testing.T) {
	rec := normalizeLegacyRow(legacyTableSpec{Table: "licenses", EntityType: "asset", AssetType: "mine"}, map[string]any{
		"id": 42, "company": "Acme Mining", "country": "zm", "commodity": "copper",
		"sector": "mining", "latitude": -12.5, "longitude": 28.3, "geo_confidence": 0.8,
	})
	if rec.Name != "Acme Mining" || rec.AssetType != "mine" || rec.CountryCode != "ZM" {
		t.Fatalf("unexpected: %+v", rec)
	}
	if len(rec.Commodities) != 1 || rec.Commodities[0] != "copper" {
		t.Fatalf("commodities: %v", rec.Commodities)
	}
}

func TestFilterLegacyTables(t *testing.T) {
	out := filterLegacyTables([]string{"oil_vessels"})
	if len(out) != 1 || out[0].Table != "oil_vessels" {
		t.Fatalf("filter failed: %+v", out)
	}
}
