package mapserving

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// SupplierHubRow is a materialized hub aggregate for registry / map hub-first navigation.
type SupplierHubRow struct {
	Locode         string `json:"locode"`
	HubName        string `json:"hub_name"`
	Country        string `json:"country"`
	SupplierCount  int    `json:"supplier_count"`
	GeocodedCount  int    `json:"geocoded_count"`
	HubAnchorCount int    `json:"hub_anchor_count"`
}

// RebuildSupplierHubs upserts map_serving_supplier_hubs from oil_companies bunker metadata.
func RebuildSupplierHubs(ctx context.Context, pool *pgxpool.Pool) (int, error) {
	const q = `
INSERT INTO map_serving_supplier_hubs (
  locode, hub_name, country, supplier_count, geocoded_count, hub_anchor_count, metadata, built_at
)
SELECT
  COALESCE(NULLIF(TRIM(metadata->>'port_locode'), ''), 'UNKNOWN') AS locode,
  MAX(COALESCE(NULLIF(TRIM(metadata->>'port_name'), ''), NULLIF(TRIM(metadata->>'port_locode'), ''), 'Unknown hub')) AS hub_name,
  MAX(COALESCE(NULLIF(TRIM(country), ''), '')) AS country,
  COUNT(*)::int AS supplier_count,
  COUNT(*) FILTER (WHERE metadata->>'geocode_tier' = 'register_address_geocoded')::int AS geocoded_count,
  COUNT(*) FILTER (WHERE metadata->>'geocode_tier' = 'port_hub_anchor')::int AS hub_anchor_count,
  jsonb_build_object('source', 'oil_companies', 'rebuilt', true),
  now()
FROM oil_companies
WHERE supplier_status = 'active'
  AND metadata->>'enrichment_tier' = 'bunker_fuel_suppliers_curated'
GROUP BY 1
ON CONFLICT (locode) DO UPDATE SET
  hub_name = EXCLUDED.hub_name,
  country = EXCLUDED.country,
  supplier_count = EXCLUDED.supplier_count,
  geocoded_count = EXCLUDED.geocoded_count,
  hub_anchor_count = EXCLUDED.hub_anchor_count,
  metadata = map_serving_supplier_hubs.metadata || EXCLUDED.metadata,
  built_at = now()
`
	tag, err := pool.Exec(ctx, q)
	if err != nil {
		return 0, fmt.Errorf("rebuild supplier hubs: %w", err)
	}
	return int(tag.RowsAffected()), nil
}

// ListSupplierHubs returns hub aggregates for registry home.
func ListSupplierHubs(ctx context.Context, pool *pgxpool.Pool) ([]SupplierHubRow, error) {
	rows, err := pool.Query(ctx, `
SELECT locode, hub_name, country, supplier_count, geocoded_count, hub_anchor_count
FROM map_serving_supplier_hubs
ORDER BY supplier_count DESC, locode
`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []SupplierHubRow
	for rows.Next() {
		var row SupplierHubRow
		if err := rows.Scan(&row.Locode, &row.HubName, &row.Country, &row.SupplierCount, &row.GeocodedCount, &row.HubAnchorCount); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

// HubMetadataJSON returns metadata blob for a hub row (API helper).
func HubMetadataJSON(row SupplierHubRow) json.RawMessage {
	b, _ := json.Marshal(row)
	return b
}
