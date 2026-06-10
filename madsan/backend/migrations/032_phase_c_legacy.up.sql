-- Phase C legacy tier-2: relationship metadata + idempotent import keys.

ALTER TABLE relationships ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

CREATE UNIQUE INDEX IF NOT EXISTS uq_relationships_legacy_fingerprint
    ON relationships ((metadata->>'legacy_fingerprint'))
    WHERE metadata->>'legacy_fingerprint' IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_pipeline_graph_edges_gem_segment
    ON pipeline_graph_edges (osm_id)
    WHERE osm_id LIKE 'gem:%';
