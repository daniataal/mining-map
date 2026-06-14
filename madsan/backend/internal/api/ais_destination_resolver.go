package api

import (
	"regexp"
	"strings"
	"unicode"
)

type aisKnownPort struct {
	Locode      string
	Name        string
	CountryCode string
	CountryName string
	Lat         float64
	Lng         float64
	Aliases     []string
}

var (
	aisLocodeRE      = regexp.MustCompile(`\b([A-Z]{2})\s*[- ]?([A-Z0-9]{3})\b`)
	aisNameCountryRE = regexp.MustCompile(`^([A-Z][A-Z0-9 .'\-]{2,})[., ]+([A-Z]{2})$`)
)

var aisGenericDestinations = map[string]bool{
	"":          true,
	"FORORDER":  true,
	"FORORDERS": true,
	"N/A":       true,
	"NA":        true,
	"NIL":       true,
	"ORDER":     true,
	"ORDERS":    true,
	"TBA":       true,
	"TBC":       true,
	"TBN":       true,
	"UNKNOWN":   true,
}

var aisCountryNames = map[string]string{
	"AE": "United Arab Emirates",
	"BE": "Belgium",
	"BH": "Bahrain",
	"BR": "Brazil",
	"CN": "China",
	"EG": "Egypt",
	"FR": "France",
	"GB": "United Kingdom",
	"GR": "Greece",
	"IN": "India",
	"IT": "Italy",
	"JP": "Japan",
	"KR": "South Korea",
	"KW": "Kuwait",
	"MY": "Malaysia",
	"NG": "Nigeria",
	"NL": "Netherlands",
	"OM": "Oman",
	"PE": "Peru",
	"QA": "Qatar",
	"SA": "Saudi Arabia",
	"SG": "Singapore",
	"TR": "Turkey",
	"US": "United States",
}

