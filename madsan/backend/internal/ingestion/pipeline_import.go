package ingestion

import (
	"context"
	"encoding/json"
	"fmt"
)

// UpsertPipelineEdge stores full LineString geometry from legacy petroleum OSM import.
// Point assets remain in assets (centroid) for search; map lines come from pipeline_graph_edges.
func (s *Service) UpsertPipelineEdge(ctx context.Context, rec NormalizedRecord) error {
	return s.upsertPipelineEdge(ctx, rec)
}

func (s *Service) upsertPipelineEdge(ctx context.Context, rec NormalizedRecord) error {
	if rec.AssetType != "pipeline" || len(rec.GeomEWKB) == 0 || rec.ExternalID == "" {
		return nil
	}
	meta := map[string]any{
		"name":     rec.Name,
		"layer_id": "pipelines",
		"legacy_id": rec.ExternalID,
	}
	if tags, ok := rec.RawPayload["tags"]; ok {
		meta["tags"] = tags
	}
	metaJSON, err := json.Marshal(meta)
	if err != nil {
		return fmt.Errorf("pipeline metadata: %w", err)
	}
	osmKey := "legacy:" + rec.ExternalID
	_, err = s.pool.Exec(ctx, `
		INSERT INTO pipeline_graph_edges (osm_id, geom, metadata)
		VALUES ($1, ST_GeomFromEWKB($2)::geography, $3::jsonb)
		ON CONFLICT (osm_id) WHERE osm_id IS NOT NULL DO UPDATE SET
			geom = EXCLUDED.geom,
			metadata = EXCLUDED.metadata
	`, osmKey, rec.GeomEWKB, metaJSON)
	if err != nil {
		return fmt.Errorf("upsert pipeline edge %s: %w", osmKey, err)
	}
	return nil
}

// BackfillPipelineRecord builds a NormalizedRecord for legacy petroleum pipeline rows.
func BackfillPipelineRecord(id int64, layerID string, tags any, lat, lon float64, wkb []byte) NormalizedRecord {
	tagsMap := parseTags(tags)
	name := normalizeName(fmt.Sprintf("%s:%d", layerID, id))
	if n, ok := tagsMap["name"].(string); ok && n != "" {
		name = normalizeName(n)
	}
	return NormalizedRecord{
		EntityType:  "asset",
		AssetType:   LayerToAssetType(layerID),
		Name:        name,
		Latitude:    &lat,
		Longitude:   &lon,
		Commodities: []string{"petroleum"},
		GeomEWKB:    wkb,
		ExternalID:  fmt.Sprint(id),
		SourceSlug:  "legacy_petroleum_osm_features",
		RawPayload:  map[string]any{"tags": tagsMap, "layer_id": layerID},
	}
}
