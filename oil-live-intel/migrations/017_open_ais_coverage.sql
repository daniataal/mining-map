-- Open-only AIS coverage expansion.
-- This keeps the legacy oil_vessel_position_observations table compatible while
-- adding enough provenance/freshness columns for multi-source open AIS reads.

ALTER TABLE oil_vessel_position_observations
  ADD COLUMN IF NOT EXISTS source TEXT,
  ADD COLUMN IF NOT EXISTS source_type TEXT,
  ADD COLUMN IF NOT EXISTS imo TEXT,
  ADD COLUMN IF NOT EXISTS position_time TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS freshness_seconds INTEGER,
  ADD COLUMN IF NOT EXISTS confidence NUMERIC DEFAULT 0.5,
  ADD COLUMN IF NOT EXISTS source_url TEXT,
  ADD COLUMN IF NOT EXISTS geom GEOMETRY(POINT, 4326);

UPDATE oil_vessel_position_observations
SET
  source = COALESCE(source, data_source),
  source_type = COALESCE(source_type, data_source),
  position_time = COALESCE(position_time, observed_at),
  received_at = COALESCE(received_at, ingested_at, now()),
  confidence = COALESCE(confidence, 0.5),
  geom = COALESCE(geom, ST_SetSRID(ST_MakePoint(lng::double precision, lat::double precision), 4326))
WHERE position_time IS NULL OR geom IS NULL OR source IS NULL OR source_type IS NULL;

ALTER TABLE oil_vessel_position_observations
  ALTER COLUMN position_time SET DEFAULT now(),
  ALTER COLUMN received_at SET DEFAULT now();

CREATE INDEX IF NOT EXISTS oil_vpos_position_time_idx
  ON oil_vessel_position_observations (position_time DESC);
CREATE INDEX IF NOT EXISTS oil_vpos_source_position_idx
  ON oil_vessel_position_observations (data_source, position_time DESC);
CREATE INDEX IF NOT EXISTS oil_vpos_geom_idx
  ON oil_vessel_position_observations USING GIST (geom);

CREATE TABLE IF NOT EXISTS coverage_cells (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cell_id TEXT NOT NULL,
  min_lat NUMERIC NOT NULL,
  min_lng NUMERIC NOT NULL,
  max_lat NUMERIC NOT NULL,
  max_lng NUMERIC NOT NULL,
  bucket_start TIMESTAMPTZ NOT NULL,
  bucket_minutes INTEGER NOT NULL DEFAULT 60,
  source TEXT NOT NULL,
  source_type TEXT,
  observation_count INTEGER NOT NULL DEFAULT 0,
  vessel_count INTEGER NOT NULL DEFAULT 0,
  freshness_seconds INTEGER,
  coverage_quality TEXT NOT NULL DEFAULT 'unknown',
  confidence NUMERIC DEFAULT 0.5,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (cell_id, bucket_start, source)
);

CREATE INDEX IF NOT EXISTS coverage_cells_bbox_idx
  ON coverage_cells (min_lat, max_lat, min_lng, max_lng);
CREATE INDEX IF NOT EXISTS coverage_cells_bucket_idx
  ON coverage_cells (bucket_start DESC, source);

CREATE TABLE IF NOT EXISTS port_event_observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'open_port_event',
  source_record_id TEXT NOT NULL,
  source_record_url TEXT,
  event_type TEXT NOT NULL,
  port_name TEXT,
  unlocode TEXT,
  terminal_name TEXT,
  vessel_name TEXT,
  mmsi BIGINT,
  imo TEXT,
  event_time TIMESTAMPTZ,
  received_at TIMESTAMPTZ DEFAULT now(),
  lat NUMERIC,
  lng NUMERIC,
  confidence NUMERIC DEFAULT 0.5,
  raw JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (source, source_record_id)
);

CREATE INDEX IF NOT EXISTS port_event_observations_time_idx
  ON port_event_observations (event_time DESC);
CREATE INDEX IF NOT EXISTS port_event_observations_source_idx
  ON port_event_observations (source, event_type);
CREATE INDEX IF NOT EXISTS port_event_observations_mmsi_idx
  ON port_event_observations (mmsi, event_time DESC);

