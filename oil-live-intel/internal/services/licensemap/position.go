package licensemap

import "math"

// ViewportGridCellCenter returns the center of a viewport-anchored grid cell.
func ViewportGridCellCenter(minLat, minLng, gridDeg float64, latBucket, lngBucket int) (float64, float64) {
	half := gridDeg / 2
	return minLat + float64(latBucket)*gridDeg + half,
		minLng + float64(lngBucket)*gridDeg + half
}

// dominantClusterCenter picks the largest grid cell center (not count-weighted centroid).
func dominantClusterCenter(clusters []ClusterMarker) (lat, lng float64, ok bool) {
	best := -1
	for _, c := range clusters {
		if c.MapClusterCount > best {
			best = c.MapClusterCount
			lat, lng = c.Lat, c.Lng
		}
	}
	return lat, lng, best >= 0
}

func clusterInsideViewportInterior(lat, lng, minLat, maxLat, minLng, maxLng, gridDeg float64) bool {
	if lat < minLat || lat > maxLat || lng < minLng || lng > maxLng {
		return false
	}
	if gridDeg <= 0 {
		gridDeg = 8
	}
	edge := math.Max(gridDeg*0.25, 0.5)
	if lat-minLat < edge || maxLat-lat < edge || lng-minLng < edge || maxLng-lng < edge {
		return false
	}
	return true
}

// snapClusterToViewport keeps in-bbox grid centers; misaligned cells snap to viewport center.
func snapClusterToViewport(lat, lng, minLat, maxLat, minLng, maxLng, gridDeg float64) (float64, float64) {
	if gridDeg <= 0 {
		gridDeg = 8
	}
	if clusterInsideViewportInterior(lat, lng, minLat, maxLat, minLng, maxLng, gridDeg) {
		return lat, lng
	}
	return (minLat + maxLat) / 2, (minLng + maxLng) / 2
}

func clusterCellKey(lat, lng, gridDeg, originLat, originLng float64) (int, int) {
	half := gridDeg / 2
	return int(math.Floor((lat - originLat - half) / gridDeg)), int(math.Floor((lng - originLng - half) / gridDeg))
}
