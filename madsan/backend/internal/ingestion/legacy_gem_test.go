package ingestion

import "testing"

func TestMapLegacyRelationshipType(t *testing.T) {
	if mapLegacyRelationshipType("operator") != "operated_by" {
		t.Fatal("operator mapping")
	}
	if mapLegacyRelationshipType("owner") != "owned_by" {
		t.Fatal("owner mapping")
	}
	if mapLegacyRelationshipType("license_holder") != "license_holder" {
		t.Fatal("passthrough")
	}
}

func TestGemExtractionDedupKey(t *testing.T) {
	key := gemExtractionDedupKey(" G001 ", " us ")
	if key != "g001|US" {
		t.Fatalf("got %q", key)
	}
}

func TestGemPlantDedupKey(t *testing.T) {
	if gemPlantDedupKey(" GOGPT-1 ") != "gogpt-1" {
		t.Fatal("plant dedup")
	}
}

func TestGemPipelineDedupKey(t *testing.T) {
	key := gemPipelineDedupKey("P100", 3, "Segment A")
	if key != "P100:3:segment_a" {
		t.Fatalf("got %q", key)
	}
}

func TestGemParseLatLng(t *testing.T) {
	lat, lng := gemParseLatLng("12.5", "-45.0")
	if lat == nil || lng == nil || *lat != 12.5 || *lng != -45.0 {
		t.Fatalf("coords %+v %+v", lat, lng)
	}
	if lat, lng := gemParseLatLng("0", "0"); lat != nil || lng != nil {
		t.Fatal("zero island should skip")
	}
}

func TestGemExtractionCompany(t *testing.T) {
	name := gemExtractionCompany(map[string]string{
		"Operator": "",
		"Owner(s)": "Acme Oil",
		"Unit ID":  "U1",
	})
	if name != "Acme Oil" {
		t.Fatalf("got %q", name)
	}
}

func TestGemPipelineOSMKey(t *testing.T) {
	if gemPipelineOSMKey("seg-1") != "gem:seg-1" {
		t.Fatal("osm key")
	}
}
