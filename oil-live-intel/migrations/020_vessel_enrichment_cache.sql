-- Migration 020: vessel_enrichment_cache
-- Stores ShipVault-sourced vessel enrichment data (owner, builder, name history, value, fleet).
-- IMO is the primary key because ShipVault's vessel lookup is IMO-based.
-- TTL is enforced at the application layer (7-day default); updated_at lets the service
-- decide whether to serve cached data or re-fetch from ShipVault.

CREATE TABLE IF NOT EXISTS vessel_enrichment_cache (
  imo                  TEXT PRIMARY KEY,
  mmsi                 BIGINT,
  shipvault_vessel_id  TEXT,
  owner_name           TEXT,
  owner_company_id     TEXT,
  operator_name        TEXT,
  builder              TEXT,
  build_year           INT,
  vessel_class         TEXT,
  flag                 TEXT,
  gross_tonnage        NUMERIC,
  deadweight_tons      NUMERIC,
  name_history         JSONB    DEFAULT '[]'::jsonb,
  estimated_value_usd  NUMERIC,
  fleet_list           JSONB    DEFAULT '[]'::jsonb,
  owner_profile        JSONB    DEFAULT '{}'::jsonb,
  raw_vessel           JSONB    DEFAULT '{}'::jsonb,
  raw_company          JSONB    DEFAULT '{}'::jsonb,
  data_source          TEXT     DEFAULT 'shipvault',
  ingested_at          TIMESTAMPTZ DEFAULT now(),
  updated_at           TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vessel_enrichment_mmsi
  ON vessel_enrichment_cache(mmsi)
  WHERE mmsi IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_vessel_enrichment_updated_at
  ON vessel_enrichment_cache(updated_at DESC);

COMMENT ON TABLE vessel_enrichment_cache IS
  'ShipVault-sourced vessel registry data. TTL managed by application (default 7 days). '
  'data_source=shipvault; always label as enrichment_tier=registry in API responses.';
