-- Precomputed vessel owner/operator enrichment (cron job, not request-path).
-- PK mmsi aligns with vessels.mmsi for indexed dossier joins.

CREATE TABLE IF NOT EXISTS vessel_enrichment (
    mmsi TEXT PRIMARY KEY,
    vessel_id UUID REFERENCES vessels(id) ON DELETE SET NULL,
    imo TEXT,
    owner_name TEXT,
    operator_name TEXT,
    owner_company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
    operator_company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
    builder TEXT,
    build_year INT,
    vessel_class TEXT,
    flag TEXT,
    gross_tonnage NUMERIC,
    deadweight_tons NUMERIC,
    fleet_list JSONB DEFAULT '[]'::jsonb,
    owner_profile JSONB DEFAULT '{}'::jsonb,
    source TEXT NOT NULL DEFAULT 'not_implemented',
    tier TEXT NOT NULL DEFAULT 'not_implemented',
    confidence_score NUMERIC(5,2) DEFAULT 0,
    limitations TEXT[] DEFAULT '{}',
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    stale_after TIMESTAMPTZ NOT NULL DEFAULT now() + interval '90 days',
    raw_payload JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vessel_enrichment_vessel_id ON vessel_enrichment(vessel_id);
CREATE INDEX IF NOT EXISTS idx_vessel_enrichment_stale_after ON vessel_enrichment(stale_after);
CREATE INDEX IF NOT EXISTS idx_vessel_enrichment_imo ON vessel_enrichment(imo) WHERE imo IS NOT NULL;

COMMENT ON TABLE vessel_enrichment IS
  'Precomputed vessel registry enrichment (owner/operator). Populated by vessel_enrichment ingestion job; read on dossier join only.';
