package ingestion

import "testing"

func TestLegacyIntelligenceTablesIncludeTier2(t *testing.T) {
	want := map[string]bool{
		"oil_intelligence_cards": true,
		"entity_relationships":   true,
	}
	for _, table := range legacyIntelligenceTables {
		delete(want, table)
	}
	if len(want) > 0 {
		t.Fatalf("missing tier2 tables: %v", want)
	}
}

func TestPortCallVoyagePorts(t *testing.T) {
	load, lc, dis, dc := portCallVoyagePorts("possible_loading", "Fujairah", "AE")
	if load != "Fujairah" || lc != "AE" || dis != "" {
		t.Fatalf("load case: %+v %+v %+v", load, lc, dis)
	}
	_, _, dis, dc = portCallVoyagePorts("possible_unloading", "Rotterdam", "NL")
	if dis != "Rotterdam" || dc != "NL" {
		t.Fatalf("discharge case: %s %s", dis, dc)
	}
}

func TestLegacyMMSIStr(t *testing.T) {
	if legacyMMSIStr(int64(636019825)) != "636019825" {
		t.Fatal("int64 mmsi")
	}
	if legacyMMSIStr(float64(0)) != "" {
		t.Fatal("zero mmsi")
	}
}
