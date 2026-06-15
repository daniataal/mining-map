package graph

import (
	"encoding/json"
	"testing"
)

func TestParsePipelineMeta(t *testing.T) {
	raw, err := json.Marshal(map[string]any{
		"legacy_id": "4242",
		"name":      "Fallback Name",
		"tags":      map[string]any{"name": "Tap Line", "substance": "oil"},
	})
	if err != nil {
		t.Fatal(err)
	}
	name, legacyID, substance := parsePipelineMeta(raw)
	if name != "Tap Line" || legacyID != "4242" || substance != "oil" {
		t.Fatalf("parse = %q %q %q", name, legacyID, substance)
	}
}

func TestConnectivityConstants(t *testing.T) {
	if AssetSnapRadiusM != 500 {
		t.Fatalf("AssetSnapRadiusM = %d, want 500", AssetSnapRadiusM)
	}
}

func TestSnappedAssetTier(t *testing.T) {
	if (&SnappedAsset{Tier: "inferred"}).Tier != "inferred" {
		t.Fatal("snapped asset tier must be inferred")
	}
}
