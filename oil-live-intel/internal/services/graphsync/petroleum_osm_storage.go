package graphsync

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

const petroleumOsmStorageLayerID = "storage_terminals"

// PetroleumOsmStorageResult mirrors Python _ensure_petroleum_osm_storage_layer payload.
type PetroleumOsmStorageResult struct {
	Status  string `json:"status"`
	Reason  string `json:"reason,omitempty"`
	LayerID string `json:"layer_id"`
	Cached  bool   `json:"cached"`
}

// LayerHasCachedFeatures returns true when petroleum_osm_features has at least one row for layer_id.
func LayerHasCachedFeatures(ctx context.Context, pool *pgxpool.Pool, layerID string) (bool, error) {
	var exists bool
	err := pool.QueryRow(ctx, `
		SELECT EXISTS(SELECT 1 FROM petroleum_osm_features WHERE layer_id = $1 LIMIT 1)
	`, layerID).Scan(&exists)
	return exists, err
}

// EnsurePetroleumOsmStorageLayer records cache health for OSM storage tanks.
// Overpass tile materialization remains on Python graph-sync until a Go Overpass client exists.
func EnsurePetroleumOsmStorageLayer(ctx context.Context, pool *pgxpool.Pool) (PetroleumOsmStorageResult, error) {
	cached, err := LayerHasCachedFeatures(ctx, pool, petroleumOsmStorageLayerID)
	if err != nil {
		return PetroleumOsmStorageResult{}, err
	}
	if cached {
		return PetroleumOsmStorageResult{
			Status:  "skipped",
			Reason:  "storage_terminals already cached",
			LayerID: petroleumOsmStorageLayerID,
			Cached:  true,
		}, nil
	}
	return PetroleumOsmStorageResult{
		Status:  "uncached",
		Reason:  "run graph-sync with OIL_GRAPH_SYNC_GO_PETROLEUM_OSM_STORAGE=false once to materialize Overpass tiles",
		LayerID: petroleumOsmStorageLayerID,
		Cached:  false,
	}, nil
}
