-- MadSan data foundation: source ledger, raw records, canonical assets,
-- organizations, contacts, and evidence-backed relationships.

CREATE TABLE IF NOT EXISTS core_source_ledger (
  source_key TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  source_type TEXT NOT NULL,
  license_name TEXT,
  terms_url TEXT,
  source_url TEXT,
  ingestion_owner TEXT,
  refresh_cadence TEXT,
  last_run_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_status TEXT,
  last_error TEXT,
  records_seen BIGINT DEFAULT 0,
  records_written BIGINT DEFAULT 0,
  checksum TEXT,
  freshness_interval INTERVAL,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS core_import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key TEXT NOT NULL REFERENCES core_source_ledger(source_key) ON DELETE RESTRICT,
  batch_kind TEXT NOT NULL DEFAULT 'scheduled',
  source_uri TEXT,
  file_name TEXT,
  file_checksum TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  rows_seen BIGINT DEFAULT 0,
  rows_written BIGINT DEFAULT 0,
  started_at TIMESTAMPTZ DEFAULT now(),
  finished_at TIMESTAMPTZ,
  error TEXT,
  metadata JSONB DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS core_source_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key TEXT NOT NULL REFERENCES core_source_ledger(source_key) ON DELETE RESTRICT,
  import_batch_id UUID REFERENCES core_import_batches(id) ON DELETE SET NULL,
  external_id TEXT,
  record_hash TEXT NOT NULL,
  source_url TEXT,
  sheet_name TEXT,
  row_number BIGINT,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  observed_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS core_source_records_source_hash_idx
  ON core_source_records (source_key, record_hash);

CREATE UNIQUE INDEX IF NOT EXISTS core_source_records_external_idx
  ON core_source_records (source_key, external_id)
  WHERE external_id IS NOT NULL AND TRIM(external_id) <> '';

CREATE TABLE IF NOT EXISTS core_organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  country TEXT,
  website TEXT,
  lei TEXT,
  source_key TEXT REFERENCES core_source_ledger(source_key) ON DELETE SET NULL,
  source_record_id UUID REFERENCES core_source_records(id) ON DELETE SET NULL,
  confidence NUMERIC DEFAULT 0.5,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(normalized_name, country)
);

CREATE TABLE IF NOT EXISTS core_organization_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES core_organizations(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  normalized_alias TEXT NOT NULL,
  source_key TEXT REFERENCES core_source_ledger(source_key) ON DELETE SET NULL,
  source_record_id UUID REFERENCES core_source_records(id) ON DELETE SET NULL,
  confidence NUMERIC DEFAULT 0.5,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(organization_id, normalized_alias)
);

CREATE TABLE IF NOT EXISTS core_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_type TEXT NOT NULL,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  country TEXT,
  region TEXT,
  port TEXT,
  locode TEXT,
  commodity_family TEXT,
  capacity_value NUMERIC,
  capacity_unit TEXT,
  geom GEOMETRY(GEOMETRY, 4326),
  source_key TEXT REFERENCES core_source_ledger(source_key) ON DELETE SET NULL,
  source_record_id UUID REFERENCES core_source_records(id) ON DELETE SET NULL,
  legacy_table TEXT,
  legacy_id TEXT,
  confidence NUMERIC DEFAULT 0.5,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS core_assets_legacy_idx
  ON core_assets (legacy_table, legacy_id)
  WHERE legacy_table IS NOT NULL AND legacy_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS core_assets_type_country_idx
  ON core_assets (asset_type, country);

CREATE INDEX IF NOT EXISTS core_assets_geom_idx
  ON core_assets USING GIST (geom);

