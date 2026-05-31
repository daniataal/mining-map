package graphsync

import (
	"testing"
)

func TestIsPetroleumLicenseRow(t *testing.T) {
	if !IsPetroleumLicenseRow("crude oil", "", "") {
		t.Fatal("expected petroleum commodity match")
	}
	if !IsPetroleumLicenseRow("", "", "oil") {
		t.Fatal("expected petroleum sector match")
	}
	if IsPetroleumLicenseRow("gold", "mining", "mining") {
		t.Fatal("expected non-petroleum skip")
	}
	if IsPetroleumLicenseRow("", "", "") {
		t.Fatal("expected empty skip")
	}
}

func TestCommodityFromText(t *testing.T) {
	cases := map[string]string{
		"crude export":  "crude",
		"LNG terminal":  "gas",
		"sulfur block":  "sulfur",
		"diesel supply": "refined",
		"generic":       "",
	}
	for in, want := range cases {
		if got := CommodityFromText(in); got != want {
			t.Fatalf("CommodityFromText(%q): got %q want %q", in, got, want)
		}
	}
}

func TestCommodityFamilyFromHS(t *testing.T) {
	if got := CommodityFamilyFromHS("270910"); got != "crude" {
		t.Fatalf("2709: got %q", got)
	}
	if got := CommodityFamilyFromHS("271111"); got != "gas" {
		t.Fatalf("2711: got %q", got)
	}
	if got := CommodityFamilyFromHS("280200"); got != "sulfur" {
		t.Fatalf("2802: got %q", got)
	}
	if got := CommodityFamilyFromHS("271019"); got != "refined" {
		t.Fatalf("2710: got %q", got)
	}
}

func TestIsPetroleumHS(t *testing.T) {
	if !IsPetroleumHS("2709") {
		t.Fatal("expected petroleum hs")
	}
	if IsPetroleumHS("2601") {
		t.Fatal("expected non-petroleum hs skip")
	}
	if !IsPetroleumHS("") {
		t.Fatal("empty hs should pass through")
	}
}
