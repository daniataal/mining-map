package mapserving

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// ResolveFeatureKey maps a map click selection to a materialized popup feature_key.
func ResolveFeatureKey(layerID, osmType string, osmID int64, segmentKey string) string {
	if sk := strings.TrimSpace(segmentKey); sk != "" {
		return GemPipelineFeatureKey(sk)
	}
	if strings.TrimSpace(osmType) != "" && osmID > 0 {
		return OsmFeatureKey(layerID, osmType, osmID)
	}
	return ""
}

// LookupPopupAtPoint finds the nearest materialized popup for a layer at lat/lng.
func LookupPopupAtPoint(
	ctx context.Context,
	pool *pgxpool.Pool,
	lat, lng float64,
	layerID string,
	maxDistanceM float64,
) (*PopupPayload, error) {
	layerID = strings.TrimSpace(layerID)
	if layerID == "" || maxDistanceM <= 0 {
		return nil, fmt.Errorf("layer_id and max_distance_m required")
	}

	var featureKey string
	switch layerID {
	case "pipelines":
		err := pool.QueryRow(ctx, `
SELECT feature_key FROM (
  SELECT 'gem:pipeline:' || g.segment_key AS feature_key,
         ST_Distance(g.geom::geography, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography) AS d
  FROM gem_pipeline_segments g
  WHERE ST_DWithin(g.geom::geography, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography, $3)
  UNION ALL
  SELECT 'osm:pipelines:' || f.osm_type || ':' || f.osm_id::text,
         ST_Distance(f.geom::geography, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography)
  FROM petroleum_osm_features f
  WHERE f.layer_id = 'pipelines'
    AND ST_DWithin(f.geom::geography, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography, $3)
) hits
ORDER BY d
LIMIT 1
`, lat, lng, maxDistanceM).Scan(&featureKey)
		if err != nil {
			return nil, nil
		}
	case "refineries", "storage_terminals":
		err := pool.QueryRow(ctx, `
SELECT 'osm:' || f.layer_id || ':' || f.osm_type || ':' || f.osm_id::text
FROM petroleum_osm_features f
WHERE f.layer_id = $4
  AND ST_DWithin(
    ST_Centroid(f.geom)::geography,
    ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
    $3
  )
ORDER BY ST_Centroid(f.geom)::geography <-> ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
LIMIT 1
`, lat, lng, maxDistanceM, layerID).Scan(&featureKey)
		if err != nil {
			return nil, nil
		}
	default:
		return nil, nil
	}

	if featureKey == "" {
		return nil, nil
	}
	return GetPopupPayload(ctx, pool, featureKey)
}
