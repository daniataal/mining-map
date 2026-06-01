package licensemap

import "strings"

// landBBox is an approximate onshore bounds box for cluster placement (not cadastre).
type landBBox struct {
	MinLat, MaxLat, MinLng, MaxLng float64
}

func (b landBBox) center() (float64, float64) {
	return (b.MinLat + b.MaxLat) / 2, (b.MinLng + b.MaxLng) / 2
}

func (b landBBox) contains(lat, lng float64) bool {
	return lat >= b.MinLat && lat <= b.MaxLat && lng >= b.MinLng && lng <= b.MaxLng
}

// countryLandBBoxes — coarse land envelopes for low-zoom cluster bubbles (open-data coords drift offshore).
var countryLandBBoxes = map[string]landBBox{
	"ghana":                        {4.5, 11.5, -3.5, 1.5},
	"cote d'ivoire":                 {4.2, 10.7, -8.6, -2.5},
	"côte d'ivoire":                 {4.2, 10.7, -8.6, -2.5},
	"ivory coast":                   {4.2, 10.7, -8.6, -2.5},
	"nigeria":                       {4.0, 14.0, 2.7, 14.5},
	"senegal":                       {12.0, 16.8, -17.8, -11.2},
	"mali":                          {10.0, 25.0, -12.5, 4.5},
	"burkina faso":                  {9.2, 15.1, -5.6, 2.5},
	"guinea":                        {7.0, 12.8, -15.5, -7.5},
	"liberia":                       {4.2, 8.6, -11.6, -7.2},
	"sierra leone":                  {6.8, 10.1, -13.5, -10.0},
	"togo":                          {6.0, 11.2, -0.2, 1.9},
	"benin":                         {6.0, 12.5, 0.6, 3.9},
	"niger":                         {11.5, 23.5, 0.8, 16.0},
	"cameroon":                      {1.5, 13.2, 8.3, 16.3},
	"gabon":                         {-4.0, 2.5, 8.5, 14.8},
	"congo":                         {-5.2, 3.8, 11.0, 18.8},
	"democratic republic of the congo": {-13.5, 5.5, 12.0, 31.5},
	"angola":                        {-18.5, -4.2, 11.5, 24.3},
	"namibia":                       {-28.5, -16.8, 11.5, 25.5},
	"south africa":                  {-35.0, -22.0, 16.0, 33.0},
	"zambia":                        {-18.5, -8.0, 21.9, 33.8},
	"zimbabwe":                      {-22.5, -15.5, 25.0, 33.2},
	"mozambique":                    {-26.9, -10.3, 30.0, 41.0},
	"kenya":                         {-4.8, 5.5, 33.5, 42.0},
	"tanzania":                      {-11.8, -0.9, 29.0, 40.8},
	"ethiopia":                      {3.0, 14.9, 32.9, 48.0},
	"egypt":                         {22.0, 31.8, 24.5, 37.0},
	"morocco":                       {27.5, 35.9, -13.5, -0.9},
	"algeria":                       {18.9, 37.2, -8.8, 12.0},
	"mauritania":                    {14.5, 27.5, -17.2, -4.5},
	"sudan":                         {8.5, 22.5, 21.5, 39.0},
	"uganda":                        {-1.5, 4.3, 29.5, 35.1},
	"botswana":                      {-26.9, -17.7, 19.9, 29.5},
	"madagascar":                    {-25.8, -11.8, 43.0, 50.6},
	"peru":                          {-18.5, -0.5, -81.5, -68.5},
	"chile":                         {-56.0, -17.5, -76.0, -66.0},
	"brazil":                        {-33.8, 5.5, -74.0, -34.0},
	"australia":                     {-44.0, -10.0, 112.0, 154.0},
	"canada":                        {41.5, 83.5, -141.5, -52.0},
	"saudi arabia":                  {16.0, 32.5, 34.5, 55.5},
	"united arab emirates":          {22.5, 26.5, 51.0, 56.5},
	"uae":                           {22.5, 26.5, 51.0, 56.5},
}

func normalizeCountryLandKey(country string) string {
	s := strings.TrimSpace(strings.ToLower(country))
	s = strings.ReplaceAll(s, "’", "'")
	return s
}

// CountryLandBBox returns a coarse onshore envelope for cluster placement.
func CountryLandBBox(country string) (landBBox, bool) {
	if country == "" {
		return landBBox{}, false
	}
	b, ok := countryLandBBoxes[normalizeCountryLandKey(country)]
	return b, ok
}

// RefineClusterLandPosition snaps offshore/mis-tagged cluster centers onto country land.
func RefineClusterLandPosition(lat, lng float64, country string) (float64, float64) {
	bbox, ok := CountryLandBBox(country)
	if !ok {
		return lat, lng
	}
	if bbox.contains(lat, lng) {
		return lat, lng
	}
	return bbox.center()
}
