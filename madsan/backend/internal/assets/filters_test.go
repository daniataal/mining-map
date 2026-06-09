package assets

import (
	"strings"
	"testing"
)

func TestMetalsMapWhereSQLExcludesPetroleum(t *testing.T) {
	if MetalsMapWhereSQL == "" {
		t.Fatal("empty filter")
	}
	for _, needle := range []string{"legacy_petroleum_osm_features", "'petroleum'", "'mine'", "'smelter'"} {
		if !strings.Contains(MetalsMapWhereSQL, needle) {
			t.Fatalf("expected %q in MetalsMapWhereSQL", needle)
		}
	}
}

func TestMetalsLicenseWhereSQL(t *testing.T) {
	if !strings.Contains(MetalsLicenseWhereSQL, "legacy_licenses") {
		t.Fatal("license filter must scope to legacy_licenses")
	}
}
