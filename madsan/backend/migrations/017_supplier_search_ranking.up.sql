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
