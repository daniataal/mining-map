package assets

// legacyLicenseMiningOnlySQL passes non-license assets and mining-sector license cadastre only.
// Petroleum-sector rows in legacy_licenses are excluded from metals map/search.
const legacyLicenseMiningOnlySQL = `(
	COALESCE(legacy_table, '') <> 'legacy_licenses'
	OR lower(COALESCE(raw_source_payload->>'sector', 'mining')) = 'mining'
)`

// MetalsMapWhereSQL limits metals MVT tiles to true mining assets.
// Misclassified petroleum OSM rows (legacy import tagged processing_plant) are excluded
// without requiring a destructive DB migration. Petroleum license cadastre (sector oil_and_gas)
// is excluded via legacyLicenseMiningOnlySQL and shown on the energy-cadastre tile layer.
const MetalsMapWhereSQL = `
	(
		asset_type IN ('mine', 'smelter')
		OR (
			asset_type = 'processing_plant'
			AND COALESCE(legacy_table, '') <> 'legacy_petroleum_osm_features'
			AND NOT ('petroleum' = ANY(COALESCE(commodities_supported, '{}')))
		)
	)
	AND ` + legacyLicenseMiningOnlySQL

// MetalsLicenseWhereSQL limits summary counts to mining-sector license cadastre imports only.
const MetalsLicenseWhereSQL = `legacy_table = 'legacy_licenses'
	AND lower(COALESCE(raw_source_payload->>'sector', 'mining')) = 'mining'`

// EnergyCadastreWhereSQL selects petroleum-sector government license/permit cadastre rows.
const EnergyCadastreWhereSQL = `legacy_table = 'legacy_licenses'
	AND lower(COALESCE(raw_source_payload->>'sector', 'mining')) = 'oil_and_gas'`
