package ingestion

import (
	"encoding/json"
	"fmt"
	"strings"
)

func mapLegacyRecord(m map[string]any, sourceSlug string) NormalizedRecord {
	rec := mapToRecord(m, sourceSlug)
	if slug, ok := m["source_slug"].(string); ok && slug != "" {
		rec.SourceSlug = slug
	}
	if rp, ok := m["raw_payload"].(map[string]any); ok {
		rec.RawPayload = rp
	} else {
		rec.RawPayload = map[string]any{}
	}
	if mmsi, ok := m["mmsi"]; ok {
		rec.RawPayload["mmsi"] = mmsi
	}
	if imo, ok := m["imo"]; ok {
		rec.RawPayload["imo"] = imo
	}
	if ext, ok := m["external_id"].(string); ok {
		rec.ExternalID = ext
	}
	if rp, ok := m["raw_payload"].(map[string]any); ok {
		if rec.Name == "" {
			if n, ok := rp["name"].(string); ok {
				rec.Name = normalizeName(n)
			}
			if n, ok := rp["company"].(string); ok && rec.Name == "" {
				rec.Name = normalizeName(n)
			}
		}
		if rec.Latitude == nil {
			if lat, ok := toFloat(rp["latitude"]); ok {
				rec.Latitude = &lat
			}
			if lat, ok := toFloat(rp["lat"]); ok {
				rec.Latitude = &lat
			}
		}
		if rec.Longitude == nil {
			if lng, ok := toFloat(rp["longitude"]); ok {
				rec.Longitude = &lng
			}
			if lng, ok := toFloat(rp["lng"]); ok {
				rec.Longitude = &lng
			}
			if lng, ok := toFloat(rp["lon"]); ok {
				rec.Longitude = &lng
			}
		}
		if rec.CountryCode == "" {
			if c, ok := rp["country"].(string); ok {
				rec.CountryCode = strings.ToUpper(strings.TrimSpace(c))
			}
		}
	}
	if et, ok := m["entity_type"].(string); ok && et != "" {
		rec.EntityType = et
	}
	if at, ok := m["asset_type"].(string); ok && at != "" {
		rec.AssetType = at
	}
	if cs, ok := toFloat(m["confidence_score"]); ok {
		_ = cs
	}
	return rec
}

func vesselMMSI(raw map[string]any) string {
	if raw == nil {
		return ""
	}
	switch m := raw["mmsi"].(type) {
	case string:
		return m
	case float64:
		return fmt.Sprintf("%.0f", m)
	case int:
		return fmt.Sprintf("%d", m)
	case int64:
		return fmt.Sprintf("%d", m)
	case json.Number:
		return m.String()
	}
	return ""
}

// TerminalTypeToAssetType maps legacy oil_terminals.terminal_type to MadSan asset_type.
func TerminalTypeToAssetType(terminalType string) string {
	switch strings.ToLower(strings.TrimSpace(terminalType)) {
	case "storage_tank", "tank_farm":
		return "tank_farm"
	case "refinery":
		return "refinery"
	case "storage_terminal", "terminal", "berth", "port":
		return "terminal"
	default:
		return "terminal"
	}
}

// LayerToAssetType maps petroleum OSM layer_id values to MadSan asset_type.
func LayerToAssetType(layer string) string {
	switch layer {
	case "storage_terminals":
		return "tank_farm"
	case "refineries":
		return "refinery"
	case "pipelines":
		return "pipeline"
	case "oilfields", "oil_fields", "petroleum_wells", "wells":
		return "terminal"
	default:
		return "terminal"
	}
}
