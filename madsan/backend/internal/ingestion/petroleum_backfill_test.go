package ingestion

import "testing"

func TestResolvePetroleumAssetType(t *testing.T) {
	raw := []byte(`{"layer_id":"storage_terminals","tags":{"name":"Test Terminal"}}`)
	got, err := ResolvePetroleumAssetType(raw)
	if err != nil {
		t.Fatal(err)
	}
	if got != "tank_farm" {
		t.Fatalf("got %q want tank_farm", got)
	}
}

func TestResolvePetroleumAssetTypeMissingLayer(t *testing.T) {
	_, err := ResolvePetroleumAssetType([]byte(`{"tags":{}}`))
	if err == nil {
		t.Fatal("expected error for missing layer_id")
	}
}

func TestPetroleumProvenanceWhereSQL(t *testing.T) {
	if PetroleumProvenanceWhereSQL == "" {
		t.Fatal("empty where sql")
	}
}
