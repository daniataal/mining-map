package geofence

import (
	"context"
	"math"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Terminal is a simplified terminal zone for in-memory checks.
type Terminal struct {
	ID        uuid.UUID
	Name      string
	Operator  string
	Country   string
	Products  []string
	Lat       float64
	Lon       float64
	HasSulfur bool
}

// Index holds terminal zones.
type Index struct {
	terminals []Terminal
	radiusM   float64
}

func Load(ctx context.Context, pool *pgxpool.Pool, radiusM float64) (*Index, error) {
	rows, err := pool.Query(ctx, `
		SELECT id, name, COALESCE(operator_name,''), COALESCE(country,''), products,
			ST_Y(geom::geometry), ST_X(geom::geometry)
		FROM oil_terminals WHERE geom IS NOT NULL
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []Terminal
	for rows.Next() {
		var t Terminal
		if err := rows.Scan(&t.ID, &t.Name, &t.Operator, &t.Country, &t.Products, &t.Lat, &t.Lon); err != nil {
			return nil, err
		}
		for _, p := range t.Products {
			if p == "sulfur" || p == "sulphur" {
				t.HasSulfur = true
				break
			}
		}
		list = append(list, t)
	}
	return &Index{terminals: list, radiusM: radiusM}, rows.Err()
}

func (idx *Index) Count() int { return len(idx.terminals) }

// ByID returns a terminal by UUID.
func (idx *Index) ByID(id uuid.UUID) *Terminal {
	for i := range idx.terminals {
		if idx.terminals[i].ID == id {
			t := idx.terminals[i]
			return &t
		}
	}
	return nil
}

// Match returns the nearest terminal within radius, if any.
func (idx *Index) Match(lat, lon float64) *Terminal {
	var best *Terminal
	bestDist := idx.radiusM + 1
	for i := range idx.terminals {
		t := &idx.terminals[i]
		d := haversineM(t.Lat, t.Lon, lat, lon)
		if d <= idx.radiusM && d < bestDist {
			best = t
			bestDist = d
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

// InferProductFamily picks a display family from terminal products and vessel class.
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