CREATE TABLE IF NOT EXISTS core_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES core_organizations(id) ON DELETE CASCADE,
  asset_id UUID REFERENCES core_assets(id) ON DELETE CASCADE,
  contact_type TEXT NOT NULL,
  contact_role TEXT,
  contact_scope TEXT NOT NULL DEFAULT 'public_business',
  label TEXT,
  value TEXT NOT NULL,
  normalized_value TEXT,
  source_key TEXT REFERENCES core_source_ledger(source_key) ON DELETE SET NULL,
  source_record_id UUID REFERENCES core_source_records(id) ON DELETE SET NULL,
  source_name TEXT,
  source_url TEXT,
  evidence_snippet TEXT,
  discovered_by TEXT NOT NULL DEFAULT 'source_import',
  verification_status TEXT NOT NULL DEFAULT 'unverified',
  confidence NUMERIC DEFAULT 0.5,
  last_seen_at TIMESTAMPTZ DEFAULT now(),
  verified_at TIMESTAMPTZ,
  raw_payload JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS core_contacts_fingerprint_idx
  ON core_contacts (
    COALESCE(organization_id::text, ''),
    COALESCE(asset_id::text, ''),
    contact_type,
    COALESCE(normalized_value, value)
  );

CREATE TABLE IF NOT EXISTS core_asset_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL REFERENCES core_assets(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES core_organizations(id) ON DELETE CASCADE,
  relationship_role TEXT NOT NULL,
  relationship_label TEXT,
  ownership_pct NUMERIC,
  effective_from DATE,
  effective_to DATE,
  source_key TEXT REFERENCES core_source_ledger(source_key) ON DELETE SET NULL,
  source_record_id UUID REFERENCES core_source_records(id) ON DELETE SET NULL,
  source_url TEXT,
  evidence_snippet TEXT,
  confidence NUMERIC DEFAULT 0.5,
  verification_status TEXT NOT NULL DEFAULT 'unverified',
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS core_asset_relationships_unique_idx
  ON core_asset_relationships (
    asset_id,
    organization_id,
    relationship_role,
    COALESCE(source_key, ''),
    COALESCE(source_record_id::text, '')
  );

CREATE TABLE IF NOT EXISTS core_vessel_registry_links (
  imo TEXT PRIMARY KEY,
  mmsi BIGINT,
  vessel_name TEXT,
  owner_organization_id UUID REFERENCES core_organizations(id) ON DELETE SET NULL,
  operator_organization_id UUID REFERENCES core_organizations(id) ON DELETE SET NULL,
  source_key TEXT REFERENCES core_source_ledger(source_key) ON DELETE SET NULL,
  source_record_id UUID REFERENCES core_source_records(id) ON DELETE SET NULL,
  vessel_enrichment_cached_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS core_vessel_registry_links_mmsi_idx
  ON core_vessel_registry_links (mmsi)
  WHERE mmsi IS NOT NULL;

INSERT INTO core_source_ledger (
  source_key, display_name, source_type, license_name, terms_url, source_url,
  ingestion_owner, refresh_cadence, freshness_interval, metadata
) VALUES
  ('shipvault', 'ShipVault vessel registry', 'provider_api', 'Provider terms', NULL, 'https://www.shipvault.com/', 'oil-live-intel', 'cache-on-first-view plus backfill', interval '30 days', '{"priority":"p0","target":"vessel owner/operator registry"}'),
  ('gem_goit', 'Global Energy Monitor GOIT pipelines', 'xlsx_geojson', 'CC BY 4.0', 'https://globalenergymonitor.org/projects/global-oil-gas-infrastructure-tracker/', 'https://globalenergymonitor.org/projects/global-oil-gas-infrastructure-tracker/', 'graph-sync', 'manual file refresh', interval '180 days', '{"priority":"p1","target":"pipeline routes/capacity/operator"}'),
  ('gem_gogpt', 'Global Energy Monitor GOGPT oil and gas plants', 'xlsx', 'GEM open data', 'https://globalenergymonitor.org/projects/global-oil-gas-plant-tracker/', 'https://globalenergymonitor.org/projects/global-oil-gas-plant-tracker/', 'graph-sync', 'manual file refresh', interval '180 days', '{"priority":"p1","target":"plant owners/operators/captive use"}'),
  ('gem_ggit', 'Global Energy Monitor GGIT LNG terminals', 'xlsx', 'GEM open data', 'https://globalenergymonitor.org/projects/global-gas-infrastructure-tracker/', 'https://globalenergymonitor.org/projects/global-gas-infrastructure-tracker/', 'graph-sync', 'manual file refresh', interval '180 days', '{"priority":"p1","target":"lng terminal owners/operators"}'),
  ('eia_refinery_capacity', 'EIA refinery capacity report', 'official_file', 'U.S. public domain', 'https://www.eia.gov/about/copyrights_reuse.php', 'https://www.eia.gov/petroleum/refinerycapacity/', 'graph-sync', 'annual file/API refresh', interval '400 days', '{"priority":"p1","target":"US refinery capacity/owner/operator"}'),
  ('eia_historic_imports', 'EIA historic company imports', 'xlsx_folder', 'U.S. public domain', 'https://www.eia.gov/about/copyrights_reuse.php', 'https://www.eia.gov/petroleum/imports/companylevel/', 'eia-historic-sync-worker', 'file-change driven', interval '400 days', '{"priority":"p1","target":"company import evidence"}'),
  ('osm_petroleum', 'OpenStreetMap petroleum infrastructure', 'overpass_snapshot', 'ODbL', 'https://www.openstreetmap.org/copyright', 'https://www.openstreetmap.org/', 'petroleum-osm-worker', 'scheduled snapshot', interval '30 days', '{"priority":"p1","target":"storage tanks, pipelines, refineries"}'),
  ('port_authority_directories', 'Port authority tenant directories', 'curated_public_web', 'Public web pages', NULL, NULL, 'graph-sync', 'manual curation', interval '180 days', '{"priority":"p0","target":"terminal tenants and contact paths"}'),
  ('gleif', 'GLEIF LEI records', 'public_api', 'GLEIF open data terms', 'https://www.gleif.org/en/meta/lei-data-terms-of-use/', 'https://api.gleif.org/api/v1/lei-records', 'graph-sync', 'batch enrichment', interval '90 days', '{"priority":"p1","target":"legal entity identity"}'),
  ('wikidata', 'Wikidata company facts', 'public_api', 'CC0', 'https://www.wikidata.org/wiki/Wikidata:Licensing', 'https://www.wikidata.org/', 'graph-sync', 'batch enrichment', interval '180 days', '{"priority":"p2","target":"company facts and aliases"}'),
  ('ted', 'EU TED procurement notices', 'public_api', 'EU open data', 'https://data.europa.eu/en/legal-notice', 'https://ted.europa.eu/', 'graph-sync', 'scheduled sync', interval '30 days', '{"priority":"p2","target":"buyer/procurement signals"}'),
  ('usaspending', 'USAspending contract awards', 'public_api', 'U.S. public data', 'https://www.usaspending.gov/data-sources', 'https://api.usaspending.gov/', 'graph-sync', 'scheduled sync', interval '30 days', '{"priority":"p2","target":"buyer/procurement signals"}'),
  ('uk_hse_comah', 'UK HSE COMAH establishments', 'official_file', 'UK public sector information', 'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/', 'https://www.hse.gov.uk/comah/comah-establishments.htm', 'future-importer', 'research/backlog', interval '365 days', '{"priority":"p2","target":"hazardous storage/refinery site leads"}')
ON CONFLICT (source_key) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  source_type = EXCLUDED.source_type,
  license_name = EXCLUDED.license_name,
  terms_url = EXCLUDED.terms_url,
  source_url = EXCLUDED.source_url,
  ingestion_owner = EXCLUDED.ingestion_owner,
  refresh_cadence = EXCLUDED.refresh_cadence,
  freshness_interval = EXCLUDED.freshness_interval,
  metadata = core_source_ledger.metadata || EXCLUDED.metadata,
  updated_at = now();

COMMENT ON TABLE core_source_ledger IS
  'MadSan source ledger: one row per external source/provider/file family with license, freshness and ingestion status.';

COMMENT ON TABLE core_source_records IS
  'Raw source rows before normalization. Canonical records must link back here whenever possible.';

COMMENT ON TABLE core_contacts IS
  'Source-backed public business contacts only; no guessed private contacts.';

COMMENT ON TABLE core_asset_relationships IS
  'Evidence-backed asset control graph: owner/operator/lessee/tenant/supplier/buyer/agent/broker roles.';
