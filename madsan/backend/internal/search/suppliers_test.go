package search

import (
	"net/http"
	"testing"
)

func TestSupplierFusionRank(t *testing.T) {
	d50 := 50.0
	tests := []struct {
		name      string
		conf      float64
		evidence  int
		contacts  int
		commodity string
		comms     []string
		dist      *float64
		radius    float64
		minWant   float64
		maxWant   float64
	}{
		{
			name: "high confidence evidence contacts commodity", conf: 80, evidence: 6, contacts: 2,
			commodity: "vlsfo", comms: []string{"vlsfo", "mgo"}, dist: &d50, radius: 200,
			minWant: 80, maxWant: 100,
		},
		{
			name: "commodity mismatch lowers score", conf: 80, evidence: 6, contacts: 2,
			commodity: "gold", comms: []string{"vlsfo"}, dist: nil, radius: 0,
			minWant: 70, maxWant: 75,
		},
		{
			name: "proximity bonus at origin", conf: 40, evidence: 1, contacts: 0,
			commodity: "vlsfo", comms: []string{"vlsfo"}, dist: ptr(0.0), radius: 200,
			minWant: 40, maxWant: 45,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := SupplierFusionRank(tc.conf, tc.evidence, tc.contacts, tc.commodity, tc.comms, tc.dist, tc.radius)
			if got < tc.minWant || got > tc.maxWant {
				t.Fatalf("rank=%v want [%v,%v]", got, tc.minWant, tc.maxWant)
			}
		})
	}
}

func TestCommodityMatches(t *testing.T) {
	if !commodityMatches("gold", []string{"Gold", "silver"}) {
		t.Fatal("expected gold match")
	}
	if commodityMatches("vlsfo", []string{"hsfo"}) {
		t.Fatal("expected no vlsfo match")
	}
	if commodityMatches("", []string{"gold"}) {
		t.Fatal("empty query should not match")
	}
}

func TestParseSupplierSearchParams(t *testing.T) {
	req, _ := http.NewRequest(http.MethodGet, "/?commodity=vlsfo&country_code=SG&near_lat=1.35&near_lon=103.82", nil)
	p := ParseSupplierSearchParams(req)
	if p.Commodity != "vlsfo" || p.CountryCode != "SG" {
		t.Fatalf("unexpected filters: %+v", p)
	}
	if p.RadiusKm != defaultSupplierRadiusKm {
		t.Fatalf("expected default radius %v got %v", defaultSupplierRadiusKm, p.RadiusKm)
	}
}

func ptr(f float64) *float64 { return &f }
