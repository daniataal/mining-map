package vesselmerge

import (
	"strconv"
	"strings"
)

// PetroleumPriorityScore ranks vessels for oil/gas map caps (higher = keep first).
// Mirrors backend/services/maritime_intel.py petroleum_vessel_priority.
func PetroleumPriorityScore(shipTypeCode *int, shipTypeLabel, vesselType string, crudeCapable, productTanker *bool) int {
	if crudeCapable != nil && *crudeCapable {
		return 100
	}
	if productTanker != nil && *productTanker {
		return 100
	}
	if shipTypeCode != nil && *shipTypeCode >= 80 && *shipTypeCode <= 89 {
		return 100
	}
	label := normalizeToken(shipTypeLabel)
	if label == "" {
		label = normalizeToken(vesselType)
	}
	if label == "" {
		return 0
	}
	for _, term := range []string{"tanker", "crude", "chemical", "lng", "lpg", "petroleum", "oil", "gas"} {
		if strings.Contains(label, term) {
			return 80
		}
	}
	if strings.Contains(label, "cargo") {
		return 20
	}
	return 0
}

// ShipTypeCategory buckets a vessel for cap diagnostics.
func ShipTypeCategory(shipTypeCode *int, shipTypeLabel, vesselType string, crudeCapable, productTanker *bool) string {
	score := PetroleumPriorityScore(shipTypeCode, shipTypeLabel, vesselType, crudeCapable, productTanker)
	switch {
	case score >= 80:
		return "tanker"
	case score >= 20:
		return "cargo"
	case shipTypeCode != nil || shipTypeLabel != "" || vesselType != "":
		return "other"
	default:
		return "unknown"
	}
}

func petroleumPriorityFromItem(item map[string]any) int {
	code := intPtrFromAny(item["ship_type_code"])
	label, _ := item["ship_type_label"].(string)
	vtype, _ := item["vessel_type"].(string)
	crude := boolPtrFromAny(item["crude_capable"])
	product := boolPtrFromAny(item["product_tanker"])
	return PetroleumPriorityScore(code, label, vtype, crude, product)
}

func shipTypeCategoryFromItem(item map[string]any) string {
	code := intPtrFromAny(item["ship_type_code"])
	label, _ := item["ship_type_label"].(string)
	vtype, _ := item["vessel_type"].(string)
	crude := boolPtrFromAny(item["crude_capable"])
	product := boolPtrFromAny(item["product_tanker"])
	return ShipTypeCategory(code, label, vtype, crude, product)
}

func normalizeToken(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func intPtrFromAny(value any) *int {
	switch v := value.(type) {
	case nil:
		return nil
	case int:
		n := v
		return &n
	case int32:
		n := int(v)
		return &n
	case int64:
		n := int(v)
		return &n
	case float64:
		n := int(v)
		return &n
	case string:
		n, err := strconv.Atoi(strings.TrimSpace(v))
		if err != nil {
			return nil
		}
		return &n
	default:
		return nil
	}
}

func boolPtrFromAny(value any) *bool {
	switch v := value.(type) {
	case nil:
		return nil
	case bool:
		b := v
		return &b
	default:
		return nil
	}
}
