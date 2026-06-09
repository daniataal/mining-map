package mapserving

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	osmTerminalFusionBatch = 50
	osmGemFusionBatch      = 50
	rebuildLongTimeout     = 12 * time.Minute
)

func tableExists(ctx context.Context, pool *pgxpool.Pool, table string) (bool, error) {
	var exists bool
	err := pool.QueryRow(ctx, `
SELECT EXISTS (
  SELECT 1 FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = $1
)`, table).Scan(&exists)
	return exists, err
}

func longRebuildCtx(ctx context.Context) (context.Context, context.CancelFunc) {
	if deadline, ok := ctx.Deadline(); ok && time.Until(deadline) > rebuildLongTimeout {
		return ctx, func() {}
	}
	return context.WithTimeout(ctx, rebuildLongTimeout)
}

// rebuildOsmPointPopupPayloads materializes refineries + storage OSM points, then fuses operators from curated terminals.
func rebuildOsmPointPopupPayloads(ctx context.Context, pool *pgxpool.Pool) (int64, error) {
	ok, err := tableExists(ctx, pool, "petroleum_osm_features")
	if err != nil || !ok {
		return 0, err
	}
	ctx, cancel := longRebuildCtx(ctx)
	defer cancel()

	tag, err := pool.Exec(ctx, `
INSERT INTO map_feature_popup_payload (
  feature_key, asset_id, title, subtitle, bol_tier, geocode_tier, sources, fields, limitations, built_at
)
SELECT
  'osm:' || f.layer_id || ':' || f.osm_type || ':' || f.osm_id::text,
  NULL,
  COALESCE(
    NULLIF(TRIM(f.tags->>'name'), ''),
    'OSM ' || f.osm_type || ' ' || f.osm_id::text
  ),
  COALESCE(
    NULLIF(TRIM(COALESCE(f.tags->>'operator', f.tags->>'Operator')), ''),
    NULLIF(TRIM(f.tags->>'brand'), ''),
    CASE WHEN f.layer_id = 'refineries' THEN 'Refinery' ELSE 'Storage' END
  ),
  'infrastructure_open',
  CASE
    WHEN NULLIF(TRIM(COALESCE(f.tags->>'operator', f.tags->>'Operator')), '') IS NOT NULL THEN 'osm_tagged'
    ELSE 'osm_community'
  END,
  jsonb_build_array(
    jsonb_build_object('name', 'OpenStreetMap', 'url',
      'https://www.openstreetmap.org/' || f.osm_type || '/' || f.osm_id::text)
  ),
  jsonb_strip_nulls(jsonb_build_object(
    'name', NULLIF(TRIM(f.tags->>'name'), ''),
    'operator', NULLIF(TRIM(COALESCE(f.tags->>'operator', f.tags->>'Operator')), ''),
    'operator_name', NULLIF(TRIM(COALESCE(f.tags->>'operator', f.tags->>'Operator')), ''),
    'owner', NULLIF(TRIM(COALESCE(f.tags->>'owner', f.tags->>'Owner')), ''),
    'country', NULLIF(TRIM(f.tags->>'addr:country'), ''),
    'capacity', NULLIF(TRIM(COALESCE(f.tags->>'capacity', f.tags->>'capacity:oil')), ''),
    'facility_type', NULLIF(TRIM(f.tags->>'man_made'), ''),
    'layer_id', f.layer_id,
    'osm_type', f.osm_type,
    'osm_id', f.osm_id,
    'data_tier', 'osm_community'
  )),
  jsonb_build_array(
    'OpenStreetMap community tags — operator/throughput not verified unless fused from curated terminal.'
  ),
  now()
FROM petroleum_osm_features f
WHERE f.layer_id IN ('refineries', 'storage_terminals')
  AND f.geom IS NOT NULL
ON CONFLICT (feature_key) DO UPDATE SET
  title = EXCLUDED.title,
  subtitle = EXCLUDED.subtitle,
  bol_tier = EXCLUDED.bol_tier,
  geocode_tier = EXCLUDED.geocode_tier,
  sources = EXCLUDED.sources,
  fields = EXCLUDED.fields,
  limitations = EXCLUDED.limitations,
  built_at = now()
`)
	if err != nil {
		return 0, fmt.Errorf("rebuild osm point popups base: %w", err)
	}
	fused, err := fuseOsmPointsFromCuratedTerminals(ctx, pool)
	if err != nil {
		return tag.RowsAffected(), err
	}
	return tag.RowsAffected() + fused, nil
}

