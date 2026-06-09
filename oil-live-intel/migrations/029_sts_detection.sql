-- Migration 029: STS (ship-to-ship) detection foundation
-- Rollback: DROP TABLE IF EXISTS oil_sts_events, oil_sts_zones, oil_ais_track_points CASCADE;

-- Durable historical AIS archive (separate from live oil_ais_positions rolling buffer).
CREATE TABLE IF NOT EXISTS oil_ais_track_points (
  id BIGSERIAL PRIMARY KEY,
  mmsi BIGINT NOT NULL,
  ts TIMESTAMPTZ NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lon DOUBLE PRECISION NOT NULL,
  sog DOUBLE PRECISION,
  cog DOUBLE PRECISION,
  geom GEOMETRY(POINT, 4326) NOT NULL,
  data_source TEXT NOT NULL DEFAULT 'live_ais_archive',
  source_record_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS oil_ais_track_points_geom_idx
  ON oil_ais_track_points USING GIST (geom);
CREATE INDEX IF NOT EXISTS oil_ais_track_points_mmsi_ts_idx
  ON oil_ais_track_points (mmsi, ts DESC);
CREATE UNIQUE INDEX IF NOT EXISTS oil_ais_track_points_source_unique_idx
  ON oil_ais_track_points (data_source, mmsi, ts)
  WHERE source_record_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS oil_ais_track_points_source_record_idx
  ON oil_ais_track_points (data_source, source_record_id)
  WHERE source_record_id IS NOT NULL;

-- Known STS anchorage / transfer areas (approximate open-source polygons).
CREATE TABLE IF NOT EXISTS oil_sts_zones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  zone_type TEXT NOT NULL DEFAULT 'sts_anchorage',
  geom GEOMETRY(POLYGON, 4326) NOT NULL,
  source TEXT NOT NULL DEFAULT 'inferred_open_sources',
  confidence NUMERIC NOT NULL DEFAULT 0.5,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS oil_sts_zones_geom_idx
  ON oil_sts_zones USING GIST (geom);

-- Inferred STS proximity events (AIS-only; not verified commodity transfer).
CREATE TABLE IF NOT EXISTS oil_sts_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mmsi_a BIGINT NOT NULL,
  mmsi_b BIGINT NOT NULL,
  start_ts TIMESTAMPTZ NOT NULL,
  end_ts TIMESTAMPTZ NOT NULL,
  centroid_lat DOUBLE PRECISION,
  centroid_lon DOUBLE PRECISION,
  min_distance_m NUMERIC,
  avg_sog NUMERIC,
  zone_id UUID REFERENCES oil_sts_zones(id),
  confidence_tier TEXT NOT NULL DEFAULT 'low'
    CHECK (confidence_tier IN ('low', 'medium', 'high', 'very_high', 'verified')),
  confidence_score NUMERIC NOT NULL DEFAULT 0.0,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'inferred'
    CHECK (status IN ('inferred', 'verified')),
  data_source TEXT NOT NULL DEFAULT 'ais_proximity',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (mmsi_a < mmsi_b),
  CHECK (end_ts > start_ts)
);

CREATE INDEX IF NOT EXISTS oil_sts_events_time_idx
  ON oil_sts_events (start_ts DESC, end_ts DESC);
CREATE INDEX IF NOT EXISTS oil_sts_events_mmsi_a_idx ON oil_sts_events (mmsi_a);
CREATE INDEX IF NOT EXISTS oil_sts_events_mmsi_b_idx ON oil_sts_events (mmsi_b);
CREATE INDEX IF NOT EXISTS oil_sts_events_zone_idx ON oil_sts_events (zone_id);
CREATE UNIQUE INDEX IF NOT EXISTS oil_sts_events_pair_start_uidx
  ON oil_sts_events (mmsi_a, mmsi_b, start_ts);

-- Minimal STS zone seed (approximate polygons; inferred from public anchorage references).
INSERT INTO oil_sts_zones (name, zone_type, geom, source, confidence, metadata)
SELECT v.name, v.zone_type, v.geom, v.source, v.confidence, v.metadata
FROM (VALUES
  (
    'Fujairah STS anchorage (approx)',
    'sts_anchorage',
    ST_GeomFromText('POLYGON((56.35 24.95, 56.65 24.95, 56.65 25.15, 56.35 25.15, 56.35 24.95))', 4326),
    'inferred_open_sources',
    0.55::numeric,
    '{"region":"UAE","note":"Approximate Fujairah/offshore anchorage polygon from public references; not an official boundary"}'::jsonb
  ),
  (
    'West Africa STS area (approx)',
    'sts_anchorage',
    ST_GeomFromText('POLYGON((1.5 4.8, 2.8 4.8, 2.8 6.0, 1.5 6.0, 1.5 4.8))', 4326),
    'inferred_open_sources',
    0.50::numeric,
    '{"region":"Gulf of Guinea","note":"Approximate open-water STS hotspot; boundaries inferred"}'::jsonb
  ),
  (
    'Singapore Strait STS area (approx)',
    'sts_anchorage',
    ST_GeomFromText('POLYGON((103.5 1.0, 104.2 1.0, 104.2 1.5, 103.5 1.5, 103.5 1.0))', 4326),
    'inferred_open_sources',
    0.55::numeric,
    '{"region":"Singapore/Malaysia","note":"Approximate eastern strait STS anchorage area"}'::jsonb
  )
) AS v(name, zone_type, geom, source, confidence, metadata)
WHERE NOT EXISTS (SELECT 1 FROM oil_sts_zones LIMIT 1);
