package licensemap

import (
	"fmt"
	"math"
	"sort"
)

// MergeClusters combines neighboring grid bubbles to reduce overlap at continental zoom.
func MergeClusters(clusters []ClusterMarker, gridDeg, originLat, originLng float64) []ClusterMarker {
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
		latKey, lngKey := clusterCellKey(c.Lat, c.Lng, gridDeg, originLat, originLng)
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
		country := ""
		sector := "mining"
		group := make([]ClusterMarker, 0, len(members))
		for _, idx := range members {
			c := clusters[idx]
			total += c.MapClusterCount
			group = append(group, c)
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
		lat, lng, ok := dominantClusterCenter(group)
		if !ok {
			out = append(out, clusters[members[0]])
			continue
		}
		lat, lng = RefineClusterLandPosition(lat, lng, country)
		out = append(out, ClusterMarker{
			ID:                fmt.Sprintf("cluster:%s:%.4f:%.4f", country, lat, lng),
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

// maxViewportClusterMergeTotal avoids one misleading mega-bubble (e.g. country focus at z 6–7).
const maxViewportClusterMergeTotal = 400

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
		total := 0
		for _, c := range cc {
			total += c.MapClusterCount
		}
		if total > maxViewportClusterMergeTotal {
			out = append(out, cc...)
			continue
		}
		out = append(out, mergeClusterMarkers(cc, minLat, maxLat, minLng, maxLng)...)
	}
	return out
}

func mergeClusterMarkers(clusters []ClusterMarker, minLat, maxLat, minLng, maxLng float64) []ClusterMarker {
	total := 0
	country := ""
	sector := "mining"
	grid := clusters[0].MapClusterGridDeg
	for _, c := range clusters {
		total += c.MapClusterCount
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
	lat, lng, ok := dominantClusterCenter(clusters)
	if !ok {
		return clusters
	}
	lat, lng = snapClusterToViewport(lat, lng, minLat, maxLat, minLng, maxLng, grid)
	lat, lng = RefineClusterLandPosition(lat, lng, country)
	return []ClusterMarker{{
		ID:                fmt.Sprintf("cluster:%s:%.4f:%.4f", country, lat, lng),
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
