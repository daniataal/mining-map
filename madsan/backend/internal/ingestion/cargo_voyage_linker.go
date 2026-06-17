package ingestion

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

const cargoVoyageLinkerJobType = "cargo_voyage_linker"

type CargoVoyageLinkerOptions struct {
	Limit int `json:"limit,omitempty"`
}

type CargoVoyageLinkerResult struct {
	RowsUpdated    int64 `json:"rows_updated"`
	DurationMillis int64 `json:"duration_ms"`
}

func (s *Service) processCargoVoyageLinker(ctx context.Context, jobID uuid.UUID, payload []byte) error {
	opts := CargoVoyageLinkerOptions{}
	if len(payload) > 0 {
		_ = json.Unmarshal(payload, &opts)
	}
	res, err := s.LinkCargoVoyagesToOpportunities(ctx, opts)
	report, _ := json.Marshal(res)
	if err != nil {
		return s.finishIntelJob(ctx, jobID, "failed", report, err)
	}
	return s.finishIntelJob(ctx, jobID, "completed", report, nil)
}

func (s *Service) LinkCargoVoyagesToOpportunities(ctx context.Context, opts CargoVoyageLinkerOptions) (CargoVoyageLinkerResult, error) {
	started := time.Now()
	if opts.Limit <= 0 {
		opts.Limit = 5000
	}
	tag, err := s.pool.Exec(ctx, cargoVoyageLinkerSQL, opts.Limit)
	return CargoVoyageLinkerResult{
		RowsUpdated:    tag.RowsAffected(),
		DurationMillis: time.Since(started).Milliseconds(),
	}, err
}

const cargoVoyageLinkerSQL = `
WITH country_aliases AS (
	SELECT * FROM (VALUES
		('AE', 'UNITED ARAB EMIRATES'),
		('US', 'UNITED STATES'),
		('GB', 'UNITED KINGDOM'),
		('KR', 'SOUTH KOREA'),
		('SA', 'SAUDI ARABIA'),
		('CN', 'CHINA'),
		('IN', 'INDIA'),
		('SG', 'SINGAPORE')
	) AS t(iso_code, country_name)
),
linked AS (
	SELECT DISTINCT ON (oc.id)
		oc.id,
		ce.id AS cargo_estimate_id,
		voy.id AS voyage_id,
		voy.load_port_name,
		voy.load_country,
		voy.discharge_port_name,
		voy.discharge_country,
		ce.payload_tons AS payload_best,
		ce.payload_low,
		ce.payload_high,
		ce.method,
		ce.confidence_score,
		v.id AS vessel_id,
		v.name AS vessel_name
	FROM opportunity_candidates oc
	JOIN assets sa ON sa.id = oc.supplier_asset_id
	JOIN assets ba ON ba.id = oc.buyer_asset_id
	JOIN cargo_estimates ce ON ce.observed_at >= now() - interval '60 days'
	JOIN voyages voy ON voy.id = ce.voyage_id
	LEFT JOIN vessels v ON v.id = ce.vessel_id
	LEFT JOIN country_aliases cal ON cal.iso_code = oc.origin_country OR upper(cal.country_name) = upper(oc.origin_country)
	LEFT JOIN country_aliases cad ON cad.iso_code = oc.destination_country OR upper(cad.country_name) = upper(oc.destination_country)
	WHERE oc.status = 'active'
	  AND voy.load_country IS NOT NULL
	  AND voy.discharge_country IS NOT NULL
	  AND (
		upper(voy.load_country) = upper(oc.origin_country)
		OR upper(voy.load_country) = upper(COALESCE(cal.country_name, ''))
		OR upper(voy.load_country) ILIKE '%' || oc.origin_country || '%'
	  )
	  AND (
		upper(voy.discharge_country) = upper(oc.destination_country)
		OR upper(voy.discharge_country) = upper(COALESCE(cad.country_name, ''))
		OR upper(voy.discharge_country) ILIKE '%' || oc.destination_country || '%'
	  )
	ORDER BY oc.id, ce.confidence_score DESC NULLS LAST, ce.observed_at DESC
	LIMIT $1
)
UPDATE opportunity_candidates oc
SET
	cargo_voyage_linked = true,
	cargo_linkage_summary = jsonb_build_object(
		'linkage', 'voyage_backed',
		'cargo_estimate_id', l.cargo_estimate_id,
		'voyage_id', l.voyage_id,
		'vessel_id', l.vessel_id,
		'vessel_name', l.vessel_name,
		'load_port', l.load_port_name,
		'load_country', l.load_country,
		'discharge_port', l.discharge_port_name,
		'discharge_country', l.discharge_country,
		'evidence_label', 'estimated'
	),
	cargo_summary = jsonb_build_object(
		'status', 'voyage_linked',
		'message', 'Cargo estimate linked through observed voyage chain',
		'cargo_estimate_id', l.cargo_estimate_id,
		'voyage_id', l.voyage_id,
		'vessel_id', l.vessel_id,
		'vessel_name', l.vessel_name,
		'quantity', jsonb_build_object(
			'low', l.payload_low,
			'best', l.payload_best,
			'high', l.payload_high,
			'unit', 'mt',
			'method', l.method
		),
		'confidence_score', l.confidence_score,
		'evidence_label', 'estimated'
	),
	vessel_id = COALESCE(oc.vessel_id, l.vessel_id)
FROM linked l
WHERE oc.id = l.id
`
