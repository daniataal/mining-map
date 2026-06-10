package ingestion

import "testing"

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
