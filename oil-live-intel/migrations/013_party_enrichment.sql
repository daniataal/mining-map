-- Party enrichment columns for Phase 4a (OpenSanctions), 4c (GLEIF LEI + Wikidata).
-- All ALTERs use IF NOT EXISTS so the migration is idempotent.

-- ------------------------------------------------------------
-- oil_companies: sanctions, LEI, Wikidata facts.
-- ------------------------------------------------------------
ALTER TABLE oil_companies
  ADD COLUMN IF NOT EXISTS sanctions_status TEXT,
  ADD COLUMN IF NOT EXISTS sanctions_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sanctions_matches JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS lei TEXT,
  ADD COLUMN IF NOT EXISTS lei_record_id TEXT,
  ADD COLUMN IF NOT EXISTS wikidata_qid TEXT,
  ADD COLUMN IF NOT EXISTS wikidata_facts JSONB DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS oil_companies_lei_idx
  ON oil_companies (lei)
  WHERE lei IS NOT NULL;

CREATE INDEX IF NOT EXISTS oil_companies_sanctions_status_idx
  ON oil_companies (sanctions_status)
  WHERE sanctions_status IS NOT NULL;

-- ------------------------------------------------------------
-- meridian_cargo_records: denormalised LEI + sanctions status per party.
-- These are populated by graph_sync from oil_companies so the cargo popup
-- can render chips without an extra JOIN.
-- ------------------------------------------------------------
ALTER TABLE meridian_cargo_records
  ADD COLUMN IF NOT EXISTS shipper_lei TEXT,
  ADD COLUMN IF NOT EXISTS consignee_lei TEXT,
  ADD COLUMN IF NOT EXISTS shipper_sanctions_status TEXT,
  ADD COLUMN IF NOT EXISTS consignee_sanctions_status TEXT;
