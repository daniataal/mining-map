package ingestion

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
)

const gemGeometryImportJobType = "gem_geometry_import"

type GEMGeometryImportOptions struct {
	Dir                 string   `json:"dir,omitempty"`
	Sources             []string `json:"sources,omitempty"`
	MaxFeatures         int      `json:"max_features,omitempty"`
	SimplifyTolerance   float64  `json:"simplify_tolerance,omitempty"`
	Force               bool     `json:"force,omitempty"`
	UpdatePipelineEdges bool     `json:"update_pipeline_edges,omitempty"`
}

type GEMGeometryImportResult struct {
	Sources        map[string]int `json:"sources"`
	FeaturesRead   int            `json:"features_read"`
	RowsWritten    int            `json:"rows_written"`
	RowsMatched    int            `json:"rows_matched"`
	RowsSkipped    int            `json:"rows_skipped"`
	SourceReleases int            `json:"source_releases"`
	SkippedRelease int            `json:"skipped_releases"`
	DurationMillis int64          `json:"duration_ms"`
}

type gemGeometrySource struct {
	Key            string
	SourceName     string
	Filename       string
	ReleaseVersion string
	LegacyTable    string
	AssetType      string
	ProjectKey     string
	UnitKey        string
}

var gemGeometrySources = []gemGeometrySource{
	{
		Key:            "gem_goit_oil_ngl_pipelines_geojson",
		SourceName:     "GEM GOIT Oil/NGL Pipeline GeoJSON",
		Filename:       "GEM-GOIT-Oil-NGL-Pipelines-2025-03/GEM-GOIT-Oil-NGL-Pipelines-2025-03.geojson",
		ReleaseVersion: "March 2025",
		LegacyTable:    "gem_goit_pipelines",
		AssetType:      "oil_pipeline",
		ProjectKey:     "ProjectID",
	},
	{
		Key:            "gem_ggit_gas_pipelines_geojson",
		SourceName:     "GEM GGIT Gas Pipeline GeoJSON",
		Filename:       "GEM-GGIT-Gas-Pipelines-2025-11/GEM-GGIT-Gas-Pipelines-2025-11.geojson",
		ReleaseVersion: "November 2025",
		LegacyTable:    "gem_ggit_gas_pipelines",
		AssetType:      "gas_pipeline",
		ProjectKey:     "ProjectID",
	},
	{
		Key:            "gem_ggit_lng_terminals_geojson",
		SourceName:     "GEM GGIT LNG Terminal GeoJSON",
		Filename:       "GEM-GGIT-LNG-Terminals-2025-09-gis-files/GEM-GGIT-LNG-Terminals-2025-09.geojson",
		ReleaseVersion: "September 2025",
		LegacyTable:    "gem_ggit_lng_terminals",
		AssetType:      "lng_terminal",
		ProjectKey:     "ProjectID",
		UnitKey:        "UnitID",
	},
}

func (s *Service) processGEMGeometryImport(ctx context.Context, jobID uuid.UUID, payload []byte) error {
	opts := GEMGeometryImportOptions{}
	if len(payload) > 0 {
		_ = json.Unmarshal(payload, &opts)
	}
	res, err := s.ImportGEMGeometries(ctx, opts)
	report, _ := json.Marshal(res)
	if err != nil {
		return s.finishIntelJob(ctx, jobID, "failed", report, err)
	}
	return s.finishIntelJob(ctx, jobID, "completed", report, nil)
}

func (s *Service) ImportGEMGeometries(ctx context.Context, opts GEMGeometryImportOptions) (GEMGeometryImportResult, error) {
	started := time.Now()
	dir := strings.TrimSpace(opts.Dir)
	if dir == "" {
		dir = locateGEMDataDir()
	}
	if dir == "" {
		return GEMGeometryImportResult{}, fmt.Errorf("GEM data dir not found")
	}
	if opts.SimplifyTolerance <= 0 {
		opts.SimplifyTolerance = 0.01
	}
	res := GEMGeometryImportResult{Sources: map[string]int{}}
	for _, spec := range filterGEMGeometrySources(opts.Sources) {
		counts, err := s.importGEMGeometrySource(ctx, dir, spec, opts)
		if err != nil {
			res.DurationMillis = time.Since(started).Milliseconds()
			return res, err
		}
		res.Sources[spec.Key] = counts.RowsWritten
		res.FeaturesRead += counts.FeaturesRead
		res.RowsWritten += counts.RowsWritten
		res.RowsMatched += counts.RowsMatched
		res.RowsSkipped += counts.RowsSkipped
		res.SourceReleases += counts.SourceReleases
		res.SkippedRelease += counts.SkippedRelease
	}
	res.DurationMillis = time.Since(started).Milliseconds()
	return res, nil
}

