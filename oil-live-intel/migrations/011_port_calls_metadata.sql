-- Port call provenance (e.g. seed_port_calls from graph sync).
ALTER TABLE oil_port_calls ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
