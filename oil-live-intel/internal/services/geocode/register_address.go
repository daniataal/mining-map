package geocode

import (
	"regexp"
	"strings"
)

var sgPostalRe = regexp.MustCompile(`\b(\d{6})\b`)

// ParsedRegisterAddress splits a bunker register line into geocode-friendly parts.
type ParsedRegisterAddress struct {
	Raw         string
	Street      string
	PostalCode  string
	Building    string
	Country     string
	FreeText    string
	Structured  bool
}

var unitSplitRe = regexp.MustCompile(`\s*#\s*`)
var leadingUnitRe = regexp.MustCompile(`^\d{1,4}-\d{1,4}(?:/\d{1,4})?\s+`)

// ParseRegisterAddress normalizes MPA-style lines for Nominatim structured search.
func ParseRegisterAddress(address, country string) ParsedRegisterAddress {
	raw := strings.TrimSpace(address)
	out := ParsedRegisterAddress{
		Raw:     raw,
		Country: strings.TrimSpace(country),
	}
	if raw == "" {
		return out
	}

	if m := sgPostalRe.FindStringSubmatch(raw); len(m) == 2 {
		out.PostalCode = m[1]
	}

	parts := unitSplitRe.Split(raw, 2)
	streetPart := strings.TrimSpace(parts[0])
	if len(parts) == 2 {
		rest := strings.TrimSpace(parts[1])
		rest = leadingUnitRe.ReplaceAllString(rest, "")
		if idx := strings.Index(strings.ToLower(rest), ", singapore"); idx >= 0 {
			out.Building = strings.TrimSpace(rest[:idx])
		} else if idx := strings.Index(rest, ","); idx >= 0 {
			out.Building = strings.TrimSpace(rest[:idx])
		} else {
			out.Building = rest
		}
	} else if idx := strings.Index(strings.ToLower(streetPart), ", singapore"); idx >= 0 {
		streetPart = strings.TrimSpace(streetPart[:idx])
	}
	out.Street = streetPart

	if out.Street != "" && out.PostalCode != "" && out.Country != "" {
		out.Structured = true
	}

	out.FreeText = firstNonEmpty(RegisterAddressFallbackQueries(out)...)
	return out
}

// RegisterAddressFallbackQueries returns ordered Nominatim free-text attempts.
func RegisterAddressFallbackQueries(parsed ParsedRegisterAddress) []string {
	out := make([]string, 0, 4)
	seen := map[string]struct{}{}
	add := func(q string) {
		q = strings.TrimSpace(q)
		if q == "" {
			return
		}
		if _, ok := seen[q]; ok {
			return
		}
		seen[q] = struct{}{}
		out = append(out, q)
	}
	if parsed.Street != "" && parsed.PostalCode != "" && parsed.Country != "" {
		add(parsed.Street + ", " + parsed.Country + " " + parsed.PostalCode)
	}
	if parsed.Street != "" && parsed.Country != "" {
		add(parsed.Street + ", " + parsed.Country)
	}
	if parsed.Building != "" && parsed.Country != "" {
		add(parsed.Building + ", " + parsed.Country)
	}
	add(normalizeFreeText(parsed.Raw, parsed.Country))
	return out
}

func normalizeFreeText(address, country string) string {
	q := strings.ReplaceAll(address, "#", " ")
	q = strings.Join(strings.Fields(q), " ")
	if country != "" && !strings.Contains(strings.ToLower(q), strings.ToLower(country)) {
		q += ", " + country
	}
	return q
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}
