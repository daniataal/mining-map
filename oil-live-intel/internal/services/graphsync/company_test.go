package graphsync

import (
	"testing"
)

func TestNormalizeName(t *testing.T) {
	got := NormalizeName("  Aramco Trading  ")
	if got != "aramco trading" {
		t.Fatalf("NormalizeName: got %q want %q", got, "aramco trading")
	}
}

func TestMergeCompanyMetadataRolesAndSources(t *testing.T) {
	merged := MergeCompanyMetadata(
		map[string]any{
			"roles":   []any{"terminal_operator"},
			"sources": []any{map[string]any{"name": "osm_storage"}},
		},
		map[string]any{"license_id": "lic-1"},
		"licenses",
		"supplier_license",
	)

	roles, ok := merged["roles"].([]string)
	if !ok {
		t.Fatalf("roles type: %T", merged["roles"])
	}
	if len(roles) != 2 || roles[0] != "terminal_operator" || roles[1] != "supplier_license" {
		t.Fatalf("roles: %#v", roles)
	}

	sources := asMapSlice(merged["sources"])
	if len(sources) != 2 {
		t.Fatalf("sources len: %d", len(sources))
	}
	if stringFromAny(sources[0]["name"]) != "osm_storage" {
		t.Fatalf("first source: %#v", sources[0])
	}
	if stringFromAny(sources[1]["name"]) != "licenses" {
		t.Fatalf("second source: %#v", sources[1])
	}
}
