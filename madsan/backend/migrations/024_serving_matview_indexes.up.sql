-- map_vessels was recreated in 016 without a GIST index on geom.
CREATE INDEX IF NOT EXISTS idx_map_vessels_geom ON map_vessels USING GIST (geom);

-- Serving-layer filter indexes (type / country / confidence) for list + bbox APIs.
CREATE INDEX IF NOT EXISTS idx_map_energy_assets_type ON map_energy_assets(asset_type);
CREATE INDEX IF NOT EXISTS idx_map_energy_assets_country ON map_energy_assets(country_code);
CREATE INDEX IF NOT EXISTS idx_map_energy_assets_confidence ON map_energy_assets(confidence_score);

CREATE INDEX IF NOT EXISTS idx_map_metals_assets_type ON map_metals_assets(asset_type);
CREATE INDEX IF NOT EXISTS idx_map_metals_assets_country ON map_metals_assets(country_code);
CREATE INDEX IF NOT EXISTS idx_map_metals_assets_confidence ON map_metals_assets(confidence_score);

CREATE INDEX IF NOT EXISTS idx_map_vessels_confidence ON map_vessels(confidence_score);
