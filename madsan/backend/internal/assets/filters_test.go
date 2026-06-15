package assets

import (
	"strings"
	"testing"
)

func TestMetalsMapWhereSQLExcludesPetroleum(t *testing.T) {
	if MetalsMapWhereSQL == "" {
		t.Fatal("empty filter")
	}
	for _, needle := range []string{
		"legacy_petroleum_osm_features",
		"'petroleum'",
		"'mine'",
		"'smelter'",
		"legacy_licenses",
		"'mining'",
		"sector",
	} {
		if !strings.Contains(MetalsMapWhereSQL, needle) {
			t.Fatalf("expected %q in MetalsMapWhereSQL", needle)
		}
	}
}

func TestMetalsLicenseWhereSQLMiningSectorOnly(t *testing.T) {
	if !strings.Contains(MetalsLicenseWhereSQL, "legacy_licenses") {
		t.Fatal("license filter must scope to legacy_licenses")
	}
	if !strings.Contains(MetalsLicenseWhereSQL, "mining") {
		t.Fatal("license filter must require mining sector")
	}
	if strings.Contains(MetalsLicenseWhereSQL, "oil_and_gas") {
		t.Fatal("license filter must not include oil_and_gas")
	}
}

func TestEnergyCadastreWhereSQL(t *testing.T) {
	for _, needle := range []string{"legacy_licenses", "oil_and_gas", "sector"} {
		if !strings.Contains(EnergyCadastreWhereSQL, needle) {
			t.Fatalf("expected %q in EnergyCadastreWhereSQL", needle)
		}
	}
}
