CREATE UNIQUE INDEX IF NOT EXISTS idx_evidence_dedupe
    ON evidence(source_id, entity_type, entity_id, claim_type);
