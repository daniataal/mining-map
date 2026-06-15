package api

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/madsan/intelligence/internal/ingestion"
)

var osmTagSummaryKeys = []string{
	"name", "operator", "owner", "substance", "man_made", "location", "network",
	"status", "usage", "capacity", "diameter", "ref", "start_date", "voltage",
}

func enrichAssetSummary(summary map[string]any, assetType string, commodities []string, rawJSON []byte, storedGeomType string) {
	if len(commodities) > 0 {
		summary["commodities"] = strings.Join(commodities, ", ")
	}

	geomType := strings.TrimPrefix(storedGeomType, "ST_")
	if assetType == "pipeline" {
		summary["geometry_type"] = "LineString"
		if geomType == "Point" {
			summary["coordinates_note"] = "centroid of line feature"
		}
	} else if geomType != "" {
		summary["geometry_type"] = geomType
	}

	if len(rawJSON) == 0 {
		return
	}
	var raw map[string]any
	if err := json.Unmarshal(rawJSON, &raw); err != nil {
		return
	}
	enrichGemPipelineSummary(summary, assetType, raw)
	if layerID, ok := raw["layer_id"].(string); ok && layerID != "" {
		summary["layer_id"] = layerID
	}
	for _, key := range []string{"osm_id", "osm_type"} {
		if v, ok := raw[key]; ok && v != nil {
			val := strings.TrimSpace(fmt.Sprint(v))
			if val != "" && val != "<nil>" {
				summary[key] = val
			}
		}
	}
	tags, _ := raw["tags"].(map[string]any)
	if tags == nil {
		return
	}
	for _, key := range osmTagSummaryKeys {
		setSummaryFromTag(summary, tags, key)
	}
	for key, v := range tags {
		if !strings.HasPrefix(key, "diameter") {
			continue
		}
		val := strings.TrimSpace(fmt.Sprint(v))
		if val != "" && val != "<nil>" {
			summary[key] = val
		}
	}
}

func setSummaryFromTag(summary map[string]any, tags map[string]any, key string) {
	v, ok := tags[key]
	if !ok || v == nil {
		return
	}
	val := strings.TrimSpace(fmt.Sprint(v))
	if val == "" || val == "<nil>" {
		return
	}
	summary[key] = val
}

func enrichGemPipelineSummary(summary map[string]any, assetType string, raw map[string]any) {
	if assetType != "pipeline" {
		return
	}
	var tags map[string]any
	if t, ok := raw["tags"].(map[string]any); ok {
		tags = t
	}
	profile := ingestion.BuildGEMPipelineProfile(raw, tags)
	for k, v := range profile {
		if _, exists := summary[k]; !exists {
			summary[k] = v
		}
	}
	if _, ok := summary["data_tier"]; !ok {
		if v := raw["data_tier"]; v != nil {
			summary["data_tier"] = v
		}
	}
}