func fuseOsmPointsFromCuratedTerminals(ctx context.Context, pool *pgxpool.Pool) (int64, error) {
	rows, err := pool.Query(ctx, `
SELECT id::text
FROM oil_terminals
WHERE geom IS NOT NULL
  AND NULLIF(TRIM(operator_name), '') IS NOT NULL
ORDER BY id
`)
	if err != nil {
		return 0, err
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return 0, err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return 0, err
	}
	if len(ids) == 0 {
		return 0, nil
	}

	var total int64
	const fuseQ = `
WITH candidates AS (
  SELECT
    'osm:' || f.layer_id || ':' || f.osm_type || ':' || f.osm_id::text AS feature_key,
    t.id AS terminal_id,
    t.name AS terminal_name,
    t.operator_name,
    t.owner_name,
    t.country,
    t.source,
    t.source_url,
    f.layer_id,
    f.osm_type,
    f.osm_id,
    f.tags,
    ROUND(ST_Distance(ST_Centroid(f.geom)::geography, t.geom::geography)::numeric, 1) AS dist_m,
    ROW_NUMBER() OVER (
      PARTITION BY f.layer_id, f.osm_type, f.osm_id
      ORDER BY ST_Centroid(f.geom)::geography <-> t.geom::geography
    ) AS rn
  FROM oil_terminals t
  JOIN LATERAL (
    SELECT layer_id, osm_type, osm_id, tags, geom
    FROM petroleum_osm_features pf
    WHERE pf.layer_id IN ('refineries', 'storage_terminals')
      AND pf.geom IS NOT NULL
      AND ST_DWithin(ST_Centroid(pf.geom)::geography, t.geom::geography, $1)
    ORDER BY ST_Centroid(pf.geom)::geography <-> t.geom::geography
    LIMIT 1
  ) f ON true
  WHERE t.id = ANY($2::uuid[])
)
INSERT INTO map_feature_popup_payload (
  feature_key, asset_id, title, subtitle, bol_tier, geocode_tier, sources, fields, limitations, built_at
)
SELECT
  c.feature_key,
  c.terminal_id,
  COALESCE(NULLIF(TRIM(c.tags->>'name'), ''), NULLIF(TRIM(c.terminal_name), ''), 'OSM ' || c.osm_type || ' ' || c.osm_id::text),
  COALESCE(NULLIF(TRIM(c.operator_name), ''), NULLIF(TRIM(COALESCE(c.tags->>'operator', c.tags->>'Operator')), ''), 'Storage'),
  'infrastructure_open',
  'fused_curated_terminal',
  jsonb_build_array(
    jsonb_build_object('name', 'OpenStreetMap', 'url',
      'https://www.openstreetmap.org/' || c.osm_type || '/' || c.osm_id::text),
    jsonb_build_object('name', COALESCE(NULLIF(TRIM(c.source), ''), 'curated_terminal'), 'url', c.source_url)
  ),
  jsonb_strip_nulls(jsonb_build_object(
    'name', COALESCE(NULLIF(TRIM(c.tags->>'name'), ''), NULLIF(TRIM(c.terminal_name), '')),
    'operator', COALESCE(NULLIF(TRIM(c.operator_name), ''), NULLIF(TRIM(COALESCE(c.tags->>'operator', c.tags->>'Operator')), '')),
    'operator_name', COALESCE(NULLIF(TRIM(c.operator_name), ''), NULLIF(TRIM(COALESCE(c.tags->>'operator', c.tags->>'Operator')), '')),
    'owner_name', COALESCE(NULLIF(TRIM(c.owner_name), ''), NULLIF(TRIM(COALESCE(c.tags->>'owner', c.tags->>'Owner')), '')),
    'country', COALESCE(NULLIF(TRIM(c.country), ''), NULLIF(TRIM(c.tags->>'addr:country'), '')),
    'layer_id', c.layer_id,
    'osm_type', c.osm_type,
    'osm_id', c.osm_id,
    'fused_terminal_id', c.terminal_id::text,
    'fused_distance_m', c.dist_m,
    'data_tier', 'osm_fused_curated'
  )),
  jsonb_build_array('OpenStreetMap geometry fused with curated terminal operator within 2.5 km.'),
  now()
FROM candidates c
WHERE c.rn = 1
ON CONFLICT (feature_key) DO UPDATE SET
  asset_id = CASE
    WHEN (EXCLUDED.fields->>'fused_distance_m')::numeric
      < COALESCE((map_feature_popup_payload.fields->>'fused_distance_m')::numeric, 999999)
    THEN EXCLUDED.asset_id
    ELSE map_feature_popup_payload.asset_id
  END,
  title = CASE
    WHEN (EXCLUDED.fields->>'fused_distance_m')::numeric
      < COALESCE((map_feature_popup_payload.fields->>'fused_distance_m')::numeric, 999999)
    THEN EXCLUDED.title
    ELSE map_feature_popup_payload.title
  END,
  subtitle = CASE
    WHEN (EXCLUDED.fields->>'fused_distance_m')::numeric
      < COALESCE((map_feature_popup_payload.fields->>'fused_distance_m')::numeric, 999999)
    THEN EXCLUDED.subtitle
    ELSE map_feature_popup_payload.subtitle
  END,
  geocode_tier = CASE
    WHEN (EXCLUDED.fields->>'fused_distance_m')::numeric
      < COALESCE((map_feature_popup_payload.fields->>'fused_distance_m')::numeric, 999999)
    THEN EXCLUDED.geocode_tier
    ELSE map_feature_popup_payload.geocode_tier
  END,
  sources = CASE
    WHEN (EXCLUDED.fields->>'fused_distance_m')::numeric
      < COALESCE((map_feature_popup_payload.fields->>'fused_distance_m')::numeric, 999999)
    THEN EXCLUDED.sources
    ELSE map_feature_popup_payload.sources
  END,
  fields = CASE
    WHEN (EXCLUDED.fields->>'fused_distance_m')::numeric
      < COALESCE((map_feature_popup_payload.fields->>'fused_distance_m')::numeric, 999999)
    THEN EXCLUDED.fields
    ELSE map_feature_popup_payload.fields
  END,
  limitations = CASE
    WHEN (EXCLUDED.fields->>'fused_distance_m')::numeric
      < COALESCE((map_feature_popup_payload.fields->>'fused_distance_m')::numeric, 999999)
    THEN EXCLUDED.limitations
    ELSE map_feature_popup_payload.limitations
  END,
  built_at = CASE
    WHEN (EXCLUDED.fields->>'fused_distance_m')::numeric
      < COALESCE((map_feature_popup_payload.fields->>'fused_distance_m')::numeric, 999999)
    THEN now()
    ELSE map_feature_popup_payload.built_at
  END
`
	for i := 0; i < len(ids); i += osmTerminalFusionBatch {
		end := i + osmTerminalFusionBatch
		if end > len(ids) {
			end = len(ids)
		}
		n, err := execFusionBatch(ctx, pool, fuseQ, FusionTerminalMaxM, ids[i:end])
		if err != nil {
			return total, fmt.Errorf("fuse osm points batch %d: %w", i/osmTerminalFusionBatch, err)
		}
		total += n
	}
	return total, nil
}

