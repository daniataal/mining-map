package supplier

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// NearbyRow is a licensed bunker/fuel supplier near a hub or map bbox.
type NearbyRow struct {
	ID              string   `json:"id"`
	Name            string   `json:"name"`
	Country         string   `json:"country,omitempty"`
	CompanyType     string   `json:"company_type,omitempty"`
	Website         *string  `json:"website"`
	Confidence      float64  `json:"confidence"`
	SupplierStatus  *string  `json:"supplier_status"`
	PortLocode      string   `json:"port_locode,omitempty"`
	PortName        string   `json:"port_name,omitempty"`
	ProductTypes    []string `json:"product_types"`
	FuelsSupplied   string   `json:"fuels_supplied,omitempty"`
	ContactPerson   string   `json:"contact_person,omitempty"`
	Phone             string   `json:"phone,omitempty"`
	Email             string   `json:"email,omitempty"`
	Address           string   `json:"address,omitempty"`
	LicenseAuthority  string   `json:"license_authority,omitempty"`
	SourceURL         string   `json:"source_url,omitempty"`
	EnrichmentTier    string   `json:"enrichment_tier,omitempty"`
	Lat               *float64 `json:"lat,omitempty"`
	Lng               *float64 `json:"lng,omitempty"`
	GeocodeTier       string   `json:"geocode_tier,omitempty"`
	GeocodeDisclaimer string   `json:"geocode_disclaimer,omitempty"`
}

type NearbyQuery struct {
	Locode string
	South  *float64
	West   *float64
	North  *float64
	East   *float64
	Limit  int
}

// QueryNearby returns oil_companies indexed as bunker/fuel suppliers near a hub LOCODE or bbox.
func QueryNearby(ctx context.Context, pool *pgxpool.Pool, q NearbyQuery) ([]NearbyRow, error) {
	limit := q.Limit
	if limit < 1 {
		limit = 40
	}
	if limit > 100 {
		limit = 100
	}

	clauses := []string{
		`company_type IN ('bunker_supplier', 'fuel_wholesaler', 'fuel_importer', 'refinery_marketer', 'trader', 'port_tenant')`,
		`confidence >= 0.45`,
	}
	args := []any{}
	n := 1

	locode := strings.TrimSpace(strings.ToUpper(q.Locode))
	if locode != "" {
		clauses = append(clauses, fmt.Sprintf(`metadata->>'port_locode' = $%d`, n))
		args = append(args, locode)
		n++
	} else if q.South != nil && q.West != nil && q.North != nil && q.East != nil {
		clauses = append(clauses, fmt.Sprintf(`(
			((metadata->>'display_lat')::float BETWEEN $%d AND $%d AND (metadata->>'display_lng')::float BETWEEN $%d AND $%d)
			OR
			((metadata->>'hub_lat')::float BETWEEN $%d AND $%d AND (metadata->>'hub_lng')::float BETWEEN $%d AND $%d)
		)`, n, n+1, n+2, n+3, n, n+1, n+2, n+3))
		args = append(args, *q.South, *q.North, *q.West, *q.East)
		n += 4
	}

	args = append(args, limit)
	sql := fmt.Sprintf(`
		SELECT id::text, name, country, company_type, website, confidence, supplier_status, metadata
		FROM oil_companies
		WHERE %s
		ORDER BY confidence DESC, name ASC
		LIMIT $%d`, strings.Join(clauses, " AND "), n)

	rows, err := pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]NearbyRow, 0, limit)
	for rows.Next() {
		var (
			id, name, country, companyType string
			website, supplierStatus        *string
			confidence                     float64
			metaRaw                        []byte
		)
		if err := rows.Scan(&id, &name, &country, &companyType, &website, &confidence, &supplierStatus, &metaRaw); err != nil {
			return nil, err
		}
		meta := map[string]any{}
		if len(metaRaw) > 0 {
			_ = json.Unmarshal(metaRaw, &meta)
		}
		out = append(out, shapeNearbyRow(id, name, country, companyType, website, confidence, supplierStatus, meta))
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

func shapeNearbyRow(
	id, name, country, companyType string,
	website *string,
	confidence float64,
	supplierStatus *string,
	meta map[string]any,
) NearbyRow {
	sourceURL := metaString(meta, "source_url")
	if sourceURL == "" {
		sourceURL = metaString(meta, "register_source_url")
	}
	tier := metaString(meta, "geocode_tier")
	disclaimer := metaString(meta, "geocode_disclaimer")
	if disclaimer == "" {
		disclaimer = GeocodeDisclaimer(tier)
	}
	var latPtr, lngPtr *float64
	if lat, ok := FloatFromMeta(meta, "display_lat"); ok {
		if lng, ok2 := FloatFromMeta(meta, "display_lng"); ok2 {
			latCopy, lngCopy := lat, lng
			latPtr, lngPtr = &latCopy, &lngCopy
		}
	}
	return NearbyRow{
		ID:                id,
		Name:              name,
		Country:           country,
		CompanyType:       companyType,
		Website:           website,
		Confidence:        confidence,
		SupplierStatus:    supplierStatus,
		PortLocode:        metaString(meta, "port_locode"),
		PortName:          metaString(meta, "port_name"),
		ProductTypes:      metaStringSlice(meta, "product_types"),
		FuelsSupplied:     metaString(meta, "fuels_supplied"),
		ContactPerson:     metaString(meta, "contact_person"),
		Phone:             metaString(meta, "phone"),
		Email:             metaString(meta, "email"),
		Address:           firstNonEmpty(metaString(meta, "register_address"), metaString(meta, "address")),
		LicenseAuthority:  metaString(meta, "license_authority"),
		SourceURL:         sourceURL,
		EnrichmentTier:    metaString(meta, "enrichment_tier"),
		Lat:               latPtr,
		Lng:               lngPtr,
		GeocodeTier:       tier,
		GeocodeDisclaimer: disclaimer,
	}
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

func metaString(meta map[string]any, key string) string {
	v, ok := meta[key]
	if !ok || v == nil {
		return ""
	}
	switch t := v.(type) {
	case string:
		return strings.TrimSpace(t)
	default:
		return strings.TrimSpace(fmt.Sprint(t))
	}
}

func metaStringSlice(meta map[string]any, key string) []string {
	v, ok := meta[key]
	if !ok || v == nil {
		return nil
	}
	switch t := v.(type) {
	case []any:
		out := make([]string, 0, len(t))
		for _, item := range t {
			s := strings.TrimSpace(fmt.Sprint(item))
			if s != "" {
				out = append(out, s)
			}
		}
		return out
	case []string:
		return t
	default:
		return nil
	}
}
