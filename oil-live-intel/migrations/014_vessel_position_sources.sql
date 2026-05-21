CREATE TABLE IF NOT EXISTS oil_vessel_position_observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mmsi BIGINT NOT NULL,
  data_source TEXT NOT NULL,  -- e.g. aisstream, maritime_redis, future_secondary
  source_record_id TEXT NOT NULL,
  lat NUMERIC NOT NULL,
  lng NUMERIC NOT NULL,
  sog NUMERIC,
  cog NUMERIC,
  vessel_name TEXT,
  observed_at TIMESTAMPTZ NOT NULL,
  ingested_at TIMESTAMPTZ DEFAULT now(),
  raw JSONB DEFAULT '{}'::jsonb,
  UNIQUE (data_source, source_record_id)
);
CREATE INDEX IF NOT EXISTS oil_vpos_mmsi_observed_idx ON oil_vessel_position_observations (mmsi, observed_at DESC);
