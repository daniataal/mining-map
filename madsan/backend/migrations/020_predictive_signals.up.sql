-- Phase 8e: predictive intelligence scaffold (STS/destination/storage forecasts).

CREATE TABLE IF NOT EXISTS predictive_signals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    signal_type TEXT NOT NULL,
    entity_type TEXT,
    entity_id UUID,
    tier TEXT NOT NULL DEFAULT 'not_implemented',
    confidence_score NUMERIC(5,2) DEFAULT 0,
    horizon_hours INT,
    payload JSONB DEFAULT '{}',
    predicted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_predictive_signals_type_at
    ON predictive_signals(signal_type, predicted_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_predictive_signals_entity
    ON predictive_signals(entity_type, entity_id, signal_type);
