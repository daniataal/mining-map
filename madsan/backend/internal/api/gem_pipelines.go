package api

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/jackc/pgx/v5"
)

const defaultGemPipelineMatchM = 2000.0

type nearestGemPipelineHit struct {
	Found       bool             `json:"found"`
	SegmentKey  string           `json:"segment_key,omitempty"`
	ProjectID   string           `json:"project_id,omitempty"`
	DistanceM   float64          `json:"distance_m,omitempty"`
	DistanceKm  float64          `json:"distance_km,omitempty"`
	Tags        map[string]any   `json:"tags,omitempty"`
	SourceID    string           `json:"source_id,omitempty"`
	Attribution string           `json:"attribution,omitempty"`
	AssetID     string           `json:"asset_id,omitempty"`
}

// nearestGemPipeline returns the closest GEM GOIT segment to a map click (OSM pipeline enrichment).
func (s *Server) nearestGemPipeline(w http.ResponseWriter, r *http.Request) {
	lat, errLat := strconv.ParseFloat(r.URL.Query().Get("lat"), 64)
	lng, errLng := strconv.ParseFloat(r.URL.Query().Get("lng"), 64)
	if errLat != nil || errLng != nil || lat < -90 || lat > 90 || lng < -180 || lng > 180 {
		http.Error(w, "lat and lng required", http.StatusBadRequest)
		return
	}
	maxM := defaultGemPipelineMatchM
	if v := r.URL.Query().Get("max_m"); v != "" {
		if f, err := strconv.ParseFloat(v, 64); err == nil && f > 0 {
			maxM = f
		}
	}

	hit, err := s.findNearestGemPipeline(r, lat, lng, maxM)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, hit)
}

func (s *Server) findNearestGemPipeline(r *http.Request, lat, lng, maxM float64) (nearestGemPipelineHit, error) {
	var segmentKey, projectID, tagsJSON, assetID string
	var distM float64
	err := s.pool.QueryRow(r.Context(), `
		SELECT
			COALESCE(e.metadata->>'segment_key', ''),
			COALESCE(e.metadata->'tags'->>'project_id', e.metadata->>'project_id', ''),
			COALESCE(e.metadata->'tags', '{}'::jsonb)::text,
			COALESCE(a.id::text, ''),
			ST_Distance(e.geom, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) AS dist_m
		FROM pipeline_graph_edges e
		LEFT JOIN assets a
			ON a.legacy_table = 'gem_goit_pipelines'
			AND a.legacy_id = COALESCE(NULLIF(e.metadata->>'segment_key', ''), '')
		WHERE e.osm_id LIKE 'gem:%'
		  AND e.geom IS NOT NULL
		  AND ST_DWithin(e.geom, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)
		ORDER BY dist_m ASC
		LIMIT 1
	`, lng, lat, maxM).Scan(&segmentKey, &projectID, &tagsJSON, &assetID, &distM)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nearestGemPipelineHit{Found: false}, nil
		}
		return nearestGemPipelineHit{}, err
	}
	if segmentKey == "" {
		return nearestGemPipelineHit{Found: false}, nil
	}
	tags := map[string]any{}
	_ = json.Unmarshal([]byte(tagsJSON), &tags)
	sourceID, _ := tags["source_id"].(string)
	return nearestGemPipelineHit{
		Found:       true,
		SegmentKey:  segmentKey,
		ProjectID:   projectID,
		DistanceM:   round1(distM),
		DistanceKm:  round2(distM / 1000),
		Tags:        tags,
		SourceID:    sourceID,
		Attribution: "Global Energy Monitor GOIT (CC BY 4.0)",
		AssetID:     assetID,
	}, nil
}

func round1(v float64) float64 {
	return float64(int(v*10+0.5)) / 10
}

func round2(v float64) float64 {
	return float64(int(v*100+0.5)) / 100
}
