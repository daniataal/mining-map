package supplier

import (
	"strings"
	"testing"

	"github.com/mining-map/oil-live-intel/internal/services/geocode"
)

func TestParseRegisterAddress(t *testing.T) {
	p := geocode.ParseRegisterAddress(
		"7 Straits View #26-01 Marina One East Tower, Singapore 018936",
		"Singapore",
	)
	if p.Street != "7 Straits View" || p.PostalCode != "018936" || p.Building != "Marina One East Tower" {
		t.Fatalf("parsed: %+v", p)
	}
	if !p.Structured {
		t.Fatal("expected structured")
	}
}

func TestNormalizeGeocodeQuery(t *testing.T) {
	q := normalizeGeocodeQuery("7 Straits View #26-01 Marina One East Tower, Singapore 018936", "Singapore")
	if !strings.Contains(q, "Straits View") || strings.Contains(q, "#") {
		t.Fatalf("query: %q", q)
	}
}

func TestGeocodeDisclaimer(t *testing.T) {
	if GeocodeDisclaimer(GeocodeTierRegisterAddress) == "" {
		t.Fatal("expected disclaimer for register address tier")
	}
}

func TestApplyPlacementMetadataHubAnchor(t *testing.T) {
	hubLat := 25.116
	hubLng := 56.35
	meta := ApplyPlacementMetadata(t.Context(), map[string]any{}, SupplierRecord{
		CompanyName: "Akron Trade and Transport",
		Locode:      "AEFJR",
		HubLat:      &hubLat,
		HubLng:      &hubLng,
	}, PlacementOptions{})
	if meta["geocode_tier"] != GeocodeTierPortHubAnchor {
		t.Fatalf("tier: %v", meta["geocode_tier"])
	}
}