CREATE TABLE IF NOT EXISTS maritime_watch_zones (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100,
  min_lat NUMERIC NOT NULL,
  min_lng NUMERIC NOT NULL,
  max_lat NUMERIC NOT NULL,
  max_lng NUMERIC NOT NULL,
  target_sources TEXT[] DEFAULT ARRAY['aisstream','aishub','barentswatch','denmark_ais','sentinel1_sar'],
  expected_gap_reason TEXT,
  status TEXT NOT NULL DEFAULT 'planned',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO maritime_watch_zones (
  id, name, priority, min_lat, min_lng, max_lat, max_lng, expected_gap_reason
) VALUES
  ('persian_gulf_fujairah_hormuz', 'Persian Gulf / Fujairah / Strait of Hormuz', 10, 22.0, 48.0, 30.8, 58.8, 'Open terrestrial/community AIS is sparse; add contributed AISHub receivers and port-event confirmation.'),
  ('oman_approaches', 'Oman approaches', 20, 16.0, 53.0, 24.5, 62.5, 'Sparse coastal receiver density; use partner receiver plus port-event fallback.'),
  ('suez_red_sea', 'Suez / Red Sea corridor', 30, 11.0, 31.0, 31.8, 45.0, 'High trader value chokepoint where open AIS must be monitored for receiver gaps.'),
  ('west_africa_gulf_of_guinea', 'West Africa / Gulf of Guinea', 40, -7.0, -18.5, 10.5, 12.5, 'Open AIS gaps around anchorage and coastal zones; use port events and partner receiver rollout.'),
  ('east_africa_mombasa_dar', 'East Africa / Mombasa / Dar es Salaam', 50, -12.5, 37.0, 3.0, 45.5, 'Sparse open coverage along East African coast; use port events and contributed receiver path.'),
  ('south_africa_durban_richards_bay', 'South Africa / Durban / Richards Bay', 60, -36.5, 15.0, -25.0, 34.5, 'Key bunkering and bulk route; monitor open AIS density before implying vessel absence.'),
  ('morocco_tangier_gibraltar', 'Morocco / Tangier / Gibraltar', 70, 32.5, -9.8, 37.2, -1.0, 'High-traffic gateway; use community AIS plus port-event fallback.')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  priority = EXCLUDED.priority,
  min_lat = EXCLUDED.min_lat,
  min_lng = EXCLUDED.min_lng,
  max_lat = EXCLUDED.max_lat,
  max_lng = EXCLUDED.max_lng,
  expected_gap_reason = EXCLUDED.expected_gap_reason,
  updated_at = now();

CREATE TABLE IF NOT EXISTS maritime_source_health (
  source TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned',
  coverage_tier TEXT NOT NULL DEFAULT 'open_partial',
  last_observation_at TIMESTAMPTZ,
  observation_count INTEGER NOT NULL DEFAULT 0,
  limitations TEXT[] DEFAULT ARRAY[]::TEXT[],
  source_url TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO maritime_source_health (
  source, source_type, display_name, status, coverage_tier, limitations, source_url, metadata
) VALUES
  ('aisstream', 'community_coastal_ais', 'AISStream', 'configured_if_key_present', 'open_partial',
    ARRAY['Open/community AIS feed; not full global coverage.', 'Known sparse regions must be represented as coverage gaps, not vessel absence.'],
    'https://aisstream.io/documentation.html',
    '{"coverage_url":"https://aisstream.io/coverage"}'::jsonb),
  ('aishub', 'contributor_terrestrial_ais', 'AISHub contributor network', 'planned', 'open_contributor',
    ARRAY['Requires contributing receiver stations before free API access.', 'Primary open path for Persian Gulf and Africa gap reduction.'],
    'https://www.aishub.net/api',
    '{"join_url":"https://www.aishub.net/join-us"}'::jsonb),
  ('barentswatch', 'government_ais', 'BarentsWatch Live AIS', 'planned', 'open_government_regional',
    ARRAY['Regional government AIS; useful for hardening ingestion model, not Gulf/Africa coverage.'],
    'https://developer.barentswatch.no/docs/AIS/live-ais-api/',
    '{}'::jsonb),
  ('denmark_ais', 'government_historical_ais', 'Danish historical AIS', 'planned', 'open_government_historical',
    ARRAY['Historical AIS data for training and validation; not live global coverage.'],
    'https://www.dma.dk/safety-at-sea/navigational-information/ais-data',
    '{}'::jsonb),
  ('sentinel1_sar', 'satellite_detected_unidentified', 'Copernicus Sentinel-1 SAR', 'planned_optional', 'open_satellite_inferred',
    ARRAY['Detects likely vessels but does not identify MMSI/IMO by itself.', 'Must be labeled satellite_detected_unidentified.'],
    'https://dataspace.copernicus.eu/data-collections/sentinel-data/sentinel-1',
    '{}'::jsonb)
ON CONFLICT (source) DO UPDATE SET
  source_type = EXCLUDED.source_type,
  display_name = EXCLUDED.display_name,
  coverage_tier = EXCLUDED.coverage_tier,
  limitations = EXCLUDED.limitations,
  source_url = EXCLUDED.source_url,
  metadata = EXCLUDED.metadata,
  updated_at = now();
