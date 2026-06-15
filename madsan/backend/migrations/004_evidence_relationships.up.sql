CREATE TABLE IF NOT EXISTS evidence (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id UUID NOT NULL REFERENCES sources(id) ON DELETE RESTRICT,
    entity_type TEXT NOT NULL,
    entity_id UUID NOT NULL,
    claim_type TEXT NOT NULL,
    claim_value TEXT,
    extracted_text TEXT,
    confidence_score NUMERIC(5,2) DEFAULT 0,
    tier TEXT DEFAULT 'observed',
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_evidence_entity ON evidence(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS relationships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_entity_type TEXT NOT NULL,
    from_entity_id UUID NOT NULL,
    to_entity_type TEXT NOT NULL,
    to_entity_id UUID NOT NULL,
    relationship_type TEXT NOT NULL,
    source_id UUID REFERENCES sources(id) ON DELETE SET NULL,
    confidence_score NUMERIC(5,2) DEFAULT 0,
    evidence_snippet TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rel_from ON relationships(from_entity_type, from_entity_id);
CREATE INDEX IF NOT EXISTS idx_rel_to ON relationships(to_entity_type, to_entity_id);

CREATE TABLE IF NOT EXISTS risk_flags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type TEXT NOT NULL,
    entity_id UUID NOT NULL,
    flag_type TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'warning',
    description TEXT,
    source_id UUID REFERENCES sources(id) ON DELETE SET NULL,
    confidence_score NUMERIC(5,2) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS core_signals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    signal_type TEXT NOT NULL,
    entity_type TEXT,
    entity_id UUID,
    tier TEXT NOT NULL DEFAULT 'observed',
    confidence_score NUMERIC(5,2) DEFAULT 0,
    payload JSONB DEFAULT '{}',
    observed_at TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_signals_type ON core_signals(signal_type, observed_at DESC);
