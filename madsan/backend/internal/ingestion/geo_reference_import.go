package ingestion

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
)

type geoReferenceImportPayload struct {
	Path     string `json:"path"`
	Kind     string `json:"kind"` // land | river | lake
	Source   string `json:"source"`
	Truncate bool   `json:"truncate"`
}

// processGeoReferenceImport loads Natural Earth (public domain) land/river/lake
// GeoJSON into geo_reference_features. Land polygons are subdivided so
// point-in-polygon checks stay index-friendly.
func (s *Service) processGeoReferenceImport(ctx context.Context, jobID uuid.UUID, payload []byte) error {
	started := time.Now()
	var p geoReferenceImportPayload
	if len(payload) > 0 {
		_ = json.Unmarshal(payload, &p)
	}
	kind := strings.ToLower(strings.TrimSpace(p.Kind))
	switch kind {
	case "land", "river", "lake":
	default:
		return s.finishIntelJob(ctx, jobID, "failed", nil, fmt.Errorf("geo_reference_import: payload.kind must be land, river or lake"))
	}
	source := strings.TrimSpace(p.Source)
	if source == "" {
		source = "natural_earth_10m"
	}
	path := strings.TrimSpace(p.Path)
	if path == "" {
		return s.finishIntelJob(ctx, jobID, "failed", nil, fmt.Errorf("geo_reference_import: payload.path required"))
	}
	if !filepath.IsAbs(path) {
		path = filepath.Join(s.cfg.RawDataDir, path)
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return s.finishIntelJob(ctx, jobID, "failed", nil, err)
	}
	var fc geoJSONFeatureCollection
	if err := json.Unmarshal(b, &fc); err != nil {
		return s.finishIntelJob(ctx, jobID, "failed", nil, err)
	}

	if p.Truncate {
		if _, err := s.pool.Exec(ctx, `DELETE FROM geo_reference_features WHERE kind=$1 AND source=$2`, kind, source); err != nil {
			return s.finishIntelJob(ctx, jobID, "failed", nil, err)
		}
	}

	imported, skipped := 0, 0
	for _, f := range fc.Features {
		if len(f.Geometry) == 0 || string(f.Geometry) == "null" {
			skipped++
			continue
		}
		name := firstProp(f.Properties, "name", "name_en", "featurecla")
		_, err := s.pool.Exec(ctx, `
			INSERT INTO geo_reference_features (kind, source, name, geom)
			SELECT $1, $2, NULLIF($3,''),
			       ST_Subdivide(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON($4), 4326)), 256)::geography
		`, kind, source, name, string(f.Geometry))
		if err != nil {
			skipped++
			continue
		}
		imported++
	}

	report, _ := json.Marshal(map[string]any{
		"kind":        kind,
		"source":      source,
		"path":        path,
		"features":    len(fc.Features),
		"imported":    imported,
		"skipped":     skipped,
		"duration_ms": time.Since(started).Milliseconds(),
	})
	status := "completed"
	if imported == 0 {
		status = "failed"
	}
	return s.finishIntelJob(ctx, jobID, status, report, nil)
}
