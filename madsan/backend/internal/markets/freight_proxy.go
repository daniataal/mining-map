package markets

import "math"

// FreightBandUSDPerBBL holds low/base/high freight estimates in USD/bbl.
type FreightBandUSDPerBBL struct {
	Low      float64
	Base     float64
	High     float64
	DistanceNM float64
	Method   string
	Source   string
}

// GreatCircleDistanceNM returns nautical miles between WGS84 points.
func GreatCircleDistanceNM(lat1, lon1, lat2, lon2 float64) float64 {
	const earthRadiusM = 6371000.0
	const mPerNM = 1852.0
	φ1 := lat1 * math.Pi / 180
	φ2 := lat2 * math.Pi / 180
	Δφ := (lat2 - lat1) * math.Pi / 180
	Δλ := (lon2 - lon1) * math.Pi / 180
	a := math.Sin(Δφ/2)*math.Sin(Δφ/2) +
		math.Cos(φ1)*math.Cos(φ2)*math.Sin(Δλ/2)*math.Sin(Δλ/2)
	meters := 2 * earthRadiusM * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
	return meters / mPerNM
}

// EstimateFreightBandUSDPerBBL uses great-circle distance and open UNCTAD/OECD-style
// tanker cost proxies. Values are indicative scenario bands, not charter fixtures.
func EstimateFreightBandUSDPerBBL(lat1, lon1, lat2, lon2 float64, vesselClass string) FreightBandUSDPerBBL {
	distanceNM := GreatCircleDistanceNM(lat1, lon1, lat2, lon2)
	if distanceNM < 1 {
		distanceNM = 1
	}
	// Open proxy: ~0.0008–0.0016 USD/bbl/nm for crude tankers (scenario calibration).
	rateLow := 0.00075
	rateBase := 0.00105
	rateHigh := 0.00145
	switch vesselClass {
	case "VLCC", "ULCC":
		rateLow, rateBase, rateHigh = 0.00055, 0.00085, 0.00115
	case "Suezmax":
		rateLow, rateBase, rateHigh = 0.00065, 0.00095, 0.00125
	case "Aframax", "Panamax":
		rateLow, rateBase, rateHigh = 0.00080, 0.00110, 0.00150
	case "MR", "Handysize":
		rateLow, rateBase, rateHigh = 0.00100, 0.00135, 0.00185
	}
	return FreightBandUSDPerBBL{
		Low:        round4(distanceNM * rateLow),
		Base:       round4(distanceNM * rateBase),
		High:       round4(distanceNM * rateHigh),
		DistanceNM: round2(distanceNM),
		Method:     "great_circle_unctad_oecd_proxy",
		Source:     "open_distance_proxy_v1",
	}
}

func round2(v float64) float64 {
	return math.Round(v*100) / 100
}

func round4(v float64) float64 {
	return math.Round(v*10000) / 10000
}
