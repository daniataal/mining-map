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
		COALESCE(a_gem.id, a_osm.id)::text AS id,
		COALESCE(
			NULLIF(e.metadata->>'segment_key', ''),
			NULLIF(e.metadata->>'legacy_id', ''),
			e.id::text
		) AS legacy_row_id,
		e.osm_id::text AS osm_id,
		CASE WHEN e.osm_id LIKE 'gem:%' THEN 'gem' ELSE 'osm' END AS pipeline_source,
		COALESCE(e.metadata->'tags'->>'osm_type', '') AS osm_type,
		COALESCE(
			NULLIF(e.metadata->'tags'->>'pipeline_name', ''),
			NULLIF(e.metadata->'tags'->>'name', ''),
			NULLIF(e.metadata->>'name', ''),
			NULLIF(e.metadata->'tags'->>'operator', ''),
			NULLIF(e.metadata->'tags'->>'owner', ''),
			''
		) AS name,
		'pipeline' AS asset_type,
		COALESCE(
			NULLIF(e.metadata->'tags'->>'owner', ''),
			NULLIF(e.metadata->'tags'->>'operator', ''),
			''
		) AS operator,
		COALESCE(e.metadata->'tags'->>'status', '') AS pipeline_status,
		COALESCE(e.metadata->'tags'->>'fuel', e.metadata->'tags'->>'substance', '') AS substance,
		COALESCE(a_gem.confidence_score, a_osm.confidence_score) AS confidence_score,` + pipelineSubstanceExpr("e") + `
	FROM pipeline_graph_edges e
	LEFT JOIN assets a_osm
		ON a_osm.legacy_table = 'legacy_petroleum_osm_features'
		AND a_osm.legacy_id = COALESCE(NULLIF(e.metadata->>'legacy_id', ''), '')
	LEFT JOIN assets a_gem
		ON a_gem.legacy_table = 'gem_goit_pipelines'
		AND a_gem.legacy_id = COALESCE(NULLIF(e.metadata->>'segment_key', ''), '')
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
		f.id::text AS id,
		f.id::text AS legacy_row_id,
		f.osm_id::text AS osm_id,
		'osm' AS pipeline_source,
		f.osm_type,
		COALESCE(NULLIF(f.tags->>'name', ''), NULLIF(f.tags->>'operator', ''), '') AS name,
		'pipeline' AS asset_type,
		COALESCE(f.tags->>'operator', '') AS operator,
		COALESCE(f.tags->>'status', '') AS pipeline_status,
		COALESCE(f.tags->>'substance', '') AS substance,
		NULL::double precision AS confidence_score,` + pipelineSubstanceCase("f.tags") + ` AS pipeline_substance
	FROM petroleum_osm_features f
	WHERE f.layer_id = 'pipelines'
		AND f.geom IS NOT NULL
		AND f.geom && ST_Transform(ST_TileEnvelope($1, $2, $3), 4326)
) AS mvt_row
WHERE geom IS NOT NULL
`
)

func pipelineSubstanceExpr(edgeAlias string) string {
	tags := edgeAlias + `.metadata->'tags'`
	return `
		CASE
			WHEN ` + edgeAlias + `.osm_id LIKE 'gem:%' THEN
				CASE lower(replace(COALESCE(` + tags + `->>'fuel_group', ''), ' ', '_'))
					WHEN 'oil' THEN 'oil'
					WHEN 'gas' THEN 'gas'
					WHEN 'ngl' THEN 'oil'
					ELSE CASE
						WHEN lower(COALESCE(` + tags + `->>'fuel', '')) LIKE '%oil%' THEN 'oil'
						WHEN lower(COALESCE(` + tags + `->>'fuel', '')) LIKE '%crude%' THEN 'oil'
						WHEN lower(COALESCE(` + tags + `->>'fuel', '')) LIKE '%ngl%' THEN 'oil'
						WHEN lower(COALESCE(` + tags + `->>'fuel', '')) LIKE '%gas%' THEN 'gas'
						ELSE 'unknown'
					END
				END
			ELSE` + pipelineSubstanceCase(tags) + `
		END AS pipeline_substance`
}

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
		END`
}

const pipelineMinZoom = 4
