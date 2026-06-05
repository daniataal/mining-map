package gfw

// DefaultArchiveRegions match seeded oil_sts_zones polygons (migration 029).
func DefaultArchiveRegions() []BBox {
	return []BBox{
		{Name: "fujairah", West: 56.35, South: 24.95, East: 56.65, North: 25.15},
		{Name: "west_africa", West: 1.5, South: 4.8, East: 2.8, North: 6.0},
		{Name: "singapore_strait", West: 103.5, South: 1.0, East: 104.2, North: 1.5},
	}
}
