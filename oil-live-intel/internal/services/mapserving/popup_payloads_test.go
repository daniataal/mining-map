package mapserving

import (
	"encoding/json"
	"testing"
)

func TestFeatureKeyBuilders(t *testing.T) {
	if got := BunkerFeatureKey("abc-123"); got != "bunker:abc-123" {
		t.Fatalf("bunker key = %q", got)
	}
	if got := StorageFeatureKey("  uuid "); got != "storage:uuid" {
		t.Fatalf("storage key = %q", got)
	}
	if got := OsmFeatureKey("storage_terminals", "way", 567978818); got != "osm:storage_terminals:way:567978818" {
		t.Fatalf("osm key = %q", got)
	}
	if got := GemPipelineFeatureKey("tap-001"); got != "gem:pipeline:tap-001" {
		t.Fatalf("gem pipeline key = %q", got)
	}
	if got := ResolveFeatureKey("pipelines", "", 0, "tap-001"); got != "gem:pipeline:tap-001" {
		t.Fatalf("resolve gem = %q", got)
	}
	if got := ResolveFeatureKey("pipelines", "way", 42, ""); got != "osm:pipelines:way:42" {
		t.Fatalf("resolve osm pipeline = %q", got)
	}
}

func TestPopupPayloadJSONShape(t *testing.T) {
	raw, err := json.Marshal(PopupPayload{
		FeatureKey:   BunkerFeatureKey("id"),
		PopupVersion: 1,
		Title:        "Acme Bunker",
		BolTier:      "open_register",
		Sources:      json.RawMessage(`[]`),
		Fields:       json.RawMessage(`{"fuels_supplied":"VLSFO"}`),
		Limitations:  json.RawMessage(`["verify"]`),
	})
	if err != nil {
		t.Fatal(err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded["feature_key"] != "bunker:id" {
		t.Fatalf("feature_key = %v", decoded["feature_key"])
	}
}
