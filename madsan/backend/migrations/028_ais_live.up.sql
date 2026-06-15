-- Phase E: direct AISStream time-series + live port-call visits in madsan_db.
-- Retention: ais-ingest worker deletes rows older than MADSAN_AIS_RETAIN_DAYS (default 30).

CREATE TABLE IF NOT EXISTS ais_positions (
    id          BIGSERIAL PRIMARY KEY,
    mmsi        TEXT NOT NULL,
    ts          TIMESTAMPTZ NOT NULL,
    lat         DOUBLE PRECISION NOT NULL,
    lon         DOUBLE PRECISION NOT NULL,
    speed_knots DOUBLE PRECISION,
    course      DOUBLE PRECISION,
    heading     DOUBLE PRECISION,
    nav_status  TEXT,
    draft_m     DOUBLE PRECISION,
    destination TEXT,
    eta         TEXT,
    geom        GEOGRAPHY(Point, 4326),
    raw         JSONB,
    created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ais_positions_mmsi_ts ON ais_positions (mmsi, ts DESC);
CREATE INDEX IF NOT EXISTS idx_ais_positions_ts ON ais_positions (ts);
CREATE INDEX IF NOT EXISTS idx_ais_positions_geom ON ais_positions USING GIST (geom);

-- Open/closed terminal visits detected from AIS x asset geofence (streaming worker).
CREATE TABLE IF NOT EXISTS port_call_visits (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vessel_id        UUID REFERENCES vessels(id) ON DELETE SET NULL,
    mmsi             TEXT NOT NULL,
    asset_id         UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    arrival_ts       TIMESTAMPTZ NOT NULL,
    departure_ts     TIMESTAMPTZ,
    duration_hours   DOUBLE PRECISION,
    draft_in_m       DOUBLE PRECISION,
    draft_out_m      DOUBLE PRECISION,
    draft_delta_m    DOUBLE PRECISION,
    destination_in   TEXT,
    destination_out  TEXT,
    event_type       TEXT NOT NULL DEFAULT 'terminal_visit_unknown',
    commodity_family TEXT,
    status           TEXT NOT NULL DEFAULT 'open',
    confidence_score NUMERIC(5,2) DEFAULT 0,
    evidence         JSONB DEFAULT '[]'::jsonb,
    metadata         JSONB DEFAULT '{}'::jsonb,
    created_at       TIMESTAMPTZ DEFAULT now(),
    updated_at       TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_port_call_visits_mmsi ON port_call_visits (mmsi, arrival_ts DESC);
CREATE INDEX IF NOT EXISTS idx_port_call_visits_asset ON port_call_visits (asset_id, arrival_ts DESC);
CREATE INDEX IF NOT EXISTS idx_port_call_visits_open ON port_call_visits (status) WHERE status = 'open';

-- Lightweight AIS provider health for admin dashboards (replaces legacy 2-hop read).
CREATE TABLE IF NOT EXISTS maritime_source_health (
    source               TEXT PRIMARY KEY,
    source_type          TEXT,
    display_name         TEXT,
    status               TEXT NOT NULL DEFAULT 'connecting',
    coverage_tier        TEXT DEFAULT 'open_partial',
    last_observation_at  TIMESTAMPTZ,
    observation_count    BIGINT DEFAULT 0,
    limitations          TEXT[] DEFAULT '{}',
    updated_at           TIMESTAMPTZ DEFAULT now()
);
