-- Persisted sync timestamps for Live Data health banner.
CREATE TABLE IF NOT EXISTS oil_live_sync_state (
  key TEXT PRIMARY KEY,
  value TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT now()
);
