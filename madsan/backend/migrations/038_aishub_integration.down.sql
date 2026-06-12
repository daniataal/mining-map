DROP TABLE IF EXISTS vessel_ais_registry;
ALTER TABLE vessels DROP COLUMN IF EXISTS callsign;
ALTER TABLE vessels DROP COLUMN IF EXISTS last_position_source;
DROP INDEX IF EXISTS idx_ais_positions_source_mmsi_ts;
ALTER TABLE ais_positions DROP COLUMN IF EXISTS data_source;
DELETE FROM maritime_source_health WHERE source = 'aishub';
