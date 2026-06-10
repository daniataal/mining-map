package mcr

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func fingerprint(parts ...string) string {
	h := sha256.Sum256([]byte(strings.Join(parts, "|")))
	return hex.EncodeToString(h[:16])
}

func strPtr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func tableExists(ctx context.Context, pool *pgxpool.Pool, table string) bool {
	if pool == nil {
		return false
	}
	var n int
	_ = pool.QueryRow(ctx, `
		SELECT COUNT(*)::int FROM information_schema.tables
		WHERE table_schema = 'public' AND table_name = $1
	`, table).Scan(&n)
	return n > 0
}

func resolveCompany(ctx context.Context, pool *pgxpool.Pool, name, country string) (*uuid.UUID, error) {
	if pool == nil || name == "" {
		return nil, nil
	}
	norm := strings.ToLower(strings.TrimSpace(name))
	var id uuid.UUID
	err := pool.QueryRow(ctx, `
		SELECT id FROM companies
		WHERE (normalized_name = $1 OR name ILIKE $2)
		  AND ($3 = '' OR country_code ILIKE $3 OR country_code IS NULL)
		LIMIT 1
	`, norm, name, country).Scan(&id)
	if err != nil {
		return nil, nil
	}
	return &id, nil
}

func companyHasContact(ctx context.Context, pool *pgxpool.Pool, companyID *uuid.UUID) bool {
	if pool == nil || companyID == nil {
		return false
	}
	var n int
	_ = pool.QueryRow(ctx, `
		SELECT COUNT(*)::int FROM contacts WHERE company_id = $1
	`, *companyID).Scan(&n)
	return n > 0
}

func inferCommodityFamily(products []string, crudeCapable, productTanker *bool) string {
	for _, p := range products {
		pl := strings.ToLower(p)
		switch {
		case strings.Contains(pl, "crude"):
			return "crude_oil"
		case strings.Contains(pl, "sulfur"):
			return "sulfur"
		case strings.Contains(pl, "lng"):
			return "lng"
		case strings.Contains(pl, "lpg"):
			return "lpg"
		case strings.Contains(pl, "diesel"), strings.Contains(pl, "gasoil"):
			return "diesel"
		case strings.Contains(pl, "gasoline"), strings.Contains(pl, "petrol"):
			return "gasoline"
		case strings.Contains(pl, "jet"), strings.Contains(pl, "kerosene"):
			return "jet_fuel"
		case strings.Contains(pl, "naphtha"):
			return "naphtha"
		case strings.Contains(pl, "bitumen"), strings.Contains(pl, "asphalt"):
			return "asphalt"
		case strings.Contains(pl, "fuel_oil"), strings.Contains(pl, "bunker"):
			return "fuel_oil"
		case strings.Contains(pl, "petrochemical"), strings.Contains(pl, "chemical"):
			return "petrochemical"
		case strings.Contains(pl, "refined"):
			return "refined_products"
		}
	}
	if crudeCapable != nil && *crudeCapable {
		return "crude_oil"
	}
	if productTanker != nil && *productTanker {
		return "refined_products"
	}
	return ""
}

func hsForFamily(family string) string {
	switch family {
	case "crude_oil":
		return "2709"
	case "sulfur":
		return "2802"
	case "lng", "lpg":
		return "2711"
	default:
		return "2710"
	}
}

func isTankerClass(class string) bool {
	switch strings.ToLower(class) {
	case "crude", "product", "chemical", "lng", "lpg", "tanker":
		return true
	default:
		return strings.Contains(strings.ToLower(class), "tanker")
	}
}
