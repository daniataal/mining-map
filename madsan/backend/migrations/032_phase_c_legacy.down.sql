DROP INDEX IF EXISTS uq_pipeline_graph_edges_gem_segment;
DROP INDEX IF EXISTS uq_relationships_legacy_fingerprint;
ALTER TABLE relationships DROP COLUMN IF EXISTS metadata;
