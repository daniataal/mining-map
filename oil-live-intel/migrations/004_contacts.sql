CREATE TABLE IF NOT EXISTS oil_company_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES oil_companies(id) ON DELETE CASCADE,
  contact_type TEXT NOT NULL,
  contact_scope TEXT NOT NULL DEFAULT 'public_business',
  label TEXT,
  value TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'manual',
  created_by TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS oil_company_contacts_company_idx
  ON oil_company_contacts (company_id);
