package ais

import (
	"strings"
)

// IsRelevantVessel returns true for oil/gas tankers and bulk near sulfur hubs (caller checks terminal).
func IsRelevantVessel(shipTypeCode int, shipTypeLabel, vesselName string, nearSulfurTerminal bool) bool {
	if nearSulfurTerminal && looksLikeBulk(shipTypeCode, shipTypeLabel, vesselName) {
		return true
	}
	if shipTypeCode >= 80 && shipTypeCode <= 89 {
		return true
	}
	hay := strings.ToLower(shipTypeLabel + " " + vesselName)
	keywords := []string{"tanker", "crude", "oil", "chemical", "lng", "lpg", "petroleum", "product"}
	for _, k := range keywords {
		if strings.Contains(hay, k) {
			return true
		}
	}
	return false
}

func looksLikeBulk(shipTypeCode int, shipTypeLabel, vesselName string) bool {
	if shipTypeCode >= 70 && shipTypeCode <= 79 {
		return true
	}
	hay := strings.ToLower(shipTypeLabel + " " + vesselName)
	return strings.Contains(hay, "bulk") || strings.Contains(hay, "cargo")
}

// TankerClass returns crude, product, chemical, lng, lpg, bulk, or unknown.
func TankerClass(shipTypeCode int, shipTypeLabel, vesselName string) string {
	hay := strings.ToLower(shipTypeLabel + " " + vesselName)
	switch {
	case strings.Contains(hay, "lng"):
		return "lng"
	case strings.Contains(hay, "lpg"):
		return "lpg"
	case strings.Contains(hay, "chemical"):
		return "chemical"
	case strings.Contains(hay, "crude"):
		return "crude"
	case strings.Contains(hay, "bulk"):
		return "bulk"
	case shipTypeCode >= 80 && shipTypeCode <= 84:
		return "crude"
	case shipTypeCode >= 85 && shipTypeCode <= 89:
		return "product"
	case strings.Contains(hay, "product"):
		return "product"
	default:
		return "unknown"
	}
}
