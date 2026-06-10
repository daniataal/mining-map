DELETE FROM core_source_ledger WHERE source_key IN ('gleif', 'sec_edgar', 'legacy_procurement');
DELETE FROM sources WHERE slug IN ('gleif', 'sec_edgar', 'legacy_procurement');
