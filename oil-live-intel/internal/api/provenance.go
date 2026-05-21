package api

import (
	"encoding/json"
	"strings"
)

// inferPortCallProvenance classifies port-call rows for UI badges.
func inferPortCallProvenance(evidenceJSON, metadataJSON []byte) string {
	if len(metadataJSON) > 0 {
		var meta map[string]any
		if json.Unmarshal(metadataJSON, &meta) == nil {
			if src, ok := meta["source"].(string); ok {
				src = strings.TrimSpace(src)
				if src != "" {
					return src
				}
			}
		}
	}
	text := strings.ToLower(string(evidenceJSON))
	if strings.Contains(text, "seed_port_calls") {
		return "seed_port_calls"
	}
	if strings.Contains(text, "demo seed") {
		return "synthetic"
	}
	if strings.Contains(text, "inferred from public ais") || strings.Contains(text, "public ais") {
		return "live_ais"
	}
	return "unknown"
}

// inferCargoProvenance returns UI badge key for synthetic cargo records.
func inferCargoProvenance(bolTier string) string {
	tier := strings.TrimSpace(strings.ToLower(bolTier))
	if tier == "" || tier == "synthetic" {
		return "synthetic"
	}
	return tier
}
