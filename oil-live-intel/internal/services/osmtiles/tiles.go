package osmtiles

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	MinZoom       = 0
	MaxZoom       = 14
	PipelineMinZ  = 4
	MVTLayerName  = "petroleum_osm"
	TileURLTempl  = "/api/petroleum/osm-tiles/{layer_id}/{z}/{x}/{y}.pbf"
)

var ValidLayerIDs = map[string]struct{}{
	"pipelines":         {},
	"refineries":        {},
	"storage_terminals": {},
}

var ErrUnknownLayer = errors.New("unknown OSM petroleum layer")

// ClampTileCoords validates and clamps z/x/y for MVT generation.
func ClampTileCoords(layerID string, z, x, y int) (int, int, int, error) {
	if _, ok := ValidLayerIDs[layerID]; !ok {
		return 0, 0, 0, fmt.Errorf("%w: %s", ErrUnknownLayer, layerID)
	}
	if z < MinZoom {
		z = MinZoom
	}
	if z > MaxZoom {
		z = MaxZoom
	}
	maxTile := (1 << z) - 1
	if x < 0 {
		x = 0
	}
	if x > maxTile {
		x = maxTile
	}
	if y < 0 {
		y = 0
	}
	if y > maxTile {
		y = maxTile
	}
	return z, x, y, nil
}

// MinZoomForLayer returns the minimum zoom at which tiles are generated.
func MinZoomForLayer(layerID string) int {
	if layerID == "pipelines" {
		return PipelineMinZ
	}
	return MinZoom
}

const mvtQuery = `
SELECT ST_AsMVT(mvt_row, $5, 4096, 'geom')
FROM (
	SELECT
		ST_AsMVTGeom(
			ST_Transform(geom::geometry, 3857),
			ST_TileEnvelope($2, $3, $4),
			4096,
			64,
			true
		) AS geom,
		osm_id,
		osm_type,
		layer_id,
		COALESCE(NULLIF(tags->>'name', ''), NULLIF(tags->>'operator', ''), '') AS name,
		COALESCE(tags->>'operator', '') AS operator,
		COALESCE(tags->>'substance', '') AS substance,
		CASE
			WHEN lower(replace(COALESCE(tags->>'substance', ''), ' ', '_')) IN
				('water', 'drinking_water', 'wastewater', 'sewage') THEN 'water'
			WHEN lower(replace(COALESCE(tags->>'substance', ''), ' ', '_')) IN
				('oil', 'crude', 'crude_oil', 'petroleum') THEN 'oil'
			WHEN lower(replace(COALESCE(tags->>'substance', ''), ' ', '_')) IN
				('gas', 'natural_gas', 'lng', 'lpg', 'methane') THEN 'gas'
			WHEN lower(replace(COALESCE(tags->>'type', ''), ' ', '_')) = 'water' THEN 'water'
			WHEN lower(replace(COALESCE(tags->>'type', ''), ' ', '_')) = 'oil' THEN 'oil'
			WHEN lower(replace(COALESCE(tags->>'type', ''), ' ', '_')) = 'gas' THEN 'gas'
			WHEN lower(replace(COALESCE(tags->>'usage', ''), ' ', '_')) IN
				('water', 'drinking_water', 'irrigation') THEN 'water'
			WHEN lower(replace(COALESCE(tags->>'content', ''), ' ', '_')) IN
				('water', 'drinking_water') THEN 'water'
			ELSE 'unknown'
		END AS pipeline_substance
	FROM petroleum_osm_features
	WHERE layer_id = $1
		AND geom && ST_Transform(ST_TileEnvelope($2, $3, $4), 4326)
) AS mvt_row
WHERE geom IS NOT NULL
`

// FetchTile loads one MVT tile from petroleum_osm_features.
func FetchTile(ctx context.Context, pool *pgxpool.Pool, layerID string, z, x, y int) ([]byte, error) {
	z, x, y, err := ClampTileCoords(layerID, z, x, y)
	if err != nil {
		return nil, err
	}
	if z < MinZoomForLayer(layerID) {
		return nil, nil
	}

	var tile []byte
	err = pool.QueryRow(ctx, mvtQuery, layerID, z, x, y, MVTLayerName).Scan(&tile)
	if err != nil {
		return nil, err
	}
	return tile, nil
}
