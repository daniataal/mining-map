package tiles

import (
	"strings"
	"testing"
)

func TestPipelineMinZoom(t *testing.T) {
	if pipelineMinZoom != 4 {
		t.Fatalf("pipelineMinZoom = %d, want 4", pipelineMinZoom)
	}
}

func TestPipelineGraphMVTQueryPresent(t *testing.T) {
	if pipelineGraphMVTQuery == "" {
		t.Fatal("pipelineGraphMVTQuery must be defined")
	}
	for _, needle := range []string{
		"pipeline_graph_edges",
		"LEFT JOIN assets a",
		"legacy_petroleum_osm_features",
		"metadata->'tags'",
		"pipeline_substance",
		"ST_AsMVTGeom",
	} {
		if !strings.Contains(pipelineGraphMVTQuery, needle) {
			t.Fatalf("pipelineGraphMVTQuery missing %q", needle)
		}
	}
}

func TestPipelineLegacyMVTQueryPresent(t *testing.T) {
	if pipelineLegacyMVTQuery == "" {
		t.Fatal("pipelineLegacyMVTQuery must be defined")
	}
	for _, needle := range []string{
		"petroleum_osm_features",
		"layer_id = 'pipelines'",
		"pipeline_substance",
		"ST_AsMVTGeom",
	} {
		if !strings.Contains(pipelineLegacyMVTQuery, needle) {
			t.Fatalf("pipelineLegacyMVTQuery missing %q", needle)
		}
	}
}

func TestPipelineSubstanceCaseShared(t *testing.T) {
	graph := pipelineSubstanceCase("e.metadata->'tags'")
	legacy := pipelineSubstanceCase("f.tags")
	for _, substance := range []string{"water", "oil", "gas", "unknown"} {
		if !strings.Contains(graph, "'"+substance+"'") {
			t.Fatalf("graph substance case missing %q", substance)
		}
		if !strings.Contains(legacy, "'"+substance+"'") {
			t.Fatalf("legacy substance case missing %q", substance)
		}
	}
}
