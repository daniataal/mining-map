package maritime

import "math"

// MinTrackSegmentM is the minimum movement between two AIS fixes to infer bearing.
const MinTrackSegmentM = 80.0

// VesselTrackBearingLateralSQL joins the latest ais_positions segment as track.inferred_course (degrees).
const VesselTrackBearingLateralSQL = `
LEFT JOIN LATERAL (
	SELECT ROUND(degrees(ST_Azimuth(
		ST_SetSRID(ST_MakePoint(prev.lon, prev.lat), 4326)::geography,
		ST_SetSRID(ST_MakePoint(curr.lon, curr.lat), 4326)::geography
	))::numeric, 1)::float8 AS inferred_course
	FROM (
		SELECT lat, lon, ROW_NUMBER() OVER (ORDER BY ts DESC) AS rn
		FROM ais_positions
		WHERE mmsi = v.mmsi
		LIMIT 2
	) curr
	JOIN (
		SELECT lat, lon, ROW_NUMBER() OVER (ORDER BY ts DESC) AS rn
		FROM ais_positions
		WHERE mmsi = v.mmsi
		LIMIT 2
	) prev ON prev.rn = curr.rn + 1
	WHERE curr.rn = 1
	  AND ST_Distance(
		ST_SetSRID(ST_MakePoint(prev.lon, prev.lat), 4326)::geography,
		ST_SetSRID(ST_MakePoint(curr.lon, curr.lat), 4326)::geography
	  ) >= 80
) track ON true`

// BearingFromDelta returns initial bearing (0=north, clockwise) between two WGS84 points.
func BearingFromDelta(lat1, lon1, lat2, lon2 float64) float64 {
	φ1 := lat1 * math.Pi / 180
	φ2 := lat2 * math.Pi / 180
	Δλ := (lon2 - lon1) * math.Pi / 180
	y := math.Sin(Δλ) * math.Cos(φ2)
	x := math.Cos(φ1)*math.Sin(φ2) - math.Sin(φ1)*math.Cos(φ2)*math.Cos(Δλ)
	θ := math.Atan2(y, x) * 180 / math.Pi
	return math.Mod(θ+360, 360)
}

// HaversineM returns great-circle distance in meters between two WGS84 points.
func HaversineM(lat1, lon1, lat2, lon2 float64) float64 {
	const r = 6371000
	φ1 := lat1 * math.Pi / 180
	φ2 := lat2 * math.Pi / 180
	Δφ := (lat2 - lat1) * math.Pi / 180
	Δλ := (lon2 - lon1) * math.Pi / 180
	a := math.Sin(Δφ/2)*math.Sin(Δφ/2) +
		math.Cos(φ1)*math.Cos(φ2)*math.Sin(Δλ/2)*math.Sin(Δλ/2)
	return 2 * r * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
}
