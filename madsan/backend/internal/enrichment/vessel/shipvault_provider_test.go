package vessel

import (
	"testing"
	"time"

	sv "github.com/madsan/intelligence/internal/enrichment/vessel/shipvault"
)

func TestFromShipVaultResultMapsOwnerOperator(t *testing.T) {
	now := time.Date(2026, 6, 10, 12, 0, 0, 0, time.UTC)
	res := FromShipVaultResult("636019825", "9599377", &sv.EnrichmentResult{
		Vessel: &sv.VesselProfile{
			IMO:            "9599377",
			Name:           "LERRIX",
			OwnerName:      "Test Owner SA",
			OperatorName:   "Test Operator Ltd",
			OwnerCompanyID: "co-1",
			VesselClass:    "Oil/Chemical Tanker",
			Flag:           "LR",
			DeadweightTons: 45800,
		},
		OwnerProfile: &sv.CompanyProfile{
			ShipVaultCompanyID: "co-1",
			Name:               "Test Owner SA",
			Country:            "GR",
		},
		CachedAt:       now,
		DataSource:     "shipvault",
		EnrichmentTier: "registry",
		Disclaimer:     "indicative",
	}, 120)

	if res.OwnerName != "Test Owner SA" {
		t.Fatalf("owner = %q", res.OwnerName)
	}
	if res.OperatorName != "Test Operator Ltd" {
		t.Fatalf("operator = %q", res.OperatorName)
	}
	if res.Source != "shipvault" || res.Tier != "observed" {
		t.Fatalf("source/tier = %s/%s", res.Source, res.Tier)
	}
	if !res.Implemented() {
		t.Fatal("expected implemented enrichment")
	}
}
