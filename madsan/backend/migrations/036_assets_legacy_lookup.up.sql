-- Speed up GEM/OSM asset dossier lookup by legacy key (was parallel seq scan on ~300k rows).
CREATE INDEX IF NOT EXISTS idx_assets_legacy_table_id
    ON assets (legacy_table, legacy_id)
    WHERE legacy_table IS NOT NULL AND legacy_id IS NOT NULL;
