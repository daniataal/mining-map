package graphsync

import "testing"

func TestPetroleumOsmStorageLayerID(t *testing.T) {
	if petroleumOsmStorageLayerID != "storage_terminals" {
		t.Fatalf("layer id = %q, want storage_terminals", petroleumOsmStorageLayerID)
	}
}
