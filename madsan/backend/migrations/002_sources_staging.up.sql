CREATE TABLE IF NOT EXISTS sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_name TEXT NOT NULL UNIQUE,
    source_type TEXT NOT NULL,
    source_category TEXT,
    vertical TEXT,
    source_url TEXT,
    source_file_name TEXT,
    source_format TEXT,
    license TEXT,
    commercial_use_ok BOOLEAN DEFAULT true,
    reliability_score NUMERIC(5,2) DEFAULT 50,
    imported_at TIMESTAMPTZ DEFAULT now(),
    last_checked_at TIMESTAMPTZ,
    last_success_at TIMESTAMPTZ,
    last_hash TEXT,
    raw_storage_path TEXT,
    enabled BOOLEAN DEFAULT true,
    refresh_schedule TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS staging_generic_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id UUID NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    entity_hint TEXT,
    row_number INT,
    raw_payload JSONB NOT NULL,
    record_hash TEXT,
    imported_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_staging_source ON staging_generic_records(source_id);
CREATE INDEX IF NOT EXISTS idx_staging_hash ON staging_generic_records(record_hash);

CREATE TABLE IF NOT EXISTS ingestion_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id UUID REFERENCES sources(id) ON DELETE SET NULL,
    job_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    priority INT DEFAULT 5,
    attempts INT DEFAULT 0,
    max_attempts INT DEFAULT 3,
    scheduled_at TIMESTAMPTZ DEFAULT now(),
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    error_message TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_status ON ingestion_jobs(status, scheduled_at);

CREATE TABLE IF NOT EXISTS manual_review_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id UUID REFERENCES sources(id) ON DELETE SET NULL,
    staging_record_id UUID REFERENCES staging_generic_records(id) ON DELETE SET NULL,
    entity_type TEXT,
    reason TEXT NOT NULL,
    confidence_score NUMERIC(5,2),
    candidate_matches JSONB DEFAULT '[]',
    raw_payload JSONB,
    status TEXT DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT now(),
    reviewed_at TIMESTAMPTZ
);
