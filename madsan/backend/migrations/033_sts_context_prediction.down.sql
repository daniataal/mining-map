DROP INDEX IF EXISTS idx_predictive_signals_geom;

ALTER TABLE predictive_signals
    DROP COLUMN IF EXISTS expires_at,
    DROP COLUMN IF EXISTS geom;

DROP INDEX IF EXISTS idx_maritime_context_zones_port_group;
DROP INDEX IF EXISTS idx_maritime_context_zones_type;
DROP INDEX IF EXISTS idx_maritime_context_zones_geom;
DROP TABLE IF EXISTS maritime_context_zones;
