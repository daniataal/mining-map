package tiles

// pipelineMVTQuery loads LineString pipeline geometry from legacy petroleum_osm_features.
// Geometries are EPSG:4326; tile envelope is Web Mercator (3857).
const pipelineMVTQuery = `
SELECT ST_AsMVT(mvt_row, $4, 4096, 'geom')
FROM (
	SELECT
		ST_AsMVTGeom(
			ST_Transform(f.geom::geometry, 3857),
			ST_TileEnvelope($1, $2, $3),
			4096,
			64,
			true
		) AS geom,
		f.id::text AS legacy_row_id,
		f.osm_id::text AS osm_id,
		f.osm_type,
		COALESCE(NULLIF(f.tags->>'name', ''), NULLIF(f.tags->>'operator', ''), '') AS name,
		'pipeline' AS asset_type,
		COALESCE(f.tags->>'operator', '') AS operator,
		COALESCE(f.tags->>'substance', '') AS substance,
		CASE
			WHEN lower(replace(COALESCE(f.tags->>'substance', ''), ' ', '_')) IN
				('water', 'drinking_water', 'wastewater', 'sewage') THEN 'water'
			WHEN lower(replace(COALESCE(f.tags->>'substance', ''), ' ', '_')) IN
				('oil', 'crude', 'crude_oil', 'petroleum') THEN 'oil'
			WHEN lower(replace(COALESCE(f.tags->>'substance', ''), ' ', '_')) IN
				('gas', 'natural_gas', 'lng', 'lpg', 'methane') THEN 'gas'
			WHEN lower(replace(COALESCE(f.tags->>'type', ''), ' ', '_')) = 'water' THEN 'water'
			WHEN lower(replace(COALESCE(f.tags->>'type', ''), ' ', '_')) = 'oil' THEN 'oil'
			WHEN lower(replace(COALESCE(f.tags->>'type', ''), ' ', '_')) = 'gas' THEN 'gas'
			WHEN lower(replace(COALESCE(f.tags->>'usage', ''), ' ', '_')) IN
				('water', 'drinking_water', 'irrigation') THEN 'water'
			WHEN lower(replace(COALESCE(f.tags->>'content', ''), ' ', '_')) IN
				('water', 'drinking_water') THEN 'water'
			ELSE 'unknown'
		END AS pipeline_substance
	FROM petroleum_osm_features f
	WHERE f.layer_id = 'pipelines'
		AND f.geom IS NOT NULL
		AND f.geom && ST_Transform(ST_TileEnvelope($1, $2, $3), 4326)
) AS mvt_row
WHERE geom IS NOT NULL
`

const pipelineMinZoom = 4
