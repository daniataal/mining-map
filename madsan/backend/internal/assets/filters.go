package assets

// MetalsMapWhereSQL limits metals MVT tiles to true mining assets.
// Misclassified petroleum OSM rows (legacy import tagged processing_plant) are excluded
// without requiring a destructive DB migration.
const MetalsMapWhereSQL = `
	asset_type IN ('mine', 'smelter')
	OR (
		asset_type = 'processing_plant'
		AND COALESCE(legacy_table, '') <> 'legacy_petroleum_osm_features'
		AND NOT ('petroleum' = ANY(COALESCE(commodities_supported, '{}')))
	)`

// MetalsLicenseWhereSQL limits summary counts to license cadastre imports only.
const MetalsLicenseWhereSQL = `legacy_table = 'legacy_licenses'`
