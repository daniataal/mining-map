DROP TABLE IF EXISTS opportunity_candidates;
DROP INDEX IF EXISTS idx_asset_geometries_source;
DROP INDEX IF EXISTS idx_asset_geometries_asset;
DROP INDEX IF EXISTS idx_asset_geometries_simplified;
DROP INDEX IF EXISTS idx_asset_geometries_geom;
DROP TABLE IF EXISTS asset_geometries;

DROP INDEX IF EXISTS uq_cargo_estimates_ais_draft_delta;
DROP INDEX IF EXISTS idx_cargo_estimates_product;
DROP INDEX IF EXISTS idx_cargo_estimates_vessel_observed;
ALTER TABLE cargo_estimates
    DROP COLUMN IF EXISTS source_payload,
    DROP COLUMN IF EXISTS evidence,
    DROP COLUMN IF EXISTS quantity_unit,
    DROP COLUMN IF EXISTS product_family,
    DROP COLUMN IF EXISTS payload_best;

DROP TABLE IF EXISTS trade_flow_facts;
DROP TABLE IF EXISTS market_price_observations;
DROP TABLE IF EXISTS market_pressure_scores;
DROP TABLE IF EXISTS market_balance_observations;
DROP TABLE IF EXISTS private_equity_exposures;
DROP TABLE IF EXISTS asset_emissions_facts;
DROP TABLE IF EXISTS asset_reserve_facts;
DROP TABLE IF EXISTS asset_production_facts;
DROP TABLE IF EXISTS gem_asset_ownership;
DROP TABLE IF EXISTS gem_ownership_edges;
DROP TABLE IF EXISTS gem_entities;
DROP TABLE IF EXISTS data_source_releases;
DROP INDEX IF EXISTS uq_contacts_raw_payload_norm;
DROP FUNCTION IF EXISTS oil_asset_supports_product(TEXT[], JSONB, TEXT);
