package geofence

import (
	"context"
	"math"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Asset is a terminal/port zone for in-memory proximity checks.
type Asset struct {
	ID        uuid.UUID
	Name      string
	Country   string
	Products  []string
	AssetType string
	Lat       float64
	Lon       float64
	HasSulfur bool
}

const gridCellDeg = 0.05

type cellKey struct {
	lat int
	lon int
}

// Index holds asset geofences with a coarse lat/lon grid for fast lookups.
type Index struct {
	assets  []Asset
	radiusM float64
	grid    map[cellKey][]int
}

func Load(ctx context.Context, pool *pgxpool.Pool, radiusM float64) (*Index, error) {
	rows, err := pool.Query(ctx, `
		SELECT id, name, COALESCE(country_code,''), COALESCE(commodities_supported, ARRAY[]::text[]),
			COALESCE(asset_type,''), latitude, longitude
		FROM assets
		WHERE geom IS NOT NULL AND latitude IS NOT NULL AND longitude IS NOT NULL
		  AND asset_type IN ('terminal', 'port', 'refinery', 'tank_farm', 'storage', 'berth', 'lng_terminal')
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []Asset
	for rows.Next() {
		var a Asset
		if err := rows.Scan(&a.ID, &a.Name, &a.Country, &a.Products, &a.AssetType, &a.Lat, &a.Lon); err != nil {
			return nil, err
		}
		for _, p := range a.Products {
			if p == "sulfur" || p == "sulphur" {
				a.HasSulfur = true
				break
			}
		}
		list = append(list, a)
	}
	idx := &Index{assets: list, radiusM: radiusM}
	idx.buildGrid()
	return idx, rows.Err()
}

// MatchByPostGIS returns the nearest asset within radiusM using ST_DWithin (batch/backfill path).
func MatchByPostGIS(ctx context.Context, pool *pgxpool.Pool, lat, lon, radiusM float64) (*Asset, error) {
	var a Asset
	err := pool.QueryRow(ctx, `
		SELECT id, name, COALESCE(country_code,''), COALESCE(commodities_supported, ARRAY[]::text[]),
			COALESCE(asset_type,''), latitude, longitude
		FROM assets
		WHERE geom IS NOT NULL
		  AND asset_type IN ('terminal', 'port', 'refinery', 'tank_farm', 'storage', 'berth', 'lng_terminal')
		  AND ST_DWithin(
			geom,
			ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
			$3
		  )
		ORDER BY ST_Distance(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography)
		LIMIT 1
	`, lon, lat, radiusM).Scan(&a.ID, &a.Name, &a.Country, &a.Products, &a.AssetType, &a.Lat, &a.Lon)
	if err != nil {
		return nil, err
	}
	for _, p := range a.Products {
		if p == "sulfur" || p == "sulphur" {
			a.HasSulfur = true
			break
		}
	}
	return &a, nil
}

func toCell(lat, lon float64) cellKey {
	return cellKey{
		lat: int(math.Floor(lat / gridCellDeg)),
		lon: int(math.Floor(lon / gridCellDeg)),
	}
}

func (idx *Index) buildGrid() {
	idx.grid = make(map[cellKey][]int, len(idx.assets)/4+1)
	for i := range idx.assets {
		ck := toCell(idx.assets[i].Lat, idx.assets[i].Lon)
		idx.grid[ck] = append(idx.grid[ck], i)
	}
}

func (idx *Index) Count() int { return len(idx.assets) }

func (idx *Index) ByID(id uuid.UUID) *Asset {
	for i := range idx.assets {
		if idx.assets[i].ID == id {
			a := idx.assets[i]
			return &a
		}
	}
	return nil
}

func (idx *Index) Match(lat, lon float64) *Asset {
	if len(idx.assets) == 0 {
		return nil
	}
	if idx.grid == nil {
		idx.buildGrid()
	}
	center := toCell(lat, lon)
	var best *Asset
	bestDist := idx.radiusM + 1
	for dLat := -1; dLat <= 1; dLat++ {
		for dLon := -1; dLon <= 1; dLon++ {
			ck := cellKey{lat: center.lat + dLat, lon: center.lon + dLon}
			for _, i := range idx.grid[ck] {
				a := &idx.assets[i]
				d := haversineM(a.Lat, a.Lon, lat, lon)
				if d <= idx.radiusM && d < bestDist {
					best = a
					bestDist = d
				}
			}
		}
	}
	return best
}

func haversineM(lat1, lon1, lat2, lon2 float64) float64 {
	const r = 6371000.0
	p1 := lat1 * math.Pi / 180
	p2 := lat2 * math.Pi / 180
	dp := (lat2 - lat1) * math.Pi / 180
	dl := (lon2 - lon1) * math.Pi / 180
	a := math.Sin(dp/2)*math.Sin(dp/2) +
		math.Cos(p1)*math.Cos(p2)*math.Sin(dl/2)*math.Sin(dl/2)
	return 2 * r * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
}

func InferProductFamily(products []string, tankerClass string) string {
	has := func(tok string) bool {
		for _, p := range products {
			if p == tok || p == "petroleum" || p == "oil" {
				return true
			}
		}
		return false
	}
	if has("sulfur") || has("sulphur") {
		return "sulfur"
	}
	if has("lng") || tankerClass == "lng" {
		return "lng"
	}
	if has("lpg") || tankerClass == "lpg" {
		return "lpg"
	}
	if has("crude_oil") || has("crude") || tankerClass == "crude" {
		return "crude_oil"
	}
	for _, p := range products {
		if p == "diesel" || p == "gasoline" || p == "refined_products" || p == "jet_fuel" || p == "fuel_oil" {
			return "refined_products"
		}
	}
	if tankerClass == "product" || tankerClass == "chemical" {
		return "refined_products"
	}
	if len(products) > 0 {
		return products[0]
	}
	return "petroleum"
}
