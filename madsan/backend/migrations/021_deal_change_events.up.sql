CREATE TABLE IF NOT EXISTS deal_change_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    change_type TEXT NOT NULL,
    field TEXT,
    old_value TEXT,
    new_value TEXT,
    delta_pct NUMERIC(8,4),
    tier TEXT NOT NULL DEFAULT 'not_implemented',
    source TEXT,
    message TEXT,
    detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deal_change_events_deal_user_at
    ON deal_change_events(deal_id, user_id, detected_at DESC);

CREATE INDEX IF NOT EXISTS idx_deal_change_events_scan
    ON deal_change_events(deal_id, user_id, change_type, detected_at DESC);

ALTER TABLE deal_watch_subscriptions
    ADD COLUMN IF NOT EXISTS last_scanned_at TIMESTAMPTZ;
