-- Accelerate cross-name duplicate discovery (pg_trgm % / similarity on normalized_name).
CREATE INDEX IF NOT EXISTS idx_companies_norm_trgm ON companies USING gin (normalized_name gin_trgm_ops);
