package ingestion

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

const gemPipelineImportJobType = "gem_pipeline_import"

// BackfillGEMPipelineEdgeMetadata sets legacy_id on GEM edges so OSM-style joins work.
func (s *Service) BackfillGEMPipelineEdgeMetadata(ctx context.Context) (int64, error) {
	tag, err := s.pool.Exec(ctx, `
		UPDATE pipeline_graph_edges
		SET metadata = metadata || jsonb_build_object('legacy_id', metadata->>'segment_key')
		WHERE osm_id LIKE 'gem:%'
		  AND COALESCE(metadata->>'segment_key', '') <> ''
		  AND COALESCE(metadata->>'legacy_id', '') = ''
	`)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

func (s *Service) processGEMPipelineImport(ctx context.Context, jobID uuid.UUID) error {
	started := time.Now()
	counts := map[string]int{}
	var firstErr error

	legacy, err := s.poolFromLegacy(ctx)
	if err == nil {
		n, segErr := s.importLegacyGEMPipelineSegments(ctx, legacy, 0)
		counts["gem_pipeline_segments"] = n
		legacy.Close()
		if segErr != nil && firstErr == nil {
			firstErr = segErr
		}
	} else if firstErr == nil {
		firstErr = err
	}

	gemDir := locateGEMDataDir()
	if gemDir != "" {
		gemCounts, gemErr := s.RunGEMImport(ctx, gemDir, []string{"gem_pipelines"}, 0, false, false)
		for k, v := range gemCounts {
			counts[k] = v
		}
		if gemErr != nil && firstErr == nil {
			firstErr = gemErr
		}
	} else {
		counts["gem_pipelines_xlsx"] = 0
	}

	backfilled, berr := s.BackfillGEMPipelineEdgeMetadata(ctx)
	enriched := 0
	if e, err := s.BackfillGEMPipelineEnrichment(ctx, 0); err != nil && firstErr == nil {
		firstErr = err
	} else {
		enriched = e
	}
	if berr != nil && firstErr == nil {
		firstErr = berr
	}

	report, _ := json.Marshal(map[string]any{
		"counts":              counts,
		"metadata_backfilled": backfilled,
		"enrichment_backfill": enriched,
		"gem_dir":             gemDir,
		"duration_ms":         time.Since(started).Milliseconds(),
	})
	status := "completed"
	if firstErr != nil && counts["gem_pipeline_segments"] == 0 && counts["gem_pipelines"] == 0 {
		status = "failed"
	}
	return s.finishIntelJob(ctx, jobID, status, report, firstErr)
}
