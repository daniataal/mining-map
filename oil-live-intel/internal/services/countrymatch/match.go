package countrymatch

import (
	"regexp"
	"strings"
	"unicode"

	"golang.org/x/text/runes"
	"golang.org/x/text/transform"
	"golang.org/x/text/unicode/norm"
)

// Aliases align with map border GeoJSON ADMIN names and oil_companies.country variants.
var aliases = map[string]string{
	"cape verde":                   "cabo verde",
	"congo kinshasa":               "democratic republic of the congo",
	"congo brazzaville":            "republic of the congo",
	"cote divoire":                 "cote d ivoire",
	"czech republic":               "czechia",
	"dem rep congo":                "democratic republic of the congo",
	"democratic republic of congo": "democratic republic of the congo",
	"drc":                          "democratic republic of the congo",
	"ivory coast":                  "cote d ivoire",
	"laos":                         "lao pdr",
	"macedonia":                    "north macedonia",
	"myanmar burma":                "myanmar",
	"palestine":                    "state of palestine",
	"republic of congo":            "republic of the congo",
	"republic of moldova":          "moldova",
	"republic of north macedonia":  "north macedonia",
	"russia":                       "russian federation",
	"south korea":                  "korea",
	"swaziland":                    "eswatini",
	"syria":                        "syrian arab republic",
	"tanzania":                     "united republic of tanzania",
	"the bahamas":                  "bahamas",
	"the gambia":                   "gambia",
	"timor leste":                  "east timor",
	"uae":                          "united arab emirates",
	"uk":                           "united kingdom",
	"usa":                          "united states of america",
	"united states":                "united states of america",
	"us":                           "united states of america",
	"venezuela":                    "venezuela bolivarian republic of",
	"viet nam":                     "vietnam",
}

var (
	nonAlnumRe = regexp.MustCompile(`[^a-z0-9]+`)
	spacesRe   = regexp.MustCompile(`\s+`)
)

// NormalizeCountryName lowercases, strips diacritics, and resolves known aliases to a canonical key.
func NormalizeCountryName(value string) string {
	t := transform.Chain(norm.NFD, runes.Remove(runes.In(unicode.Mn)), norm.NFC)
	s, _, _ := transform.String(t, value)
	s = strings.ToLower(strings.TrimSpace(s))
	s = strings.ReplaceAll(s, "&", " and ")
	s = nonAlnumRe.ReplaceAllString(s, " ")
	s = strings.TrimSpace(spacesRe.ReplaceAllString(s, " "))
	if alias, ok := aliases[s]; ok {
		return alias
	}
	return s
}

// KeysMatch reports whether two country labels refer to the same jurisdiction.
func KeysMatch(a, b string) bool {
	if strings.TrimSpace(a) == "" || strings.TrimSpace(b) == "" {
		return false
	}
	return NormalizeCountryName(a) == NormalizeCountryName(b)
}

// MatchKeys returns lowercase keys for SQL IN/ANY matching against TRIM(country).
func MatchKeys(name string) []string {
	canon := NormalizeCountryName(name)
	seen := map[string]struct{}{canon: {}}
	for alias, target := range aliases {
		if target == canon {
			seen[alias] = struct{}{}
		}
	}
	raw := strings.ToLower(strings.TrimSpace(name))
	if raw != "" {
		seen[raw] = struct{}{}
	}
	out := make([]string, 0, len(seen))
	for k := range seen {
		out = append(out, k)
	}
	return out
}
