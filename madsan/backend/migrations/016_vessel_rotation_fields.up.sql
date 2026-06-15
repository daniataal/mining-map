-- AIS rotation fields for vessel MVT tiles and live map symbols.
ALTER TABLE vessels ADD COLUMN IF NOT EXISTS heading DOUBLE PRECISION;

DROP MATERIALIZED VIEW IF EXISTS map_vessels;

CREATE MATERIALIZED VIEW map_vessels AS
SELECT
    v.id,
    v.name,
    v.imo,
    v.mmsi,
    v.vessel_type,
    v.flag_country_code,
    v.latitude,
    v.longitude,
    v.geom::geometry AS geom,
    v.course,
    v.heading,
    v.speed_knots,
    v.destination,
    v.last_seen_at,
    v.confidence_score,
    v.data_quality_status
FROM vessels v
WHERE v.latitude IS NOT NULL AND v.longitude IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_map_vessels_id ON map_vessels(id);
