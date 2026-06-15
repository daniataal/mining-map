package ingestion

// Curated dossier corrections where GEM GOIT is stale or incomplete.
// Keyed by GEM segment_key (e.g. P0549:175). Re-applied on every dossier build
// so gem_pipeline_import does not revert trader-verified attributes.
var gemPipelineSegmentCorrections = map[string]map[string]string{
	"P0549:175": {
		"fuel_source": "Kazakhstan, UAE, Azerbaijan",
	},
}

func applyGEMPipelineCuratedCorrections(out map[string]string, segmentKey, projectID string) {
	if out == nil {
		return
	}
	if segmentKey != "" {
		if corr, ok := gemPipelineSegmentCorrections[segmentKey]; ok {
			for k, v := range corr {
				out[k] = v
			}
		}
	}
	// Whole Trans-Israel GOIT project shares one commercial profile on the main segment.
	if projectID == "P0549" {
		if corr, ok := gemPipelineSegmentCorrections["P0549:175"]; ok {
			for k, v := range corr {
				if _, exists := out[k]; !exists || k == "fuel_source" {
					out[k] = v
				}
			}
		}
	}
}
