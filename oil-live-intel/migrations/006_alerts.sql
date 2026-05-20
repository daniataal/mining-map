CREATE TABLE IF NOT EXISTS oil_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  watchlist_id UUID REFERENCES oil_watchlists(id) ON DELETE SET NULL,
  user_id TEXT NOT NULL DEFAULT 'default',
  alert_type TEXT NOT NULL,
  ref_type TEXT,
  ref_id TEXT,
  title TEXT NOT NULL,
  body TEXT,
  severity TEXT DEFAULT 'info',
  payload JSONB DEFAULT '{}'::jsonb,
  assigned_to TEXT,
  status TEXT DEFAULT 'open',
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS oil_alerts_user_created_idx ON oil_alerts (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS oil_alerts_unread_idx ON oil_alerts (user_id) WHERE read_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS oil_alerts_dedup_idx
  ON oil_alerts (watchlist_id, ref_type, ref_id)
  WHERE watchlist_id IS NOT NULL AND ref_id IS NOT NULL;
