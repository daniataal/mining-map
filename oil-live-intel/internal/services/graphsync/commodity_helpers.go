package graphsync

import (
	"regexp"
	"strings"
)

var petroleumKeywords = regexp.MustCompile(`(?i)(petroleum|fuel|diesel|gasoil|gasoline|crude|lng|lpg|jet|kerosene|naphtha|oil|gas)`)

// PetroleumHSPrefixes mirrors backend/services/oil_live_graph_sync.PETROLEUM_HS_PREFIXES.
var PetroleumHSPrefixes = []string{"2709", "2710", "2711", "2802"}

// IsPetroleumLicenseRow mirrors backend/services/oil_live_graph_sync._is_petroleum_license_row.
func IsPetroleumLicenseRow(commodity, licenseType, sector string) bool {
	haystack := strings.TrimSpace(strings.Join([]string{commodity, licenseType, sector}, " "))
	if haystack == "" {
		return false
	}
	sectorL := strings.ToLower(strings.TrimSpace(sector))
	switch sectorL {
	case "oil", "gas", "petroleum", "energy", "oil_and_gas", "oil & gas":
		return true
	}
	return petroleumKeywords.MatchString(haystack)
}

// CommodityFromText mirrors backend/services/oil_live_graph_sync._commodity_from_text.
func CommodityFromText(text string) string {
	t := strings.ToLower(text)
	if strings.Contains(t, "sulfur") || strings.Contains(t, "sulphur") {
		return "sulfur"
	}
	if strings.Contains(t, "lng") || strings.Contains(t, "natural gas") {
		return "gas"
	}
	if strings.Contains(t, "lpg") || strings.Contains(t, "propane") {
		return "gas"
	}
	if strings.Contains(t, "crude") {
		return "crude"
	}
	for _, kw := range []string{"diesel", "gasoil", "gasoline", "jet", "naphtha", "refined"} {
		if strings.Contains(t, kw) {
			return "refined"
		}
	}
	if strings.Contains(t, "oil") || strings.Contains(t, "petroleum") || strings.Contains(t, "fuel") {
		return "refined"
	}
	return ""
}

// CommodityFamilyFromHS mirrors trade-flow family inference in _mirror_trade_flows.
func CommodityFamilyFromHS(hs string) string {
	hs = strings.TrimSpace(hs)
	if strings.HasPrefix(hs, "2709") {
		return "crude"
	}
	if strings.HasPrefix(hs, "2711") {
		return "gas"
	}
	if strings.HasPrefix(hs, "2802") {
		return "sulfur"
	}
	return "refined"
}

// IsPetroleumHS returns true when hs_code is empty or matches petroleum prefixes.
func IsPetroleumHS(hs string) bool {
	hs = strings.TrimSpace(hs)
	if hs == "" {
		return true
	}
	for _, prefix := range PetroleumHSPrefixes {
		if strings.HasPrefix(hs, prefix) {
			return true
		}
	}
	return false
}
