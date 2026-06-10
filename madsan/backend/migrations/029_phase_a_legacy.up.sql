-- Phase A legacy intelligence: idempotent import keys + STS zone reference polygons.

CREATE TABLE IF NOT EXISTS sts_zones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    legacy_zone_id UUID UNIQUE,
    name TEXT NOT NULL,
    zone_type TEXT NOT NULL DEFAULT 'sts_anchorage',
    geom GEOGRAPHY(Polygon, 4326),
    source TEXT NOT NULL DEFAULT 'inferred_open_sources',
    confidence NUMERIC(5,2) DEFAULT 0.5,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sts_zones_geom ON sts_zones USING GIST (geom);

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

CREATE UNIQUE INDEX IF NOT EXISTS uq_core_signals_legacy_port_call
    ON core_signals ((payload->>'legacy_port_call_id'))
    WHERE signal_type = 'port_call' AND payload->>'legacy_port_call_id' IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_core_signals_sts_legacy
    ON core_signals ((payload->>'legacy_sts_id'))
    WHERE signal_type = 'sts' AND payload->>'legacy_sts_id' IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_core_signals_commercial_fingerprint
    ON core_signals ((payload->>'fingerprint'))
    WHERE signal_type = 'commercial_event' AND payload->>'fingerprint' IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_voyages_legacy_port_call
    ON voyages ((metadata->>'legacy_port_call_id'))
    WHERE metadata->>'legacy_port_call_id' IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_prices_eia_historic_legacy
    ON prices ((raw_payload->>'legacy_eia_id'))
    WHERE raw_payload->>'legacy_eia_id' IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_prices_eia_spot_symbol_period
    ON prices (location_name, price_type, observed_at)
    WHERE price_type = 'eia_spot';

CREATE UNIQUE INDEX IF NOT EXISTS uq_contacts_legacy
    ON contacts ((metadata->>'legacy_contact_id'))
    WHERE metadata->>'legacy_contact_id' IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_deals_legacy_broker_pack
    ON deals ((metadata->>'legacy_broker_pack_id'))
    WHERE metadata->>'legacy_broker_pack_id' IS NOT NULL;
