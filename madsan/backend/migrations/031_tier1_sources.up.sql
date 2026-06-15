-- Phase H Tier-1 open sources: GLEIF, SEC EDGAR, legacy procurement leads.
INSERT INTO sources (source_name, slug, source_type, source_category, vertical, source_url, license, commercial_use_ok, reliability_score, refresh_schedule, enabled, notes)
VALUES
  ('GLEIF LEI', 'gleif', 'api', 'government_register', 'cross', 'https://api.gleif.org/api/v1/lei-records', 'GLEIF open data terms', true, 85, 'weekly', true, 'Legal Entity Identifier registry — company verification evidence'),
  ('SEC EDGAR', 'sec_edgar', 'api', 'government_register', 'cross', 'https://data.sec.gov', 'US public domain', true, 70, 'weekly', true, 'US issuer CIK/ticker linker stub — heuristic name match, confirm on sec.gov'),
  ('Legacy procurement leads', 'legacy_procurement', 'etl', 'procurement', 'cross', NULL, 'public_notice', true, 60, 'daily', true, 'Backfill eu_procurement_notices + gov_procurement_awards from mining_db')
ON CONFLICT (source_name) DO UPDATE SET
  slug = EXCLUDED.slug,
  source_type = EXCLUDED.source_type,
  source_category = EXCLUDED.source_category,
  source_url = EXCLUDED.source_url,
  license = EXCLUDED.license,
  commercial_use_ok = EXCLUDED.commercial_use_ok,
  reliability_score = EXCLUDED.reliability_score,
  refresh_schedule = EXCLUDED.refresh_schedule,
  enabled = EXCLUDED.enabled,
  notes = EXCLUDED.notes,
  updated_at = now();

INSERT INTO core_source_ledger (source_key, display_name, source_type, license_name, terms_url, attribution, commercial_use_ok, metadata)
VALUES
  ('gleif', 'GLEIF LEI', 'public_api', 'GLEIF open data terms', 'https://www.gleif.org/en/meta/lei-data-terms-of-use/', 'LEI data © GLEIF', true, '{"dedup_key":"lei","tier_default":"observed"}'),
  ('sec_edgar', 'SEC EDGAR', 'public_api', 'US public domain', 'https://www.sec.gov/os/webmaster-faq#code-support', 'Source: U.S. SEC EDGAR', true, '{"dedup_key":"cik","tier_default":"inferred_match","stub":true}'),
  ('legacy_procurement', 'TED + USAspending procurement', 'legacy_etl', 'public_notice', 'https://ted.europa.eu/', 'EU TED + USAspending open awards', true, '{"dedup_key":"notice_id|award_id","tier_default":"observed"}')
ON CONFLICT (source_key) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  license_name = EXCLUDED.license_name,
  terms_url = EXCLUDED.terms_url,
  attribution = EXCLUDED.attribution,
  commercial_use_ok = EXCLUDED.commercial_use_ok,
  metadata = EXCLUDED.metadata,
  updated_at = now();
