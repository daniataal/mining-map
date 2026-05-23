// Package licensemap ports Python backend/services/license_map_perf.py for Go read paths.
package licensemap

import "math"

// GridDegrees returns server-side cluster grid size; nil means individual points (z >= 7).
func GridDegrees(zoom *float64) *float64 {
	if zoom == nil {
		return nil
	}
	z := *zoom
	if z >= 7 {
		return nil
	}
	if z < 3 {
		g := 16.0
		return &g
	}
	if z < 4 {
		g := 12.0
		return &g
	}
	if z < 5 {
		g := 8.0
		return &g
	}
	g := 6.0
	return &g
}

// ClusterMinCount drops singleton grid cells; coarse cells need more licenses.
func ClusterMinCount(gridDeg float64) int {
	if gridDeg >= 12.0 {
		return 4
	}
	if gridDeg >= 4.0 {
		return 3
	}
	return 2
}

// ClusterLimitForZoom caps markers at world zoom.
func ClusterLimitForZoom(zoom *float64, requested int) int {
	if requested <= 0 {
		requested = 800
	}
	if zoom == nil {
		if requested > 2000 {
			return 2000
		}
		if requested < 1 {
			return 1
		}
		return requested
	}
	z := *zoom
	if z < 3 {
		if requested < 60 {
			return requested
		}
		return 60
	}
	if z < 5 {
		if requested < 120 {
			return requested
		}
		return 120
	}
	if z < 8 {
		if requested < 350 {
			return requested
		}
		return 350
	}
	if requested > 2000 {
		return 2000
	}
	if requested < 1 {
		return 1
	}
	return requested
}

// SimplifyToleranceForZoom returns degrees tolerance for ST_Simplify on WGS84 geometries.
func SimplifyToleranceForZoom(zoom *float64) float64 {
	if zoom == nil {
		return 0
	}
	z := *zoom
	if z >= 10 {
		return 0
	}
	if z >= 8 {
		return 0.02
	}
	return math.Min(0.35, 0.04*math.Pow(2, 8-z))
}
