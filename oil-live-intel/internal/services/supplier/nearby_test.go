package supplier

import "testing"

func TestShapeNearbyRow(t *testing.T) {
	row := shapeNearbyRow(
		"id-1", "BP Singapore Pte. Limited", "Singapore", "bunker_supplier",
		nil, 0.88, nil,
		map[string]any{
			"port_locode":       "SGSIN",
			"fuels_supplied":    "MDO/ MGO /MFO",
			"contact_person":    "Ms Masaki Low",
			"register_address":  "7 Straits View, Singapore",
			"product_types":     []any{"marine_fuel_oil", "marine_gas_oil"},
			"license_authority": "MPA Singapore",
			"source_url":        "https://example.com/register.pdf",
			"geocode_tier":       "register_address_geocoded",
			"geocode_disclaimer": "Marker from MPA register address",
			"display_lat":        1.278,
			"display_lng":        103.854,
			"enrichment_tier":    "regulator_curated",
		},
	)
	if row.FuelsSupplied != "MDO/ MGO /MFO" {
		t.Fatalf("fuels: %q", row.FuelsSupplied)
	}
	if row.ContactPerson != "Ms Masaki Low" {
		t.Fatalf("contact: %q", row.ContactPerson)
	}
	if row.Address != "7 Straits View, Singapore" {
		t.Fatalf("address: %q", row.Address)
	}
	if row.GeocodeTier != "register_address_geocoded" {
		t.Fatalf("tier: %q", row.GeocodeTier)
	}
	if row.Lat == nil || row.Lng == nil {
		t.Fatal("expected lat/lng")
	}
}

func TestShapeNearbyRowRegisterSourceFallback(t *testing.T) {
	row := shapeNearbyRow("id", "Test", "UAE", "bunker_supplier", nil, 0.8, nil, map[string]any{
		"register_source_url": "https://fujairahport.ae/bunker",
	})
	if row.SourceURL != "https://fujairahport.ae/bunker" {
		t.Fatalf("source url: %q", row.SourceURL)
	}
}
