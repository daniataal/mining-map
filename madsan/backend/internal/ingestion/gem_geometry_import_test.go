package ingestion

import (
	"encoding/json"
	"os"
	"testing"
)

func TestGEMGeometrySourceAssetID(t *testing.T) {
	props := map[string]any{
		"ProjectID":    "P0061",
		"SegmentName":  "Main Line",
		"PipelineName": "Double E Pipeline Project",
	}
	got := gemGeometrySourceAssetID(gemGeometrySources[1], props, 0)
	if got != "P0061:main_line" {
		t.Fatalf("source asset id=%q", got)
	}
}

func TestGEMGeometrySourceAssetIDLNGUsesUnitID(t *testing.T) {
	props := map[string]any{
		"ProjectID":    "T100000130274",
		"UnitID":       "G100002027401",
		"TerminalName": "Abadi LNG Terminal",
	}
	got := gemGeometrySourceAssetID(gemGeometrySources[2], props, 0)
	if got != "G100002027401" {
		t.Fatalf("source asset id=%q", got)
	}
}

func TestReadGEMGeometryFeatures(t *testing.T) {
	tmp := t.TempDir() + "/fixture.geojson"
	payload := geoJSONFeatureCollection{
		Type: "FeatureCollection",
		Features: []geoJSONFeature{{
			Type:       "Feature",
			Properties: map[string]any{"ProjectID": "P1"},
			Geometry:   json.RawMessage(`{"type":"Point","coordinates":[1,2]}`),
		}},
	}
	b, _ := json.Marshal(payload)
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		t.Fatal(err)
	}
	features, err := readGEMGeometryFeatures(tmp)
	if err != nil {
		t.Fatal(err)
	}
	if len(features) != 1 || firstProp(features[0].Properties, "ProjectID") != "P1" {
		t.Fatalf("features=%+v", features)
	}
}

func TestFilterGEMGeometrySources(t *testing.T) {
	got := filterGEMGeometrySources([]string{"lng_terminal"})
	if len(got) != 1 || got[0].Key != "gem_ggit_lng_terminals_geojson" {
		t.Fatalf("got=%+v", got)
	}
}
