package ingestion

import (
	"encoding/json"
	"fmt"
)

// PetroleumProvenanceWhereSQL limits backfill to assets with honest petroleum provenance.
const PetroleumProvenanceWhereSQL = `
	(
		COALESCE(legacy_table, '') ILIKE '%petroleum%'
		OR 'petroleum' = ANY(COALESCE(commodities_supported, '{}'))
	)`

// ResolvePetroleumAssetType maps layer_id from petroleum OSM raw_source_payload to asset_type.
func ResolvePetroleumAssetType(raw []byte) (string, error) {
	if len(raw) == 0 {
		return "", fmt.Errorf("empty raw_source_payload")
	}
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		return "", err
	}
	layer := ""
	if v, ok := payload["layer_id"]; ok {
		layer = fmt.Sprint(v)
	}
	if layer == "" {
		return "", fmt.Errorf("missing layer_id")
	}
	return LayerToAssetType(layer), nil
}
