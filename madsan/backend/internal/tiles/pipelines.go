package tiles

var (
	// pipelineGraphMVTQuery loads LineString pipeline geometry from canonical pipeline_graph_edges.
	// Geometries are EPSG:4326 geography; tile envelope is Web Mercator (3857).
	pipelineGraphMVTQuery = `
SELECT ST_AsMVT(mvt_row, $4, 4096, 'geom')
FROM (
	SELECT
		ST_AsMVTGeom(
			ST_Transform(e.geom::geometry, 3857),
			ST_TileEnvelope($1, $2, $3),
			4096,
			64,
			true
		) AS geom,
		COALESCE(e.metadata->>'legacy_id', e.id::text) AS legacy_row_id,
		e.osm_id::text AS osm_id,
		COALESCE(e.metadata->'tags'->>'osm_type', '') AS osm_type,
		COALESCE(
			NULLIF(e.metadata->'tags'->>'name', ''),
			NULLIF(e.metadata->>'name', ''),
			NULLIF(e.metadata->'tags'->>'operator', ''),
			''
		) AS name,
		'pipeline' AS asset_type,
		COALESCE(e.metadata->'tags'->>'operator', '') AS operator,
		COALESCE(e.metadata->'tags'->>'substance', '') AS substance,` + pipelineSubstanceCase("e.metadata->'tags'") + `
	FROM pipeline_graph_edges e
	WHERE e.geom IS NOT NULL
		AND e.geom::geometry && ST_Transform(ST_TileEnvelope($1, $2, $3), 4326)
) AS mvt_row
WHERE geom IS NOT NULL
`

	// pipelineLegacyMVTQuery loads LineString pipeline geometry from legacy petroleum_osm_features.
	// Geometries are EPSG:4326; tile envelope is Web Mercator (3857).
	pipelineLegacyMVTQuery = `
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
		COALESCE(f.tags->>'substance', '') AS substance,` + pipelineSubstanceCase("f.tags") + `
	FROM petroleum_osm_features f
	WHERE f.layer_id = 'pipelines'
		AND f.geom IS NOT NULL
		AND f.geom && ST_Transform(ST_TileEnvelope($1, $2, $3), 4326)
) AS mvt_row
WHERE geom IS NOT NULL
`
)

func pipelineSubstanceCase(tagsRef string) string {
	return `
		CASE
			WHEN lower(replace(COALESCE(` + tagsRef + `->>'substance', ''), ' ', '_')) IN
				('water', 'drinking_water', 'wastewater', 'sewage') THEN 'water'
			WHEN lower(replace(COALESCE(` + tagsRef + `->>'substance', ''), ' ', '_')) IN
				('oil', 'crude', 'crude_oil', 'petroleum') THEN 'oil'
			WHEN lower(replace(COALESCE(` + tagsRef + `->>'substance', ''), ' ', '_')) IN
				('gas', 'natural_gas', 'lng', 'lpg', 'methane') THEN 'gas'
			WHEN lower(replace(COALESCE(` + tagsRef + `->>'type', ''), ' ', '_')) = 'water' THEN 'water'
			WHEN lower(replace(COALESCE(` + tagsRef + `->>'type', ''), ' ', '_')) = 'oil' THEN 'oil'
			WHEN lower(replace(COALESCE(` + tagsRef + `->>'type', ''), ' ', '_')) = 'gas' THEN 'gas'
			WHEN lower(replace(COALESCE(` + tagsRef + `->>'usage', ''), ' ', '_')) IN
				('water', 'drinking_water', 'irrigation') THEN 'water'
			WHEN lower(replace(COALESCE(` + tagsRef + `->>'content', ''), ' ', '_')) IN
				('water', 'drinking_water') THEN 'water'
			ELSE 'unknown'
		END AS pipeline_substance`
}

const pipelineMinZoom = 4
