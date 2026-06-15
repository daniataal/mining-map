package api

import (
	"testing"
)

func TestEnrichAssetSummaryPipelineOSM(t *testing.T) {
	raw := []byte(`{
		"layer_id": "pipelines",
		"osm_id": 1006728636,
		"osm_type": "way",
		"tags": {
			"man_made": "pipeline",
			"substance": "gas",
			"operator": "TGS S.A.",
			"location": "overground",
			"network": "transmission"
		}
	}`)
	summary := map[string]any{"asset_type": "pipeline", "country": "AR"}
	enrichAssetSummary(summary, "pipeline", []string{"petroleum"}, raw, "ST_Point")

	if summary["geometry_type"] != "LineString" {
		t.Fatalf("geometry_type = %v, want LineString", summary["geometry_type"])
	}
	if summary["coordinates_note"] != "centroid of line feature" {
		t.Fatalf("coordinates_note = %v", summary["coordinates_note"])
	}
	for _, key := range []string{"layer_id", "osm_id", "osm_type", "substance", "operator", "man_made", "network", "commodities"} {
		if summary[key] == nil || summary[key] == "" {
			t.Fatalf("missing summary[%s]", key)
		}
	}
}

func TestEnrichAssetSummaryEmptyRaw(t *testing.T) {
	summary := map[string]any{"asset_type": "terminal", "country": "US"}
	enrichAssetSummary(summary, "terminal", nil, nil, "ST_Point")
	if summary["geometry_type"] != "Point" {
		t.Fatalf("geometry_type = %v, want Point", summary["geometry_type"])
	}
}
