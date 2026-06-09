package compliance

import "testing"

func TestLoadRules(t *testing.T) {
	rules, err := LoadRules()
	if err != nil {
		t.Fatal(err)
	}
	if rules.Version != "1.0.0" {
		t.Fatalf("version: got %q", rules.Version)
	}
	if len(rules.SanctionedCountries) < 5 {
		t.Fatalf("expected sanctioned countries, got %d", len(rules.SanctionedCountries))
	}
	if rules.KYCThresholds["enhanced_kyc_above_usd"] != 1_000_000 {
		t.Fatalf("enhanced KYC threshold: got %v", rules.KYCThresholds["enhanced_kyc_above_usd"])
	}
	mining := CommodityRuleForFamily(rules, "mining")
	if len(mining.ConflictMinerals) == 0 {
		t.Fatal("expected mining conflict_minerals")
	}
	oil := CommodityRuleForFamily(rules, "oil")
	if !oil.OffshoreExtraCheck {
		t.Fatal("expected oil offshore_extra_check")
	}
}

func TestCountryInList(t *testing.T) {
	if !countryInList("Iran", []string{"Iran", "Syria"}) {
		t.Fatal("Iran should match")
	}
	if countryInList("UAE", []string{"Iran", "Syria"}) {
		t.Fatal("UAE should not match")
	}
}

func TestIsConflictMineral(t *testing.T) {
	rules, err := LoadRules()
	if err != nil {
		t.Fatal(err)
	}
	minerals := CommodityRuleForFamily(rules, "mining").ConflictMinerals
	if !isConflictMineral("gold", minerals) {
		t.Fatal("gold should be conflict mineral")
	}
}
