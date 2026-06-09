CREATE MATERIALIZED VIEW IF NOT EXISTS map_energy_assets AS
SELECT
    a.id,
    a.name,
    a.asset_type,
    a.country_code,
    a.latitude,
    a.longitude,
    a.geom::geometry AS geom,
    a.capacity,
    a.capacity_unit,
    a.commodities_supported,
    a.confidence_score,
    a.data_quality_status,
    c.name AS operator_name
FROM assets a
LEFT JOIN companies c ON c.id = a.operator_company_id
WHERE a.latitude IS NOT NULL
  AND a.longitude IS NOT NULL
  AND a.asset_type IN (
    'tank_farm', 'terminal', 'refinery', 'pipeline', 'port', 'sts_zone', 'storage', 'berth'
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_map_energy_assets_id ON map_energy_assets(id);
CREATE INDEX IF NOT EXISTS idx_map_energy_assets_geom ON map_energy_assets USING GIST (geom);

CREATE MATERIALIZED VIEW IF NOT EXISTS map_metals_assets AS
SELECT
    a.id,
    a.name,
    a.asset_type,
    a.country_code,
    a.latitude,
    a.longitude,
    a.geom::geometry AS geom,
    a.commodities_supported,
    a.confidence_score,
    a.data_quality_status,
    c.name AS operator_name
FROM assets a
LEFT JOIN companies c ON c.id = a.operator_company_id
WHERE a.latitude IS NOT NULL
  AND a.longitude IS NOT NULL
  AND a.asset_type IN ('mine', 'smelter', 'refinery', 'processing_plant', 'port');

CREATE UNIQUE INDEX IF NOT EXISTS idx_map_metals_assets_id ON map_metals_assets(id);
CREATE INDEX IF NOT EXISTS idx_map_metals_assets_geom ON map_metals_assets USING GIST (geom);

CREATE MATERIALIZED VIEW IF NOT EXISTS map_vessels AS
SELECT
    v.id,
    v.name,
    v.imo,
    v.mmsi,
    v.vessel_type,
    v.flag_country_code,
    v.latitude,
    v.longitude,
    v.geom::geometry AS geom,
    v.course,
    v.speed_knots,
    v.destination,
    v.last_seen_at,
    v.confidence_score,
    v.data_quality_status
FROM vessels v
WHERE v.latitude IS NOT NULL AND v.longitude IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_map_vessels_id ON map_vessels(id);

-- Supplier discovery: expose evidence depth for honest ranking (confidence + evidence_count).
CREATE OR REPLACE VIEW supplier_search AS
SELECT
    c.id,
    c.name,
    c.country_code,
    c.commodities,
    c.confidence_score,
    c.data_quality_status,
    COUNT(ct.id) AS contact_count,
    (SELECT COUNT(*)::int
     FROM evidence e
     WHERE e.entity_type = 'company' AND e.entity_id = c.id) AS evidence_count
FROM companies c
LEFT JOIN contacts ct ON ct.company_id = c.id
WHERE c.company_type = 'supplier' OR 'supplier' = ANY(c.commodities)
GROUP BY c.id;

CREATE OR REPLACE VIEW company_search AS
SELECT id, name, normalized_name, country_code, company_type, confidence_score, data_quality_status
FROM companies;

CREATE OR REPLACE VIEW asset_search AS
SELECT id, name, asset_type, country_code, commodities_supported, confidence_score, data_quality_status
FROM assets;

CREATE OR REPLACE VIEW deal_verification_view AS
SELECT
    d.id,
    d.title,
    d.commodity,
    d.quantity,
    d.location_name,
    d.seller_name,
    d.verification_score,
    d.status,
    d.updated_at
FROM deals d;