var aisKnownPorts = []aisKnownPort{
	{Locode: "AEFJR", Name: "Fujairah", CountryCode: "AE", CountryName: "United Arab Emirates", Lat: 25.12, Lng: 56.34, Aliases: []string{"FUJAIRAH", "FUJAIRAH.AE", "AE FJR"}},
	{Locode: "AEJEA", Name: "Jebel Ali", CountryCode: "AE", CountryName: "United Arab Emirates", Lat: 25.01, Lng: 55.06, Aliases: []string{"JEBEL ALI", "JEBELALI", "JEBELALI.AE", "AE JEA"}},
	{Locode: "AEDXB", Name: "Dubai", CountryCode: "AE", CountryName: "United Arab Emirates", Lat: 25.25, Lng: 55.36, Aliases: []string{"DUBAI", "DUBAI.AE", "AE DXB"}},
	{Locode: "BEANR", Name: "Antwerp", CountryCode: "BE", CountryName: "Belgium", Lat: 51.22, Lng: 4.40, Aliases: []string{"ANTWERP", "ANTWERP.BE", "ANTWERPEN", "BE ANR"}},
	{Locode: "BHBAH", Name: "Bahrain", CountryCode: "BH", CountryName: "Bahrain", Lat: 26.22, Lng: 50.58, Aliases: []string{"BAHRAIN", "BAHRAIN.BH", "BH BAH"}},
	{Locode: "BRSSZ", Name: "Santos", CountryCode: "BR", CountryName: "Brazil", Lat: -23.96, Lng: -46.33, Aliases: []string{"SANTOS", "SANTOS.BR", "BR SSZ"}},
	{Locode: "CNSHA", Name: "Shanghai", CountryCode: "CN", CountryName: "China", Lat: 31.23, Lng: 121.47, Aliases: []string{"SHANGHAI", "SHANGHAI.CN", "CN SHA"}},
	{Locode: "CNNGB", Name: "Ningbo", CountryCode: "CN", CountryName: "China", Lat: 29.87, Lng: 121.55, Aliases: []string{"NINGBO", "NINGBO.CN", "CN NGB"}},
	{Locode: "CNZOS", Name: "Zhoushan", CountryCode: "CN", CountryName: "China", Lat: 29.99, Lng: 122.20, Aliases: []string{"ZHOUSHAN", "ZHOUSHAN.CN", "CN ZOS"}},
	{Locode: "EGPSD", Name: "Port Said", CountryCode: "EG", CountryName: "Egypt", Lat: 31.26, Lng: 32.30, Aliases: []string{"PORT SAID", "PORTSAID", "PORTSAID.EG", "EG PSD"}},
	{Locode: "EGSUZ", Name: "Suez", CountryCode: "EG", CountryName: "Egypt", Lat: 29.97, Lng: 32.55, Aliases: []string{"SUEZ", "SUEZ.EG", "EG SUZ"}},
	{Locode: "FRLEH", Name: "Le Havre", CountryCode: "FR", CountryName: "France", Lat: 49.49, Lng: 0.11, Aliases: []string{"LE HAVRE", "LEHAVRE", "LEHAVRE.FR", "FR LEH"}},
	{Locode: "GBTEE", Name: "Teesport", CountryCode: "GB", CountryName: "United Kingdom", Lat: 54.59, Lng: -1.15, Aliases: []string{"TEESPORT", "TEES", "TEESPORT.GB", "GB TEE"}},
	{Locode: "GRPIR", Name: "Piraeus", CountryCode: "GR", CountryName: "Greece", Lat: 37.94, Lng: 23.64, Aliases: []string{"PIRAEUS", "PIRAEUS.GR", "GR PIR"}},
	{Locode: "INMUN", Name: "Mundra", CountryCode: "IN", CountryName: "India", Lat: 22.84, Lng: 69.72, Aliases: []string{"MUNDRA", "MUNDRA.IN", "IN MUN"}},
	{Locode: "INNSA", Name: "Nhava Sheva", CountryCode: "IN", CountryName: "India", Lat: 18.95, Lng: 72.95, Aliases: []string{"NHAVA SHEVA", "JNPT", "JAWAHARLAL NEHRU", "IN NSA"}},
	{Locode: "KRPUS", Name: "Busan", CountryCode: "KR", CountryName: "South Korea", Lat: 35.10, Lng: 129.04, Aliases: []string{"BUSAN", "PUSAN", "BUSAN.KR", "KR PUS"}},
	{Locode: "KRUSN", Name: "Ulsan", CountryCode: "KR", CountryName: "South Korea", Lat: 35.54, Lng: 129.31, Aliases: []string{"ULSAN", "ULSAN.KR", "KR USN"}},
	{Locode: "MYBTU", Name: "Bintulu", CountryCode: "MY", CountryName: "Malaysia", Lat: 3.17, Lng: 113.03, Aliases: []string{"BINTULU", "BINTULU.MY", "MY BTU"}},
	{Locode: "MYPKG", Name: "Port Klang", CountryCode: "MY", CountryName: "Malaysia", Lat: 3.00, Lng: 101.40, Aliases: []string{"PORT KLANG", "PORTKLANG", "KLANG", "MY PKG"}},
	{Locode: "NGLOS", Name: "Lagos", CountryCode: "NG", CountryName: "Nigeria", Lat: 6.45, Lng: 3.40, Aliases: []string{"LAGOS", "LAGOS.NG", "NG LOS"}},
	{Locode: "NLRTM", Name: "Rotterdam", CountryCode: "NL", CountryName: "Netherlands", Lat: 51.95, Lng: 4.14, Aliases: []string{"ROTTERDAM", "ROTTERDAM.NL", "NL RTM"}},
	{Locode: "NLVLI", Name: "Vlissingen", CountryCode: "NL", CountryName: "Netherlands", Lat: 51.44, Lng: 3.58, Aliases: []string{"VLISSINGEN", "VLISSINGEN.NL", "FLUSHING", "NL VLI"}},
	{Locode: "OMSOH", Name: "Sohar", CountryCode: "OM", CountryName: "Oman", Lat: 24.35, Lng: 56.74, Aliases: []string{"SOHAR", "SOHAR.OM", "OM SOH"}},
	{Locode: "OMSLL", Name: "Salalah", CountryCode: "OM", CountryName: "Oman", Lat: 16.94, Lng: 54.00, Aliases: []string{"SALALAH", "SALALAH.OM", "OM SLL"}},
	{Locode: "QAHMD", Name: "Hamad", CountryCode: "QA", CountryName: "Qatar", Lat: 25.01, Lng: 51.62, Aliases: []string{"HAMAD", "HAMAD.QA", "DOHA", "QA HMD"}},
	{Locode: "SADMM", Name: "Dammam", CountryCode: "SA", CountryName: "Saudi Arabia", Lat: 26.43, Lng: 50.10, Aliases: []string{"DAMMAM", "DAMMAM.SA", "SA DMM"}},
	{Locode: "SAJED", Name: "Jeddah", CountryCode: "SA", CountryName: "Saudi Arabia", Lat: 21.49, Lng: 39.19, Aliases: []string{"JEDDAH", "JEDDAH.SA", "SA JED"}},
	{Locode: "SGSIN", Name: "Singapore", CountryCode: "SG", CountryName: "Singapore", Lat: 1.29, Lng: 103.85, Aliases: []string{"SINGAPORE", "SINGAPORE.SG", "SG SIN"}},
	{Locode: "TRALI", Name: "Aliaga", CountryCode: "TR", CountryName: "Turkey", Lat: 38.80, Lng: 26.97, Aliases: []string{"ALIAGA", "ALIAGA.TR", "TR ALI"}},
	{Locode: "USCRP", Name: "Corpus Christi", CountryCode: "US", CountryName: "United States", Lat: 27.80, Lng: -97.40, Aliases: []string{"CORPUS CHRISTI", "CORPUSCHRISTI", "US CRP"}},
	{Locode: "USHOU", Name: "Houston", CountryCode: "US", CountryName: "United States", Lat: 29.76, Lng: -95.37, Aliases: []string{"HOUSTON", "HOUSTON.US", "US HOU"}},
	{Locode: "USMAH", Name: "Marcus Hook", CountryCode: "US", CountryName: "United States", Lat: 39.82, Lng: -75.42, Aliases: []string{"MARCUS HOOK", "MARCUSHOOK", "MARCUSHOOK.US", "US MAH"}},
	{Locode: "USNOL", Name: "New Orleans", CountryCode: "US", CountryName: "United States", Lat: 29.95, Lng: -90.07, Aliases: []string{"NEW ORLEANS", "NEWORLEANS", "US NOL"}},
}

