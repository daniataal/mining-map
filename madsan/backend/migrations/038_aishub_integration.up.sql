-- AISHub secondary AIS: positions tagged by source + static registry for infrequent fields.

ALTER TABLE ais_positions
    ADD COLUMN IF NOT EXISTS data_source TEXT NOT NULL DEFAULT 'aisstream';

CREATE INDEX IF NOT EXISTS idx_ais_positions_source_mmsi_ts
    ON ais_positions (data_source, mmsi, ts DESC);

ALTER TABLE vessels
    ADD COLUMN IF NOT EXISTS last_position_source TEXT,
    ADD COLUMN IF NOT EXISTS callsign TEXT;

CREATE TABLE IF NOT EXISTS vessel_ais_registry (
    mmsi             TEXT PRIMARY KEY,
    imo              TEXT,
    name             TEXT,
    callsign         TEXT,
    ship_type_code   INT,
    ship_type_label  TEXT,
    length_m         NUMERIC,
    beam_m           NUMERIC,
    draught_m        NUMERIC,
    destination      TEXT,
    raw_payload      JSONB DEFAULT '{}'::jsonb,
    source           TEXT NOT NULL DEFAULT 'aishub',
    first_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_static_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vessel_ais_registry_imo ON vessel_ais_registry (imo) WHERE imo IS NOT NULL;

INSERT INTO maritime_source_health (
    source, source_type, display_name, status, coverage_tier, limitations
) VALUES (
    'aishub',
    'contributor_terrestrial_ais',
    'AISHub contributor network',
    'connecting',
    'open_partial',
    ARRAY[
        'Open terrestrial AIS feed — polls AISHub bbox API on a schedule',
        'Optional AISHUB_USERNAME if your endpoint requires it'
    ]
)
ON CONFLICT (source) DO NOTHING;
