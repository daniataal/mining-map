package dedup

import "testing"

func TestScoreCluster(t *testing.T) {
	same := []CompanyMember{{CountryCode: "AE"}, {CountryCode: "AE"}}
	if scoreCluster(same) < 80 {
		t.Fatalf("same country should score high: %v", scoreCluster(same))
	}
	mixed := []CompanyMember{{CountryCode: "AE"}, {CountryCode: "US"}}
	if scoreCluster(mixed) >= 85 {
		t.Fatalf("mixed country should be manual review tier: %v", scoreCluster(mixed))
	}
}
