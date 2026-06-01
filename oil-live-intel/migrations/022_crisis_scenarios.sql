-- Crisis Desk v1: saved scenarios + optional watchlists (MER-D-CRISIS).

CREATE TABLE IF NOT EXISTS crisis_scenarios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    min_lat DOUBLE PRECISION NOT NULL,
    min_lng DOUBLE PRECISION NOT NULL,
    max_lat DOUBLE PRECISION NOT NULL,
    max_lng DOUBLE PRECISION NOT NULL,
    watch_zone_ids TEXT[] NOT NULL DEFAULT '{}',
    product_filter TEXT,
    assumptions_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scenario_watchlists (
    scenario_id UUID NOT NULL REFERENCES crisis_scenarios(id) ON DELETE CASCADE,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (scenario_id, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS scenario_watchlists_scenario_idx
    ON scenario_watchlists (scenario_id);

INSERT INTO crisis_scenarios (
    slug, title, min_lat, min_lng, max_lat, max_lng,
    watch_zone_ids, product_filter, assumptions_json
) VALUES (
    'hormuz_disruption_v1',
    'Hormuz disruption v1',
    12.0, 48.0, 31.0, 62.0,
    ARRAY['persian_gulf_fujairah_hormuz', 'oman_approaches', 'gulf_of_oman_hormuz_approaches'],
    'crude',
    '{"summary":"Screening scenario for Strait of Hormuz / Gulf disruption. Open AIS may be sparse — verify coverage banner.","tier":"synthetic"}'::jsonb
)
ON CONFLICT (slug) DO UPDATE SET
    title = EXCLUDED.title,
    min_lat = EXCLUDED.min_lat,
    min_lng = EXCLUDED.min_lng,
    max_lat = EXCLUDED.max_lat,
    max_lng = EXCLUDED.max_lng,
    watch_zone_ids = EXCLUDED.watch_zone_ids,
    product_filter = EXCLUDED.product_filter,
    assumptions_json = EXCLUDED.assumptions_json,
    updated_at = now();