func decodeAISDestination(raw string) map[string]any {
	raw = strings.TrimSpace(raw)
	if raw == "" || aisGenericDestinations[normalizeAISDestinationKey(raw)] {
		return nil
	}
	segments := splitAISDestinationSegments(raw)
	if len(segments) == 0 {
		return nil
	}

	candidates := make([]map[string]any, 0, len(segments))
	for i, segment := range segments {
		if candidate := matchAISDestinationSegment(segment, i); candidate != nil {
			candidates = append(candidates, candidate)
		}
	}
	if len(candidates) == 0 {
		return nil
	}

	var primary map[string]any
	if len(segments) > 1 {
		lastIdx := len(segments) - 1
		for _, candidate := range candidates {
			if intFromAny(candidate["segment_index"]) == lastIdx {
				primary = candidate
				break
			}
		}
	} else {
		primary = candidates[0]
	}

	out := map[string]any{
		"raw":          raw,
		"candidates":   candidates,
		"evidence":     "ais_destination_text",
		"source_label": "MadSan common AIS destination decoder",
	}
	if primary != nil {
		for k, v := range primary {
			if k == "segment" || k == "segment_index" {
				continue
			}
			out[k] = v
		}
		out["primary_segment"] = primary["segment"]
		out["primary_segment_index"] = primary["segment_index"]
	} else if len(segments) > 1 {
		out["unresolved_destination"] = segments[len(segments)-1]
		out["method"] = "partial_route_decode"
		out["confidence_score"] = 35.0
	}
	return out
}

func decodedAISDestinationLabel(decoded map[string]any) string {
	if len(decoded) == 0 {
		return ""
	}
	port := stringFromAny(decoded["port_name"])
	country := stringFromAny(decoded["country_name"])
	if port != "" {
		if country == "" {
			return port
		}
		return port + ", " + country
	}
	unresolved := stringFromAny(decoded["unresolved_destination"])
	if unresolved == "" {
		return ""
	}
	if candidates, ok := decoded["candidates"].([]map[string]any); ok && len(candidates) > 0 {
		if clue := decodedAISDestinationLabel(candidates[len(candidates)-1]); clue != "" {
			return unresolved + " unresolved; clue " + clue
		}
	}
	return unresolved + " unresolved"
}

