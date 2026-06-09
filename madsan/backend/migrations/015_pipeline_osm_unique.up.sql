-- Deduplicate legacy/OSM pipeline segments on re-import.
CREATE UNIQUE INDEX IF NOT EXISTS idx_pipeline_graph_edges_osm_id
    ON pipeline_graph_edges (osm_id)
    WHERE osm_id IS NOT NULL;