func filterGEMGeometrySources(requested []string) []gemGeometrySource {
	if len(requested) == 0 {
		return gemGeometrySources
	}
	want := map[string]bool{}
	for _, raw := range requested {
		raw = strings.ToLower(strings.TrimSpace(raw))
		if raw != "" {
			want[raw] = true
		}
	}
	out := []gemGeometrySource{}
	for _, spec := range gemGeometrySources {
		short := strings.TrimPrefix(strings.TrimSuffix(spec.Key, "_geojson"), "gem_")
		if want[strings.ToLower(spec.Key)] || want[short] || want[strings.ToLower(spec.LegacyTable)] || want[strings.ToLower(spec.AssetType)] {
			out = append(out, spec)
		}
	}
	return out
}

func (s *Service) importGEMGeometrySource(ctx context.Context, dir string, spec gemGeometrySource, opts GEMGeometryImportOptions) (GEMGeometryImportResult, error) {
	res := GEMGeometryImportResult{Sources: map[string]int{}}
	path := filepath.Join(dir, spec.Filename)
	releaseID, skipped, err := s.prepareGEMInfrastructureRelease(ctx, spec.Key, spec.SourceName, "geojson", path, spec.ReleaseVersion, opts.Force)
	if err != nil {
		if os.IsNotExist(err) {
			return res, nil
		}
		return res, err
	}
	if skipped {
		res.SkippedRelease = 1
		return res, nil
	}
	res.SourceReleases = 1

	features, err := readGEMGeometryFeatures(path)
	if err != nil {
		_ = s.markSourceReleaseFailed(ctx, releaseID, err)
		return res, err
	}
	assetIndex, err := s.loadGEMAssetIndex(ctx, spec.LegacyTable)
	if err != nil {
		_ = s.markSourceReleaseFailed(ctx, releaseID, err)
		return res, err
	}
	for i, feature := range features {
		if opts.MaxFeatures > 0 && res.FeaturesRead >= opts.MaxFeatures {
			break
		}
		res.FeaturesRead++
		if len(feature.Geometry) == 0 || string(feature.Geometry) == "null" {
			res.RowsSkipped++
			continue
		}
		sourceAssetID := gemGeometrySourceAssetID(spec, feature.Properties, i)
		if sourceAssetID == "" {
			res.RowsSkipped++
			continue
		}
		assetID := gemAssetIndexLookup(assetIndex, gemGeometryLookupKey(spec, feature.Properties), gemGeometryName(feature.Properties))
		if assetID == uuid.Nil {
			res.RowsSkipped++
		} else {
			res.RowsMatched++
		}
		written, err := upsertAssetGeometry(ctx, s.pool, assetID, spec.Key, sourceAssetID, feature, releaseID, opts.SimplifyTolerance)
		if err != nil {
			res.RowsSkipped++
			continue
		}
		res.RowsWritten += written
		if opts.UpdatePipelineEdges && assetID != uuid.Nil && strings.Contains(spec.AssetType, "pipeline") {
			_ = upsertGEMGeometryPipelineEdge(ctx, s.pool, spec, sourceAssetID, feature)
		}
	}
	if err := s.completeGEMInfrastructureRelease(ctx, releaseID, map[string]any{
		"features_read":       res.FeaturesRead,
		"rows_written":        res.RowsWritten,
		"rows_matched":        res.RowsMatched,
		"rows_skipped":        res.RowsSkipped,
		"simplify_tolerance":  opts.SimplifyTolerance,
		"pipeline_edges_sync": opts.UpdatePipelineEdges,
	}); err != nil {
		return res, err
	}
	return res, nil
}

func readGEMGeometryFeatures(path string) ([]geoJSONFeature, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var fc geoJSONFeatureCollection
	if err := json.Unmarshal(b, &fc); err != nil {
		return nil, err
	}
	if strings.EqualFold(fc.Type, "Feature") {
		var f geoJSONFeature
		if err := json.Unmarshal(b, &f); err != nil {
			return nil, err
		}
		return []geoJSONFeature{f}, nil
	}
	return fc.Features, nil
}

type geometryExecer interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
}

