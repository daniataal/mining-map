-- Geographic reference features (Natural Earth, public domain): land polygons,
-- river centerlines and lakes. Used for AIS position-integrity checks — an STS
-- event "on land" away from waterways is GPS interference, not a transfer.
CREATE TABLE IF NOT EXISTS geo_reference_features (
    id BIGSERIAL PRIMARY KEY,
    kind TEXT NOT NULL, -- land | river | lake
    source TEXT NOT NULL DEFAULT 'natural_earth_10m',
    name TEXT,
    geom GEOGRAPHY NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS geo_reference_features_gix ON geo_reference_features USING GIST (geom);
CREATE INDEX IF NOT EXISTS geo_reference_features_kind_idx ON geo_reference_features (kind);