func splitAISDestinationSegments(raw string) []string {
	upper := strings.ToUpper(strings.TrimSpace(raw))
	for _, repl := range []string{"->", "=>", " TO "} {
		upper = strings.ReplaceAll(upper, repl, ">")
	}
	var parts []string
	if strings.Contains(upper, ">") {
		for _, part := range strings.Split(upper, ">") {
			part = cleanAISDestinationSegment(part)
			if part != "" && !aisGenericDestinations[normalizeAISDestinationKey(part)] {
				parts = append(parts, part)
			}
		}
		return parts
	}
	if matches := aisLocodeRE.FindAllString(upper, -1); len(matches) > 1 {
		for _, match := range matches {
			part := cleanAISDestinationSegment(match)
			if part != "" {
				parts = append(parts, part)
			}
		}
		return parts
	}
	part := cleanAISDestinationSegment(upper)
	if part == "" || aisGenericDestinations[normalizeAISDestinationKey(part)] {
		return nil
	}
	return []string{part}
}

func matchAISDestinationSegment(segment string, idx int) map[string]any {
	if port, ok := findKnownAISPort(segment); ok {
		return mapKnownAISPort(port, "known_port_alias", 86, segment, idx)
	}
	if m := aisLocodeRE.FindStringSubmatch(segment); len(m) == 3 {
		locodeKey := normalizeAISDestinationKey(m[1] + m[2])
		if port, ok := findKnownAISPort(locodeKey); ok {
			return mapKnownAISPort(port, "locode_exact", 90, segment, idx)
		}
	}
	if m := aisNameCountryRE.FindStringSubmatch(strings.ToUpper(strings.TrimSpace(segment))); len(m) == 3 {
		name := cleanAISReadableName(m[1])
		countryCode := strings.ToUpper(m[2])
		if countryName := aisCountryNames[countryCode]; countryName != "" {
			return map[string]any{
				"port_name":        name,
				"country_code":     countryCode,
				"country_name":     countryName,
				"method":           "name_country_hint",
				"confidence_score": 70.0,
				"evidence_label":   "inferred",
				"segment":          segment,
				"segment_index":    idx,
			}
		}
	}
	key := normalizeAISDestinationKey(segment)
	if len(key) >= 4 {
		for _, port := range aisKnownPorts {
			if strings.Contains(key, normalizeAISDestinationKey(port.Name)) {
				return mapKnownAISPort(port, "port_name_contains", 68, segment, idx)
			}
		}
	}
	return nil
}

func findKnownAISPort(value string) (aisKnownPort, bool) {
	key := normalizeAISDestinationKey(value)
	for _, port := range aisKnownPorts {
		aliases := append([]string{port.Locode, port.Name, port.CountryCode + port.Locode[2:]}, port.Aliases...)
		for _, alias := range aliases {
			if key == normalizeAISDestinationKey(alias) {
				return port, true
			}
		}
	}
	return aisKnownPort{}, false
}

func mapKnownAISPort(port aisKnownPort, method string, confidence float64, segment string, idx int) map[string]any {
	return map[string]any{
		"locode":           port.Locode,
		"port_name":        port.Name,
		"country_code":     port.CountryCode,
		"country_name":     port.CountryName,
		"lat":              port.Lat,
		"lng":              port.Lng,
		"method":           method,
		"confidence_score": confidence,
		"evidence_label":   "inferred",
		"segment":          segment,
		"segment_index":    idx,
	}
}

func cleanAISDestinationSegment(value string) string {
	value = strings.TrimSpace(value)
	value = strings.Trim(value, ".,;:/\\|")
	value = strings.Join(strings.Fields(value), " ")
	return value
}

func cleanAISReadableName(value string) string {
	value = strings.ReplaceAll(value, ".", " ")
	value = strings.ReplaceAll(value, "_", " ")
	value = strings.Join(strings.Fields(value), " ")
	if value == "" {
		return ""
	}
	words := strings.Fields(strings.ToLower(value))
	for i, word := range words {
		runes := []rune(word)
		if len(runes) == 0 {
			continue
		}
		runes[0] = unicode.ToUpper(runes[0])
		words[i] = string(runes)
	}
	return strings.Join(words, " ")
}

func normalizeAISDestinationKey(value string) string {
	value = strings.ToUpper(strings.TrimSpace(value))
	var b strings.Builder
	for _, r := range value {
		if (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
		}
	}
	return b.String()
}
