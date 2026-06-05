-- Migration 028: Broker Workspace entities, deal packs, and follow-ups
-- Extends 026 broker workspaces for map-first deal packing.

ALTER TABLE user_workspaces
    ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT false;

-- workspace_entities: suppliers, buyers, custom pins on the loose map layer
CREATE TABLE IF NOT EXISTS workspace_entities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES user_workspaces(id) ON DELETE CASCADE,
    entity_type TEXT NOT NULL CHECK (entity_type IN ('supplier', 'buyer', 'custom_pin')),
    ref_kind TEXT NOT NULL DEFAULT 'custom' CHECK (ref_kind IN ('license', 'oil_company', 'vessel', 'custom')),
    ref_id TEXT,
    display_name TEXT NOT NULL,
    lat DOUBLE PRECISION NOT NULL DEFAULT 0,
    lng DOUBLE PRECISION NOT NULL DEFAULT 0,
    deal_signal TEXT DEFAULT 'maybe' CHECK (deal_signal IN ('good', 'maybe', 'bad')),
    dd_stage TEXT DEFAULT 'New',
    in_dd_queue BOOLEAN NOT NULL DEFAULT false,
    packed_into_pack_id UUID,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workspace_entities_ws ON workspace_entities(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_entities_packed ON workspace_entities(packed_into_pack_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_entities_unique_ref
    ON workspace_entities(workspace_id, ref_kind, ref_id)
    WHERE ref_id IS NOT NULL AND ref_id <> '';

-- broker_deal_packs: collapsed package pins on the map
CREATE TABLE IF NOT EXISTS broker_deal_packs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES user_workspaces(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    map_lat DOUBLE PRECISION,
    map_lng DOUBLE PRECISION,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'packed', 'archived')),
    journal JSONB NOT NULL DEFAULT '{"stage_label":"","done":[],"missing":[],"notes":""}'::jsonb,
    transport JSONB NOT NULL DEFAULT '{}'::jsonb,
    economics JSONB NOT NULL DEFAULT '{}'::jsonb,
    constituent_entity_ids UUID[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_broker_deal_packs_ws ON broker_deal_packs(workspace_id);
CREATE INDEX IF NOT EXISTS idx_broker_deal_packs_user ON broker_deal_packs(user_id);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_workspace_entities_pack'
    ) THEN
        ALTER TABLE workspace_entities
            ADD CONSTRAINT fk_workspace_entities_pack
            FOREIGN KEY (packed_into_pack_id) REFERENCES broker_deal_packs(id) ON DELETE SET NULL;
    END IF;
END $$;

-- deal_pack_followups: scheduled reminders (in_app v1, email later)
CREATE TABLE IF NOT EXISTS deal_pack_followups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pack_id UUID NOT NULL REFERENCES broker_deal_packs(id) ON DELETE CASCADE,
    remind_at TIMESTAMPTZ NOT NULL,
    title TEXT NOT NULL,
    message TEXT,
    completed_at TIMESTAMPTZ,
    delivery_channel TEXT NOT NULL DEFAULT 'in_app' CHECK (delivery_channel IN ('in_app', 'email')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deal_pack_followups_pack ON deal_pack_followups(pack_id);
CREATE INDEX IF NOT EXISTS idx_deal_pack_followups_due ON deal_pack_followups(remind_at)
    WHERE completed_at IS NULL;

-- Entity route edges (logistics lines between workspace_entities)
CREATE TABLE IF NOT EXISTS workspace_entity_edges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES user_workspaces(id) ON DELETE CASCADE,
    source_entity_id UUID NOT NULL REFERENCES workspace_entities(id) ON DELETE CASCADE,
    target_entity_id UUID NOT NULL REFERENCES workspace_entities(id) ON DELETE CASCADE,
    label TEXT DEFAULT 'logistics_route',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workspace_entity_edges_ws ON workspace_entity_edges(workspace_id);
