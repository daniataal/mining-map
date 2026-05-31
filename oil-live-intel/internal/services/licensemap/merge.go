package licensemap

import (
	"fmt"
	"math"
	"sort"
)

type clusterCell struct {
	lat, lng float64
	count    int
	country  string
	sector   string
}

func clusterCellKey(lat, lng, gridDeg float64) (int, int) {
	// SQL centers cells at FLOOR(coord/g)*g + g/2 — invert that for neighbor merge keys.
	half := gridDeg / 2
	return int(math.Floor((lat - half) / gridDeg)), int(math.Floor((lng - half) / gridDeg))
}

// MergeClusters combines neighboring grid bubbles to reduce overlap at continental zoom.
func MergeClusters(clusters []ClusterMarker, gridDeg float64) []ClusterMarker {
	if len(clusters) < 2 || gridDeg <= 0 {
		return clusters
	}

	parent := make([]int, len(clusters))
	for i := range parent {
		parent[i] = i
	}
	find := func(i int) int {
		for parent[i] != i {
			parent[i] = parent[parent[i]]
			i = parent[i]
		}
		return i
	}
	union := func(i, j int) {
		pi, pj := find(i), find(j)
		if pi != pj {
			parent[pj] = pi
		}
	}

	cells := map[[2]int][]int{}
	for idx, c := range clusters {
		latKey, lngKey := clusterCellKey(c.Lat, c.Lng, gridDeg)
		key := [2]int{latKey, lngKey}
		cells[key] = append(cells[key], idx)
	}
	for key, members := range cells {
		for dy := -1; dy <= 1; dy++ {
			for dx := -1; dx <= 1; dx++ {
				if dy == 0 && dx == 0 {
					continue
				}
				neighbor := [2]int{key[0] + dy, key[1] + dx}
				others, ok := cells[neighbor]
				if !ok {
					continue
				}
				for _, i := range members {
					for _, j := range others {
						if clusters[i].Country == clusters[j].Country {
							union(i, j)
						}
					}
				}
			}
		}
	}

	groups := map[int][]int{}
	for idx := range clusters {
		root := find(idx)
		groups[root] = append(groups[root], idx)
	}

	out := make([]ClusterMarker, 0, len(groups))
	for _, members := range groups {
		if len(members) == 1 {
			out = append(out, clusters[members[0]])
			continue
		}
		total := 0
		wlat := 0.0
		wlng := 0.0
		country := ""
		sector := "mining"
		for _, idx := range members {
			c := clusters[idx]
			total += c.MapClusterCount
			wlat += c.Lat * float64(c.MapClusterCount)
			wlng += c.Lng * float64(c.MapClusterCount)
			if country == "" && c.Country != "" {
				country = c.Country
			}
			if c.Sector != "" {
				sector = c.Sector
			}
		}
		if total <= 0 {
			out = append(out, clusters[members[0]])
			continue
		}
		lat := wlat / float64(total)
		lng := wlng / float64(total)
		out = append(out, ClusterMarker{
			ID:                fmt.Sprintf("cluster:%.4f:%.4f", lat, lng),
			Company:           fmt.Sprintf("%d licenses", total),
			LicenseType:       "Cluster",
			Commodity:         "",
			Status:            "Active",
			Date:              nil,
			Country:           country,
			Region:            "",
			Sector:            sector,
			Lat:               lat,
			Lng:               lng,
			MapClusterCount:   total,
			MapClusterGridDeg: gridDeg,
			EntityKind:        "license",
		})
	}

	sort.Slice(out, func(i, j int) bool {
		return out[i].MapClusterCount > out[j].MapClusterCount
	})
	return out
}

// CollapseClustersTightViewport merges clusters into one bubble for country/regional zoom (z < 8).
func CollapseClustersTightViewport(
	clusters []ClusterMarker,
	minLat, maxLat, minLng, maxLng float64,
	zoom *float64,
) []ClusterMarker {
	if len(clusters) <= 1 {
		return clusters
	}
	span := math.Max(maxLat-minLat, maxLng-minLng)
	z := 99.0
	if zoom != nil {
		z = *zoom
	}
	grid := clusters[0].MapClusterGridDeg
	shouldCollapse := (z < 8 && span > 0 && span < 22) || (grid > 0 && span < grid*1.5)
	if !shouldCollapse {
		return clusters
	}
	
	byCountry := map[string][]ClusterMarker{}
	for _, c := range clusters {
		byCountry[c.Country] = append(byCountry[c.Country], c)
	}
	
	var out []ClusterMarker
	for _, cc := range byCountry {
		out = append(out, mergeClusterMarkers(cc)...)
	}
	return out
}

func mergeClusterMarkers(clusters []ClusterMarker) []ClusterMarker {
	total := 0
	wlat := 0.0
	wlng := 0.0
	country := ""
	sector := "mining"
	grid := clusters[0].MapClusterGridDeg
	for _, c := range clusters {
		total += c.MapClusterCount
		wlat += c.Lat * float64(c.MapClusterCount)
		wlng += c.Lng * float64(c.MapClusterCount)
		if country == "" && c.Country != "" {
			country = c.Country
		}
		if c.Sector != "" {
			sector = c.Sector
		}
	}
	if total <= 0 {
		return clusters
	}
	lat := wlat / float64(total)
	lng := wlng / float64(total)
	return []ClusterMarker{{
		ID:                fmt.Sprintf("cluster:%.4f:%.4f", lat, lng),
		Company:           fmt.Sprintf("%d licenses", total),
		LicenseType:       "Cluster",
		Commodity:         "",
		Status:            "Active",
		Date:              nil,
		Country:           country,
		Region:            "",
		Sector:            sector,
		Lat:               lat,
		Lng:               lng,
		MapClusterCount:   total,
		MapClusterGridDeg: grid,
		EntityKind:        "license",
	}}
}
