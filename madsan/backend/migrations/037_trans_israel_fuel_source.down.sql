UPDATE assets
SET raw_source_payload = jsonb_set(
        COALESCE(raw_source_payload::jsonb, '{}'::jsonb),
        '{FuelSource}',
        '"Iran"'::jsonb,
        true
    ),
    updated_at = now()
WHERE legacy_table = 'gem_goit_pipelines'
  AND (
    legacy_id = 'P0549:175'
    OR name ILIKE 'Trans-Israel Oil Pipeline%'
    OR COALESCE(raw_source_payload->>'ProjectID', raw_source_payload->>'project_id') = 'P0549'
  );
