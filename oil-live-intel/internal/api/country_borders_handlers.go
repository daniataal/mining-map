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

	"github.com/mining-map/oil-live-intel/internal/data"
	"github.com/mining-map/oil-live-intel/internal/services/countrymatch"
)

var spacesRe = regexp.MustCompile(`\s+`)

func normalizeCountryName(value string) string {
	return countrymatch.NormalizeCountryName(value)
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
