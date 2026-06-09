package ingestion

import "testing"

func TestNormalizeLegacyPipelineRowPreservesGeomWKB(t *testing.T) {
	wkb := []byte{0x01, 0x02, 0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00}
	rec := normalizeLegacyRow(legacyTableSpec{Table: "petroleum_osm_features", EntityType: "asset"}, map[string]any{
		"id": 42, "layer_id": "pipelines", "tags": map[string]any{"name": "Tap Line"},
		"latitude": 28.1, "longitude": -97.2, "geom_wkb": wkb,
	})
	if rec.AssetType != "pipeline" {
		t.Fatalf("asset_type = %q", rec.AssetType)
	}
	if len(rec.GeomEWKB) != len(wkb) {
		t.Fatalf("geom_wkb len = %d want %d", len(rec.GeomEWKB), len(wkb))
	}
	if rec.Name != "Tap Line" {
		t.Fatalf("name = %q", rec.Name)
	}
}
