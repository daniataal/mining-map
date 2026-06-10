package ingestion

import "testing"

func TestEnqueueEntityEnrichmentRefreshPayloadKeys(t *testing.T) {
	vessel := map[string]any{"imo": "1234567", "force": true}
	vessel["entity_id"] = "vessel-uuid"
	if got := payloadString(vessel, "entity_id"); got != "vessel-uuid" {
		t.Fatalf("vessel entity_id = %q", got)
	}

	asset := map[string]any{"force": true, "asset_id": "asset-uuid"}
	if got := payloadString(asset, "asset_id"); got != "asset-uuid" {
		t.Fatalf("asset asset_id = %q", got)
	}
	if got := payloadString(asset, "entity_id"); got != "" {
		t.Fatalf("asset refresh should use asset_id not entity_id, got entity_id=%q", got)
	}
}
