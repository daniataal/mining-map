-- Exclude seed-linked MCRs from corridor aggregate views (real-data-only trade flows).

CREATE OR REPLACE VIEW mcr_corridor_aggregates_company AS
SELECT
  shipper_name,
  consignee_name,
  commodity_family,
  COUNT(*)::int                                         AS cargo_count,
  SUM(volume_best_estimate)::double precision           AS volume_total,
  COALESCE(
    (array_agg(volume_unit ORDER BY event_date DESC NULLS LAST)
       FILTER (WHERE volume_unit IS NOT NULL))[1],
    'bbl'
  )                                                     AS volume_unit,
  AVG(confidence)::double precision                     AS avg_confidence,
  AVG(corridor_load_lat)::double precision              AS origin_lat,
  AVG(corridor_load_lng)::double precision              AS origin_lng,
  AVG(corridor_discharge_lat)::double precision         AS dest_lat,
  AVG(corridor_discharge_lng)::double precision         AS dest_lng,
  (array_agg(id ORDER BY confidence DESC NULLS LAST,
                       event_date DESC NULLS LAST))[1:5] AS sample_mcr_ids
FROM meridian_cargo_records m
WHERE corridor_load_lat IS NOT NULL
  AND corridor_load_lng IS NOT NULL
  AND corridor_discharge_lat IS NOT NULL
  AND corridor_discharge_lng IS NOT NULL
  AND confidence >= 0.5
  AND shipper_name IS NOT NULL
  AND consignee_name IS NOT NULL
  AND commodity_family IS NOT NULL
  AND NOT (
    COALESCE(m.evidence_chain::text, '') ILIKE '%seed_port_calls%'
    OR EXISTS (
      SELECT 1 FROM oil_port_calls pc
      WHERE pc.id = m.port_call_id
        AND (
          COALESCE(pc.evidence::text, '') ILIKE '%seed_port_calls%'
          OR COALESCE(pc.metadata::text, '') ILIKE '%seed_port_calls%'
        )
    )
    OR EXISTS (
      SELECT 1 FROM oil_port_calls pc
      WHERE pc.id::text = m.metadata->>'import_port_call_id'
        AND (
          COALESCE(pc.evidence::text, '') ILIKE '%seed_port_calls%'
          OR COALESCE(pc.metadata::text, '') ILIKE '%seed_port_calls%'
        )
    )
  )
GROUP BY shipper_name, consignee_name, commodity_family;

CREATE OR REPLACE VIEW mcr_corridor_aggregates_country AS
SELECT
  load_country,
  discharge_country,
  commodity_family,
  COUNT(*)::int                                         AS cargo_count,
  SUM(volume_best_estimate)::double precision           AS volume_total,
  COALESCE(
    (array_agg(volume_unit ORDER BY event_date DESC NULLS LAST)
       FILTER (WHERE volume_unit IS NOT NULL))[1],
    'bbl'
  )                                                     AS volume_unit,
  AVG(confidence)::double precision                     AS avg_confidence,
  AVG(corridor_load_lat)::double precision              AS origin_lat,
  AVG(corridor_load_lng)::double precision              AS origin_lng,
  AVG(corridor_discharge_lat)::double precision         AS dest_lat,
  AVG(corridor_discharge_lng)::double precision         AS dest_lng,
  (array_agg(id ORDER BY confidence DESC NULLS LAST,
                       event_date DESC NULLS LAST))[1:5] AS sample_mcr_ids
FROM meridian_cargo_records m
WHERE corridor_load_lat IS NOT NULL
  AND corridor_load_lng IS NOT NULL
  AND corridor_discharge_lat IS NOT NULL
  AND corridor_discharge_lng IS NOT NULL
  AND confidence >= 0.5
  AND load_country IS NOT NULL
  AND discharge_country IS NOT NULL
  AND commodity_family IS NOT NULL
  AND NOT (
    COALESCE(m.evidence_chain::text, '') ILIKE '%seed_port_calls%'
    OR EXISTS (
      SELECT 1 FROM oil_port_calls pc
      WHERE pc.id = m.port_call_id
        AND (
          COALESCE(pc.evidence::text, '') ILIKE '%seed_port_calls%'
          OR COALESCE(pc.metadata::text, '') ILIKE '%seed_port_calls%'
        )
    )
    OR EXISTS (
      SELECT 1 FROM oil_port_calls pc
      WHERE pc.id::text = m.metadata->>'import_port_call_id'
        AND (
          COALESCE(pc.evidence::text, '') ILIKE '%seed_port_calls%'
          OR COALESCE(pc.metadata::text, '') ILIKE '%seed_port_calls%'
        )
    )
  )
GROUP BY load_country, discharge_country, commodity_family;
