package api

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"sync"
	"unicode"

	"github.com/mining-map/oil-live-intel/internal/data"
	"golang.org/x/text/runes"
	"golang.org/x/text/transform"
	"golang.org/x/text/unicode/norm"
)

var countryAliases = map[string]string{
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
	"venezuela":                    "venezuela bolivarian republic of",
	"viet nam":                     "vietnam",
}

var (
	nonAlnumRe = regexp.MustCompile(`[^a-z0-9]+`)
	spacesRe   = regexp.MustCompile(`\s+`)
)

func normalizeCountryName(value string) string {
	t := transform.Chain(norm.NFD, runes.Remove(runes.In(unicode.Mn)), norm.NFC)
	s, _, _ := transform.String(t, value)
	s = strings.ToLower(strings.TrimSpace(s))
	s = strings.ReplaceAll(s, "&", " and ")

	s = nonAlnumRe.ReplaceAllString(s, " ")
	s = strings.TrimSpace(spacesRe.ReplaceAllString(s, " "))

	if alias, ok := countryAliases[s]; ok {
		return alias
	}
	return s
}

func parseRequestedCountries(raw string) []string {
	if raw == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	var out []string
	for _, p := range parts {
		p = strings.TrimSpace(spacesRe.ReplaceAllString(p, " "))
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

type GeoJSONFeature struct {
	Type       string                 `json:"type"`
	Properties map[string]interface{} `json:"properties"`
	Geometry   interface{}            `json:"geometry"`
}

type GeoJSONFeatureCollection struct {
	Type     string           `json:"type"`
	Features []GeoJSONFeature `json:"features"`
}

var (
	cachedCollection *GeoJSONFeatureCollection
	baseEtag         string
	loadOnce         sync.Once
)

func loadCountryBorders() {
	loadOnce.Do(func() {
		var coll GeoJSONFeatureCollection
		if err := json.Unmarshal(data.CountryBordersGeoJSON, &coll); err != nil {
			panic("invalid country_borders.geojson embedded data: " + err.Error())
		}
		cachedCollection = &coll

		h := sha256.New()
		h.Write(data.CountryBordersGeoJSON)
		baseEtag = hex.EncodeToString(h.Sum(nil))
	})
}

func featureMatches(feature GeoJSONFeature, requested map[string]bool) bool {
	keys := []string{"ADMIN", "name", "NAME", "formal_en"}
	for _, k := range keys {
		if val, ok := feature.Properties[k].(string); ok {
			if requested[normalizeCountryName(val)] {
				return true
			}
		}
	}
	return false
}

func (s *Server) CountryBorders(w http.ResponseWriter, r *http.Request) {
	loadCountryBorders()

	requestedStr := r.URL.Query().Get("countries")
	parsed := parseRequestedCountries(requestedStr)

	var requested []string
	reqSet := make(map[string]bool)
	for _, c := range parsed {
		normC := normalizeCountryName(c)
		if normC != "" && !reqSet[normC] {
			reqSet[normC] = true
			requested = append(requested, normC)
		}
	}
	sort.Strings(requested)

	var payload GeoJSONFeatureCollection
	var etag string

	if len(requested) == 0 {
		payload = *cachedCollection
		etag = baseEtag
	} else {
		payload.Type = "FeatureCollection"
		for _, f := range cachedCollection.Features {
			if featureMatches(f, reqSet) {
				payload.Features = append(payload.Features, f)
			}
		}
		if payload.Features == nil {
			payload.Features = []GeoJSONFeature{} // ensure json emits [] instead of null
		}
		
		h := sha256.New()
		h.Write([]byte(baseEtag + "|" + strings.Join(requested, ",")))
		etag = hex.EncodeToString(h.Sum(nil))
	}

	ifMatch := r.Header.Get("If-None-Match")
	if ifMatch == etag {
		w.Header().Set("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800")
		w.Header().Set("ETag", etag)
		w.WriteHeader(http.StatusNotModified)
		return
	}

	w.Header().Set("Content-Type", "application/geo+json")
	w.Header().Set("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800")
	w.Header().Set("ETag", etag)

	if err := json.NewEncoder(w).Encode(payload); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
	}
}
