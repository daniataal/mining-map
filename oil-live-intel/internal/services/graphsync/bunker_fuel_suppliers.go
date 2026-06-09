package graphsync

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/mining-map/oil-live-intel/internal/services/geocode"
	"github.com/mining-map/oil-live-intel/internal/services/supplier"
)

// BunkerFuelSuppliersResult mirrors Python sync_bunker_fuel_suppliers_to_companies payload.
type BunkerFuelSuppliersResult struct {
	SuppliersIndexed int `json:"suppliers_indexed"`
	ContactsWritten  int `json:"contacts_written"`
	RecordsSkipped   int `json:"records_skipped"`
	SeedHubs         int `json:"seed_hubs"`
	Geocoded         int `json:"geocoded"`
}

// ExpectedBunkerFuelSuppliersIndexed counts upsert-eligible seed records.
func ExpectedBunkerFuelSuppliersIndexed(seedPath string) (int, int, error) {
	payload, err := supplier.LoadBunkerFuelSuppliers(seedPath)
	if err != nil {
		return 0, 0, err
	}
	return supplier.ExpectedSupplierCount(payload), len(payload.Hubs), nil
}

// IndexBunkerFuelSuppliers syncs curated bunker registers into oil_companies + contacts.
func IndexBunkerFuelSuppliers(ctx context.Context, pool *pgxpool.Pool, seedPath string) (BunkerFuelSuppliersResult, error) {
	payload, err := supplier.LoadBunkerFuelSuppliers(seedPath)
	if err != nil {
		return BunkerFuelSuppliersResult{}, err
	}
	records := supplier.IterSupplierRecords(payload)
	geocoder := geocode.NewClient()
	result := BunkerFuelSuppliersResult{SeedHubs: len(payload.Hubs)}

	for _, row := range records {
		sourceURL := row.SourceURL
		meta := map[string]any{
			"supplier_type":       row.SupplierType,
			"product_types":       row.ProductTypes,
			"fuels_supplied":      row.FuelsSupplied,
			"contact_person":      row.ContactPerson,
			"register_address":    row.Address,
			"port_locode":         row.Locode,
			"port_name":           row.PortName,
			"hub_key":             row.HubKey,
			"hub_lat":             row.HubLat,
			"hub_lng":             row.HubLng,
			"license_authority":   row.LicenseAuthority,
			"register_source_url": row.RegisterSourceURL,
			"source_url":          sourceURL,
			"enrichment_tier":     "regulator_curated",
			"notes":               row.Notes,
		}
		meta = supplier.ApplyPlacementMetadata(ctx, meta, row, supplier.PlacementOptions{
			Geocoder: geocoder,
			Pool:     pool,
		})
		if tier, _ := meta["geocode_tier"].(string); tier == supplier.GeocodeTierRegisterAddress {
			result.Geocoded++
		}

		companyID, err := UpsertCompany(
			ctx, pool,
			row.CompanyName, row.Country, row.SupplierType,
			"bunker_fuel_suppliers_curated",
			row.ConfidenceScore,
			meta,
		)
		if err != nil {
			return result, err
		}
		if companyID == "" {
			result.RecordsSkipped++
			continue
		}
		result.SuppliersIndexed++

		if row.Website != "" {
			_, _ = pool.Exec(ctx, `
				UPDATE oil_companies
				SET website = COALESCE(NULLIF(website, ''), $1), updated_at = now()
				WHERE id = $2::uuid AND (website IS NULL OR website = '')
			`, row.Website, companyID)
		}

		labelBase := row.LicenseAuthority
		if labelBase == "" {
			labelBase = "Bunker register"
		}
		for _, pair := range []struct {
			val  string
			typ  string
		}{
			{row.Phone, "phone"},
			{row.Email, "email"},
			{row.Address, "address"},
		} {
			if pair.val == "" {
				continue
			}
			written, err := supplier.UpsertCompanyContact(
				ctx, pool, companyID, pair.typ, pair.val,
				fmt.Sprintf("%s (%s)", labelBase, pair.typ),
				sourceURL,
			)
			if err != nil {
				return result, err
			}
			if written {
				result.ContactsWritten++
			}
		}
	}
	return result, nil
}
