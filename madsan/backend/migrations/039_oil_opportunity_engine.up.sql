-- MadSan Oil/Gas/LNG Opportunity Engine V1 foundation.
-- Raw GEM/JODI files stay outside git; import jobs persist releases and normalized facts here.

CREATE TABLE IF NOT EXISTS data_source_releases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_key TEXT NOT NULL,
    source_name TEXT,
    source_type TEXT,
    path TEXT,
    checksum TEXT,
    row_count BIGINT,
    release_version TEXT,
    release_date DATE,
    attribution TEXT,
    license TEXT,
    commercial_use_ok BOOLEAN DEFAULT true,
    import_status TEXT NOT NULL DEFAULT 'pending',
    imported_at TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (source_key, checksum)
);

CREATE INDEX IF NOT EXISTS idx_data_source_releases_source
    ON data_source_releases (source_key, imported_at DESC NULLS LAST);

CREATE OR REPLACE FUNCTION oil_asset_supports_product(commodities TEXT[], raw_payload JSONB, product_code TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
AS $$
    SELECT CASE
        WHEN upper(COALESCE(product_code, '')) IN ('CRUDEOIL', 'TOTCRUDE', 'OTHERCRUDE')
            THEN (
                lower(COALESCE(array_to_string(commodities, ' '), '') || ' ' ||
                      COALESCE(raw_payload->>'commodity', '') || ' ' ||
                      COALESCE(raw_payload->>'sector', '') || ' ' ||
                      COALESCE(raw_payload->>'license_type', '')) ~ '(crude|oil|petroleum|oil_and_gas)'
            )
        WHEN upper(COALESCE(product_code, '')) IN ('NGL', 'LPG')
            THEN (
                lower(COALESCE(array_to_string(commodities, ' '), '') || ' ' ||
                      COALESCE(raw_payload->>'commodity', '') || ' ' ||
                      COALESCE(raw_payload->>'sector', '') || ' ' ||
                      COALESCE(raw_payload->>'license_type', '')) ~ '(gas|ngl|lpg|lng|oil_and_gas|petroleum)'
            )
        WHEN upper(COALESCE(product_code, '')) IN ('GASDIES', 'GASOLINE', 'JETKERO', 'KEROSENE', 'NAPHTHA', 'RESFUEL', 'TOTPRODS', 'ONONSPEC')
            THEN (
                lower(COALESCE(array_to_string(commodities, ' '), '') || ' ' ||
                      COALESCE(raw_payload->>'commodity', '') || ' ' ||
                      COALESCE(raw_payload->>'products', '') || ' ' ||
                      COALESCE(raw_payload->>'terminal_type', '') || ' ' ||
                      COALESCE(raw_payload->>'sector', '')) ~ '(petroleum|oil|fuel|refined|product|diesel|gasoline|kerosene|naphtha|lpg|terminal|storage|oil_and_gas)'
            )
        ELSE (
            lower(COALESCE(array_to_string(commodities, ' '), '') || ' ' ||
                  COALESCE(raw_payload->>'commodity', '') || ' ' ||
                  COALESCE(raw_payload->>'sector', '')) ~ '(petroleum|oil|gas|fuel|refined|oil_and_gas)'
        )
    END;
$$;

CREATE TABLE IF NOT EXISTS gem_entities (
    entity_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    full_name TEXT,
    normalized_name TEXT,
    lei TEXT,
    registry_id TEXT,
    permid TEXT,
    gem_wiki_url TEXT,
    registration_country TEXT,
    headquarters_country TEXT,
    entity_type TEXT,
    legal_entity_type TEXT,
    website TEXT,
    raw_payload JSONB DEFAULT '{}'::jsonb,
    source_release_id UUID REFERENCES data_source_releases(id) ON DELETE SET NULL,
    matched_company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gem_entities_norm ON gem_entities (normalized_name);
CREATE INDEX IF NOT EXISTS idx_gem_entities_lei ON gem_entities (lei) WHERE lei IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_gem_entities_company ON gem_entities (matched_company_id) WHERE matched_company_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS gem_ownership_edges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_entity_id TEXT REFERENCES gem_entities(entity_id) ON DELETE CASCADE,
    interested_entity_id TEXT REFERENCES gem_entities(entity_id) ON DELETE CASCADE,
    relationship_type TEXT NOT NULL DEFAULT 'ownership',
    share_pct NUMERIC,
    share_type TEXT,
    start_date DATE,
    end_date DATE,
    evidence_label TEXT NOT NULL DEFAULT 'reported',
    source_release_id UUID REFERENCES data_source_releases(id) ON DELETE SET NULL,
    raw_payload JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (subject_entity_id, interested_entity_id, relationship_type, source_release_id)
);

CREATE INDEX IF NOT EXISTS idx_gem_ownership_subject ON gem_ownership_edges (subject_entity_id);
CREATE INDEX IF NOT EXISTS idx_gem_ownership_interested ON gem_ownership_edges (interested_entity_id);

CREATE TABLE IF NOT EXISTS gem_asset_ownership (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id UUID REFERENCES assets(id) ON DELETE SET NULL,
    gem_asset_id TEXT,
    gem_unit_id TEXT,
    asset_name TEXT,
    asset_type TEXT,
    country_code TEXT,
    operator_entity_id TEXT REFERENCES gem_entities(entity_id) ON DELETE SET NULL,
    owner_entity_id TEXT REFERENCES gem_entities(entity_id) ON DELETE SET NULL,
    parent_entity_id TEXT REFERENCES gem_entities(entity_id) ON DELETE SET NULL,
    share_pct NUMERIC,
    share_imputed BOOLEAN DEFAULT false,
    evidence_label TEXT NOT NULL DEFAULT 'reported',
    source_release_id UUID REFERENCES data_source_releases(id) ON DELETE SET NULL,
    raw_payload JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_gem_asset_ownership_natural_key
    ON gem_asset_ownership (gem_asset_id, gem_unit_id, owner_entity_id, source_release_id) NULLS NOT DISTINCT;
CREATE INDEX IF NOT EXISTS idx_gem_asset_ownership_asset ON gem_asset_ownership (asset_id) WHERE asset_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_gem_asset_ownership_owner ON gem_asset_ownership (owner_entity_id);
CREATE INDEX IF NOT EXISTS idx_gem_asset_ownership_operator ON gem_asset_ownership (operator_entity_id);
CREATE INDEX IF NOT EXISTS idx_gem_asset_ownership_country_type ON gem_asset_ownership (country_code, asset_type);

CREATE TABLE IF NOT EXISTS asset_production_facts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id UUID REFERENCES assets(id) ON DELETE CASCADE,
    gem_asset_id TEXT,
    product_code TEXT,
    year INT,
    month DATE,
    production_value NUMERIC,
    unit TEXT,
    evidence_label TEXT NOT NULL DEFAULT 'reported',
    confidence_score NUMERIC(5,2) DEFAULT 0,
    source_release_id UUID REFERENCES data_source_releases(id) ON DELETE SET NULL,
    raw_payload JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_asset_production_natural_key
    ON asset_production_facts (asset_id, gem_asset_id, product_code, month, year, unit) NULLS NOT DISTINCT;
CREATE INDEX IF NOT EXISTS idx_asset_production_asset ON asset_production_facts (asset_id);
CREATE INDEX IF NOT EXISTS idx_asset_production_product_time ON asset_production_facts (product_code, month DESC NULLS LAST, year DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS asset_reserve_facts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id UUID REFERENCES assets(id) ON DELETE CASCADE,
    gem_asset_id TEXT,
    product_code TEXT,
    reserve_value NUMERIC,
    unit TEXT,
    as_of_date DATE,
    evidence_label TEXT NOT NULL DEFAULT 'reported',
    confidence_score NUMERIC(5,2) DEFAULT 0,
    source_release_id UUID REFERENCES data_source_releases(id) ON DELETE SET NULL,
    raw_payload JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_asset_reserve_natural_key
    ON asset_reserve_facts (asset_id, gem_asset_id, product_code, as_of_date, unit) NULLS NOT DISTINCT;
CREATE INDEX IF NOT EXISTS idx_asset_reserve_asset ON asset_reserve_facts (asset_id);
CREATE INDEX IF NOT EXISTS idx_asset_reserve_product ON asset_reserve_facts (product_code, as_of_date DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS asset_emissions_facts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id UUID REFERENCES assets(id) ON DELETE CASCADE,
    gem_asset_id TEXT,
    scope TEXT,
    emissions_value NUMERIC,
    unit TEXT,
    year INT,
    evidence_label TEXT NOT NULL DEFAULT 'reported',
    confidence_score NUMERIC(5,2) DEFAULT 0,
    source_release_id UUID REFERENCES data_source_releases(id) ON DELETE SET NULL,
    raw_payload JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_asset_emissions_natural_key
    ON asset_emissions_facts (asset_id, gem_asset_id, scope, year, unit) NULLS NOT DISTINCT;
CREATE INDEX IF NOT EXISTS idx_asset_emissions_asset ON asset_emissions_facts (asset_id);
CREATE INDEX IF NOT EXISTS idx_asset_emissions_year ON asset_emissions_facts (year DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS private_equity_exposures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    investor_entity_id TEXT REFERENCES gem_entities(entity_id) ON DELETE SET NULL,
    investor_name TEXT NOT NULL,
    exposed_entity_id TEXT REFERENCES gem_entities(entity_id) ON DELETE SET NULL,
    exposed_company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
    exposed_asset_id UUID REFERENCES assets(id) ON DELETE SET NULL,
    exposure_type TEXT NOT NULL,
    commodity TEXT,
    country_code TEXT,
    exposure_value NUMERIC,
    exposure_unit TEXT,
    share_pct NUMERIC,
    evidence_label TEXT NOT NULL DEFAULT 'reported',
    confidence_score NUMERIC(5,2) DEFAULT 0,
    source_release_id UUID REFERENCES data_source_releases(id) ON DELETE SET NULL,
    raw_payload JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_private_equity_exposures_investor ON private_equity_exposures (investor_entity_id, investor_name);
CREATE INDEX IF NOT EXISTS idx_private_equity_exposures_asset ON private_equity_exposures (exposed_asset_id) WHERE exposed_asset_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_private_equity_exposures_company ON private_equity_exposures (exposed_company_id) WHERE exposed_company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_private_equity_exposures_country_commodity ON private_equity_exposures (country_code, commodity);

CREATE TABLE IF NOT EXISTS market_balance_observations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_key TEXT NOT NULL DEFAULT 'jodi_oil',
    country_code TEXT NOT NULL,
    product_code TEXT NOT NULL,
    flow_code TEXT NOT NULL,
    unit_code TEXT NOT NULL,
    month DATE NOT NULL,
    value NUMERIC,
    evidence_label TEXT NOT NULL DEFAULT 'reported',
    confidence_score NUMERIC(5,2) DEFAULT 0.8,
    source_release_id UUID REFERENCES data_source_releases(id) ON DELETE SET NULL,
    raw_payload JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (source_key, country_code, product_code, flow_code, unit_code, month)
);

CREATE INDEX IF NOT EXISTS idx_market_balance_lookup
    ON market_balance_observations (country_code, product_code, flow_code, month DESC);
CREATE INDEX IF NOT EXISTS idx_market_balance_pressure_flows
    ON market_balance_observations (source_key, flow_code, unit_code, month DESC)
    WHERE value IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_market_balance_source_month
    ON market_balance_observations (source_key, month DESC);

CREATE TABLE IF NOT EXISTS market_pressure_scores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_key TEXT NOT NULL DEFAULT 'jodi_oil',
    country_code TEXT NOT NULL,
    product_code TEXT NOT NULL,
    month DATE NOT NULL,
    buyer_pressure_score NUMERIC(6,2) DEFAULT 0,
    supplier_availability_score NUMERIC(6,2) DEFAULT 0,
    stock_pressure_score NUMERIC(6,2) DEFAULT 0,
    import_pressure_score NUMERIC(6,2) DEFAULT 0,
    export_pressure_score NUMERIC(6,2) DEFAULT 0,
    refinery_pressure_score NUMERIC(6,2) DEFAULT 0,
    baseline_years INT DEFAULT 5,
    components JSONB DEFAULT '{}'::jsonb,
    evidence_label TEXT NOT NULL DEFAULT 'estimated',
    confidence_score NUMERIC(5,2) DEFAULT 0,
    generated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (source_key, country_code, product_code, month)
);

CREATE INDEX IF NOT EXISTS idx_market_pressure_lookup
    ON market_pressure_scores (country_code, product_code, month DESC);
CREATE INDEX IF NOT EXISTS idx_market_pressure_buyer_score
    ON market_pressure_scores (buyer_pressure_score DESC);

CREATE TABLE IF NOT EXISTS market_price_observations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_key TEXT NOT NULL,
    benchmark_key TEXT NOT NULL,
    product_code TEXT,
    country_code TEXT,
    price NUMERIC NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    unit TEXT NOT NULL,
    observed_at TIMESTAMPTZ NOT NULL,
    evidence_label TEXT NOT NULL DEFAULT 'observed',
    confidence_score NUMERIC(5,2) DEFAULT 0.8,
    source_release_id UUID REFERENCES data_source_releases(id) ON DELETE SET NULL,
    raw_payload JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_market_price_natural_key
    ON market_price_observations (source_key, benchmark_key, product_code, country_code, observed_at) NULLS NOT DISTINCT;
CREATE INDEX IF NOT EXISTS idx_market_price_lookup
    ON market_price_observations (benchmark_key, product_code, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_price_country_product
    ON market_price_observations (country_code, product_code, observed_at DESC);

CREATE TABLE IF NOT EXISTS trade_flow_facts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_key TEXT NOT NULL,
    reporter_country_code TEXT NOT NULL,
    partner_country_code TEXT,
    product_code TEXT NOT NULL,
    flow_code TEXT NOT NULL,
    month DATE,
    year INT,
    quantity NUMERIC,
    quantity_unit TEXT,
    value_usd NUMERIC,
    evidence_label TEXT NOT NULL DEFAULT 'reported',
    confidence_score NUMERIC(5,2) DEFAULT 0,
    source_release_id UUID REFERENCES data_source_releases(id) ON DELETE SET NULL,
    raw_payload JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_trade_flow_natural_key
    ON trade_flow_facts (source_key, reporter_country_code, partner_country_code, product_code, flow_code, month, year) NULLS NOT DISTINCT;
CREATE INDEX IF NOT EXISTS idx_trade_flow_lookup
    ON trade_flow_facts (reporter_country_code, partner_country_code, product_code, flow_code, month DESC NULLS LAST, year DESC NULLS LAST);

ALTER TABLE cargo_estimates
    ADD COLUMN IF NOT EXISTS payload_best NUMERIC,
    ADD COLUMN IF NOT EXISTS product_family TEXT,
    ADD COLUMN IF NOT EXISTS quantity_unit TEXT DEFAULT 'tons',
    ADD COLUMN IF NOT EXISTS evidence JSONB DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS source_payload JSONB DEFAULT '{}'::jsonb;

UPDATE cargo_estimates
SET payload_best = payload_tons
WHERE payload_best IS NULL AND payload_tons IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cargo_estimates_vessel_observed
    ON cargo_estimates (vessel_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_cargo_estimates_product
    ON cargo_estimates (product_family, observed_at DESC NULLS LAST);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cargo_estimates_ais_draft_delta
    ON cargo_estimates (vessel_id, method, observed_at)
    WHERE method = 'ais_draft_delta_v1' AND vessel_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS asset_geometries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id UUID REFERENCES assets(id) ON DELETE CASCADE,
    source_key TEXT NOT NULL,
    source_asset_id TEXT,
    geometry_type TEXT,
    geom geometry(Geometry, 4326) NOT NULL,
    geom_simplified geometry(Geometry, 4326),
    properties JSONB DEFAULT '{}'::jsonb,
    source_release_id UUID REFERENCES data_source_releases(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_asset_geometries_natural_key
    ON asset_geometries (source_key, source_asset_id, asset_id) NULLS NOT DISTINCT;
CREATE INDEX IF NOT EXISTS idx_asset_geometries_geom ON asset_geometries USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_asset_geometries_simplified ON asset_geometries USING GIST (geom_simplified);
CREATE INDEX IF NOT EXISTS idx_asset_geometries_asset ON asset_geometries (asset_id) WHERE asset_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_asset_geometries_source ON asset_geometries (source_key, source_asset_id);

CREATE TABLE IF NOT EXISTS opportunity_candidates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    opportunity_type TEXT NOT NULL,
    commodity TEXT,
    origin_country TEXT,
    destination_country TEXT,
    supplier_company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
    buyer_company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
    supplier_asset_id UUID REFERENCES assets(id) ON DELETE SET NULL,
    buyer_asset_id UUID REFERENCES assets(id) ON DELETE SET NULL,
    vessel_id UUID REFERENCES vessels(id) ON DELETE SET NULL,
    lane_id TEXT,
    score NUMERIC(6,2) DEFAULT 0,
    confidence_score NUMERIC(5,2) DEFAULT 0,
    evidence_grade TEXT NOT NULL DEFAULT 'inferred',
    supplier_reality_score NUMERIC(5,2) DEFAULT 0,
    buyer_reality_score NUMERIC(5,2) DEFAULT 0,
    market_pressure_score NUMERIC(6,2) DEFAULT 0,
    route_feasibility_score NUMERIC(5,2) DEFAULT 0,
    price_context_score NUMERIC(5,2) DEFAULT 0,
    investor_control_score NUMERIC(5,2) DEFAULT 0,
    risk_discount_score NUMERIC(5,2) DEFAULT 0,
    route_summary JSONB DEFAULT '{}'::jsonb,
    cargo_summary JSONB DEFAULT '{}'::jsonb,
    market_pressure_summary JSONB DEFAULT '{}'::jsonb,
    price_context JSONB DEFAULT '{}'::jsonb,
    evidence JSONB DEFAULT '[]'::jsonb,
    limitations TEXT[] DEFAULT '{}',
    tier TEXT NOT NULL DEFAULT 'inferred',
    status TEXT NOT NULL DEFAULT 'active',
    generated_at TIMESTAMPTZ DEFAULT now(),
    expires_at TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_opportunity_candidates_score
    ON opportunity_candidates (status, score DESC, confidence_score DESC);
CREATE INDEX IF NOT EXISTS idx_opportunity_candidates_filters
    ON opportunity_candidates (commodity, origin_country, destination_country, opportunity_type);
CREATE INDEX IF NOT EXISTS idx_opportunity_candidates_supplier ON opportunity_candidates (supplier_company_id) WHERE supplier_company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_opportunity_candidates_buyer ON opportunity_candidates (buyer_company_id) WHERE buyer_company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_opportunity_candidates_lane ON opportunity_candidates (lane_id) WHERE lane_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_contacts_raw_payload_norm
    ON contacts (
        company_id,
        COALESCE(role, ''),
        lower(COALESCE(email, '')),
        lower(COALESCE(phone, '')),
        COALESCE(metadata->>'url', '')
    )
    WHERE metadata->>'source' = 'raw_payload_normalization';

WITH raw_contacts AS (
    SELECT
        c.id AS company_id,
        NULLIF(TRIM(COALESCE(c.raw_source_payload->>'contact_name', c.raw_source_payload->>'contact')), '') AS name,
        NULLIF(lower(TRIM(c.raw_source_payload->>'email')), '') AS email,
        NULLIF(TRIM(c.raw_source_payload->>'phone'), '') AS phone,
        COALESCE(NULLIF(TRIM(c.raw_source_payload->>'supplier_type'), ''), 'official_register') AS role,
        NULLIF(TRIM(COALESCE(c.raw_source_payload->>'source_url', c.raw_source_payload->>'register_source_url')), '') AS source_url,
        CASE
            WHEN COALESCE(c.raw_source_payload->>'confidence_score', '') ~ '^[0-9]+(\.[0-9]+)?$'
                THEN (c.raw_source_payload->>'confidence_score')::numeric
            ELSE COALESCE(c.confidence_score, 0)
        END AS confidence_score
    FROM companies c
    WHERE c.raw_source_payload IS NOT NULL
)
INSERT INTO contacts (company_id, name, email, phone, role, evidence_snippet, confidence_score, verification_status, metadata)
SELECT
    company_id,
    name,
    email,
    phone,
    role,
    source_url,
    LEAST(confidence_score, 1.0),
    'source_backed',
    jsonb_build_object(
        'source', 'raw_payload_normalization',
        'contact_type', 'primary',
        'url', source_url,
        'evidence_label', 'reported'
    )
FROM raw_contacts rc
WHERE (email IS NOT NULL OR phone IS NOT NULL)
  AND NOT EXISTS (
      SELECT 1
      FROM contacts ct
      WHERE ct.company_id = rc.company_id
        AND (
            (rc.email IS NOT NULL AND lower(COALESCE(ct.email, '')) = rc.email)
            OR (rc.phone IS NOT NULL AND regexp_replace(COALESCE(ct.phone, ''), '[^0-9+]', '', 'g') = regexp_replace(rc.phone, '[^0-9+]', '', 'g'))
        )
  );

WITH raw_urls AS (
    SELECT
        c.id AS company_id,
        NULLIF(TRIM(COALESCE(c.raw_source_payload->>'website', c.raw_source_payload->>'source_url', c.raw_source_payload->>'register_source_url')), '') AS url,
        CASE
            WHEN COALESCE(c.raw_source_payload->>'confidence_score', '') ~ '^[0-9]+(\.[0-9]+)?$'
                THEN (c.raw_source_payload->>'confidence_score')::numeric
            ELSE COALESCE(c.confidence_score, 0)
        END AS confidence_score
    FROM companies c
    WHERE c.raw_source_payload IS NOT NULL
)
INSERT INTO contacts (company_id, role, evidence_snippet, confidence_score, verification_status, metadata)
SELECT
    company_id,
    'source_url',
    url,
    LEAST(confidence_score, 1.0),
    'source_backed',
    jsonb_build_object(
        'source', 'raw_payload_normalization',
        'contact_type', 'source_url',
        'url', url,
        'evidence_label', 'reported'
    )
FROM raw_urls ru
WHERE url IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
      FROM contacts ct
      WHERE ct.company_id = ru.company_id
        AND COALESCE(ct.metadata->>'url', '') = ru.url
  );

WITH raw_primary AS (
    SELECT
        c.id AS company_id,
        NULLIF(lower(TRIM(c.raw_source_payload->>'email')), '') AS email,
        NULLIF(TRIM(c.raw_source_payload->>'phone'), '') AS phone,
        NULLIF(TRIM(COALESCE(c.raw_source_payload->>'website', c.raw_source_payload->>'source_url', c.raw_source_payload->>'register_source_url')), '') AS website
    FROM companies c
    WHERE c.raw_source_payload IS NOT NULL
)
UPDATE companies c
SET
    email = CASE WHEN NULLIF(TRIM(COALESCE(c.email, '')), '') IS NULL THEN rp.email ELSE c.email END,
    phone = CASE WHEN NULLIF(TRIM(COALESCE(c.phone, '')), '') IS NULL THEN rp.phone ELSE c.phone END,
    website = CASE WHEN NULLIF(TRIM(COALESCE(c.website, '')), '') IS NULL AND rp.website ILIKE 'http%' THEN rp.website ELSE c.website END,
    updated_at = now()
FROM raw_primary rp
WHERE c.id = rp.company_id
  AND (
      (NULLIF(TRIM(COALESCE(c.email, '')), '') IS NULL AND rp.email IS NOT NULL)
      OR (NULLIF(TRIM(COALESCE(c.phone, '')), '') IS NULL AND rp.phone IS NOT NULL)
      OR (NULLIF(TRIM(COALESCE(c.website, '')), '') IS NULL AND rp.website ILIKE 'http%')
  );
