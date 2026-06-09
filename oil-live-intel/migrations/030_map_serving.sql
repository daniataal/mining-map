-- Map serving read models: pre-built popups, clusters, hub supplier grids.

CREATE TABLE IF NOT EXISTS map_feature_popup_payload (
  feature_key TEXT PRIMARY KEY,
  asset_id UUID,
  popup_version INT NOT NULL DEFAULT 1,
  title TEXT,
  subtitle TEXT,
  bol_tier TEXT,
  geocode_tier TEXT,
  sources JSONB NOT NULL DEFAULT '[]'::jsonb,
  fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  limitations JSONB NOT NULL DEFAULT '[]'::jsonb,
  built_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS map_feature_popup_payload_built_idx
  ON map_feature_popup_payload (built_at DESC);

CREATE TABLE IF NOT EXISTS map_serving_point_clusters (
  id BIGSERIAL PRIMARY KEY,
  layer_id TEXT NOT NULL,
  zoom_band INT NOT NULL,
  grid_cell TEXT NOT NULL,
  count INT NOT NULL DEFAULT 0,
  bounds GEOMETRY(POLYGON, 4326),
  source_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  built_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (layer_id, zoom_band, grid_cell)
);

CREATE INDEX IF NOT EXISTS map_serving_point_clusters_layer_zoom_idx
  ON map_serving_point_clusters (layer_id, zoom_band);

CREATE INDEX IF NOT EXISTS map_serving_point_clusters_bounds_idx
  ON map_serving_point_clusters USING GIST (bounds);

CREATE TABLE IF NOT EXISTS map_serving_supplier_hubs (
  locode TEXT PRIMARY KEY,
  hub_name TEXT,
  country TEXT,
  supplier_count INT NOT NULL DEFAULT 0,
  geocoded_count INT NOT NULL DEFAULT 0,
  hub_anchor_count INT NOT NULL DEFAULT 0,
  bounds GEOMETRY(POLYGON, 4326),
  hub_centroid GEOMETRY(POINT, 4326),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  built_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS map_serving_supplier_hubs_centroid_idx
  ON map_serving_supplier_hubs USING GIST (hub_centroid);

COMMENT ON TABLE map_feature_popup_payload IS
  'Pre-merged popup JSON for map features — no runtime multi-source merge on pan.';

COMMENT ON TABLE map_serving_point_clusters IS
  'Pre-computed point clusters per layer and zoom band for fast bbox cluster API.';

COMMENT ON TABLE map_serving_supplier_hubs IS
  'Hub-level bunker supplier aggregates for registry and hub-first navigation.';
