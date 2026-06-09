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

func TestPipelineMVTQueryPresent(t *testing.T) {
	if pipelineMVTQuery == "" {
		t.Fatal("pipelineMVTQuery must be defined")
	}
	for _, needle := range []string{
		"petroleum_osm_features",
		"layer_id = 'pipelines'",
		"pipeline_substance",
		"ST_AsMVTGeom",
	} {
		if !strings.Contains(pipelineMVTQuery, needle) {
			t.Fatalf("pipelineMVTQuery missing %q", needle)
		}
	}
}