func upsertAssetGeometry(ctx context.Context, execer geometryExecer, assetID uuid.UUID, sourceKey, sourceAssetID string, feature geoJSONFeature, releaseID uuid.UUID, tolerance float64) (int, error) {
	props := feature.Properties
	if props == nil {
		props = map[string]any{}
	}
	propsJSON, _ := json.Marshal(props)
	tag, err := execer.Exec(ctx, `
		WITH incoming AS (
			SELECT ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON($7), 4326)) AS geom
		)
		INSERT INTO asset_geometries (
			asset_id,
			source_key,
			source_asset_id,
			geometry_type,
			geom,
			geom_simplified,
			properties,
			source_release_id
		)
		SELECT
			$1,
			$2,
			$3,
			REPLACE(ST_GeometryType(geom), 'ST_', ''),
			geom,
			ST_SimplifyPreserveTopology(geom, $4),
			$5,
			$6
		FROM incoming
		WHERE geom IS NOT NULL AND NOT ST_IsEmpty(geom)
		ON CONFLICT (source_key, source_asset_id, asset_id) DO UPDATE SET
			geometry_type = EXCLUDED.geometry_type,
			geom = EXCLUDED.geom,
			geom_simplified = EXCLUDED.geom_simplified,
			properties = EXCLUDED.properties,
			source_release_id = EXCLUDED.source_release_id
	`, nullableUUID(assetID), sourceKey, sourceAssetID, tolerance, propsJSON, releaseID, string(feature.Geometry))
	if err != nil {
		return 0, err
	}
	return int(tag.RowsAffected()), nil
}

func upsertGEMGeometryPipelineEdge(ctx context.Context, execer geometryExecer, spec gemGeometrySource, sourceAssetID string, feature geoJSONFeature) error {
	props := feature.Properties
	if props == nil {
		props = map[string]any{}
	}
	metadata := map[string]any{
		"source_key":      spec.Key,
		"source_asset_id": sourceAssetID,
		"project_id":      firstProp(props, "ProjectID"),
		"pipeline_name":   gemGeometryName(props),
		"asset_type":      spec.AssetType,
		"properties":      props,
	}
	metaJSON, _ := json.Marshal(metadata)
	_, err := execer.Exec(ctx, `
		WITH incoming AS (
			SELECT ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON($3), 4326)) AS geom
		)
		INSERT INTO pipeline_graph_edges (osm_id, geom, metadata)
		SELECT $1, geom::geography, $2
		FROM incoming
		WHERE geom IS NOT NULL
		  AND NOT ST_IsEmpty(geom)
		  AND GeometryType(geom) IN ('LINESTRING', 'MULTILINESTRING')
		ON CONFLICT (osm_id) WHERE osm_id IS NOT NULL DO UPDATE SET
			geom = EXCLUDED.geom,
			metadata = COALESCE(pipeline_graph_edges.metadata, '{}'::jsonb) || EXCLUDED.metadata
	`, "gemgeo:"+spec.Key+":"+sourceAssetID, metaJSON, string(feature.Geometry))
	return err
}

func gemGeometrySourceAssetID(spec gemGeometrySource, props map[string]any, index int) string {
	projectID := firstProp(props, spec.ProjectKey, "ProjectID")
	unitID := firstProp(props, spec.UnitKey, "UnitID")
	segment := firstProp(props, "SegmentName")
	switch {
	case unitID != "":
		return unitID
	case projectID != "" && segment != "":
		return projectID + ":" + normalizeGeometryToken(segment)
	case projectID != "":
		return projectID
	default:
		return fmt.Sprintf("%s:%d", spec.Key, index+1)
	}
}

func gemGeometryLookupKey(spec gemGeometrySource, props map[string]any) string {
	if spec.UnitKey != "" {
		if unit := firstProp(props, spec.UnitKey, "UnitID"); unit != "" {
			return unit
		}
	}
	return firstProp(props, spec.ProjectKey, "ProjectID")
}

func gemGeometryName(props map[string]any) string {
	terminal := firstProp(props, "TerminalName")
	unit := firstProp(props, "UnitName")
	if terminal != "" && unit != "" {
		return normalizeName(terminal + " - " + unit)
	}
	if terminal != "" {
		return normalizeName(terminal)
	}
	pipeline := firstProp(props, "PipelineName")
	segment := firstProp(props, "SegmentName")
	if pipeline != "" && segment != "" {
		return normalizeName(pipeline + " - " + segment)
	}
	if pipeline != "" {
		return normalizeName(pipeline)
	}
	return normalizeName(firstProp(props, "ProjectID", "UnitID"))
}

var geometryTokenRE = regexp.MustCompile(`[^a-z0-9]+`)

func normalizeGeometryToken(raw string) string {
	raw = strings.ToLower(strings.TrimSpace(raw))
	raw = geometryTokenRE.ReplaceAllString(raw, "_")
	return strings.Trim(raw, "_")
}
