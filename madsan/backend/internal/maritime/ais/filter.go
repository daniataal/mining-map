package ais

import (
	"strings"
)

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