func execFusionBatch(ctx context.Context, pool *pgxpool.Pool, query string, maxDistM int, ids any) (int64, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `SET LOCAL statement_timeout = '300s'`); err != nil {
		return 0, err
	}
	tag, err := tx.Exec(ctx, query, maxDistM, ids)
	if err != nil {
		return 0, err
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

func rebuildGemPipelinePopupPayloads(ctx context.Context, pool *pgxpool.Pool) (int64, error) {
	ok, err := tableExists(ctx, pool, "gem_pipeline_segments")
	if err != nil || !ok {
		return 0, err
	}
	tag, err := pool.Exec(ctx, `
INSERT INTO map_feature_popup_payload (
  feature_key, asset_id, title, subtitle, bol_tier, geocode_tier, sources, fields, limitations, built_at
)
SELECT
  'gem:pipeline:' || g.segment_key,
  NULL,
  COALESCE(
    NULLIF(TRIM(g.tags->>'pipeline_name'), ''),
    NULLIF(TRIM(g.tags->>'name'), ''),
    NULLIF(TRIM(g.tags->>'segment_name'), ''),
    g.project_id
  ),
  COALESCE(
    NULLIF(TRIM(g.tags->>'Capacity'), ''),
    NULLIF(TRIM(g.tags->>'capacity'), ''),
    NULLIF(TRIM(g.tags->>'fuel_group'), ''),
    'Oil pipeline'
  ),
  'gem_goit',
  'segment_line',
  jsonb_build_array(
    jsonb_build_object(
      'name', 'GEM GOIT',
      'url', COALESCE(NULLIF(TRIM(g.tags->>'wiki_url'), ''), 'https://globalenergymonitor.org/')
    )
  ),
  jsonb_strip_nulls(g.tags || jsonb_build_object(
    'pipeline_name', COALESCE(NULLIF(TRIM(g.tags->>'pipeline_name'), ''), NULLIF(TRIM(g.tags->>'name'), '')),
    'name', COALESCE(NULLIF(TRIM(g.tags->>'pipeline_name'), ''), NULLIF(TRIM(g.tags->>'name'), '')),
    'operator', COALESCE(
      NULLIF(TRIM(g.tags->>'Operator'), ''),
      NULLIF(TRIM(g.tags->>'operator'), ''),
      NULLIF(TRIM(g.tags->>'Owner'), ''),
      NULLIF(TRIM(g.tags->>'owner'), '')
    ),
    'owner', NULLIF(TRIM(COALESCE(g.tags->>'Owner', g.tags->>'owner')), ''),
    'capacity', NULLIF(TRIM(COALESCE(g.tags->>'Capacity', g.tags->>'capacity')), ''),
    'status', NULLIF(TRIM(g.tags->>'Status'), ''),
    'country', NULLIF(TRIM(g.tags->>'Country'), ''),
    'fuel_group', NULLIF(TRIM(g.tags->>'fuel_group'), ''),
    'segment_key', g.segment_key,
    'project_id', g.project_id,
    'layer_id', 'gem_pipelines',
    'source', 'gem_goit_oil_ngl_pipelines_march_2025',
    'data_tier', 'gem_curated'
  )),
  jsonb_build_array('GEM Global Oil Infrastructure Tracker (CC BY) — verify against operator filings before execution.'),
  now()
FROM gem_pipeline_segments g
ON CONFLICT (feature_key) DO UPDATE SET
  title = EXCLUDED.title,
  subtitle = EXCLUDED.subtitle,
  bol_tier = EXCLUDED.bol_tier,
  geocode_tier = EXCLUDED.geocode_tier,
  sources = EXCLUDED.sources,
  fields = EXCLUDED.fields,
  limitations = EXCLUDED.limitations,
  built_at = now()
`)
	if err != nil {
		return 0, fmt.Errorf("rebuild gem pipeline popups: %w", err)
	}
	return tag.RowsAffected(), nil
}

func rebuildOsmPipelinePopupPayloads(ctx context.Context, pool *pgxpool.Pool) (int64, error) {
	ok, err := tableExists(ctx, pool, "petroleum_osm_features")
	if err != nil || !ok {
		return 0, err
	}
	ctx, cancel := longRebuildCtx(ctx)
	defer cancel()

	tag, err := pool.Exec(ctx, `
INSERT INTO map_feature_popup_payload (
  feature_key, asset_id, title, subtitle, bol_tier, geocode_tier, sources, fields, limitations, built_at
)
SELECT
  'osm:pipelines:' || f.osm_type || ':' || f.osm_id::text,
  NULL,
  COALESCE(NULLIF(TRIM(f.tags->>'name'), ''), 'OSM pipeline ' || f.osm_id::text),
  COALESCE(NULLIF(TRIM(f.tags->>'substance'), ''), 'Pipeline'),
  'infrastructure_open',
  'osm_community',
  jsonb_build_array(jsonb_build_object('name', 'OpenStreetMap', 'url',
    'https://www.openstreetmap.org/' || f.osm_type || '/' || f.osm_id::text)),
  jsonb_strip_nulls(f.tags || jsonb_build_object(
    'layer_id', 'pipelines',
    'osm_type', f.osm_type,
    'osm_id', f.osm_id,
    'data_tier', 'osm_community',
    'source', 'openstreetmap'
  )),
  jsonb_build_array('OSM community pipeline — GEM GOIT fusion applied when segment is within 2 km.'),
  now()
FROM petroleum_osm_features f
WHERE f.layer_id = 'pipelines' AND f.geom IS NOT NULL
ON CONFLICT (feature_key) DO UPDATE SET
  title = EXCLUDED.title,
  subtitle = EXCLUDED.subtitle,
  bol_tier = EXCLUDED.bol_tier,
  geocode_tier = EXCLUDED.geocode_tier,
  sources = EXCLUDED.sources,
  fields = EXCLUDED.fields,
  limitations = EXCLUDED.limitations,
  built_at = now()
`)
	if err != nil {
		return 0, fmt.Errorf("rebuild osm pipeline popups base: %w", err)
	}

	gemOK, _ := tableExists(ctx, pool, "gem_pipeline_segments")
	if !gemOK {
		return tag.RowsAffected(), nil
	}
	fused, err := fuseOsmPipelinesFromGem(ctx, pool)
	if err != nil {
		return tag.RowsAffected(), err
	}
	return tag.RowsAffected() + fused, nil
}

func fuseOsmPipelinesFromGem(ctx context.Context, pool *pgxpool.Pool) (int64, error) {
	rows, err := pool.Query(ctx, `SELECT segment_key FROM gem_pipeline_segments ORDER BY segment_key`)
	if err != nil {
		return 0, err
	}
	defer rows.Close()

	var keys []string
	for rows.Next() {
		var key string
		if err := rows.Scan(&key); err != nil {
			return 0, err
		}
		keys = append(keys, key)
	}
	if err := rows.Err(); err != nil {
		return 0, err
	}
	if len(keys) == 0 {
		return 0, nil
	}

	var total int64
	const fuseQ = `
WITH candidates AS (
  SELECT
    'osm:pipelines:' || f.osm_type || ':' || f.osm_id::text AS feature_key,
    g.tags AS gem_tags,
    g.segment_key,
    f.osm_type,
    f.osm_id,
    f.tags AS osm_tags,
    ROUND(ST_Distance(f.geom::geography, g.geom::geography)::numeric, 1) AS dist_m,
    ROW_NUMBER() OVER (
      PARTITION BY f.osm_type, f.osm_id
      ORDER BY f.geom::geography <-> g.geom::geography
    ) AS rn
  FROM gem_pipeline_segments g
  JOIN LATERAL (
    SELECT osm_type, osm_id, tags, geom
    FROM petroleum_osm_features pf
    WHERE pf.layer_id = 'pipelines'
      AND pf.geom IS NOT NULL
      AND ST_DWithin(pf.geom::geography, g.geom::geography, $1)
    ORDER BY pf.geom::geography <-> g.geom::geography
    LIMIT 1
  ) f ON true
  WHERE g.segment_key = ANY($2::text[])
)
INSERT INTO map_feature_popup_payload (
  feature_key, asset_id, title, subtitle, bol_tier, geocode_tier, sources, fields, limitations, built_at
)
SELECT
  c.feature_key,
  NULL,
  COALESCE(
    NULLIF(TRIM(c.gem_tags->>'pipeline_name'), ''),
    NULLIF(TRIM(c.gem_tags->>'name'), ''),
    NULLIF(TRIM(c.osm_tags->>'name'), ''),
    'OSM pipeline ' || c.osm_id::text
  ),
  COALESCE(
    NULLIF(TRIM(c.gem_tags->>'Capacity'), ''),
    NULLIF(TRIM(c.gem_tags->>'capacity'), ''),
    NULLIF(TRIM(c.osm_tags->>'substance'), ''),
    'Pipeline'
  ),
  'gem_goit_fused',
  'osm_line_fused_gem',
  jsonb_build_array(
    jsonb_build_object('name', 'OpenStreetMap', 'url',
      'https://www.openstreetmap.org/' || c.osm_type || '/' || c.osm_id::text),
    jsonb_build_object('name', 'GEM GOIT (fused)', 'url', 'https://globalenergymonitor.org/')
  ),
  jsonb_strip_nulls(
    COALESCE(c.gem_tags, '{}'::jsonb) ||
    jsonb_build_object(
      'name', COALESCE(NULLIF(TRIM(c.gem_tags->>'pipeline_name'), ''), NULLIF(TRIM(c.osm_tags->>'name'), '')),
      'operator', COALESCE(
        NULLIF(TRIM(c.gem_tags->>'Operator'), ''),
        NULLIF(TRIM(c.gem_tags->>'operator'), ''),
        NULLIF(TRIM(c.osm_tags->>'operator'), '')
      ),
      'layer_id', 'pipelines',
      'osm_type', c.osm_type,
      'osm_id', c.osm_id,
      'gem_segment_key', c.segment_key,
      'gem_fused_distance_m', c.dist_m,
      'data_tier', 'osm_fused_gem',
      'source', 'gem_goit_oil_ngl_pipelines_march_2025'
    )
  ),
  jsonb_build_array('OSM geometry with GEM GOIT commercial attributes fused at sync time.'),
  now()
FROM candidates c
WHERE c.rn = 1
ON CONFLICT (feature_key) DO UPDATE SET
  title = CASE
    WHEN (EXCLUDED.fields->>'gem_fused_distance_m')::numeric
      < COALESCE((map_feature_popup_payload.fields->>'gem_fused_distance_m')::numeric, 999999)
    THEN EXCLUDED.title
    ELSE map_feature_popup_payload.title
  END,
  subtitle = CASE
    WHEN (EXCLUDED.fields->>'gem_fused_distance_m')::numeric
      < COALESCE((map_feature_popup_payload.fields->>'gem_fused_distance_m')::numeric, 999999)
    THEN EXCLUDED.subtitle
    ELSE map_feature_popup_payload.subtitle
  END,
  bol_tier = CASE
    WHEN (EXCLUDED.fields->>'gem_fused_distance_m')::numeric
      < COALESCE((map_feature_popup_payload.fields->>'gem_fused_distance_m')::numeric, 999999)
    THEN EXCLUDED.bol_tier
    ELSE map_feature_popup_payload.bol_tier
  END,
  geocode_tier = CASE
    WHEN (EXCLUDED.fields->>'gem_fused_distance_m')::numeric
      < COALESCE((map_feature_popup_payload.fields->>'gem_fused_distance_m')::numeric, 999999)
    THEN EXCLUDED.geocode_tier
    ELSE map_feature_popup_payload.geocode_tier
  END,
  sources = CASE
    WHEN (EXCLUDED.fields->>'gem_fused_distance_m')::numeric
      < COALESCE((map_feature_popup_payload.fields->>'gem_fused_distance_m')::numeric, 999999)
    THEN EXCLUDED.sources
    ELSE map_feature_popup_payload.sources
  END,
  fields = CASE
    WHEN (EXCLUDED.fields->>'gem_fused_distance_m')::numeric
      < COALESCE((map_feature_popup_payload.fields->>'gem_fused_distance_m')::numeric, 999999)
    THEN EXCLUDED.fields
    ELSE map_feature_popup_payload.fields
  END,
  limitations = CASE
    WHEN (EXCLUDED.fields->>'gem_fused_distance_m')::numeric
      < COALESCE((map_feature_popup_payload.fields->>'gem_fused_distance_m')::numeric, 999999)
    THEN EXCLUDED.limitations
    ELSE map_feature_popup_payload.limitations
  END,
  built_at = CASE
    WHEN (EXCLUDED.fields->>'gem_fused_distance_m')::numeric
      < COALESCE((map_feature_popup_payload.fields->>'gem_fused_distance_m')::numeric, 999999)
    THEN now()
    ELSE map_feature_popup_payload.built_at
  END
`
	for i := 0; i < len(keys); i += osmGemFusionBatch {
		end := i + osmGemFusionBatch
		if end > len(keys) {
			end = len(keys)
		}
		n, err := execFusionBatch(ctx, pool, fuseQ, FusionGemPipelineM, keys[i:end])
		if err != nil {
			return total, fmt.Errorf("fuse osm pipelines batch %d: %w", i/osmGemFusionBatch, err)
		}
		total += n
	}
	return total, nil
}
